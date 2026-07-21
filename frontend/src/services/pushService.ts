/**
 * Web Push subscription management.
 *
 * Push is strictly opt-in: subscribeToPush() must only be called from a user
 * gesture (e.g. a Settings toggle), never on page load, since requesting
 * notification permission unprompted can permanently poison the "denied"
 * state in the browser.
 */

import { api } from './api';

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Converts a base64url-encoded VAPID key into a concrete Uint8Array<ArrayBuffer> (valid BufferSource). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);

  const buffer = new ArrayBuffer(rawData.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export async function getVapidPublicKey(): Promise<string | null> {
  const { data } = await api.get<{ publicKey: string | null }>('/push/vapid-public-key');
  return data.publicKey;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Requests notification permission (must be called from a user gesture) and subscribes. */
export async function subscribeToPush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(`Notification permission ${permission}`);
  }

  const publicKey = await getVapidPublicKey();
  if (!publicKey) {
    throw new Error('Push notifications are not configured on the server');
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await api.post('/push/subscriptions', subscription.toJSON());
  return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;

  await api.delete('/push/subscriptions', { data: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
