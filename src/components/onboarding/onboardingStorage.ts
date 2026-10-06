import { isSceneKey, type OrgType, type SceneKey } from './onboardingMeta';
import type { WritingTone } from '@/lib/onboarding/outreach';
import type { BriefDraft } from '@/lib/onboarding/brief';

// ⚠️ Bumper la version à chaque changement de forme du parcours (ajout ou
// retrait de scènes) : une progression enregistrée sur l'ancien parcours serait
// ignorée plutôt que de pointer sur la mauvaise scène.
// v7 : neuf scènes (hello, profile, structure, role, brief, linkedin, candidates, message, finale).
// v8 : sept scènes sans bureau animé (you, role, brief, linkedin, candidates, message, finale).
const STORAGE_KEY = 'konekt_onboarding_progress_v8';
const LEGACY_STORAGE_KEYS = [
  'konekt_onboarding_progress_v4',
  'konekt_onboarding_progress_v5',
  'konekt_onboarding_progress_v6',
  'konekt_onboarding_progress_v7',
];

export interface PersistedProgress {
  /** Scène en cours : la reprise repart d'ici, ou du début si elle n'existe plus. */
  scene: SceneKey | null;
  completed: SceneKey[];
  firstName: string;
  orgType: OrgType | null;
  orgName: string;
  /**
   * Id de l'espace créé par ce tunnel. Sauvegardé avec la progression : après un
   * rechargement (ou le retour de LinkedIn), on reprend cet espace au lieu
   * d'échouer sur « déjà membre d'un espace » ou, avec ?new=1, d'en créer un second.
   */
  createdOrgId?: string | null;
  jobTitle: string;
  clientName: string;
  /** Mission créée à la fin du brief : la relecture des filtres et la recherche partent d'elle. */
  missionId: string | null;
  linkedinSkipped: boolean;
  tone: WritingTone | null;
  /** Brief corrigé à l'écran : il survit au voyage chez LinkedIn (le message et la fin en ont besoin). */
  brief?: BriefDraft | null;
}

export function loadOnboardingProgress(): PersistedProgress | null {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedProgress;
    if (typeof parsed !== 'object' || parsed === null || !isSceneKey(parsed.scene)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveOnboardingProgress(progress: PersistedProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // stockage plein ou indisponible : la progression n'est simplement pas enregistrée
  }
}

export function clearOnboardingProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
