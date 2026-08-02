import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';

const STAFF_EXPORT_PATH = process.env.SYNERGY_STAFF_EXPORT_CSV ?? '/sis-data/SynergyStaff.csv';
const STUDENT_EXPORT_PATH = process.env.SYNERGY_STUDENT_EXPORT_CSV ?? '/sis-data/SynergyStudents.csv';

/**
 * Exports active users to the two Synergy-format CSVs the SIS pulls back in:
 * SynergyStaff.csv (employeeId,userPrincipalName) and
 * SynergyStudents.csv (employeeNumber,userPrincipalName).
 *
 * Staff vs. student is determined by the same 's'-prefix convention
 * userProvision.service.ts already uses for employeeId (student IDs are
 * stored as 's' + SIS Student ID; staff IDs are plain numeric badge numbers).
 */
export async function runSynergyCsvExportJob(): Promise<Record<string, unknown>> {
  const users = await prisma.user.findMany({
    where: { isActive: true, employeeId: { not: null } },
    select: { employeeId: true, email: true },
  });

  const staffRows: string[] = [];
  const studentRows: string[] = [];

  for (const user of users) {
    const employeeId = user.employeeId!;
    if (employeeId.startsWith('s')) {
      studentRows.push(`${employeeId.slice(1)},${user.email}`);
    } else {
      staffRows.push(`${employeeId},${user.email}`);
    }
  }

  const staffCsv = ['employeeId,userPrincipalName', ...staffRows].join('\n') + '\n';
  const studentCsv = ['employeeNumber,userPrincipalName', ...studentRows].join('\n') + '\n';

  fs.mkdirSync(path.dirname(STAFF_EXPORT_PATH), { recursive: true });
  fs.writeFileSync(STAFF_EXPORT_PATH, staffCsv, 'utf8');
  fs.writeFileSync(STUDENT_EXPORT_PATH, studentCsv, 'utf8');

  loggers.scheduler.info('Synergy CSV export complete', {
    staffCount: staffRows.length,
    studentCount: studentRows.length,
    staffPath: STAFF_EXPORT_PATH,
    studentPath: STUDENT_EXPORT_PATH,
  });

  return {
    staffCount: staffRows.length,
    studentCount: studentRows.length,
    staffPath: STAFF_EXPORT_PATH,
    studentPath: STUDENT_EXPORT_PATH,
  };
}
