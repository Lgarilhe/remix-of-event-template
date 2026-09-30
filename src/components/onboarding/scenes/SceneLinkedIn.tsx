import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { connectedAccounts, requestLinkedInConnectionUrl } from '@/lib/onboarding/linkedin';
import { LICENSE_LABEL, licenseOf } from '@/lib/onboarding/search';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { WarmupChart } from '../parts/WarmupChart';
import { SPRING_DROP, SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  orgName: string | null;
  /** Lecture du retour de LinkedIn : `ok` (formulaire terminé), `ko` (refusé ou abandonné), rien sinon. */
  returning: 'ok' | 'ko' | null;
  /** Le parcours part chez LinkedIn : on enregistre l'état avant de quitter la page. */
  onLeave: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
  /** Le bureau suit : prise écartée, en cours, branchée. */
  onState: (state: 'none' | 'connecting' | 'connected') => void;
}

const POLL_EVERY_MS = 2500;
const POLL_FOR_MS = 45_000;

/**
 * Connexion du compte LinkedIn. Le formulaire du prestataire s'ouvre dans le
 * même onglet et renvoie ici : un seul parcours en cours, l'état est repris à
 * l'arrivée. La liaison est écrite côté serveur (webhook) quelques secondes
 * après le formulaire : on interroge la liste des comptes jusqu'à la voir.
 */
export const SceneLinkedIn: React.FC<Props> = ({ orgName, returning, onLeave, onContinue, onSkip, onBack, onState }) => {
  const { accounts, reload } = useLinkedInAccounts();
  const connected = useMemo(() => connectedAccounts(accounts), [accounts]);
  const account = connected[0] ?? null;
  // Le retour de LinkedIn ne vaut que pour l'arrivée sur la scène : revenir plus tard ne relance pas l'attente.
  const d = useDelay();
  const [initialReturn] = useState(returning);
  const [connecting, setConnecting] = useState(false);
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

  useEffect(() => {
    onState(account ? 'connected' : waiting || connecting ? 'connecting' : 'none');
  }, [account, waiting, connecting, onState]);

  const connect = async () => {
    setConnecting(true);
    setTimedOut(false);
    try {
      const url = await requestLinkedInConnectionUrl(orgName);
      onLeave();
      window.location.assign(url);
    } catch (e) {
      console.error('[SceneLinkedIn] lien de connexion indisponible :', e);
      toast.error("La fenêtre de connexion LinkedIn n'a pas pu s'ouvrir. Réessayez dans un instant.");
      setConnecting(false);
    }
  };

  const checkAgain = () => {
    setTimedOut(false);
    setWaiting(true);
  };

  return (
    <div className="space-y-7">
      <SceneHeading
        eyebrow="LinkedIn"
        title={account ? 'C\'est branché.' : 'Branchez votre compte LinkedIn.'}
        accent={[account ? 'branché' : 'LinkedIn']}
      >
        <p>
          {account
            ? 'Konekt peut chercher et écrire depuis ce compte. Aucun message ne part tant que vous n\'avez pas lancé de séquence.'
            : "Konekt cherche les candidats et écrit depuis votre compte. Aucun message ne part tant que vous n'avez pas lancé de séquence."}
        </p>
      </SceneHeading>

      <AnimatePresence mode="wait">
        {account ? (
          <motion.div key="connected" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_DROP} className="flex items-center gap-4 rounded-xl border border-success/40 bg-success-muted p-4">
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
              Connecté
            </Badge>
          </motion.div>
        ) : waiting ? (
          <motion.div key="waiting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_SOFT} className="rounded-xl border border-border bg-card p-4" role="status">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
              LinkedIn confirme la connexion…
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Quelques secondes. Cette page se met à jour toute seule.</p>
          </motion.div>
        ) : (
          <motion.div key="intro" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ ...SPRING_SOFT, delay: d(0.5) }} className="space-y-4">
            {initialReturn === 'ko' && (
              <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-foreground-secondary">
                LinkedIn n'a pas validé la connexion. Vous pouvez réessayer, ou continuer sans compte pour l'instant.
              </p>
            )}
            {timedOut && (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-foreground-secondary">La connexion met plus de temps que prévu à apparaître.</p>
                <Button variant="outline" size="sm" onClick={checkAgain} className="shrink-0">
                  <RefreshCw aria-hidden="true" />
                  Revérifier
                </Button>
              </div>
            )}
            <WarmupChart delay={d(0.7)} />
          </motion.div>
        )}
      </AnimatePresence>

      {account ? (
        <NavRow onBack={onBack} onNext={onContinue} nextLabel="Voir mes premiers candidats" />
      ) : waiting ? (
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" onClick={onBack} className="min-h-11 md:min-h-0">
            <ArrowLeft aria-hidden="true" />
            Retour
          </Button>
          <Button variant="ghost" onClick={onSkip} className="min-h-11 text-muted-foreground md:min-h-0">
            Plus tard
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={onBack} className="min-h-11 md:min-h-0">
              <ArrowLeft aria-hidden="true" />
              Retour
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={onSkip} className="min-h-11 text-muted-foreground md:min-h-0">
                Plus tard
              </Button>
              <Button
                size="lg"
                onClick={() => void connect()}
                loading={connecting}
                className="min-h-11 border-transparent bg-linkedin font-semibold text-white hover:border-transparent hover:bg-linkedin-hover hover:text-white md:min-h-0"
              >
                {!connecting && <ExternalLink aria-hidden="true" />}
                Connecter LinkedIn
              </Button>
            </div>
          </div>
          <p className="text-right text-xs text-muted-foreground">Vous passez par LinkedIn quelques instants, puis vous revenez ici.</p>
        </div>
      )}
    </div>
  );
};
