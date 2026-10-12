/**
 * Fins de parcours de l'assistant de connexion directe : compte relié, échec,
 * et passage à la page de connexion standard quand l'écran ne sait pas
 * afficher la vérification demandée.
 */

import { Check } from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import {
  FALLBACK,
  FLOW,
  RETURN_PAGE,
  SUCCESS,
  readableConnectionName,
  successTitle,
  type ConnectionProviderId,
  type FallbackCause,
} from '@/lib/connectionCopy';
import type { ConnectedAccount } from '../../connectionApi';
import { FooterButton, FormError, StepFooter, StepFrame, WaitLine } from './StepParts';

export function DoneStep({
  provider,
  reconnect,
  account,
  onFinish,
}: {
  provider: ConnectionProviderId;
  reconnect: boolean;
  account: ConnectedAccount | null;
  onFinish: () => void;
}) {
  return (
    <StepFrame
      heading={successTitle(provider, reconnect)}
      description={(
        <>
          {account && <p>{SUCCESS.accountLine(readableConnectionName(account.name, provider))}</p>}
          {reconnect && provider === 'linkedin' && <p className="mt-1.5">{SUCCESS.linkedinResumed}</p>}
        </>
      )}
      focusHeading
    >
      <IconTile icon={Check} tone="success" size="lg" aria-hidden="true" />
      <StepFooter>
        <FooterButton type="button" variant="primary" onClick={onFinish}>{FLOW.finish}</FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

export function FailedStep({
  message,
  onRestart,
  onClose,
}: {
  message: string;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <StepFrame heading={RETURN_PAGE.failedTitle} focusHeading>
      <FormError>{message}</FormError>
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onClose}>{FLOW.close}</FooterButton>
        <FooterButton type="button" variant="primary" onClick={onRestart}>{FLOW.restart}</FooterButton>
      </StepFooter>
    </StepFrame>
  );
}

/**
 * La vérification demandée ne s'affiche pas ici : la personne la termine sur la
 * page de connexion standard. Le départ est automatique ; si le serveur refuse,
 * l'erreur est écrite avec « Réessayer ».
 */
export function FallbackStep({
  provider,
  cause,
  phase,
  error,
  onRetry,
  onClose,
}: {
  provider: ConnectionProviderId;
  cause: FallbackCause;
  phase: 'starting' | 'redirecting' | 'failed';
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <StepFrame heading={FALLBACK.heading[cause]} description={<p>{FALLBACK.body(provider, cause)}</p>} focusHeading>
      {phase === 'failed' && error ? (
        <FormError>{error}</FormError>
      ) : (
        <WaitLine>{phase === 'redirecting' ? FALLBACK.redirecting : FALLBACK.starting}</WaitLine>
      )}
      <StepFooter>
        <FooterButton type="button" variant="ghost" onClick={onClose}>{FLOW.cancel}</FooterButton>
        {phase === 'failed' && <FooterButton type="button" variant="primary" onClick={onRetry}>{FLOW.retry}</FooterButton>}
      </StepFooter>
    </StepFrame>
  );
}
