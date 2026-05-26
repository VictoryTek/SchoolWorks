/**
 * backfill-audit-fiscal-year.ts
 *
 * Ties existing completed InventoryAuditSession records to an active
 * FiscalYearAudit by updating their fiscalYear field to match.
 *
 * Use case: Sessions were conducted before the FiscalYearAudit was started,
 * so their fiscalYear is null or differs — rooms don't show as "done".
 *
 * Dry-run (default): shows what WOULD be updated, no changes made.
 * Live run:          npx tsx scripts/backfill-audit-fiscal-year.ts --force
 *
 * Optional: target a specific fiscal year (bypasses active-audit lookup):
 *   npx tsx scripts/backfill-audit-fiscal-year.ts --force --fy "2025-2026"
 */

import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const force = process.argv.includes('--force');

  // Parse --fy "2025-2026" or --fy="2025-2026"
  const fyFlagIndex = process.argv.indexOf('--fy');
  const fyArg =
    process.argv.find((a) => a.startsWith('--fy='))?.split('=').slice(1).join('=') ??
    (fyFlagIndex !== -1 ? process.argv[fyFlagIndex + 1] : undefined);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('   Inventory Audit — Backfill Fiscal Year on Sessions      ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(force ? '  MODE: LIVE (changes will be written)' : '  MODE: DRY RUN (no changes written)');
  console.log('');

  // ── 1. Find the target FiscalYearAudit ──────────────────────────────────────
  let fyAudit: { id: string; fiscalYear: string; status: string; startedByName: string; startedAt: Date } | null;

  if (fyArg) {
    fyAudit = await prisma.fiscalYearAudit.findUnique({ where: { fiscalYear: fyArg } });
    if (!fyAudit) {
      console.error(`❌  No FiscalYearAudit found for fiscal year "${fyArg}"`);
      console.error('    Check the exact value stored in the fiscal_year_audits table.');
      process.exit(1);
    }
  } else {
    fyAudit = await prisma.fiscalYearAudit.findFirst({ where: { status: 'ACTIVE' } });
    if (!fyAudit) {
      console.error('❌  No ACTIVE FiscalYearAudit found.');
      console.error('    Use --fy "YYYY-YYYY" to target a completed/specific audit instead.');
      process.exit(1);
    }
  }

  console.log(`  Target FiscalYearAudit : "${fyAudit.fiscalYear}"`);
  console.log(`  Audit status           : ${fyAudit.status}`);
  console.log(`  Started by             : ${fyAudit.startedByName} on ${fyAudit.startedAt.toISOString()}`);
  console.log('');

  // ── 2. Find sessions that don't already carry the correct fiscal year ────────
  const candidates = await prisma.inventoryAuditSession.findMany({
    where: {
      fiscalYear: { not: fyAudit.fiscalYear },
      status: { in: ['COMPLETED', 'IN_PROGRESS'] },
    },
    include: {
      officeLocation: { select: { name: true } },
      room: { select: { name: true } },
    },
    orderBy: [
      { officeLocation: { name: 'asc' } },
      { room: { name: 'asc' } },
    ],
  });

  if (candidates.length === 0) {
    console.log('✅  No sessions need backfilling — all completed/in-progress sessions');
    console.log(`    already have fiscalYear = "${fyAudit.fiscalYear}".`);
    process.exit(0);
  }

  // ── 3. Print the candidate table ────────────────────────────────────────────
  console.log(`  Found ${candidates.length} session(s) whose fiscalYear will be changed`);
  console.log(`  from their current value  →  "${fyAudit.fiscalYear}"\n`);

  const colW = { idx: 4, status: 12, school: 34, room: 22, fy: 14 };

  const header =
    '  ' +
    '#'.padEnd(colW.idx) +
    'Status'.padEnd(colW.status) +
    'School'.padEnd(colW.school) +
    'Room'.padEnd(colW.room) +
    'Current FY'.padEnd(colW.fy) +
    'Auditor';

  const divider = '  ' + '─'.repeat(header.length - 2);

  console.log(header);
  console.log(divider);

  candidates.forEach((s, i) => {
    const idx   = String(i + 1).padEnd(colW.idx);
    const stat  = s.status.padEnd(colW.status);
    const sch   = (s.officeLocation?.name ?? '(unknown)').slice(0, colW.school - 2).padEnd(colW.school);
    const room  = (s.room?.name ?? '(unknown)').slice(0, colW.room - 2).padEnd(colW.room);
    const fy    = (s.fiscalYear ?? 'null').padEnd(colW.fy);
    console.log(`  ${idx}${stat}${sch}${room}${fy}${s.conductedByName}`);
  });

  // ── 4. Dry-run gate ──────────────────────────────────────────────────────────
  if (!force) {
    console.log('');
    console.log('⚠   DRY RUN — no changes made.');
    console.log(`    Re-run with --force to update all ${candidates.length} session(s).`);
    console.log('');
    console.log('    Example:');
    console.log(`      npx tsx scripts/backfill-audit-fiscal-year.ts --force`);
    process.exit(0);
  }

  // ── 5. Perform the update ────────────────────────────────────────────────────
  const result = await prisma.inventoryAuditSession.updateMany({
    where: {
      id: { in: candidates.map((s) => s.id) },
    },
    data: {
      fiscalYear: fyAudit.fiscalYear,
    },
  });

  console.log('');
  console.log(`✅  Updated ${result.count} session(s) → fiscalYear = "${fyAudit.fiscalYear}"`);
  console.log('');
  console.log('  Next steps:');
  console.log('    1. Refresh the Inventory Audit page — rooms that were done should');
  console.log('       now appear as COMPLETED under the fiscal year.');
  console.log('    2. For any school that is fully audited, click "Complete Location"');
  console.log('       in the UI to mark it done within the fiscal year audit.');
  console.log('    3. Once all schools are complete, you can close the fiscal year audit.');
}

main()
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
