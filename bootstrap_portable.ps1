param([switch]$Stop)

$ErrorActionPreference = 'Stop'
$repositoryRoot = $PSScriptRoot
$portableRoot = Join-Path $repositoryRoot 'portable_windows'
$packageName = 'ABB_Workforce360'
$portablePackage = Join-Path $portableRoot $packageName
$portableLauncher = Join-Path $portablePackage 'run_app.bat'
$repository = 'vipulahire1357-png/ABB-Workforce360'
$assetName = 'ABB_Workforce360_Portable_Windows.zip'

if ($Stop) {
    if (-not (Test-Path -LiteralPath $portableLauncher)) {
        Write-Host 'No local portable Workforce360 instance is available to stop.'
        exit 0
    }
    Write-Host 'Requesting shutdown of the local portable Workforce360 instance...'
    Push-Location $portablePackage
    try {
        & $portableLauncher /stop
        if ($LASTEXITCODE -ne 0) { throw "The portable launcher exited with code $LASTEXITCODE while stopping." }
    }
    finally {
        Pop-Location
    }
    exit 0
}

if (-not (Test-Path -LiteralPath $portableLauncher)) {
    if (Test-Path -LiteralPath $portablePackage) {
        throw "The local portable folder exists but is incomplete: $portablePackage. It was left untouched. Back it up or rename it, then run this launcher again."
    }

    $null = New-Item -ItemType Directory -Path $portableRoot -Force
    $temporaryId = [Guid]::NewGuid().ToString('N')
    $archivePath = Join-Path $env:TEMP "${packageName}_$temporaryId.zip"
    $stagingPath = Join-Path $portableRoot ".${packageName}_$temporaryId"
    try {
        $githubCli = Get-Command gh.exe -ErrorAction SilentlyContinue
        if (-not $githubCli) {
            throw "This repository is private, so the release asset cannot be downloaded anonymously. Install GitHub CLI, run 'gh auth login --hostname github.com --web' with an account that can access $repository, then run this launcher again."
        }
        & $githubCli.Source auth status --hostname github.com *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub CLI is not authenticated. Run 'gh auth login --hostname github.com --web' with an account that can access $repository, then run this launcher again."
        }

        Write-Host 'Downloading the Workforce360 portable runtime from the latest GitHub Release...'
        & $githubCli.Source release download --repo $repository --pattern $assetName --output $archivePath
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub CLI could not download '$assetName'. Check that your authenticated account has access to $repository and that the latest Release contains this asset."
        }
        if (-not (Test-Path -LiteralPath $archivePath) -or (Get-Item -LiteralPath $archivePath).Length -lt 1024) {
            throw "The GitHub Release download was empty or incomplete. Confirm that the latest Release has the '$assetName' asset."
        }

        New-Item -ItemType Directory -Path $stagingPath | Out-Null
        Expand-Archive -LiteralPath $archivePath -DestinationPath $stagingPath
        $stagedLauncher = Join-Path (Join-Path $stagingPath $packageName) 'run_app.bat'
        if (-not (Test-Path -LiteralPath $stagedLauncher)) {
            throw "The ZIP did not contain $packageName\run_app.bat. The incomplete download was not installed."
        }

        Move-Item -LiteralPath (Join-Path $stagingPath $packageName) -Destination $portablePackage
        Write-Host "Portable runtime installed at $portablePackage"
    }
    catch {
        throw "Could not prepare the Workforce360 portable runtime. Check network access and the latest GitHub Release asset '$assetName'. Details: $($_.Exception.Message)"
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
