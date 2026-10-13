import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { NativeConnectSlot } from '@/components/connections/NativeConnectSlot';
import { useHostedConnect } from '@/components/connections/useHostedConnect';
import { useMyLinkedInAccount } from '@/components/connections/useMyLinkedInAccount';
import { HOSTED_BUTTON, ONBOARDING_LINKEDIN as COPY, connectLabel } from '@/lib/connectionCopy';
import { LICENSE_LABEL, licenseOf } from '@/lib/onboarding/search';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { WarmupChart } from '../parts/WarmupChart';

interface Props {
  /** Lecture du retour de LinkedIn : `ok` (formulaire terminé), `ko` (refusé ou abandonné), rien sinon. */
  returning: 'ok' | 'ko' | null;
  /** Le parcours part chez LinkedIn : on enregistre l'état avant de quitter la page. */
  onLeave: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
}

const POLL_EVERY_MS = 2500;
const POLL_FOR_MS = 45_000;

/**
 * Connexion du compte LinkedIn. La page de connexion sécurisée s'ouvre dans le
 * même onglet. Le serveur la fait revenir sur la page de retour des connexions,
 * qui ramène ici (?li=ok ou ?li=ko) : un seul parcours en cours, l'état est
 * repris à l'arrivée. La liaison est écrite côté serveur quelques secondes
 * après la page de connexion : on interroge la liste des comptes jusqu'à la voir.
 * Le compte montré est celui de la personne (liaison stricte), jamais celui d'un
 * collègue.
 */
export const SceneLinkedIn: React.FC<Props> = ({ returning, onLeave, onContinue, onSkip, onBack }) => {
  const { reload } = useLinkedInAccounts();
  const { account } = useMyLinkedInAccount();
  const hosted = useHostedConnect();
  // Le retour de LinkedIn ne vaut que pour l'arrivée sur la scène : revenir plus tard ne relance pas l'attente.
  const [initialReturn] = useState(returning);
  const [waiting, setWaiting] = useState(initialReturn === 'ok');
  const [timedOut, setTimedOut] = useState(false);

  // État à jour dès l'arrivée : un compte relié plus tôt, ou par un autre chemin, se voit tout de suite.
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compte vu : l'attente est finie, la carte du compte prend la place.
  useEffect(() => {
    if (account) setWaiting(false);
  }, [account]);

  useEffect(() => {
    if (!waiting || account) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_FOR_MS) {
        window.clearInterval(timer);
        setWaiting(false);
        setTimedOut(true);
        return;
      }
      void reload();
    }, POLL_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [waiting, account, reload]);

  const connect = () => {
    setTimedOut(false);
    void hosted.start({ provider: 'linkedin', returnTo: 'onboarding', onLeave });
  };
  const connecting = hosted.busy;

  const checkAgain = () => {
    setTimedOut(false);
    setWaiting(true);
  };

  return (
    <div className="space-y-7">
      <SceneHeading title={account ? COPY.headingDone : COPY.headingTodo}>
        <p>{account ? COPY.bodyDone : COPY.bodyTodo}</p>
      </SceneHeading>

      {account ? (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
          {account.photo ? (
            <img src={account.photo} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-full border border-border object-cover" />
          ) : (
            <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-foreground-secondary">
              {account.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-md font-semibold text-foreground">{account.name}</p>
            <p className="text-xs text-foreground-secondary">{LICENSE_LABEL[licenseOf(account.subscriptions)]}</p>
          </div>
          <Badge variant="success" className="shrink-0">
            <Check className="h-3 w-3" aria-hidden="true" />
            {COPY.connected}
          </Badge>
        </div>
      ) : waiting ? (
        <div className="rounded-xl border border-border bg-card p-4" role="status">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
            {COPY.waitingTitle}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{COPY.waitingBody}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {initialReturn === 'ko' && (
            <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-foreground-secondary">
              {COPY.refused}
            </p>
          )}
          {hosted.error && (
            <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-foreground-secondary">
              {hosted.error}
            </p>
          )}
          {timedOut && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
              <p className="text-sm text-foreground-secondary">{COPY.slow}</p>
              <Button variant="outline" size="sm" onClick={checkAgain} className="shrink-0">
                <RefreshCw aria-hidden="true" />
                {COPY.recheck}
              </Button>
            </div>
          )}
          <WarmupChart />
        </div>
      )}

      {account ? (
        <NavRow onBack={onBack} onNext={onContinue} nextLabel={COPY.next} />
      ) : waiting ? (
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onBack} className="min-h-11 md:min-h-0">
            <ArrowLeft aria-hidden="true" />
            {COPY.back}
          </Button>
          <Button variant="ghost" onClick={onSkip} className="min-h-11 md:min-h-0">
            {COPY.later}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={onBack} className="min-h-11 md:min-h-0">
              <ArrowLeft aria-hidden="true" />
              {COPY.back}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={onSkip} className="min-h-11 md:min-h-0">
                {COPY.later}
              </Button>
              <Button variant="primary" size="lg" onClick={connect} loading={connecting} disabled={connecting} className="min-h-11 md:min-h-0">
                {!connecting && <ExternalLink aria-hidden="true" />}
                {hosted.phase === 'redirecting' ? HOSTED_BUTTON.redirecting : connectLabel('linkedin')}
              </Button>
            </div>
          </div>
          <p className="text-right text-xs text-muted-foreground">{HOSTED_BUTTON.help('linkedin')}</p>
          <div className="flex justify-end">
            <NativeConnectSlot provider="linkedin" returnTo="onboarding" onConnected={() => { void reload(); }} />
          </div>
        </div>
      )}
    </div>
  );
};
