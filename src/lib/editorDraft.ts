/**
 * Brouillons d'éditeurs longs (création de mission, éditeur de séquence).
 *
 * Pourquoi : fermer une de ces fenêtres effaçait le travail en cours sans rien
 * demander ni rien conserver (audit UX du 09/09/2026, constat UX06). Un
 * brouillon incomplet doit survivre à une fermeture, sans pour autant devenir
 * un objet activable.
 *
 * Stockage local au navigateur, par clé d'éditeur. Ce n'est pas une sauvegarde
 * serveur : le brouillon ne suit pas l'utilisateur d'une machine à l'autre.
 * Il répond au cas courant, la fermeture par erreur ou l'aller-retour.
 */

const PREFIX = 'konekt_editor_draft_';
/** Au-delà, un brouillon oublié n'a plus d'intérêt et encombre le stockage. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredDraft<T> {
  savedAt: number;
  value: T;
}

/** Écrit le brouillon. Une valeur nulle ou vide efface l'entrée. */
export function saveEditorDraft<T>(key: string, value: T | null): void {
  try {
    if (value == null) {
      localStorage.removeItem(PREFIX + key);
      return;
    }
    const payload: StoredDraft<T> = { savedAt: Date.now(), value };
    localStorage.setItem(PREFIX + key, JSON.stringify(payload));
  } catch {
    // Stockage plein ou navigation privée : on perd le brouillon, pas la session.
  }
}

/** Relit le brouillon, ou `null` s'il n'y en a pas ou s'il est trop vieux. */
export function loadEditorDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

/** Supprime le brouillon. À appeler quand le travail a été réellement créé. */
export function clearEditorDraft(key: string): void {
  saveEditorDraft(key, null);
}

/** Date d'enregistrement du brouillon, pour l'annoncer à l'utilisateur. */
export function editorDraftSavedAt(key: string): Date | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<unknown>;
    return typeof parsed?.savedAt === 'number' ? new Date(parsed.savedAt) : null;
  } catch {
    return null;
  }
}
