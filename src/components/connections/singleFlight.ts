/**
 * Garde « un seul à la fois » pour un geste à confirmer ou à cliquer (choisir un contrat,
 * déconnecter un compte) : tant que le geste est en cours, un second clic ne part pas.
 *
 * Désactiver le bouton pendant l'attente ne suffit pas : deux clics rapprochés arrivent
 * avant que le rendu qui le désactive ait eu lieu, et le geste partait deux fois (deux
 * appels, deux messages). La garde se lève à la fin du geste, réussi ou non.
 *
 * Module pur, sans import : testé par tests/ux/connexion-gestes.test.mjs.
 */
export type SingleFlight = <T>(task: () => Promise<T>) => Promise<T | undefined>;

export function createSingleFlight(): SingleFlight {
  let busy = false;
  return async <T>(task: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined;
    busy = true;
    try {
      return await task();
    } finally {
      busy = false;
    }
  };
}
