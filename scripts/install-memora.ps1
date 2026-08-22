$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".venv"
$python = Join-Path $venv "Scripts\python.exe"
$requirements = Join-Path $root "requirements-memora.txt"

if (-not (Test-Path -LiteralPath $python)) {
  python -m venv $venv
}

& $python -m pip install --disable-pip-version-check --upgrade pip
& $python -m pip install --disable-pip-version-check --requirement $requirements

$version = & $python -c "import memora; print(memora.__version__)"
Write-Output "Memora installed in the project environment: $version"
Write-Output "MCP config: .mcp.json (local, ignored by Git)"
