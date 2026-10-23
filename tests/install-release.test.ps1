$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\scripts\install.ps1"

function Assert-Throws {
    param([scriptblock] $Action, [string] $Message)
    try {
        & $Action
    } catch {
        if ($_.Exception.Message -notlike "*$Message*") { throw }
        return
    }
    throw "Expected an error containing: $Message"
}

$root = Join-Path ([IO.Path]::GetTempPath()) ("ado-boost-install-test-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path "$root\source\companion\dist" -Force | Out-Null
New-Item -ItemType Directory -Path "$root\source\companion\prebuilt-extension" -Force | Out-Null
$originalLocalAppData = $env:LOCALAPPDATA
$originalPath = $env:Path
$env:LOCALAPPDATA = Join-Path $root 'local'
try {
    foreach ($file in @('cli.js', 'host.js', 'ado-boost-native-host.exe')) {
        Set-Content -LiteralPath "$root\source\companion\dist\$file" -Value 'test fixture'
    }
    Set-Content -LiteralPath "$root\source\companion\dist\cli.js" -Value 'console.log("fixture command " + process.argv.slice(2).join(" "));'
    Set-Content -LiteralPath "$root\source\companion\prebuilt-extension\manifest.json" -Value '{}'
    Compress-Archive -Path "$root\source\*" -DestinationPath "$root\fixture.zip"
    $script:release = @{
        tag_name = 'v0.2.0'
        draft = $false
        prerelease = $false
        assets = @(@{
            name = 'ado-boost-windows-0.2.0.zip'
            browser_download_url = 'https://github.com/nathan815/ADO-Boost/releases/download/v0.2.0/ado-boost-windows-0.2.0.zip'
            digest = "sha256:$((Get-FileHash "$root\fixture.zip" -Algorithm SHA256).Hash)"
        })
    }
    function Invoke-RestMethod { param($Uri, $Headers) return $script:release }
    function Invoke-WebRequest {
        param($Uri, $Headers, $OutFile, [switch] $UseBasicParsing)
        $script:downloadDirectory = Split-Path $OutFile
        Copy-Item -LiteralPath "$root\fixture.zip" -Destination $OutFile
    }
    function copilot.exe {}
    function winget.exe {
        $script:wingetCalls += ,$args
        $global:LASTEXITCODE = $script:wingetExitCode
        if ($script:wingetExitCode -eq 0) {
            if ($args -contains 'OpenJS.NodeJS.LTS') { $script:nodeVersion = 'v24.0.0'; $script:missingNode = $false }
            if ($args -contains 'GitHub.Copilot') { $script:missingCopilot = $false }
        }
    }
    function Get-Command {
        param($Name, $ErrorAction)
        if ($Name -eq 'node' -and $script:missingNode) { return }
        if ($Name -eq 'copilot.exe' -and $script:missingCopilot) { return }
        if ($Name -eq 'winget.exe' -and $script:missingWinget) { return }
        Microsoft.PowerShell.Core\Get-Command $Name -ErrorAction $ErrorAction
    }
    function Confirm-AdoBoostAction {
        param([string] $Message)
        $script:confirmations += $Message
        return -not $script:decline
    }
    function Get-AdoBoostUserPath { return $script:userPath }
    function Set-AdoBoostUserPath {
        param([string] $Value)
        if ($script:pathFailure) { throw 'PATH write failed' }
        $script:userPath = $Value
    }
    function Update-AdoBoostProcessPath {}
    function node {
        if ($args[0] -eq '--version') {
            $global:LASTEXITCODE = 0
            return $script:nodeVersion
        }
        if ($args.Count -ne 2 -or $args[1] -ne 'setup' -or -not (Test-Path -LiteralPath $args[0])) {
            throw 'Unexpected setup invocation'
        }
        $script:setupCalls++
        $global:LASTEXITCODE = $script:setupExitCode
    }
    $script:nodeVersion = 'v22.12.0'
    $script:setupCalls = 0
    $script:setupExitCode = 0
    $script:userPath = 'C:\existing'
    $script:wingetCalls = @()
    $script:confirmations = @()
    $script:wingetExitCode = 0
    Install-AdoBoost
    if ($script:setupCalls -ne 1) { throw 'Setup did not run exactly once' }
    if (Test-Path -LiteralPath $script:downloadDirectory) { throw 'Staging directory was not cleaned up' }
    $launcher = Join-Path $env:LOCALAPPDATA 'ADO Boost\bin\ado-boost.cmd'
    if (-not (Test-Path -LiteralPath $launcher)) { throw 'CLI command was not installed' }
    if ($script:userPath -ne "C:\existing;$env:LOCALAPPDATA\ADO Boost\bin") { throw 'User PATH was not preserved and extended' }
    if ($script:wingetCalls.Count -ne 0) { throw 'Installed existing prerequisites again' }
    if ((Get-Content -LiteralPath $launcher -Raw) -notlike '*%~dp0..\cli\*') { throw 'CLI launcher did not use its persistent package' }
    $result = & $launcher doctor
    if ($LASTEXITCODE -ne 0 -or $result -ne 'fixture command doctor') { throw 'Installed CLI command did not run after staging cleanup' }

    $script:setupExitCode = 1
    Assert-Throws { Install-AdoBoost } 'setup failed with exit code 1'
    if (Test-Path -LiteralPath $script:downloadDirectory) { throw 'Failed setup staging directory was not cleaned up' }
    if ($script:userPath.Split(';').Count -ne 2) { throw 'Upgrade duplicated the user PATH entry' }
    $script:setupExitCode = 0
    $script:setupCalls = 0

    $digest = $script:release.assets[0].digest
    $script:release.assets[0].digest = 'sha256:' + ('0' * 64)
    Assert-Throws { Install-AdoBoost } 'SHA-256 verification failed'
    if ($script:setupCalls -ne 0) { throw 'Setup ran with an invalid checksum' }
    if (Test-Path -LiteralPath $script:downloadDirectory) { throw 'Checksum failure staging directory was not cleaned up' }
    $script:release.assets[0].digest = $null
    Assert-Throws { Get-AdoBoostReleaseAsset $script:release } 'missing its GitHub SHA-256'
    $script:release.assets[0].digest = $digest

    $script:release.assets[0].browser_download_url = 'https://example.com/package.zip'
    Assert-Throws { Get-AdoBoostReleaseAsset $script:release } 'unexpected download URL'
    $script:release.assets[0].browser_download_url = 'https://github.com/nathan815/ADO-Boost/releases/download/v0.2.0/ado-boost-windows-0.2.0.zip'
    $script:release.draft = $true
    Assert-Throws { Get-AdoBoostReleaseAsset $script:release } 'published stable'
    $script:release.draft = $false
    $script:release.prerelease = $true
    Assert-Throws { Get-AdoBoostReleaseAsset $script:release } 'published stable'
    $script:release.prerelease = $false
    $script:release.assets = @()
    Assert-Throws { Get-AdoBoostReleaseAsset $script:release } 'exactly one'

    foreach ($unsupported in @('v20.18.0', 'v21.9.0', 'v22.11.0')) {
        $script:nodeVersion = $unsupported
        Initialize-AdoBoostPrerequisites
        if (-not (Test-AdoBoostNode)) { throw 'Unsupported Node was not upgraded' }
    }
    $script:missingNode = $true
    $script:missingCopilot = $true
    $script:wingetCalls = @()
    Initialize-AdoBoostPrerequisites
    if ($script:wingetCalls.Count -ne 2) { throw 'Missing prerequisites were not both installed' }
    foreach ($call in $script:wingetCalls) {
        if ($call -notcontains '--exact' -or $call -notcontains '--interactive' -or $call -contains '--accept-package-agreements') {
            throw 'Prerequisite installation did not preserve exact selection and user approvals'
        }
    }
    $script:missingNode = $true
    $script:decline = $true
    $script:wingetCalls = @()
    Assert-Throws { Initialize-AdoBoostPrerequisites } 'installation declined'
    if ($script:wingetCalls.Count -ne 0) { throw 'Installed a declined prerequisite' }
    $script:decline = $false
    $script:missingWinget = $true
    Assert-Throws { Initialize-AdoBoostPrerequisites } 'WinGet is unavailable'
    $script:missingWinget = $false
    $script:wingetExitCode = 1
    Assert-Throws { Initialize-AdoBoostPrerequisites } 'installation failed with exit code 1'
    $script:wingetExitCode = 0
    $script:missingNode = $false
    $script:decline = $true
    Assert-Throws { Install-AdoBoostCommand -Package "$root\source" -InstallRoot (Join-Path $env:LOCALAPPDATA 'ADO Boost') } 'installation declined'
    $script:decline = $false
    $previousLauncher = Get-Content -LiteralPath $launcher -Raw
    $script:userPath = 'C:\existing'
    $script:pathFailure = $true
    Assert-Throws { Install-AdoBoostCommand -Package "$root\source" -InstallRoot (Join-Path $env:LOCALAPPDATA 'ADO Boost') } 'PATH write failed'
    if ((Get-Content -LiteralPath $launcher -Raw) -cne $previousLauncher) { throw 'Failed upgrade did not restore the CLI launcher' }
    $script:pathFailure = $false
    Set-Content -LiteralPath $launcher -Value 'user-owned command'
    Assert-Throws { Install-AdoBoostCommand -Package "$root\source" -InstallRoot (Join-Path $env:LOCALAPPDATA 'ADO Boost') } 'unowned command'
    [IO.File]::WriteAllText($launcher, $previousLauncher)
    $script:nodeVersion = 'v22.12.0'
    Remove-Item -LiteralPath "$root\source\companion\dist\host.js"
    Compress-Archive -Path "$root\source\*" -DestinationPath "$root\incomplete.zip"
    Copy-Item -LiteralPath "$root\incomplete.zip" -Destination "$root\fixture.zip" -Force
    $script:release.assets = @(@{
        name = 'ado-boost-windows-0.2.0.zip'
        browser_download_url = 'https://github.com/nathan815/ADO-Boost/releases/download/v0.2.0/ado-boost-windows-0.2.0.zip'
        digest = "sha256:$((Get-FileHash "$root\fixture.zip" -Algorithm SHA256).Hash)"
    })
    Assert-Throws { Install-AdoBoost } 'missing companion\dist\host.js'
    if ($script:setupCalls -ne 0) { throw 'Setup ran with an incomplete package' }
    if (Test-Path -LiteralPath $script:downloadDirectory) { throw 'Incomplete package staging directory was not cleaned up' }
    Write-Host 'Installer tests passed.'
} finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    $env:Path = $originalPath
    Remove-Item -LiteralPath $root -Recurse -Force
}
