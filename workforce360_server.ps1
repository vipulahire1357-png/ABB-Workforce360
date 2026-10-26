param(
    [ValidateSet('Start', 'Stop')]
    [string]$Action = 'Start',
    [ValidateRange(1024, 65535)]
    [int]$Port = 8000
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$FrontendIndex = Join-Path $ProjectRoot 'frontend\dist\index.html'
$RunDirectory = Join-Path $ProjectRoot 'data\run'
$StatePath = Join-Path $RunDirectory "workforce360-$Port.json"
$StdoutPath = Join-Path $RunDirectory "workforce360-$Port.out.log"
$StderrPath = Join-Path $RunDirectory "workforce360-$Port.error.log"
$Mutex = $null
$HasMutex = $false
$ManagedProcess = $null
$StartedHere = $false
$BackendReady = $false
$ExitCode = 0

function Get-ManagedBackend {
    if (-not (Test-Path -LiteralPath $StatePath)) { return $null }

    try {
        $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
        $process = Get-Process -Id ([int]$state.ProcessId) -ErrorAction SilentlyContinue
    } catch {
        throw "Could not read the Workforce360 process record at $StatePath. Do not delete it until its process is checked."
    }

    if (-not $process) {
        Remove-Item -LiteralPath $StatePath -Force
        return $null
    }

    $expectedPython = [IO.Path]::GetFullPath($Python)
    $actualPython = [IO.Path]::GetFullPath($process.Path)
    $expectedStart = [DateTime]::Parse($state.StartTimeUtc).ToUniversalTime()
    $actualStart = $process.StartTime.ToUniversalTime()
    if (-not $actualPython.Equals($expectedPython, [StringComparison]::OrdinalIgnoreCase) -or
        [Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -gt 2 -or
        [IO.Path]::GetFullPath([string]$state.ProjectRoot) -ne [IO.Path]::GetFullPath($ProjectRoot)) {
        throw "The recorded process ID no longer matches this Workforce360 backend. It was left untouched; inspect $StatePath before retrying."
    }

    return $process
}

function Test-BackendHealth {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        return ($response.status -eq 'ok')
    } catch {
        return $false
    }
}

function Wait-BackendHealth {
    param([System.Diagnostics.Process]$Process, [int]$Seconds = 30)
    for ($attempt = 0; $attempt -lt ($Seconds * 2); $attempt++) {
        $Process.Refresh()
        if ($Process.HasExited) { return $false }
        if (Test-BackendHealth) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Save-ProcessRecord {
    param([System.Diagnostics.Process]$Process)
    $record = [ordered]@{
        ProcessId = $Process.Id
        StartTimeUtc = $Process.StartTime.ToUniversalTime().ToString('o')
        ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
        Python = [IO.Path]::GetFullPath($Python)
        Port = $Port
    }
    $temporaryRecord = "$StatePath.tmp"
    $record | ConvertTo-Json | Set-Content -LiteralPath $temporaryRecord -Encoding UTF8
    Move-Item -LiteralPath $temporaryRecord -Destination $StatePath -Force
}

function Stop-ManagedBackend {
    $process = Get-ManagedBackend
    if (-not $process) {
        Write-Host 'No managed Workforce360 backend is running.'
        return
    }

    $process.Kill()
    if (-not $process.WaitForExit(10000)) {
        throw 'The Workforce360 backend did not stop within 10 seconds.'
    }
    Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    Write-Host 'Stopped the Workforce360 backend.'
}

function Get-LanAddress {
    $candidate = $null
    try {
        $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop |
            Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
        if ($route) {
            $candidate = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254*' } |
                Select-Object -First 1 -ExpandProperty IPAddress
        }
    } catch { }

    if (-not $candidate) {
        try {
            $candidate = Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
                Select-Object -First 1 -ExpandProperty IPAddress
        } catch { }
    }

    if (-not $candidate) {
        try {
            $candidate = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) |
                Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } |
                ForEach-Object { $_.IPAddressToString } |
                Where-Object { $_ -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
                Select-Object -First 1
        } catch { }
    }

    if ($candidate) { return $candidate }
    return '127.0.0.1'
}

try {
    $Mutex = [Threading.Mutex]::new($false, 'Local\ABBWorkforce360Manager')
    try {
        $HasMutex = $Mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $HasMutex = $true
    }
    if (-not $HasMutex) { throw 'Another Workforce360 start or stop operation is already in progress.' }

    if ($Action -eq 'Start' -and -not (Test-Path -LiteralPath $Python)) {
        throw "The project virtual environment is missing: $Python. Install the project requirements first."
    }
    New-Item -ItemType Directory -Path $RunDirectory -Force | Out-Null

    if ($Action -eq 'Stop') {
        Stop-ManagedBackend
    } else {
        $ManagedProcess = Get-ManagedBackend
        if ($ManagedProcess) {
            if (-not (Test-BackendHealth)) {
                throw "The managed backend process is still running but its health check failed. Check $StderrPath. No duplicate was started."
            }
            $BackendReady = $true
            Write-Host 'Workforce360 backend is already running; reusing it.'
        } else {
            $portProbe = $null
            try {
                $portProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $Port)
                $portProbe.Start()
            } catch {
                throw "Port $Port is already in use by a process not managed by this launcher. It was left untouched."
            } finally {
                if ($portProbe) { $portProbe.Stop() }
            }

            if (-not (Test-Path -LiteralPath $FrontendIndex)) {
                $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
                if (-not $npm) { throw 'The built frontend is missing and npm is unavailable. Install Node.js, then run npm ci in frontend.' }
                Push-Location (Join-Path $ProjectRoot 'frontend')
                try {
                    & $npm.Source run build
                    if ($LASTEXITCODE -ne 0) { throw 'The React production build failed. Resolve the build error and try again.' }
                } finally {
                    Pop-Location
                }
            }

            if (Test-Path -LiteralPath $StderrPath) { Clear-Content -LiteralPath $StderrPath }
            if (Test-Path -LiteralPath $StdoutPath) { Clear-Content -LiteralPath $StdoutPath }
            $ManagedProcess = Start-Process -FilePath $Python `
                -ArgumentList @('-m', 'uvicorn', 'backend.main:app', '--host', '0.0.0.0', '--port', [string]$Port, '--no-access-log') `
                -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath
            $StartedHere = $true
            Save-ProcessRecord -Process $ManagedProcess

            if (-not (Wait-BackendHealth -Process $ManagedProcess -Seconds 30)) {
                $ManagedProcess.Refresh()
                $diagnostics = ''
                if (Test-Path -LiteralPath $StderrPath) { $diagnostics = Get-Content -LiteralPath $StderrPath -Raw }
                if ($ManagedProcess.HasExited) {
                    throw "Backend exited before becoming healthy. Check project configuration. $diagnostics"
                }
                throw "Backend did not become healthy within 30 seconds. Check $StderrPath."
            }
            $BackendReady = $true
            Write-Host 'Workforce360 backend started and passed its health check.' -ForegroundColor Green
        }

        $lanIp = Get-LanAddress
        $url = "http://${lanIp}:$Port"
        try {
            Start-Process -FilePath $url
            Write-Host "Opened $url in the default browser."
        } catch {
            Write-Host "Backend is ready at $url, but Windows could not open the default browser: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        Write-Host 'The backend keeps running after the browser or this launcher closes.'
        Write-Host "Run start_workforce360.bat /stop to stop this managed backend."
        if ($lanIp -eq '127.0.0.1') {
            Write-Host 'No LAN IPv4 address was detected. Other laptops need a reachable server LAN IP and an inbound firewall rule for this port.' -ForegroundColor Yellow
        } else {
            Write-Host "Other laptops on the same LAN can open $url. Allow inbound TCP $Port on the Windows Private firewall profile if needed."
        }
    }
} catch {
    Write-Host "Workforce360 $Action failed: $($_.Exception.Message)" -ForegroundColor Red
    $ExitCode = 1
} finally {
    if ($StartedHere -and -not $BackendReady -and $ManagedProcess) {
        try {
            $ManagedProcess.Refresh()
            if (-not $ManagedProcess.HasExited) {
                $ManagedProcess.Kill()
                $ManagedProcess.WaitForExit(10000) | Out-Null
            }
        } catch { }
        Remove-Item -LiteralPath $StatePath -Force -ErrorAction SilentlyContinue
    }
    if ($HasMutex -and $Mutex) {
        try { $Mutex.ReleaseMutex() } catch { }
    }
    if ($Mutex) { $Mutex.Dispose() }
}

exit $ExitCode
