/**
 * Notification Preferences Service
 *
 * Lets a user disable (and re-enable) notification emails independently of
 * push, which has its own separate toggle in push.service.ts. Mirrors that
 * module's shape and fail-open philosophy — a preference lookup failure
 * must never block an email from sending.
 */

import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';

const log = loggers.notificationPreferences;

export async function getEmailNotificationsEnabled(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailNotificationsEnabled: true },
  });
  return user?.emailNotificationsEnabled ?? true;
}

export async function setEmailNotificationsEnabled(userId: string, enabled: boolean): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { emailNotificationsEnabled: enabled },
  });
}

/**
 * Returns recipientEmails with any addresses belonging to users who have
 * opted out of email removed. Fails open (returns the original, unfiltered
 * list) on any DB error — email should never break because a preference
 * lookup failed, matching notifyPushByEmails()'s own never-throw contract.
 */
export async function filterEmailEnabledRecipients(recipientEmails: string[]): Promise<string[]> {
  if (recipientEmails.length === 0) return recipientEmails;

  try {
    const optedOut = await prisma.user.findMany({
      where: {
        email: { in: recipientEmails, mode: 'insensitive' },
        emailNotificationsEnabled: false,
      },
      select: { email: true },
    });

    if (optedOut.length === 0) return recipientEmails;

    const optedOutEmails = new Set(optedOut.map((u) => u.email.toLowerCase()));
    return recipientEmails.filter((email) => !optedOutEmails.has(email.toLowerCase()));
  } catch (error) {
    log.error('Failed to filter email-enabled recipients', {
      error: error instanceof Error ? error.message : String(error),
    });
    return recipientEmails;
  }
}
