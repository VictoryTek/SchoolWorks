import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Refreshes on-screen data when a push notification arrives.
 *
 * The service worker (sw.ts) posts `{ type: 'PUSH_RECEIVED' }` to every open page whenever it
 * shows a push notification. Invalidating with no arguments marks every query stale and
 * refetches only the ones currently on screen (TanStack Query v5 default refetchType
 * 'active'), so an open list, dashboard counts and similar update without a click.
 */
export function usePushRefresh() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_RECEIVED') {
        queryClient.invalidateQueries();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [queryClient]);
}
