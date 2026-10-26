param(
    [ValidateSet('Start', 'Stop')]
    [string]$Action = 'Start'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $Python)) {
    Write-Host "Development Python is missing: $Python. Create the project virtual environment and install requirements.txt first." -ForegroundColor Red
    exit 1
}

if ($Action -eq 'Start') {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -and -not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host 'Node.js was not found. Install the project-supported Node.js release before starting the development frontend.' -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'frontend\node_modules\vite'))) {
        Write-Host "Frontend dependencies are missing. Run 'npm ci' from $ProjectRoot\frontend first." -ForegroundColor Red
        exit 1
    }
}

Push-Location $ProjectRoot
try {
    $arguments = @('-m', 'backend.dev_server')
    if ($Action -eq 'Stop') { $arguments += '--stop' }
    & $Python @arguments
    $result = $LASTEXITCODE
} catch {
    Write-Host "Workforce360 $Action failed: $($_.Exception.Message)" -ForegroundColor Red
    $result = 1
} finally {
    Pop-Location
}
exit $result
