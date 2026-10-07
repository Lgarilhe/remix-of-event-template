import type { BrowserContext, Page } from '@playwright/test';

/**
 * Résolution centralisée de la config e2e depuis l'environnement.
 * Tout est requis sauf BASE_URL (défaut localhost). On échoue tôt et clairement
 * si une variable manque, plutôt qu'avec une erreur réseau obscure plus tard.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `[e2e] Variable d'environnement manquante: ${name}. ` +
        `Configure un environnement Supabase de TEST (staging ou \`supabase start\`) — voir AUDITS/QA_PLAYWRIGHT_PLAN_2026-06-11.md §3.`,
    );
  }
  return v.trim();
}

export const E2E = {
  baseUrl: process.env.E2E_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080',
  get supabaseUrl() {
    return required('E2E_SUPABASE_URL');
  },
  get anonKey() {
    return required('E2E_SUPABASE_ANON_KEY');
  },
  get serviceRoleKey() {
    return required('E2E_SUPABASE_SERVICE_ROLE_KEY');
  },
  get projectRef() {
    // Déduit de l'URL si non fourni : https://<ref>.supabase.co
    const explicit = process.env.E2E_SUPABASE_PROJECT_REF;
    if (explicit) return explicit.trim();
    const m = required('E2E_SUPABASE_URL').match(/https?:\/\/([^.]+)\./);
    return m ? m[1] : 'localhost';
  },
} as const;

/** Clé localStorage utilisée par supabase-js v2 pour stocker la session. */
export function authStorageKey(): string {
  return `sb-${E2E.projectRef}-auth-token`;
}

/**
 * Interrupteur de la nouvelle page mission (src/lib/missionBeta.ts) : allumé
 * par défaut. Les états de session posent « 0 » (ancienne page) pour que les
 * specs écrites contre l'ancienne page (séquences, Sourcing, Pipeline par
 * ?tab=) gardent leur cible ; mission-v3.spec.ts choisit la valeur par test.
 */
export const MISSION_V3_STORAGE_KEY = 'konekt.mission-v3';
export type MissionPageChoice = 'legacy' | 'default' | 'v3';
export function missionPageEntries(choice: MissionPageChoice = 'legacy'): Array<{ name: string; value: string }> {
  if (choice === 'default') return [];
  return [{ name: MISSION_V3_STORAGE_KEY, value: choice === 'v3' ? '1' : '0' }];
}

/**
 * Interrupteur des pages Séquences (src/lib/sequencesBeta.ts) : allumé par
 * défaut depuis le lot 5h. Les specs écrites contre l'ancienne interface
 * (liste des séquences seule, ancien éditeur) s'épinglent sur le secours :
 * clé à « 0 » posée avant chaque chargement, jusqu'au lot 5j qui les porte
 * sur les nouveaux écrans. Les specs du nouveau parcours (seq-v2-*) gardent
 * leur réglage (?sequences-v2=1) ou la valeur par défaut.
 */
export const SEQUENCES_V2_STORAGE_KEY = 'konekt.sequences-v2';
export async function pinLegacySequences(target: Pick<BrowserContext, 'addInitScript'> | Pick<Page, 'addInitScript'>): Promise<void> {
  await target.addInitScript((key: string) => {
    try { localStorage.setItem(key, '0'); } catch { /* sans stockage */ }
  }, SEQUENCES_V2_STORAGE_KEY);
}
