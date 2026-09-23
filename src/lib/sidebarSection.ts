/**
 * État d'une section de la barre latérale, dérivé d'une requête React Query
 * (D9, D42). Module pur, sans import : hors du .tsx de SidebarSection pour ne
 * pas ajouter d'avertissement react-refresh/only-export-components.
 */

/**
 * - loading : première lecture en cours, aucune donnée ;
 * - offline : aucune donnée, requête en pause faute de réseau (jamais un chargement sans fin) ;
 * - error : aucune donnée, lecture en échec ;
 * - ok : des données sont affichables (éventuellement anciennes, voir `stale`).
 */
export type SectionState = 'loading' | 'offline' | 'error' | 'ok';

export interface QueryStateInput {
  data: unknown;
  isError: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * Données présentes : 'ok', et `stale` si la dernière relecture a échoué
 * (données gardées). Hors ligne (requête en pause), `stale` reste faux : le
 * bandeau du panneau le dit déjà (D42).
 * Sans données : en pause → 'offline', sinon erreur → 'error', sinon 'loading'.
 */
export function queryState(q: QueryStateInput): { state: SectionState; stale: boolean } {
  if (q.data !== undefined) {
    return { state: 'ok', stale: q.isError && q.fetchStatus !== 'paused' };
  }
  if (q.fetchStatus === 'paused') return { state: 'offline', stale: false };
  if (q.isError) return { state: 'error', stale: false };
  return { state: 'loading', stale: false };
}
