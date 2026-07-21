/**
 * Web Push Service
 *
 * Mirrors every notification email with a best-effort native browser/OS push
 * notification for users who have opted in on a given device. Push is purely
 * additive — email remains the reliable channel of record.
 *
 * Silent no-op whenever VAPID keys are not configured (self-hosted VAPID via
 * the `web-push` library — no Firebase/FCM).
 *
 * Environment variables:
 *   VAPID_PUBLIC_KEY   — VAPID public key (base64url), also served to the frontend
 *   VAPID_PRIVATE_KEY  — VAPID private key (base64url)
 *   VAPID_SUBJECT      — contact URI, e.g. mailto:noreply@district.org
 */

import webpush, { WebPushError, type PushSubscription as WebPushSubscription } from 'web-push';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';

const log = loggers.push;

// ---------------------------------------------------------------------------
// VAPID configuration
// ---------------------------------------------------------------------------

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT     = process.env.VAPID_SUBJECT;

let pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);

if (pushConfigured) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  } catch (error) {
    // A malformed VAPID key must never take down the whole server (email,
    // login, everything) — degrade to "push disabled" instead, matching the
    // "push is non-critical" design of the rest of this module.
    pushConfigured = false;
    log.error('Invalid VAPID configuration — push notifications disabled', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const isPushConfigured = pushConfigured;

export function getVapidPublicKey(): string | null {
  return isPushConfigured ? VAPID_PUBLIC_KEY! : null;
}

// ---------------------------------------------------------------------------
// Subscription management (called from the controller, owner-scoped)
// ---------------------------------------------------------------------------

export async function saveSubscription(
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  userAgent?: string,
): Promise<void> {
  await prisma.push_subscription.upsert({
    where: { endpoint: subscription.endpoint },
    create: {
      userId,
      endpoint: subscription.endpoint,
      p256dh:   subscription.keys.p256dh,
      auth:     subscription.keys.auth,
      userAgent,
    },
    update: {
      userId,
      p256dh:   subscription.keys.p256dh,
      auth:     subscription.keys.auth,
      userAgent,
    },
  });
}

export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.push_subscription.deleteMany({
    where: { endpoint, userId },
  });
}

// ---------------------------------------------------------------------------
// Deep-link helper — mirrors the "View X" links already built into the
// corresponding notification emails in email.service.ts.
// ---------------------------------------------------------------------------

function buildUrl(context?: string, relatedEntityId?: string): string {
  if (context && relatedEntityId) {
    if (context.startsWith('po_')) return `/purchase-orders/${relatedEntityId}`;
    if (context.startsWith('work_order_')) return `/work-orders/${relatedEntityId}`;
    if (context.startsWith('field_trip_')) return `/field-trips/${relatedEntityId}`;
  }
  return '/dashboard';
}

// ---------------------------------------------------------------------------
// Fan-out — called from email.service.ts's sendMail() alongside enqueueEmail()
// ---------------------------------------------------------------------------

export interface NotifyPushOptions {
  subject: string;
  context?: string;
  relatedEntityId?: string;
}

/**
 * Sends a push notification to every subscribed device belonging to the
 * given recipient email addresses. Best-effort — never throws, matching the
 * "email is non-critical" pattern used by sendMail().
 */
export async function notifyPushByEmails(
  recipientEmails: string[],
  options: NotifyPushOptions,
): Promise<void> {
  if (!isPushConfigured || recipientEmails.length === 0) return;

  try {
    const users = await prisma.user.findMany({
      where: {
        email: { in: recipientEmails, mode: 'insensitive' },
      },
      include: { pushSubscriptions: true },
    });

    const payload = JSON.stringify({
      title: options.subject,
      url: buildUrl(options.context, options.relatedEntityId),
    });

    const subscriptions = users.flatMap((user) => user.pushSubscriptions);
    await Promise.allSettled(subscriptions.map((sub) => sendToSubscription(sub, payload)));
  } catch (error) {
    log.error('Failed to fan out push notifications', {
      subject: options.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    // Intentionally not re-throwing — push is non-critical
  }
}

async function sendToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  payload: string,
): Promise<void> {
  const subscription: WebPushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (error) {
    if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
      // Subscription is dead — prune it so future sends skip it.
      await prisma.push_subscription.delete({ where: { id: sub.id } }).catch(() => {
        // Already deleted (e.g. user unsubscribed concurrently) — ignore.
      });
      return;
    }
    log.warn('Push send failed', {
      endpoint: sub.endpoint,
      statusCode: error instanceof WebPushError ? error.statusCode : undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
