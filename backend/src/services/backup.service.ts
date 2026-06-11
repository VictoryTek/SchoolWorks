import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loggers } from '../lib/logger';

export interface BackupFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

const BACKUP_DIR = process.env.BACKUP_DIR ?? '/backups';
const BACKUP_FILENAME_PATTERN = /^tech_v2_\d{4}-\d{2}-\d{2}_\d{6}\.sql\.gz$/;
const DB_HOST = 'db';
const DB_NAME = 'tech_v2';

/** Validates that a filename is a known backup file and contains no path traversal. */
export function isValidBackupFilename(filename: string): boolean {
  return BACKUP_FILENAME_PATTERN.test(filename) && !filename.includes('/') && !filename.includes('..');
}

/** Returns the list of backup files sorted newest-first. */
export function listBackups(): BackupFile[] {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(isValidBackupFilename)
    .map((filename) => {
      const fullPath = path.join(BACKUP_DIR, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.birthtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return files;
}

/** Runs an on-demand pg_dump and returns the filename written. */
export function triggerBackup(): string {
  const dbUser = process.env.DB_USER ?? 'techv2';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15);
  const filename = `tech_v2_${timestamp}.sql.gz`;
  const filePath = path.join(BACKUP_DIR, filename);

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  loggers.admin.info('Starting on-demand backup', { filename });

  const env = {
    ...process.env,
    PGPASSWORD: process.env.DB_PASSWORD ?? '',
  };

  execSync(
    `pg_dump -h ${DB_HOST} -U ${dbUser} --clean --if-exists ${DB_NAME} | gzip > "${filePath}"`,
    { env, shell: '/bin/sh', stdio: ['ignore', 'ignore', 'pipe'] }
  );

  loggers.admin.info('On-demand backup complete', { filename, sizeBytes: fs.statSync(filePath).size });
  return filename;
}

/** Restores the database from the specified backup file. */
export function restoreBackup(filename: string): void {
  if (!isValidBackupFilename(filename)) {
    throw new Error('Invalid backup filename');
  }

  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }

  const dbUser = process.env.DB_USER ?? 'techv2';

  const env = {
    ...process.env,
    PGPASSWORD: process.env.DB_PASSWORD ?? '',
  };

  loggers.admin.warn('Starting database restore', { filename });

  execSync(
    `gunzip -c "${filePath}" | psql --set ON_ERROR_STOP=on -h ${DB_HOST} -U ${dbUser} ${DB_NAME}`,
    { env, shell: '/bin/sh', stdio: ['ignore', 'ignore', 'pipe'] }
  );

  loggers.admin.warn('Database restore complete', { filename });
}

// ── Maintenance mode ────────────────────────────────────────────────────────

const MAINTENANCE_FLAG = path.join(
  process.env.MAINTENANCE_FLAG_DIR ?? path.resolve(__dirname, '..', '..', 'logs'),
  '.maintenance'
);

export function isMaintenanceEnabled(): boolean {
  return fs.existsSync(MAINTENANCE_FLAG);
}

export function enableMaintenance(): void {
  fs.mkdirSync(path.dirname(MAINTENANCE_FLAG), { recursive: true });
  fs.writeFileSync(MAINTENANCE_FLAG, new Date().toISOString(), 'utf8');
  loggers.admin.warn('Maintenance mode ENABLED');
}

export function disableMaintenance(): void {
  if (fs.existsSync(MAINTENANCE_FLAG)) {
    fs.unlinkSync(MAINTENANCE_FLAG);
  }
  loggers.admin.info('Maintenance mode DISABLED');
}
