/**
 * This is a single-learner demo: one browser == one learner, identified by
 * a learner profile id kept in localStorage. That id is what makes a second
 * session personalized by the first (progress dashboard, mastery, priors
 * fed into intent parsing) — see docs/ARCHITECTURE.md.
 */
const STORAGE_KEY = "ait-learner-profile-id";

export function getStoredLearnerProfileId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredLearnerProfileId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private-browsing/storage-disabled: the session still works, it just won't be remembered next visit.
  }
}
