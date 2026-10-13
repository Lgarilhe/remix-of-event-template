// Connexion des comptes (LinkedIn, WhatsApp, messagerie) : interrupteur des
// écrans de connexion directe, ceux où la personne saisit ses identifiants ou
// scanne un code dans Konekt au lieu de passer par la page de connexion
// standard.
//
// Deux conditions, toutes deux nécessaires : le drapeau serveur
// CONNECTION_NATIVE_ENABLED (action connection_capabilities du serveur) ET cet
// interrupteur local. Par défaut, partout : la connexion standard.
//
// Interrupteur par navigateur, ÉTEINT par défaut : clé konekt.connection-native
// du stockage local ('1' = allumé, '0' = éteint, absente = valeur par défaut).
// ?connection-native=1 allume, ?connection-native=0 éteint ; l'écran qui lit le
// paramètre le retire ensuite de l'adresse (useConnectionNativeParamSync, dans
// src/hooks/useConnection.ts). Stockage indisponible (navigation privée, sites
// bloqués) : la valeur par défaut vaut pour la session en cours, jamais d'erreur.
//
// Module pur, sans import. Modèle : sequencesBeta.ts.

export const CONNECTION_NATIVE_STORAGE_KEY = 'konekt.connection-native';
export const CONNECTION_NATIVE_PARAM = 'connection-native';
/** Valeur d'un navigateur qui n'a jamais choisi : éteint (connexion standard). */
export const CONNECTION_NATIVE_DEFAULT = false;

export type ConnectionNativeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ConnectionNativeStorage | null {
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
  return CONNECTION_NATIVE_DEFAULT;
}

/** Lecture protégée : un stockage absent ou qui refuse rend la valeur par défaut. */
export function readConnectionNative(storage: ConnectionNativeStorage | null = defaultStorage()): boolean {
  if (!storage) return CONNECTION_NATIVE_DEFAULT;
  try {
    return parseStored(storage.getItem(CONNECTION_NATIVE_STORAGE_KEY));
  } catch {
    return CONNECTION_NATIVE_DEFAULT;
  }
}

/** Écriture protégée : le choix est gardé dans les deux sens ; rend false si le stockage a refusé. */
export function writeConnectionNative(on: boolean, storage: ConnectionNativeStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONNECTION_NATIVE_STORAGE_KEY, on ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

// Magasin du module : une seule copie pour tous les écrans de connexion
// (useSyncExternalStore dans src/hooks/useConnection.ts).
let cached: boolean | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== CONNECTION_NATIVE_STORAGE_KEY) return;
  const next = parseStored(event.newValue);
  if (cached === next) return;
  cached = next;
  notify();
}

/** État courant (lu une fois dans le stockage, puis en mémoire). */
export function getConnectionNative(): boolean {
  if (cached === null) cached = readConnectionNative();
  return cached;
}

/** Allume ou éteint, pour la session même si le stockage refuse, et prévient les abonnés. */
export function setConnectionNative(on: boolean): void {
  writeConnectionNative(on);
  if (cached === on) return;
  cached = on;
  notify();
}

export function subscribeConnectionNative(listener: () => void): () => void {
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
export function resetConnectionNativeForTests(): void {
  cached = null;
  listeners.clear();
}

/** Valeur demandée par ?connection-native= : true (1), false (0), sinon null. */
export function connectionNativeParam(search: string): boolean | null {
  const raw = new URLSearchParams(search).get(CONNECTION_NATIVE_PARAM);
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Recherche sans ?connection-native= : '' ou '?a=b', les autres paramètres gardés dans leur ordre. */
export function withoutConnectionNativeParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(CONNECTION_NATIVE_PARAM);
  const out = params.toString();
  return out ? `?${out}` : '';
}

/**
 * Écrans de connexion directe permis : le serveur les annonce pour ce canal ET
 * l'interrupteur local est allumé. Sans l'un des deux, la connexion standard.
 */
export function nativeScreensAllowed(serverNative: boolean | null | undefined, localFlag: boolean): boolean {
  return serverNative === true && localFlag === true;
}
