import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { EXTENSION_REVEAL_STORAGE_KEY, resolveLegacySettingsUrl } from '@/lib/settingsRoutes';

/**
 * Anciennes adresses des Paramètres à ?tab=… : redirigées AVANT la garde de connexion, pour que
 * la rubrique survive à un détour par /auth (ProtectedRoute ne garde que le chemin).
 * Aucune rubrique n'est montée ici : un lecteur de retour (paiement, Notion) monté puis
 * remonté à l'arrivée afficherait deux fois son message. replace : le bouton Retour ne revient pas sur ?tab=.
 */
export function LegacySettingsRedirect({ children }: { children: ReactNode }) {
  const location = useLocation();
  const target = resolveLegacySettingsUrl(location.pathname, location.search, location.hash);
  const revealExtension = target?.revealExtension === true;
  // L'état de navigation ne survit pas à /auth (Auth.tsx:53 et 143 ne relisent que le chemin) :
  // un mémo de session le relaie jusqu'à Connexions, qui le consomme (D13).
  useEffect(() => {
    if (!revealExtension) return;
    try {
      sessionStorage.setItem(EXTENSION_REVEAL_STORAGE_KEY, '1');
    } catch {
      // stockage indisponible : l'état de navigation suffit quand il n'y a pas de détour par /auth
    }
  }, [revealExtension]);
  if (target) {
    return (
      <Navigate
        replace
        to={{ pathname: target.pathname, search: target.search, hash: target.hash }}
        state={revealExtension ? { revealExtension: true } : undefined}
      />
    );
  }
  return <>{children}</>;
}
