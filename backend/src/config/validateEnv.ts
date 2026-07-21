/**
 * Validates required environment variables at startup.
 * Throws with a clear list of missing vars rather than failing silently
 * mid-request when the first caller hits the missing value.
 */

// Variables that must be present for the server to function at all.
const REQUIRED: string[] = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'ENTRA_TENANT_ID',
  'REDIRECT_URI',
  'ENTRA_ADMIN_GROUP_ID',
];

// Variables needed for email delivery. Not required at startup if you intend
// to run without email, but if any one of them is set, all must be set.
const SMTP_VARS: string[] = [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
];

// Variables needed for Web Push (VAPID). Not required at startup — push is
// purely additive to email — but if any one is set, all must be set.
const VAPID_VARS: string[] = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
];

export function validateEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nCheck your .env file against .env.example.`
    );
  }

  // SMTP: if any SMTP var is set, all must be set (partial config causes runtime failures).
  const smtpSet = SMTP_VARS.filter((k) => process.env[k]);
  if (smtpSet.length > 0 && smtpSet.length < SMTP_VARS.length) {
    const smtpMissing = SMTP_VARS.filter((k) => !process.env[k]);
    throw new Error(
      `Partial SMTP configuration detected. Either set all SMTP vars or none:\n${smtpMissing.map((k) => `  - ${k}`).join('\n')}`
    );
  }

  // VAPID: if any push var is set, all must be set (partial config causes runtime failures).
  const vapidSet = VAPID_VARS.filter((k) => process.env[k]);
  if (vapidSet.length > 0 && vapidSet.length < VAPID_VARS.length) {
    const vapidMissing = VAPID_VARS.filter((k) => !process.env[k]);
    throw new Error(
      `Partial VAPID (Web Push) configuration detected. Either set all VAPID vars or none:\n${vapidMissing.map((k) => `  - ${k}`).join('\n')}`
    );
  }
}
