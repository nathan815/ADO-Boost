#Requires -Version 5.1

param([switch] $FromExtension)

function Get-AdoBoostReleaseAsset {
    param([Parameter(Mandatory = $true)] $Release)

    if ($Release.draft -or $Release.prerelease -or $Release.tag_name -notmatch '^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') {
        throw 'Expected a published stable ADO Boost release with a vMAJOR.MINOR.PATCH tag.'
    }

    $name = "ado-boost-windows-$($Release.tag_name.Substring(1)).zip"
    $assets = @($Release.assets | Where-Object { $_.name -ceq $name })
    if ($assets.Count -ne 1) {
        throw "Release $($Release.tag_name) must contain exactly one $name asset."
    }
    $asset = $assets[0]
    $expectedUrl = "https://github.com/nathan815/ADO-Boost/releases/download/$($Release.tag_name)/$name"
    if ($asset.browser_download_url -cne $expectedUrl) {
        throw 'The Windows package has an unexpected download URL.'
    }
    if ($asset.digest -notmatch '^sha256:[a-fA-F0-9]{64}$') {
        throw 'The Windows package is missing its GitHub SHA-256 digest.'
    }
    return $asset
}

function Confirm-AdoBoostAction {
    param([string] $Message)
    return (Read-Host "$Message [y/N]") -match '^(?i:y|yes)$'
}

function Update-AdoBoostProcessPath {
    $paths = @($env:Path, [Environment]::GetEnvironmentVariable('Path', 'Machine'), (Get-AdoBoostUserPath)) | Where-Object { $_ }
    $env:Path = $paths -join ';'
}

function Get-AdoBoostUserPath {
    return [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Set-AdoBoostUserPath {
    param([string] $Value)
    [Environment]::SetEnvironmentVariable('Path', $Value, 'User')
}

function Test-AdoBoostNode {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        return $false
    }
    $nodeVersion = & node --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        throw 'Could not determine the installed Node.js version.'
    }
    $version = [version]$nodeVersion.Substring(1)
    return ($version.Major -eq 20 -and $version -ge [version]'20.19.0') -or $version -ge [version]'22.12.0'
}

function Install-AdoBoostPrerequisite {
    param([string] $Name, [string] $Id)
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "WinGet is unavailable. Install $Name from its official website, open a new terminal, and retry."
    }
    if (-not (Confirm-AdoBoostAction "Install or upgrade $Name using winget install --exact --id $Id --source winget?")) {
        throw "$Name installation declined. ADO Boost installation stopped."
    }
    & winget.exe install --exact --id $Id --source winget --interactive
    if ($LASTEXITCODE -ne 0) {
        throw "$Name installation failed with exit code $LASTEXITCODE. Resolve the WinGet error and retry."
    }
    Update-AdoBoostProcessPath
}

function Initialize-AdoBoostPrerequisites {
    if (-not (Test-AdoBoostNode)) {
        Install-AdoBoostPrerequisite -Name 'Node.js LTS (22.12 or newer)' -Id 'OpenJS.NodeJS.LTS'
        if (-not (Test-AdoBoostNode)) {
            throw 'A supported Node.js runtime is still unavailable. Open a new terminal and retry.'
        }
    }
    if (-not (Get-Command copilot.exe -ErrorAction SilentlyContinue)) {
        Install-AdoBoostPrerequisite -Name 'GitHub Copilot CLI' -Id 'GitHub.Copilot'
        if (-not (Get-Command copilot.exe -ErrorAction SilentlyContinue)) {
            throw 'GitHub Copilot CLI is still unavailable. Open a new terminal and retry.'
        }
    }
}

function Install-AdoBoostCommand {
    param([string] $Package, [string] $InstallRoot)
    $bin = Join-Path $InstallRoot 'bin'
    $launcher = Join-Path $bin 'ado-boost.cmd'
    $marker = "@echo off`r`nrem ADO Boost managed CLI`r`n"
    if (Test-Path -LiteralPath $launcher) {
        if (-not ([IO.File]::ReadAllText($launcher)).StartsWith($marker)) {
            throw "Refusing to replace an unowned command: $launcher"
        }
    }
    if (-not (Confirm-AdoBoostAction "Install ADO Boost CLI in $InstallRoot and add $bin to your user PATH?")) {
        throw 'ADO Boost CLI installation declined.'
    }
    $id = [Guid]::NewGuid().ToString('N')
    $destination = Join-Path $InstallRoot "cli\$id"
    $previousLauncher = if (Test-Path -LiteralPath $launcher) { [IO.File]::ReadAllText($launcher) } else { $null }
    $previousPath = Get-AdoBoostUserPath
    $temporaryLauncher = Join-Path $bin "$id.cmd"
    try {
        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Copy-Item -Path (Join-Path $Package '*') -Destination $destination -Recurse
        New-Item -ItemType Directory -Path $bin -Force | Out-Null
        $command = $marker + "node `"%~dp0..\cli\$id\companion\dist\cli.js`" %*`r`n"
        [IO.File]::WriteAllText($temporaryLauncher, $command, [Text.Encoding]::ASCII)
        Move-Item -LiteralPath $temporaryLauncher -Destination $launcher -Force
        if (-not (@($previousPath -split ';' | ForEach-Object { $_.Trim().TrimEnd('\') }) -contains $bin.TrimEnd('\'))) {
            Set-AdoBoostUserPath -Value (($previousPath, $bin | Where-Object { $_ }) -join ';')
        }
    } catch {
        if ($null -ne $previousLauncher) {
            [IO.File]::WriteAllText($launcher, $previousLauncher, [Text.Encoding]::ASCII)
        } elseif (Test-Path -LiteralPath $launcher) {
            Remove-Item -LiteralPath $launcher -Force
        }
        if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
        throw
    } finally {
        if (Test-Path -LiteralPath $temporaryLauncher) { Remove-Item -LiteralPath $temporaryLauncher -Force }
    }
    $env:Path = "$bin;$env:Path"
    Write-Host "ADO Boost CLI installed. New terminals can run ado-boost doctor, ado-boost login, and ado-boost setup."
    return (Join-Path $destination 'companion\dist\cli.js')
}

function Install-AdoBoost {
    param([switch] $FromExtension)

    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'The ADO Boost Copilot companion requires Windows.'
    }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is not available.' }
    Initialize-AdoBoostPrerequisites
    $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'ADO-Boost-Installer' }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/nathan815/ADO-Boost/releases/latest' -Headers $headers
    $asset = Get-AdoBoostReleaseAsset -Release $release
    $staging = Join-Path ([IO.Path]::GetTempPath()) ("ado-boost-install-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -ErrorAction Stop | Out-Null
    try {
        $archive = Join-Path $staging $asset.name
        Write-Host "Downloading ADO Boost $($release.tag_name)..."
        Invoke-WebRequest -Uri $asset.browser_download_url -Headers $headers -OutFile $archive -UseBasicParsing
        $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
        if ($hash -ine $asset.digest.Substring(7)) {
            throw 'Windows package SHA-256 verification failed. Setup was not run.'
        }
        $package = Join-Path $staging 'package'
        Expand-Archive -LiteralPath $archive -DestinationPath $package
        $cli = Join-Path $package 'companion\dist\cli.js'
        foreach ($relativePath in @('companion\dist\cli.js', 'companion\dist\host.js', 'companion\dist\ado-boost-native-host.exe', 'companion\prebuilt-extension\manifest.json')) {
            if (-not (Test-Path -LiteralPath (Join-Path $package $relativePath) -PathType Leaf)) {
                throw "Windows package is missing $relativePath. Setup was not run."
            }
        }
        $cli = Install-AdoBoostCommand -Package $package -InstallRoot (Join-Path $env:LOCALAPPDATA 'ADO Boost')
        Write-Host 'Setup handles Copilot sign-in when needed, account selection, and confirmation of the per-user installation.'
        if (-not $FromExtension) {
            Write-Host 'After setup completes, open edge://extensions, enable Developer mode, and select Load unpacked.'
            Write-Host 'Choose: %LOCALAPPDATA%\ADO Boost\extension'
        }
        Write-Host 'Then enable the desired Copilot features in ADO Boost settings.'
        $setupArguments = @('setup')
        if ($FromExtension) { $setupArguments += '--from-extension' }
        & node $cli @setupArguments
        if ($LASTEXITCODE -ne 0) {
            throw "ADO Boost setup failed with exit code $LASTEXITCODE."
        }
    } finally {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction Stop
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Install-AdoBoost -FromExtension:$FromExtension
}
