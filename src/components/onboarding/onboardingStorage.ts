import type { OrgType, SceneKey } from './onboardingMeta';
import type { OrgDetailsData } from './SceneOrgDetails';

// ⚠️ Bumper la version à chaque changement de forme du flow (ajout/retrait
// d'étapes) : un step index persisté sur l'ancien flow pointerait sur la
// mauvaise scène et ferait sauter les nouvelles étapes.
const STORAGE_KEY = 'konekt_onboarding_progress_v3';

export interface PersistedProgress {
  step: number;
  orgType: OrgType | null;
  goal?: string;
  stack?: string[];
  orgDetails: OrgDetailsData | null;
  discoverySource: string;
  specializations: string[];
  completed: SceneKey[];
  profileBasics: { displayName: string; jobTitle: string; linkedinUrl: string } | null;
}

export function loadOnboardingProgress(): PersistedProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProgress;
    if (typeof parsed?.step !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOnboardingProgress(progress: PersistedProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // stockage plein/indisponible — la progression n'est simplement pas persistée
  }
}

export function clearOnboardingProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
