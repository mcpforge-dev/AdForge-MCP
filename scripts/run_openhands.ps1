param(
    [switch]$AllowNoDocker
)

$ErrorActionPreference = "Stop"

function Test-Command($Name) {
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Write-Host "HolyMedia MCP OpenHands launcher" -ForegroundColor Cyan
Write-Host "Repository: $repoRoot"

if (-not (Test-Command "node")) {
    throw "Node.js is required. Install Node.js 22.12 or newer."
}

$nodeVersion = (& node --version).Trim()
Write-Host "Node: $nodeVersion"

if (-not (Test-Command "npm.cmd")) {
    throw "npm.cmd was not found. Reinstall Node.js or add it to PATH."
}

$hasDocker = Test-Command "docker"
if ($hasDocker) {
    $dockerVersion = (& docker --version).Trim()
    Write-Host "Docker: $dockerVersion"
} else {
    Write-Warning "Docker was not found in this shell."
    Write-Warning "OpenHands can run without Docker, but that gives the agent broader filesystem access."
    if (-not $AllowNoDocker) {
        Write-Host ""
        Write-Host "Recommended next step:" -ForegroundColor Yellow
        Write-Host "1. Install Docker Desktop with WSL 2 integration."
        Write-Host "2. Run this script again."
        Write-Host ""
        Write-Host "If you still want to start Agent Canvas without Docker, run:"
        Write-Host "powershell -ExecutionPolicy Bypass -File scripts\\run_openhands.ps1 -AllowNoDocker"
        exit 2
    }
}

Write-Host ""
Write-Host "Starting OpenHands Agent Canvas..."
Write-Host "Do not paste secrets into OpenHands chats. Keep .env and tokens out of commits." -ForegroundColor Yellow
Write-Host "When the UI opens, select this repository and let AGENTS.md guide the agent."
Write-Host ""

npm.cmd exec --yes --package @openhands/agent-canvas -- agent-canvas

