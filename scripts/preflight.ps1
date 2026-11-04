# Preflight validation gate for Tech-V2.
#
# Development runs fully in Docker (docker-compose.dev.yml); there are no host
# node_modules. The image builds are therefore the compile/validation gate:
#   - backend image:  shared tsc -> prisma generate -> backend tsc
#   - frontend image: frontend tsc -> vite build
#   - test run:       prisma migrate deploy -> npx vitest run (inside backend-test container)
#
# Requires: Docker Desktop running, .env present at repo root (compose interpolation).
# Exit code 0 = all checks passed.

$ErrorActionPreference = 'Stop'

# Ensure Docker CLI is on PATH (Docker Desktop installs here on Windows)
$dockerBin = 'C:\Program Files\Docker\Docker\resources\bin'
if (Test-Path $dockerBin) {
    $env:PATH = "$dockerBin;$env:PATH"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot
$preflightStart = Get-Date

Write-Host '==> Preflight 1/4: mobile table card-view guard'
# Every page/component that renders a raw MUI <TableHead> must also reference
# useIsMobile (a hand-rolled mobile branch, e.g. ProvisioningPage.tsx's
# AuditLogSection) or ResponsiveTable (the shared component) somewhere in the
# same file -- otherwise the table renders as a cramped/overflowing raw table
# on mobile instead of switching to cards. This is a file-level heuristic, not
# a line-level one: it cannot tell whether a *specific* table within a file
# that has multiple tables is the one actually guarded. Treat a pass as "no
# obviously-untouched table", not proof every table in a multi-table file is
# fixed.
$mobileTableExceptions = @(
    # Pre-existing gap, not a new regression -- tracked, not yet fixed.
    'frontend/src/components/inventory-audit/FiscalYearAuditEntry.tsx',
    # Dead code -- not routed anywhere in App.tsx (see pages/DeviceManagement/
    # IntuneDeviceActionsPage.tsx for the live equivalent). Not deleted since
    # that wasn't asked for; exempted so it doesn't block on an unused table.
    'frontend/src/pages/IntuneDeviceActions.tsx'
)
$mobileTableViolations = @()
Get-ChildItem -Path (Join-Path $repoRoot 'frontend/src') -Recurse -Include *.tsx |
    Where-Object { $_.FullName -notmatch '[\\/]components[\\/]responsive[\\/]' } |
    ForEach-Object {
        $relPath = $_.FullName.Substring($repoRoot.Length + 1).Replace('\', '/')
        if ($mobileTableExceptions -contains $relPath) { return }
        $content = Get-Content -Raw -LiteralPath $_.FullName
        if ($content -match 'TableHead' -and $content -notmatch 'useIsMobile' -and $content -notmatch 'ResponsiveTable') {
            $mobileTableViolations += $relPath
        }
    }
if ($mobileTableViolations.Count -gt 0) {
    Write-Host 'PREFLIGHT FAILED: these files render a raw MUI table with no mobile card-view handling'
    Write-Host '(no useIsMobile or ResponsiveTable reference found in the file):'
    $mobileTableViolations | ForEach-Object { Write-Host "  - $_" }
    Write-Host 'Add a useIsMobile()-guarded card branch (see ProvisioningPage.tsx AuditLogSection),'
    Write-Host 'switch to ResponsiveTable, or add a justified entry to $mobileTableExceptions in this script.'
    exit 1
}

Write-Host '==> Preflight 2/4: backend image build (shared + prisma generate + backend tsc)'
docker compose -f docker-compose.dev.yml build backend
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PREFLIGHT FAILED: backend image build returned a non-zero exit code.'
    exit 1
}

Write-Host '==> Preflight 3/4: frontend image build (tsc + vite build)'
docker compose -f docker-compose.dev.yml build frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PREFLIGHT FAILED: frontend image build returned a non-zero exit code.'
    exit 1
}

Write-Host '==> Preflight 4/4: backend integration tests (vitest run inside Docker)'
docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test
$testResult = $LASTEXITCODE

# Only remove the test-scoped db-test container. backend-test already cleans
# itself up via `run --rm` above. Deliberately scoped to just this one
# service (not `--profile test down`) — `down` also matches default-profile
# services with no `profiles:` key, which would stop/remove the persistent
# dev backend/frontend/db containers too.
Write-Host '==> Cleaning up test-only containers (db-test)'
docker compose -f docker-compose.dev.yml --profile test rm -f -s db-test

if ($testResult -ne 0) {
    Write-Host 'PREFLIGHT FAILED: backend integration tests returned a non-zero exit code.'
    exit 1
}

# Stamp read by .claude/hooks/preflight-gate.sh (Stop hook): proves preflight
# passed after the last file change. Gitignored; never written on failure.
# The stamp is dated to when preflight STARTED, so a file edited while the
# builds and tests were running still counts as newer than the stamp.
$stampDir = Join-Path $repoRoot '.claude'
if (Test-Path $stampDir) {
    $stampFile = Join-Path $stampDir '.preflight-pass'
    Set-Content -LiteralPath $stampFile -Value (Get-Date -Format o) -Encoding ascii
    (Get-Item -LiteralPath $stampFile).LastWriteTime = $preflightStart
}

Write-Host 'All preflight checks passed.'
exit 0
