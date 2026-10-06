// Refonte des séquences (lot 5c-2) : garde des routes /sequences et
// /sequences/:id, placée avant la mise en page.
//
// Interrupteur éteint (défaut jusqu'au lot 5h) : renvoi vers la liste des
// missions, où vivent les séquences aujourd'hui, sans monter la page.
// ?sequences-v2=1 allume et ?sequences-v2=0 éteint dès ce rendu (pas
// d'aller-retour le temps que l'effet écrive l'interrupteur) ; le paramètre
// quitte ensuite l'adresse.
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import {
  SEQUENCES_FALLBACK_PATH,
  sequencesBetaParam,
  setSequencesBeta,
  withoutSequencesBetaParam,
} from '@/lib/sequencesBeta';
import { withPreviewAccessToken } from '@/lib/previewToken';

export function SequencesGate({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const stored = useSequencesBeta();
  const requested = sequencesBetaParam(search);
  const on = requested ?? stored;

  useEffect(() => {
    if (requested === null) return;
    setSequencesBeta(requested);
    // Éteint : le renvoi ci-dessous quitte déjà l'adresse.
    if (requested) navigate(`${pathname}${withoutSequencesBetaParam(search)}${hash}`, { replace: true });
  }, [requested, pathname, search, hash, navigate]);

  if (!on) return <Navigate to={withPreviewAccessToken(SEQUENCES_FALLBACK_PATH)} replace />;
  return <>{children}</>;
}
