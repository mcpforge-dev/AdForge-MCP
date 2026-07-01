param(
    [switch]$NpmMode
)

$ErrorActionPreference = "Stop"

function Test-Command($Name) {
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "HolyMedia MCP OpenHands launcher" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"

$hasDocker = Test-Command "docker"

if (-not $NpmMode) {
    if (-not $hasDocker) {
        throw "Docker Desktop is required for the default sandboxed OpenHands launch."
    }

    $dockerVersion = (& docker --version).Trim()
    Write-Host "Docker: $dockerVersion"

    $openhandsHome = Join-Path $env:USERPROFILE ".openhands"
    New-Item -ItemType Directory -Force -Path $openhandsHome | Out-Null

    Write-Host ""
    Write-Host "Starting OpenHands Agent Canvas in Docker..." -ForegroundColor Cyan
    Write-Host "Mounted project: /projects/mcp-for-ads"
    Write-Host "Do not paste secrets into OpenHands chats. Keep .env and tokens out of commits." -ForegroundColor Yellow
    Write-Host ""

    docker rm -f openhands-agent-canvas 2>$null | Out-Null
    docker run -d `
        --name openhands-agent-canvas `
        -p 8000:8000 `
        -v "${openhandsHome}:/home/openhands/.openhands" `
        -v "${repoRoot}:/projects/mcp-for-ads" `
        ghcr.io/openhands/agent-canvas:latest | Out-Host

    Write-Host ""
    Write-Host "OpenHands is starting at http://127.0.0.1:8000" -ForegroundColor Green
    Write-Host "Check logs with: docker logs -f openhands-agent-canvas"
    exit 0
}

if (-not (Test-Command "node")) {
    throw "Node.js is required for -NpmMode. Install Node.js 22.12 or newer."
}

$nodeVersion = (& node --version).Trim()
Write-Host "Node: $nodeVersion"

if (-not (Test-Command "npm.cmd")) {
    throw "npm.cmd was not found. Reinstall Node.js or add it to PATH."
}

Write-Host ""
Write-Host "Starting OpenHands Agent Canvas through npm..." -ForegroundColor Cyan
Write-Host "NpmMode runs on the host machine and is less isolated than Docker." -ForegroundColor Yellow

npm.cmd exec --yes --package @openhands/agent-canvas -- agent-canvas
