/**
 * Emplacement de la connexion directe (identifiants, cookie, QR code ou code
 * d'association saisis dans Konekt). Les cartes de Connexions le montent à côté
 * du bouton de la connexion standard ; l'assistant (native/NativeConnectFlow) est
 * chargé à la demande.
 *
 * Deux conditions, toutes deux nécessaires, avant d'afficher quoi que ce soit :
 * le serveur annonce la connexion directe pour ce fournisseur ET l'interrupteur
 * local est allumé (src/hooks/useConnection.ts, useNativeScreens). Éteints, la
 * connexion standard reste la seule voie et l'emplacement ne montre rien.
 *
 * Une nouvelle messagerie (Gmail, Outlook ou autre) est permise dès que l'un
 * des deux types l'est : l'assistant ne propose alors que ceux que le serveur
 * annonce.
 */

import { Suspense, lazy, useMemo, type ComponentType } from 'react';
import { useNativeScreens } from '@/hooks/useConnection';
import type { ConnectionProviderId } from '@/lib/connectionCopy';
import type { ReturnTarget } from './returnTarget';

export interface NativeConnectFlowProps {
  provider: ConnectionProviderId;
  /** Compte à reconnecter ; absent pour une nouvelle connexion. */
  reconnectAccountId?: string | null;
  returnTo?: ReturnTarget;
  /** Appelé quand le compte est relié, pour relire les cartes. */
  onConnected?: () => void;
}

export type NativeFlowLoader = () => Promise<{ default: ComponentType<NativeConnectFlowProps> }>;

/** Charge l'assistant au premier affichage de l'emplacement permis. */
export const NATIVE_FLOW_LOADER = (() => import('./native/NativeConnectFlow')) as NativeFlowLoader | null;

const EMAIL_PROVIDERS: readonly ConnectionProviderId[] = ['google', 'outlook', 'imap'];

export function NativeConnectSlot(props: NativeConnectFlowProps) {
  const own = useNativeScreens(props.provider);
  const oauth = useNativeScreens('google');
  const imap = useNativeScreens('imap');
  const newEmail = !props.reconnectAccountId && EMAIL_PROVIDERS.includes(props.provider);
  const allowed = newEmail ? oauth || imap : own;
  const Flow = useMemo(() => (NATIVE_FLOW_LOADER ? lazy(NATIVE_FLOW_LOADER) : null), []);
  if (!Flow || !allowed) return null;
  return (
    <Suspense fallback={null}>
      <Flow {...props} />
    </Suspense>
  );
}
