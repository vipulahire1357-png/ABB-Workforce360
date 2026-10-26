$ErrorActionPreference = 'Stop'

$repositoryRoot = $PSScriptRoot
$portableRoot = Join-Path $repositoryRoot 'portable_windows'
$packageName = 'ABB_Workforce360'
$portablePackage = Join-Path $portableRoot $packageName
$portableLauncher = Join-Path $portablePackage 'run_app.bat'
$assetName = 'ABB_Workforce360_Portable_Windows.zip'
$downloadUrl = "https://github.com/vipulahire1357-png/ABB-Workforce360/releases/latest/download/$assetName"

if (-not (Test-Path -LiteralPath $portableLauncher)) {
    if (Test-Path -LiteralPath $portablePackage) {
        throw "The local portable folder exists but is incomplete: $portablePackage. It was left untouched. Back it up or rename it, then run this launcher again."
    }

    $null = New-Item -ItemType Directory -Path $portableRoot -Force
    $temporaryId = [Guid]::NewGuid().ToString('N')
    $archivePath = Join-Path $env:TEMP "${packageName}_$temporaryId.zip"
    $stagingPath = Join-Path $portableRoot ".${packageName}_$temporaryId"
    try {
        Write-Host "Downloading the Workforce360 portable runtime from the latest GitHub Release..."
        Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $archivePath -TimeoutSec 180
        if (-not (Test-Path -LiteralPath $archivePath) -or (Get-Item -LiteralPath $archivePath).Length -lt 1024) {
            throw 'The GitHub Release download was empty or incomplete. Confirm that the latest Release has a completed portable ZIP asset.'
        }

        New-Item -ItemType Directory -Path $stagingPath | Out-Null
        Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingPath
        $stagedLauncher = Join-Path (Join-Path $stagingPath $packageName) 'run_app.bat'
        if (-not (Test-Path -LiteralPath $stagedLauncher)) {
            throw "The downloaded ZIP did not contain $packageName\run_app.bat. The incomplete download was not installed."
        }

        Move-Item -LiteralPath (Join-Path $stagingPath $packageName) -Destination $portablePackage
        Write-Host "Portable runtime installed at $portablePackage"
    }
    catch {
        throw "Could not prepare the Workforce360 portable runtime. Check your internet connection and the latest GitHub Release asset '$assetName'. Details: $($_.Exception.Message)"
    }
    finally {
        Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not (Test-Path -LiteralPath $portableLauncher)) {
    throw "The Workforce360 portable launcher is missing: $portableLauncher"
}

Write-Host 'Starting ABB Workforce360...'
Push-Location $portablePackage
try {
    & $portableLauncher
    if ($LASTEXITCODE -ne 0) {
        throw "The portable Workforce360 launcher exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
