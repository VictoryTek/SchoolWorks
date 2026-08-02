const SEEN_VERSION_KEY = 'schoolworks_whats_new_version';
const OPT_OUT_KEY = 'schoolworks_whats_new_optout';

export function getSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_VERSION_KEY);
  } catch {
    return null;
  }
}

export function setSeenVersion(version: string): void {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, version);
  } catch {
    // Blocked storage (private mode, locked-down policy) — nothing to persist to.
  }
}

export function isReleaseNotesOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'true';
  } catch {
    return true;
  }
}

export function setReleaseNotesOptedOut(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(OPT_OUT_KEY, 'true');
    } else {
      localStorage.removeItem(OPT_OUT_KEY);
      setSeenVersion(__APP_VERSION__);
    }
  } catch {
    // Blocked storage — nothing to persist to.
  }
}
