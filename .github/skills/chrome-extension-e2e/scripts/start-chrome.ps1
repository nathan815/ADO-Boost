[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 9223,
    [string]$ProfileDirectory = (Join-Path $env:LOCALAPPDATA 'ADOBoost\ChromeDebug9223'),
    [string]$ChromePath
)

$ErrorActionPreference = 'Stop'
$profilePath = [IO.Path]::GetFullPath($ProfileDirectory)
$normalProfile = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'))
if ($profilePath.TrimEnd('\') -eq $normalProfile -or $profilePath.StartsWith("$normalProfile\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use a dedicated debug profile, not the regular Chrome user-data directory.'
}

$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -eq $Port })
if ($listeners.Count) {
    if ($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }) {
        throw "Port $Port is not restricted to loopback. Do not use a network-exposed browser debug endpoint."
    }
    $processIds = $listeners.OwningProcess | Select-Object -Unique
    foreach ($processId in $processIds) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
        $escapedPath = [regex]::Escape($profilePath)
        $profilePattern = "--user-data-dir=(?:`"$escapedPath`"|$escapedPath)(?:\s|$)"
        if ($owner.Name -ne 'chrome.exe' -or $owner.CommandLine -notmatch $profilePattern -or $owner.CommandLine -notmatch "--remote-debugging-port=$Port(?:\s|$)") {
            throw "Port $Port is owned by another process/profile. Choose a separate port and dedicated profile; do not terminate it."
        }
    }
} else {
    if (!$ChromePath) {
        $candidates = @(
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
        )
        $ChromePath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (!$ChromePath -or !(Test-Path -LiteralPath $ChromePath -PathType Leaf)) {
        throw 'Installed Google Chrome was not found. Pass -ChromePath to its existing executable.'
    }
    $arguments = @(
        '--remote-debugging-address=127.0.0.1',
        "--remote-debugging-port=$Port",
        "--user-data-dir=`"$profilePath`"",
        '--enable-unsafe-extension-debugging',
        '--no-first-run',
        '--no-default-browser-check'
    )
    $process = Start-Process -FilePath $ChromePath -ArgumentList $arguments -PassThru
    Write-Output "Started isolated Chrome (PID $($process.Id))."
}

$endpoint = "http://127.0.0.1:$Port/json/version"
$deadline = [DateTime]::UtcNow.AddSeconds(20)
$lastError = $null
do {
    try {
        $version = Invoke-RestMethod -Uri $endpoint -TimeoutSec 2
        if ($version.Browser -notmatch '^(Chrome|Chromium)/' -or !$version.webSocketDebuggerUrl) {
            throw "The endpoint at port $Port is not a Chrome browser CDP endpoint."
        }
        Write-Output "Chrome ready: $($version.Browser)"
        Write-Output "Profile: $profilePath"
        Write-Output "CDP: http://127.0.0.1:$Port"
        return
    } catch [System.Net.Http.HttpRequestException] {
        $lastError = $_.Exception.Message
    } catch [System.Net.WebException] {
        $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deadline)
throw "Chrome did not become responsive at $endpoint. Last connection error: $lastError"
