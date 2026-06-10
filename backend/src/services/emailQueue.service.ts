/**
 * Email Queue Service
 *
 * Provides enqueue() to buffer emails in PostgreSQL and a worker
 * that drains the queue with rate limiting and exponential backoff retry.
 *
 * Architecture:
 * - Controllers call existing email service functions (unchanged API)
 * - email.service.ts routes through enqueueEmail() instead of direct SMTP
 * - This worker polls the DB and sends emails with rate limiting
 * - Transient SMTP failures are retried with exponential backoff
 * - After MAX_ATTEMPTS, emails are marked as dead letter ('failed')
 */

import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { loggers } from '../lib/logger';

const log = loggers.email;

// ---------------------------------------------------------------------------
// Configuration (override via env vars, sensible defaults hardcoded)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS   = parseInt(process.env.EMAIL_QUEUE_POLL_INTERVAL_MS ?? '30000', 10);
const SEND_INTERVAL_MS   = parseInt(process.env.EMAIL_QUEUE_SEND_INTERVAL_MS ?? '2000', 10);
const MAX_ATTEMPTS       = parseInt(process.env.EMAIL_QUEUE_MAX_ATTEMPTS ?? '5', 10);
const BASE_BACKOFF_MS    = parseInt(process.env.EMAIL_QUEUE_BACKOFF_BASE_MS ?? '30000', 10);
const BATCH_SIZE         = 10;

// ---------------------------------------------------------------------------
// SMTP Transporter (pooled, rate-limited at the nodemailer level)
// ---------------------------------------------------------------------------

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool:           true,
  maxConnections: 2,
  maxMessages:    10,
  // Rate limiting is handled by the explicit sleep between sends.
  // Do NOT add rateDelta/rateLimit here — it would double the delay (O3).
});

const FROM_ADDRESS = process.env.SMTP_FROM ?? 'noreply@district.org';

// ---------------------------------------------------------------------------
// Enqueue interface
// ---------------------------------------------------------------------------

/** Maps named priority to numeric value for DB storage (1=high, 2=normal, 3=low). */
const PRIORITY_MAP = { high: 1, normal: 2, low: 3 } as const;
type PriorityName = keyof typeof PRIORITY_MAP;

export interface EmailAttachment {
  filename:    string;
  contentType: string;
  data:        string; // base64-encoded file content
}

export interface EnqueueEmailOptions {
  to:              string | string[];
  subject:        string;
  html:           string;
  priority?:      PriorityName;
  context?:       string;
  relatedEntityId?: string;
  attachments?:   EmailAttachment[];
}

/**
 * Insert an email into the queue for async delivery.
 * Returns immediately — the worker handles actual sending.
 */
export async function enqueueEmail(options: EnqueueEmailOptions): Promise<string> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  if (recipients.length === 0) return '';

  try {
    const record = await prisma.email_queue.create({
      data: {
        recipients,
        subject:         options.subject,
        htmlBody:        options.html,
        priority:        PRIORITY_MAP[options.priority ?? 'normal'],
        context:         options.context ?? null,
        relatedEntityId: options.relatedEntityId ?? null,
        attachments:     options.attachments as unknown as Prisma.InputJsonValue | undefined,
        status:          'pending',
        attempts:        0,
        nextAttemptAt:   new Date(),
      },
    });

    log.debug('Email enqueued', {
      id: record.id,
      context: options.context,
      recipientCount: recipients.length,
    });

    return record.id;
  } catch (error) {
    log.error('Failed to enqueue email', {
      subject: options.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

// ---------------------------------------------------------------------------
// Worker: poll and send
// ---------------------------------------------------------------------------

let isRunning = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the email queue worker. Call once on app startup.
 */
export async function startEmailQueueWorker(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  // Recover any stuck 'processing' emails from a previous crash
  try {
    const recovered = await prisma.email_queue.updateMany({
      where: {
        status: 'processing',
        updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) },
      },
      data: { status: 'pending' },
    });
    if (recovered.count > 0) {
      log.warn('Recovered stuck emails on startup', { count: recovered.count });
    }
  } catch (error) {
    log.error('Failed to recover stuck emails', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  log.info('Email queue worker started', {
    pollInterval: POLL_INTERVAL_MS,
    sendInterval: SEND_INTERVAL_MS,
    maxAttempts: MAX_ATTEMPTS,
  });

  pollTimer = setInterval(processBatch, POLL_INTERVAL_MS);
}

/**
 * Stop the email queue worker. Call on graceful shutdown.
 */
export function stopEmailQueueWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isRunning = false;
  log.info('Email queue worker stopped');
}

/** Purge sent emails older than 30 days to prevent unbounded table growth. */
async function cleanupOldSentEmails(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deleted = await prisma.email_queue.deleteMany({
      where: { status: 'sent', sentAt: { lt: cutoff } },
    });
    if (deleted.count > 0) {
      log.info('Cleaned up old sent emails', { count: deleted.count });
    }
  } catch (error) {
    log.error('Failed to clean up old sent emails', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const CLEANUP_INTERVAL_MS = parseInt(process.env.EMAIL_QUEUE_CLEANUP_INTERVAL_MS ?? String(6 * 60 * 60 * 1000), 10);
let lastCleanupAt: Date | null = null;

/**
 * Process a batch of pending emails.
 */
async function processBatch(): Promise<void> {
  try {
    // Periodic cleanup of old sent emails — time-based, not poll-count-based
    const now = new Date();
    if (!lastCleanupAt || now.getTime() - lastCleanupAt.getTime() >= CLEANUP_INTERVAL_MS) {
      lastCleanupAt = now;
      await cleanupOldSentEmails();
    }

    const emails = await prisma.email_queue.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: [
        { priority: 'asc' },  // 1=high, 2=normal, 3=low — numeric sort is correct
        { createdAt: 'asc' },
      ],
      take: BATCH_SIZE,
    });

    if (emails.length === 0) return;

    log.debug('Processing email batch', { count: emails.length });

    for (const email of emails) {
      // Atomic claim: only transitions if still 'pending' (prevents race condition)
      const claimed = await prisma.email_queue.updateMany({
        where: { id: email.id, status: 'pending' },
        data: { status: 'processing' },
      });
      if (claimed.count === 0) continue; // Another worker claimed it

      try {
        const info = await transporter.sendMail({
          from:    FROM_ADDRESS,
          to:      (email.recipients as string[]).join(', '),
          subject: email.subject,
          html:    email.htmlBody,
          ...(email.attachments && Array.isArray(email.attachments)
            ? {
                attachments: (email.attachments as unknown as EmailAttachment[]).map((a) => ({
                  filename:    a.filename,
                  contentType: a.contentType,
                  content:     Buffer.from(a.data, 'base64'),
                  encoding:    'base64' as const,
                })),
              }
            : {}),
        });

        // Check if SMTP server rejected any recipients
        if (info.rejected && info.rejected.length > 0) {
          throw new Error(`SMTP rejected recipients: ${info.rejected.join(', ')}. Response: ${info.response}`);
        }

        // Success
        await prisma.email_queue.update({
          where: { id: email.id },
          data: {
            status:   'sent',
            sentAt:   new Date(),
            attempts: email.attempts + 1,
          },
        });

        const redacted = (email.recipients as string[])
          .map((e: string) => e.replace(/^[^@]*/, '***'))
          .join(', ');
        log.info('Email sent from queue', {
          id: email.id,
          to: redacted,
          subject: email.subject,
          context: email.context,
          attempt: email.attempts + 1,
          messageId: info.messageId,
          smtpResponse: info.response,
          accepted: info.accepted?.length ?? 0,
        });

        // Rate limit: explicit delay between sends
        await sleep(SEND_INTERVAL_MS);
      } catch (error) {
        const attempts = email.attempts + 1;
        const errMsg = error instanceof Error ? error.message : String(error);

        if (attempts >= MAX_ATTEMPTS) {
          // Dead letter — give up
          await prisma.email_queue.update({
            where: { id: email.id },
            data: {
              status:    'failed',
              attempts,
              lastError: errMsg,
            },
          });
          log.error('Email permanently failed (dead letter)', {
            id: email.id,
            subject: email.subject,
            context: email.context,
            attempts,
            error: errMsg,
          });
        } else {
          // Transient failure — schedule retry with exponential backoff
          const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempts - 1);
          const nextAttemptAt = new Date(Date.now() + backoffMs);

          await prisma.email_queue.update({
            where: { id: email.id },
            data: {
              status:        'pending',
              attempts,
              lastError:     errMsg,
              nextAttemptAt,
            },
          });
          log.warn('Email send failed, will retry', {
            id: email.id,
            subject: email.subject,
            context: email.context,
            attempt: attempts,
            nextRetryIn: `${backoffMs / 1000}s`,
            error: errMsg,
          });
        }
      }
    }
  } catch (error) {
    log.error('Email queue processor batch error', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
