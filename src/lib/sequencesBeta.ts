// Refonte des séquences (lot 5c-2) : interrupteur des pages Séquences
// (/sequences, /sequences/:id) et de leurs accès (barre latérale, palette
// Ctrl J, « G puis S », lignes de la liste des séquences).
//
// Interrupteur par navigateur, éteint par défaut jusqu'au lot 5h : clé
// konekt.sequences-v2 du stockage local ('1' = allumé, '0' = éteint, absente =
// valeur par défaut). ?sequences-v2=1 allume, ?sequences-v2=0 éteint ; la page
// retire ensuite le paramètre de l'adresse. Stockage indisponible (navigation
// privée, sites bloqués) : la valeur par défaut vaut pour la session en cours,
// jamais d'erreur.
//
// Éteint, rien de visible ne change : aucun lien ne mène aux pages, et leurs
// adresses renvoient à la liste des missions.
//
// Module pur, sans import : lu par la mise en page, la barre latérale, la
// palette, les raccourcis et la garde des routes. Modèle : missionBeta.ts.

export const SEQUENCES_BETA_STORAGE_KEY = 'konekt.sequences-v2';
export const SEQUENCES_BETA_PARAM = 'sequences-v2';
/** Valeur d'un navigateur qui n'a jamais choisi : éteint (jusqu'au lot 5h). */
export const SEQUENCES_BETA_DEFAULT = false;

/** Écran Séquences de l'organisation. */
export const SEQUENCES_PATH = '/sequences';
/** Adresse servie à la place des pages Séquences quand l'interrupteur est éteint. */
export const SEQUENCES_FALLBACK_PATH = '/missions';

export type SequencesBetaStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): SequencesBetaStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** '1' allume, '0' éteint, toute autre valeur (absente comprise) : la valeur par défaut. */
function parseStored(raw: string | null | undefined): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return SEQUENCES_BETA_DEFAULT;
}

/** Lecture protégée : un stockage absent ou qui refuse rend la valeur par défaut. */
export function readSequencesBeta(storage: SequencesBetaStorage | null = defaultStorage()): boolean {
  if (!storage) return SEQUENCES_BETA_DEFAULT;
  try {
    return parseStored(storage.getItem(SEQUENCES_BETA_STORAGE_KEY));
  } catch {
    return SEQUENCES_BETA_DEFAULT;
  }
}

/** Écriture protégée : le choix est gardé dans les deux sens ; rend false si le stockage a refusé. */
export function writeSequencesBeta(on: boolean, storage: SequencesBetaStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SEQUENCES_BETA_STORAGE_KEY, on ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

// Magasin du module : une seule copie pour la garde des routes, la mise en page,
// la barre latérale, la palette et les raccourcis (useSyncExternalStore dans
// src/hooks/useSequencesBeta.ts).
let cached: boolean | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== SEQUENCES_BETA_STORAGE_KEY) return;
  const next = parseStored(event.newValue);
  if (cached === next) return;
  cached = next;
  notify();
}

/** État courant (lu une fois dans le stockage, puis en mémoire). */
export function getSequencesBeta(): boolean {
  if (cached === null) cached = readSequencesBeta();
  return cached;
}

/** Allume ou éteint, pour la session même si le stockage refuse, et prévient les abonnés. */
export function setSequencesBeta(on: boolean): void {
  writeSequencesBeta(on);
  if (cached === on) return;
  cached = on;
  notify();
}

export function subscribeSequencesBeta(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/** Tests seulement : oublie l'état en mémoire. */
export function resetSequencesBetaForTests(): void {
  cached = null;
  listeners.clear();
}

/** Valeur demandée par ?sequences-v2= : true (1), false (0), sinon null. */
export function sequencesBetaParam(search: string): boolean | null {
  const raw = new URLSearchParams(search).get(SEQUENCES_BETA_PARAM);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Recherche sans ?sequences-v2= : '' ou '?a=b', les autres paramètres gardés dans leur ordre. */
export function withoutSequencesBetaParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SEQUENCES_BETA_PARAM);
  const out = params.toString();
  return out ? `?${out}` : '';
}

/** /sequences et ses sous-adresses (/sequences/:id). */
export function isSequencesPath(pathname: string): boolean {
  return pathname === SEQUENCES_PATH || pathname.startsWith(`${SEQUENCES_PATH}/`);
}

/**
 * Page d'une séquence. `fromMissionId` : mission d'où l'on vient
 * (&depuis=mission:<id>, fil d'Ariane et retour au panneau de la mission).
 */
export function sequencePath(id: string, fromMissionId?: string | null): string {
  const base = `${SEQUENCES_PATH}/${encodeURIComponent(id)}`;
  if (!fromMissionId) return base;
  return `${base}?depuis=mission:${encodeURIComponent(fromMissionId)}`;
}

/** Segment de l'adresse d'une séquence pas encore créée (/sequences/nouvelle, lot 5d-2). */
export const NEW_SEQUENCE_SLUG = 'nouvelle';

/** Départ d'une nouvelle séquence : vide, modèle Konekt ou de l'organisation, copie d'une séquence. */
export type NewSequenceStart =
  | { kind: 'zero' }
  | { kind: 'modele'; key: string }
  | { kind: 'copie'; id: string };

/** Valeur de &depart= : zero, modele:<clé>, copie:<id>. Toute autre valeur : null. */
export function parseNewSequenceStart(raw: string | null | undefined): NewSequenceStart | null {
  if (!raw || raw === 'zero') return raw === 'zero' ? { kind: 'zero' } : null;
  const sep = raw.indexOf(':');
  if (sep <= 0) return null;
  const kind = raw.slice(0, sep);
  const value = raw.slice(sep + 1).trim();
  if (!value) return null;
  if (kind === 'modele') return { kind: 'modele', key: value };
  if (kind === 'copie') return { kind: 'copie', id: value };
  return null;
}

/**
 * Nouvelle séquence : /sequences/nouvelle?mission=<id>&depart=zero|modele:<clé>|copie:<id>.
 * Rien n'est écrit avant « Enregistrer ».
 */
export function newSequencePath(start: NewSequenceStart, missionId?: string | null): string {
  const depart = start.kind === 'zero' ? 'zero' : start.kind === 'modele' ? `modele:${start.key}` : `copie:${start.id}`;
  const params = [missionId ? `mission=${encodeURIComponent(missionId)}` : null, `depart=${encodeURIComponent(depart).replace('%3A', ':')}`].filter(Boolean);
  return `${SEQUENCES_PATH}/${NEW_SEQUENCE_SLUG}?${params.join('&')}`;
}
