/**
 * featureFlags — Système de feature flags simple basé sur localStorage.
 *
 * Permet de basculer entre l'ancienne et la nouvelle UX sans rebuild.
 * Pour activer un flag (depuis la console navigateur) :
 *
 *   localStorage.setItem('konekt:flag:mission_v2', 'true')
 *   // puis recharge la page
 *
 * Pour désactiver :
 *
 *   localStorage.removeItem('konekt:flag:mission_v2')
 *   // ou
 *   localStorage.setItem('konekt:flag:mission_v2', 'false')
 *
 * Si le flag n'est pas défini, on retombe sur DEFAULTS ci-dessous.
 *
 * Les flags sont aussi écoutés via 'storage' event → si tu changes la
 * valeur dans un autre onglet, l'app courante reflète le changement
 * sans reload (utile pour les démos / tests).
 */

import { useEffect, useState } from 'react';

export const FLAGS = {
  /** Active le nouveau parcours Mission (3 phases au lieu de 8 tabs). */
  mission_v2: 'mission_v2',
} as const;

export type FlagKey = keyof typeof FLAGS;

/** Valeurs par défaut si le flag n'est pas dans localStorage. */
const DEFAULTS: Record<FlagKey, boolean> = {
  mission_v2: false,
};

const PREFIX = 'konekt:flag:';

function readFlag(key: FlagKey): boolean {
  if (typeof window === 'undefined') return DEFAULTS[key];
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (raw === null) return DEFAULTS[key];
    return raw === 'true' || raw === '1';
  } catch {
    return DEFAULTS[key];
  }
}

/** Lit la valeur du flag (one-shot, pas réactif). */
export function getFlag(key: FlagKey): boolean {
  return readFlag(key);
}

/**
 * Hook réactif sur la valeur du flag. Re-render le composant si la
 * valeur change dans un autre onglet (storage event).
 */
export function useFlag(key: FlagKey): boolean {
  const [value, setValue] = useState(() => readFlag(key));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === `${PREFIX}${key}`) {
        setValue(readFlag(key));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  return value;
}

/** Setter (utile pour les toggles depuis l'UI ou la console). */
export function setFlag(key: FlagKey, value: boolean): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, value ? 'true' : 'false');
    // Force re-render des autres useFlag dans la même fenêtre via dispatch
    window.dispatchEvent(new StorageEvent('storage', {
      key: `${PREFIX}${key}`,
      newValue: value ? 'true' : 'false',
    }));
  } catch {
    // localStorage indispo (private mode, quota) — silencieux
  }
}
