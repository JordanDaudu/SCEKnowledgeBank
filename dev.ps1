<#
.SYNOPSIS
  Start the Knowledge Bank dev stack on Windows.

.DESCRIPTION
  Brings up Postgres in Docker, loads .env into the environment, optionally
  runs DB migrations + seed, builds the API, then launches the API and the
  Vite web dev server each in their own window.

  Notes on why this script exists (Windows-specific quirks):
    - pnpm is invoked via `corepack pnpm` (no global pnpm shim on this box).
    - The app reads process.env directly and does NOT load .env itself, so we
      load .env here.
    - The api-server "dev" npm script uses bash `export`, which fails under
      cmd.exe on Windows, so we run build + start directly.
    - The web/Vite server needs PORT and BASE_PATH; launching it from Git Bash
      mangles BASE_PATH=/ into a path, so we start it from PowerShell.

.PARAMETER Migrate
  Run `prisma migrate deploy` before starting.

.PARAMETER Seed
  Run the demo seed before starting.

.EXAMPLE
  .\dev.ps1
  .\dev.ps1 -Migrate -Seed
#>
param(
  [switch]$Migrate,
  [switch]$Seed
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

# --- Load .env into the current process environment ---------------------------
$envFile = Join-Path $root '.env'
if (-not (Test-Path $envFile)) {
  throw ".env not found. Copy .env.example to .env and fill in SESSION_SECRET / SIGNED_URL_SECRET."
}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
    $idx = $line.IndexOf('=')
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1).Trim()
    Set-Item -Path "Env:$name" -Value $value
  }
}
Write-Host "Loaded .env" -ForegroundColor DarkGray

# --- Postgres in Docker -------------------------------------------------------
Write-Host "Starting Postgres (docker compose up -d db db-init)..." -ForegroundColor Cyan
docker compose up -d db db-init | Out-Null

# --- Optional migrate / seed --------------------------------------------------
if ($Migrate) {
  Write-Host "Applying migrations..." -ForegroundColor Cyan
  corepack pnpm --filter '@workspace/db' run migrate
}
if ($Seed) {
  Write-Host "Seeding demo data..." -ForegroundColor Cyan
  corepack pnpm --filter '@workspace/api-server' run seed
}

# --- Build API (esbuild bundle) ----------------------------------------------
Write-Host "Building API..." -ForegroundColor Cyan
corepack pnpm --filter '@workspace/api-server' run build

# --- Launch API + Web in their own windows ------------------------------------
Write-Host "Launching API on :$($env:PORT) and Web on :5173..." -ForegroundColor Green

Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root'; `$Host.UI.RawUI.WindowTitle='KB API :$($env:PORT)'; corepack pnpm --filter '@workspace/api-server' run start"
)

$env:PORT_WEB = '5173'
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root'; `$Host.UI.RawUI.WindowTitle='KB Web :5173'; `$env:PORT='5173'; `$env:BASE_PATH='/'; `$env:NODE_ENV='development'; corepack pnpm --filter '@workspace/web' run dev"
)

Write-Host ""
Write-Host "Web:  http://localhost:5173" -ForegroundColor Yellow
Write-Host "API:  http://localhost:8080/api/healthz" -ForegroundColor Yellow
Write-Host "Demo login: admin@knowledgebank.demo / Demo1234!" -ForegroundColor Yellow
