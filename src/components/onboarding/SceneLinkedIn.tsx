import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, ExternalLink, RefreshCw, Lock, Unplug } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

import linkedinLogo from '@/assets/linkedin-logo.webp';

interface Props {
  onNext: (linkedInConnected: boolean) => void;
  /** Absent quand la scène suit la création de l'espace : revenir en arrière
   *  relancerait la création (espace en double ou tunnel bloqué). */
  onBack?: () => void;
}

// La connexion se fait dans un autre onglet : après un clic « Connecter
// LinkedIn », on interroge la liste des comptes toutes les 8 s pendant 3 min.
const POLL_INTERVAL_MS = 8000;
const POLL_WINDOW_MS = 3 * 60 * 1000;

const LINKEDIN_BENEFITS = [
  'Invitations, messages et relances entièrement automatisés',
  'Fonctionne 24h/24, même ordinateur éteint',
  'Connexion sécurisée, déconnectable à tout moment',
];

const NAV_BUTTON_CLASS = 'min-h-11 md:min-h-0';

/**
 * Scène de connexion LinkedIn : la seule intégration indispensable pour
 * utiliser l'app (sourcing et messages). E-mail et WhatsApp se connectent
 * plus tard depuis les Paramètres.
 */
export const SceneLinkedIn: React.FC<Props> = ({ onNext, onBack }) => {
  const { accounts, reload: reloadLinkedIn } = useLinkedInAccounts();
  const { organization } = useOrganization();

  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const linkedInConnected = accounts.some((a) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP');

  // Rechargement silencieux (pas de spinner) : le ref empêche deux appels
  // qui se chevauchent (focus + visibilitychange arrivent souvent ensemble).
  const reloadInFlightRef = useRef(false);
  const [pollUntil, setPollUntil] = useState<number | null>(null);

  const silentReload = useCallback(async () => {
    if (reloadInFlightRef.current) return;
    reloadInFlightRef.current = true;
    try {
      await reloadLinkedIn();
    } catch {
      // Erreur transitoire : la prochaine tentative reprendra
    } finally {
      reloadInFlightRef.current = false;
    }
  }, [reloadLinkedIn]);

  // Retour sur la fenêtre (focus / onglet redevenu visible) tant qu'aucun
  // compte n'est connecté. Les écouteurs sont retirés dès la connexion.
  useEffect(() => {
    if (linkedInConnected) return;
    const onFocus = () => { void silentReload(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void silentReload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [linkedInConnected, silentReload]);

  // Sondage borné dans le temps après un clic « Connecter LinkedIn » ;
  // s'arrête à l'échéance, à la connexion ou au démontage.
  useEffect(() => {
    if (pollUntil === null || linkedInConnected) return;
    const timer = setInterval(() => {
      if (Date.now() >= pollUntil) {
        setPollUntil(null);
        return;
      }
      void silentReload();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pollUntil, linkedInConnected, silentReload]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction<{ url?: string }>('unipile-accounts', {
        action: 'hosted_auth_link',
        providers: ['LINKEDIN'],
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });
      if (data?.success && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        setPollUntil(Date.now() + POLL_WINDOW_MS);
        toast.info('Fenêtre de connexion LinkedIn ouverte. Revenez ici une fois connecté.');
      } else {
        throw new Error(data?.error || 'lien de connexion absent');
      }
    } catch (e) {
      console.error('[SceneLinkedIn] lien de connexion indisponible :', e);
      toast.error("La fenêtre de connexion LinkedIn n'a pas pu s'ouvrir. Réessayez dans un instant.");
    } finally {
      setConnecting(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reloadLinkedIn();
    } finally {
      setRefreshing(false);
    }
  }, [reloadLinkedIn]);

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connectez votre compte LinkedIn</h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
          Sans LinkedIn connecté, pas de sourcing ni de messages.
        </p>
      </div>

      <div
        className={cn(
          'rounded-xl border p-4 transition-colors duration-150 sm:p-5',
          linkedInConnected ? 'border-success/40 bg-success-muted' : 'border-border bg-card',
        )}
      >
        <div className="mb-3 flex items-center gap-3">
          <img src={linkedinLogo} alt="" className="h-9 w-9 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <p className="text-md font-semibold text-foreground">LinkedIn</p>
            <p className="text-xs text-muted-foreground">Le moteur de votre sourcing.</p>
          </div>
          {linkedInConnected && (
            <Badge variant="success" className="shrink-0">
              <Check className="h-3 w-3" aria-hidden="true" />
              Connecté
            </Badge>
          )}
        </div>

        <ul className="mb-4 space-y-1.5">
          {LINKEDIN_BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2 text-sm text-foreground-secondary">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {benefit}
            </li>
          ))}
        </ul>

        {!linkedInConnected && (
          <Button
            onClick={handleConnect}
            loading={connecting}
            className="h-11 w-full border-transparent bg-linkedin font-semibold text-white hover:border-transparent hover:bg-linkedin-hover hover:text-white md:h-10"
          >
            {!connecting && <ExternalLink aria-hidden="true" />}
            Connecter LinkedIn
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Connexion sécurisée
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Unplug className="h-3.5 w-3.5" aria-hidden="true" /> Déconnectable à tout moment
        </span>
        <Button variant="ghost" size="xs" onClick={handleRefresh} disabled={refreshing} className="text-muted-foreground min-h-11 md:min-h-0">
          <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
          Vérifier la connexion
        </Button>
      </div>

      <div className={cn('flex items-center gap-2 pt-2', onBack ? 'justify-between' : 'justify-end')}>
        {onBack && (
          <Button variant="ghost" onClick={onBack} className={NAV_BUTTON_CLASS}>
            <ArrowLeft aria-hidden="true" />
            Retour
          </Button>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!linkedInConnected && (
            <Button variant="ghost" onClick={() => onNext(false)} className={NAV_BUTTON_CLASS}>
              Connecter plus tard
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => onNext(linkedInConnected)}
            disabled={!linkedInConnected}
            className={NAV_BUTTON_CLASS}
          >
            Continuer
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
};
