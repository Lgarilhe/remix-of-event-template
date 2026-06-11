/**
 * Garde-fou : interdit absolument que la suite e2e (qui crée/supprime des orgs,
 * envoie des actions, consomme des crédits) tourne contre la prod Konekt.
 *
 * Le service-role de prod entre les mains d'un seed/téardown = catastrophe.
 * On bloque par ref projet ET par URL, en plus d'exiger un opt-in explicite.
 */

const PROD_PROJECT_REF = 'crckfywoyjxkawathdff';
const PROD_HOST_FRAGMENTS = [PROD_PROJECT_REF, 'konekt-app-navy.vercel.app'];

export function assertNotProduction(supabaseUrl: string, baseUrl: string): void {
  const haystack = `${supabaseUrl} ${baseUrl}`.toLowerCase();
  for (const frag of PROD_HOST_FRAGMENTS) {
    if (haystack.includes(frag)) {
      throw new Error(
        `[e2e] REFUS : la cible ressemble à la PRODUCTION (« ${frag} »). ` +
          `Les tests créent et suppriment des données — ils ne doivent jamais toucher konekt-production. ` +
          `Pointe E2E_SUPABASE_URL / E2E_BASE_URL vers un environnement de test.`,
      );
    }
  }

  // Opt-in explicite obligatoire : on ne seed/téardown que si l'opérateur l'a confirmé.
  if (process.env.E2E_ALLOW_SEEDING !== '1') {
    throw new Error(
      `[e2e] Le seeding/téardown nécessite E2E_ALLOW_SEEDING=1 (confirmation que la cible est jetable).`,
    );
  }
}
