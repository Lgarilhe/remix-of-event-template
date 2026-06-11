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
