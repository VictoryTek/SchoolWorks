# Preflight validation gate for Tech-V2.
#
# Development runs fully in Docker (docker-compose.dev.yml); there are no host
# node_modules. The image builds are therefore the compile/validation gate:
#   - backend image:  shared tsc -> prisma generate -> backend tsc
#   - frontend image: frontend tsc -> vite build
#
# Requires: Docker Desktop running, .env present at repo root (compose interpolation).
# Exit code 0 = all checks passed.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host '==> Preflight 1/2: backend image build (shared + prisma generate + backend tsc)'
docker compose -f docker-compose.dev.yml build backend
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PREFLIGHT FAILED: backend image build returned a non-zero exit code.'
    exit 1
}

Write-Host '==> Preflight 2/2: frontend image build (tsc + vite build)'
docker compose -f docker-compose.dev.yml build frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PREFLIGHT FAILED: frontend image build returned a non-zero exit code.'
    exit 1
}

Write-Host 'All preflight checks passed.'
exit 0
