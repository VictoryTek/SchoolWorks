import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  // 1. Get jlewis's user ID
  const userRes = await pool.query(
    `SELECT id, "displayName", email, role FROM users WHERE email ILIKE 'jlewis@ocboe.com' LIMIT 1`
  );
  if (userRes.rows.length === 0) { console.log('User not found'); await pool.end(); return; }
  const user = userRes.rows[0];
  console.log('\n=== USER ===');
  console.log(user);

  // 2. All locationSupervisor records for this user
  const supRes = await pool.query(
    `SELECT ls."supervisorType", ls."isPrimary", ol.name AS location, ol.code, ol.type AS "locationType"
     FROM location_supervisors ls
     JOIN office_locations ol ON ls."locationId" = ol.id
     WHERE ls."userId" = $1
     ORDER BY ls."isPrimary" DESC, ol.name`,
    [user.id]
  );
  console.log('\n=== LOCATION SUPERVISOR RECORDS ===');
  console.table(supRes.rows);

  // 3. Primary supervisor locations (what Stage 1 pendingMyApproval uses)
  const primaryRes = await pool.query(
    `SELECT ls."supervisorType", ol.name AS location, ol.code, ol.type AS "locationType"
     FROM location_supervisors ls
     JOIN office_locations ol ON ls."locationId" = ol.id
     WHERE ls."userId" = $1 AND ls."isPrimary" = true`,
    [user.id]
  );
  console.log('\n=== PRIMARY SUPERVISOR LOCATIONS (Stage 1 query) ===');
  console.table(primaryRes.rows);

  // 4. Submitted POs from those locations (what jlewis would see via Stage 1)
  if (primaryRes.rows.length > 0) {
    const locationCodes = primaryRes.rows.map((r: any) => r.code);
    const pendingRes = await pool.query(
      `SELECT po.id, po."reqNumber", po.description, po.status, po."workflowType",
              po."entityType", ol.name AS location, u."displayName" AS requestor
       FROM purchase_orders po
       LEFT JOIN office_locations ol ON po."officeLocationId" = ol.id
       LEFT JOIN users u ON po."requestorId" = u.id
       WHERE po.status = 'submitted'
         AND po."workflowType" = 'standard'
         AND ol.code = ANY($1)`,
      [locationCodes]
    );
    console.log('\n=== SUBMITTED POs FROM PRIMARY LOCATIONS (Stage 1 results) ===');
    console.table(pendingRes.rows);
  }

  // 5. Check: are there supervisor_approved standard POs? (Stage 2 — FD-only)
  const stage2Res = await pool.query(
    `SELECT po.id, po."reqNumber", po.description, po.status, po."entityType",
            ol.name AS location, u."displayName" AS requestor
     FROM purchase_orders po
     LEFT JOIN office_locations ol ON po."officeLocationId" = ol.id
     LEFT JOIN users u ON po."requestorId" = u.id
     WHERE po.status = 'supervisor_approved' AND po."workflowType" = 'standard'
     LIMIT 20`
  );
  console.log('\n=== SUPERVISOR_APPROVED STANDARD POs (Stage 2 — would show if user has FD group) ===');
  console.log(`Count: ${stage2Res.rows.length}`);
  if (stage2Res.rows.length > 0) console.table(stage2Res.rows);

  // 6. Check: are there submitted District Office POs? (Stage 2 DO addition)
  const doPORes = await pool.query(
    `SELECT po.id, po."reqNumber", po.description, po.status, po."entityType",
            ol.name AS location, u."displayName" AS requestor
     FROM purchase_orders po
     LEFT JOIN office_locations ol ON po."officeLocationId" = ol.id
     LEFT JOIN users u ON po."requestorId" = u.id
     WHERE po.status = 'submitted' AND po."entityType" = 'DISTRICT_OFFICE' AND po."workflowType" = 'standard'
     LIMIT 20`
  );
  console.log('\n=== SUBMITTED DISTRICT OFFICE POs (Stage 2 DO addition — would show if user has FD group) ===');
  console.log(`Count: ${doPORes.rows.length}`);
  if (doPORes.rows.length > 0) console.table(doPORes.rows);

  // 7. Key env vars for group comparison (print partial IDs for matching against JWT)
  console.log('\n=== ENTRA GROUP IDs (for JWT comparison) ===');
  const envVars = [
    'ENTRA_ADMIN_GROUP_ID',
    'ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',
    'ENTRA_FINANCE_DIRECTOR_GROUP_ID',
    'ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',
    'ENTRA_FINANCE_PO_ENTRY_GROUP_ID',
    'ENTRA_PRINCIPALS_GROUP_ID',
  ];
  for (const v of envVars) {
    const val = process.env[v];
    console.log(`  ${v} = ${val ?? '(not set)'}`);
  }
  console.log('\n>>> NEXT STEP: Decode jlewis JWT access_token and compare groups array against these IDs');
  console.log('>>> If the JWT contains ENTRA_FINANCE_DIRECTOR_GROUP_ID, that is the root cause.');

  await pool.end();
}

main().catch(console.error);
