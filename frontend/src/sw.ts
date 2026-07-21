/// <reference lib="webworker" />

/**
 * Custom service worker (injectManifest strategy).
 *
 * Reproduces the previous generateSW-based caching behavior exactly
 * (precache, SPA navigation fallback, API NetworkFirst, image CacheFirst,
 * autoUpdate via skipWaiting + clientsClaim) and adds Web Push handling.
 */

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);

// SPA navigation fallback — same as the previous navigateFallback: 'index.html'
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// API — NetworkFirst, excluding /api/auth/ (same urlPattern as before)
registerRoute(
  ({ url }) => /^https:\/\/.*\/api\/(?!auth\/).*/i.test(url.href),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
  }),
);

// Images — CacheFirst (same pattern as before)
registerRoute(
  ({ url }) => /\.(?:png|jpg|jpeg|svg|gif|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'image-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------

interface PushPayload {
  title?: string;
  url?: string;
}

self.addEventListener('push', (event: PushEvent) => {
  if (!(self.Notification && self.Notification.permission === 'granted')) return;

  const data: PushPayload = event.data?.json() ?? {};
  const title = data.title ?? 'SchoolWorks';
  const url = data.url ?? '/dashboard';

  event.waitUntil(
    self.registration.showNotification(title, {
      icon: '/favicon.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url: string = event.notification.data?.url ?? '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          if ('navigate' in client) client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
