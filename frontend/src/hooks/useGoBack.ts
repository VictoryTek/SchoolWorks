/**
 * useGoBack
 *
 * Returns a handler that goes back to the previous screen, falling back to the
 * dashboard when there is no previous screen to go back to.
 *
 * The fallback is what keeps the installed PWA alive. In standalone mode there is
 * no browser chrome, so calling navigate(-1) with nothing to pop walks off the end
 * of the app's history and hands the user to the browser — the app looks like it
 * exited. That happens whenever a back button is pressed at the first history
 * entry: a fresh launch into a deep link, an emailed link, or a refresh.
 *
 * BrowserRouter records its position in window.history.state.idx, which counts only
 * entries this router session created — so idx 0 means there is nothing of ours to
 * pop. (history.length is useless here: it also counts entries from before the app
 * was loaded.) The fallback replaces rather than pushes, so the dead-end entry is
 * not left behind for a second Back to hit.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export function useGoBack() {
  const navigate = useNavigate();

  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/dashboard', { replace: true });
  }, [navigate]);
}
