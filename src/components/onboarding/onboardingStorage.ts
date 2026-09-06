import type { OrgType, SceneKey } from './onboardingMeta';
import type { OrgDetailsData } from './SceneOrgDetails';

// ⚠️ Bumper la version à chaque changement de forme du flow (ajout/retrait
// d'étapes) : une progression persistée sur l'ancien flow serait ignorée
// plutôt que de pointer sur la mauvaise scène.
// v5 : tunnel raccourci (orgtype → org | orgdetails + specializations → linkedin → launch).
const STORAGE_KEY = 'konekt_onboarding_progress_v5';

export interface PersistedProgress {
  step: number;
  /** Clé de la scène courante — permet un repli sûr si la scène n'existe plus. */
  scene: SceneKey | null;
  orgType: OrgType | null;
  orgDetails: OrgDetailsData | null;
  specializations: string[];
  completed: SceneKey[];
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
