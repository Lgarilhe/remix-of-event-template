import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, ExternalLink, RefreshCw, Lock, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

/**
 * Scène de connexion LinkedIn — la seule intégration indispensable pour
 * utiliser l'app (sourcing + messages). Email et WhatsApp se connectent
 * plus tard depuis les Réglages.
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
        toast.info('Fenêtre de connexion LinkedIn ouverte. Revenez ici après connexion.');
      } else {
        throw new Error(data?.error || 'Erreur');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erreur lors de la connexion');
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
    <div className="w-full flex flex-col gap-5">
      {/* Header */}
      <div className="mb-2">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">Branchez le moteur.</h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Sans LinkedIn connecté, pas de sourcing ni de messages.
        </p>
      </div>

      {/* Hero LinkedIn */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={`rounded-xl border p-4 sm:p-5 transition-colors duration-300 ${
          linkedInConnected ? 'border-success/40 bg-success/5' : 'border-border bg-background/40'
        }`}
      >
        <div className="flex items-center gap-3 mb-3">
          <img src={linkedinLogo} alt="LinkedIn" className="w-9 h-9 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold">LinkedIn</span>
            <p className="text-xs text-muted-foreground">Le moteur de votre sourcing.</p>
          </div>
          {linkedInConnected && (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-success shrink-0"
            >
              <Check className="w-3.5 h-3.5" /> Connecté
            </motion.div>
          )}
        </div>

        <ul className="space-y-1.5 mb-4">
          {LINKEDIN_BENEFITS.map((benefit, i) => (
            <motion.li
              key={benefit}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              className="flex items-start gap-2 text-xs text-foreground/85"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-px" />
              {benefit}
            </motion.li>
          ))}
        </ul>

        {!linkedInConnected && (
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full h-10 text-sm font-semibold text-white bg-linkedin hover:bg-linkedin-hover"
          >
            {connecting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-2" />
            )}
            Connecter LinkedIn
          </Button>
        )}
      </motion.div>

      {/* Confiance + refresh */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex items-center justify-center gap-4 flex-wrap"
      >
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Lock className="w-3 h-3" /> Connexion sécurisée
        </span>
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Unplug className="w-3 h-3" /> Déconnectable à tout moment
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Actualiser la connexion"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          Actualiser
        </button>
      </motion.div>

      {/* Navigation */}
      <div className={`flex items-center pt-2 ${onBack ? 'justify-between' : 'justify-end'}`}>
        {onBack && (
          <Button variant="ghost" onClick={onBack} className="gap-2 text-sm">
            <ArrowLeft className="w-4 h-4" /> Retour
          </Button>
        )}
        <div className="flex items-center gap-2">
          {!linkedInConnected && (
            <Button variant="ghost" onClick={() => onNext(false)} className="text-sm text-muted-foreground">
              Connecter plus tard
            </Button>
          )}
          <Button
            onClick={() => onNext(linkedInConnected)}
            disabled={!linkedInConnected}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            Continuer <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
