// Refonte des séquences (lot 5c-2) : état de l'interrupteur des pages
// Séquences, partagé par la garde des routes, la mise en page, la barre
// latérale, la palette et les raccourcis (magasin de src/lib/sequencesBeta.ts).
// Rendu serveur : valeur par défaut (allumé depuis le lot 5h).
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  SEQUENCES_BETA_DEFAULT,
  getSequencesBeta,
  isSequencesPath,
  sequencesBetaParam,
  setSequencesBeta,
  subscribeSequencesBeta,
  withoutSequencesBetaParam,
} from '@/lib/sequencesBeta';

export function useSequencesBeta(): boolean {
  return useSyncExternalStore(subscribeSequencesBeta, getSequencesBeta, () => SEQUENCES_BETA_DEFAULT);
}

/**
 * ?sequences-v2=1 ou =0 sur une page de l'application : écrit l'interrupteur,
 * puis retire le paramètre de l'adresse (remplacement, pas d'entrée
 * d'historique). Monté par AppLayout. Les pages Séquences ont leur propre
 * lecture (SequencesGate), qui doit trancher avant d'afficher ou de renvoyer.
 */
export function useSequencesBetaParamSync(): void {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const requested = sequencesBetaParam(search);
  useEffect(() => {
    if (requested === null || isSequencesPath(pathname)) return;
    setSequencesBeta(requested);
    navigate(`${pathname}${withoutSequencesBetaParam(search)}${hash}`, { replace: true });
  }, [requested, pathname, search, hash, navigate]);
}
