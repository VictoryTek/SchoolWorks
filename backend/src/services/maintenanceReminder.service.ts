import { isMaintenanceEnabled, MaintenanceInitiator } from './backup.service';
import { sendMaintenanceModeReminder } from './email.service';
import { loggers } from '../lib/logger';

const REMINDER_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3 hours

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedules a one-time reminder to the given admin if Maintenance Mode is
 * still on 3 hours after enabledAt. Computing the delay from the real
 * enabledAt (not always "3 hours from now") makes this safe to call again
 * after a server restart — it resumes the remaining time instead of
 * restarting a fresh window, firing immediately if already overdue.
 */
export function scheduleMaintenanceReminder(enabledAt: Date, initiatedBy: MaintenanceInitiator): void {
  cancelMaintenanceReminder();
  const remainingMs = REMINDER_THRESHOLD_MS - (Date.now() - enabledAt.getTime());
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void fireReminder(enabledAt, initiatedBy);
  }, Math.max(remainingMs, 0));
}

export function cancelMaintenanceReminder(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

async function fireReminder(enabledAt: Date, initiatedBy: MaintenanceInitiator): Promise<void> {
  if (!isMaintenanceEnabled()) return; // re-check in case it was disabled between schedule and fire
  try {
    await sendMaintenanceModeReminder({ email: initiatedBy.email, name: initiatedBy.name }, enabledAt);
  } catch (error) {
    loggers.admin.error('Failed to send maintenance mode reminder', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
