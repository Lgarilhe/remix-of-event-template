import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, ExternalLink, RefreshCw, Mail, Lock, Unplug } from 'lucide-react';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { Button } from '@/components/ui/button';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

import linkedinLogo from '@/assets/linkedin-logo.webp';

interface Props {
  onNext: (connectedCount: number) => void;
  onBack: () => void;
}

type HostedProvider = 'LINKEDIN' | 'WHATSAPP' | 'GOOGLE' | 'OUTLOOK';

interface UnipileEmailAccount {
  id: string;
  identifier?: string;
  name?: string;
  type?: string;
}

const LINKEDIN_BENEFITS = [
  'Invitations, messages et relances entièrement automatisés',
  'Fonctionne 24h/24, même ordinateur éteint',
  'Connexion sécurisée, déconnectable à tout moment',
];

export const SceneIntegrations: React.FC<Props> = ({ onNext, onBack }) => {
  const { accounts, loading: linkedInLoading, reload: reloadLinkedIn } = useLinkedInAccounts();
  const { mappings, linkAccount, getMappingForAccount } = useMemberEmailAccounts();
  const { organization } = useOrganization();

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUserId(user?.id ?? null));
  }, []);

  const linkedInConnected = accounts.some((a: any) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP');
  const whatsappConnected = accounts.some((a: any) => a.type === 'WHATSAPP' || a.provider === 'WHATSAPP');
  const emailConnected = !!currentUserId && mappings.some((m) => m.user_id === currentUserId);
  const totalConnected = (linkedInConnected ? 1 : 0) + (whatsappConnected ? 1 : 0) + (emailConnected ? 1 : 0);

  const handleHostedConnect = async (defId: string, provider: HostedProvider) => {
    setConnectingId(defId);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'hosted_auth_link',
        providers: [provider],
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });
      if (data?.success && (data as any).url) {
        window.open((data as any).url, '_blank', 'noopener,noreferrer');
        const msg = provider === 'WHATSAPP'
          ? 'Scannez le QR code dans la fenêtre qui s\'est ouverte.'
          : provider === 'LINKEDIN'
          ? 'Fenêtre de connexion LinkedIn ouverte. Revenez ici après connexion.'
          : 'Fenêtre de connexion email ouverte. Revenez ici après connexion, puis actualisez.';
        toast.info(msg);
      } else {
        throw new Error((data as any)?.error || 'Erreur');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la connexion');
    } finally {
      setConnectingId(null);
    }
  };

  /** Récupère les comptes email connectés et associe automatiquement le premier compte libre à l'utilisateur. */
  const claimEmailAccount = useCallback(async () => {
    if (!currentUserId || emailConnected) return;
    try {
      const { data } = await invokeEdgeFunction('unipile-accounts', { action: 'list_email' });
      if ((data as any)?.success && Array.isArray((data as any).accounts)) {
        const unclaimed = ((data as any).accounts as UnipileEmailAccount[]).find(
          (acc) => !getMappingForAccount(acc.id)
        );
        if (unclaimed) {
          linkAccount({
            userId: currentUserId,
            emailAccountId: unclaimed.id,
            emailAddress: unclaimed.identifier || unclaimed.name || undefined,
            provider: unclaimed.type || undefined,
          });
        }
      }
    } catch (err) {
      console.warn('[SceneIntegrations] Email claim failed:', err);
    }
  }, [currentUserId, emailConnected, getMappingForAccount, linkAccount]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([reloadLinkedIn(), claimEmailAccount()]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadLinkedIn, claimEmailAccount]);

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Automatisez votre sourcing</h2>
        <p className="text-muted-foreground text-sm">
          Connectez vos canaux : LinkedIn d’abord, l’email et WhatsApp démultiplient ensuite vos séquences.
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">LinkedIn</span>
              <span className="text-2xs uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-foreground">
                Recommandé
              </span>
            </div>
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
            onClick={() => handleHostedConnect('linkedin', 'LINKEDIN')}
            disabled={connectingId === 'linkedin'}
            className="w-full h-10 text-sm font-semibold text-white bg-linkedin hover:bg-linkedin-hover"
          >
            {connectingId === 'linkedin' ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-2" />
            )}
            Connecter LinkedIn
          </Button>
        )}
      </motion.div>

      {/* Canaux secondaires */}
      <div className="grid sm:grid-cols-2 gap-2.5">
        {/* Email */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={`rounded-lg border p-3 transition-colors duration-300 ${
            emailConnected ? 'border-success/40 bg-success/5' : 'border-border'
          }`}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-7 h-7 flex items-center justify-center rounded-lg bg-emerald-500/15 shrink-0">
              <Mail className="w-3.5 h-3.5 text-foreground" strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold flex-1">Email pro</span>
            {emailConnected && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground mb-2.5">Séquences email depuis votre adresse.</p>
          {!emailConnected && (
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleHostedConnect('email', 'GOOGLE')}
                disabled={connectingId === 'email'}
                className="flex-1 h-8 text-xs"
              >
                Gmail
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleHostedConnect('email', 'OUTLOOK')}
                disabled={connectingId === 'email'}
                className="flex-1 h-8 text-xs"
              >
                Outlook
              </Button>
            </div>
          )}
        </motion.div>

        {/* WhatsApp */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.26 }}
          className={`rounded-lg border p-3 transition-colors duration-300 ${
            whatsappConnected ? 'border-success/40 bg-success/5' : 'border-border'
          }`}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <img src={whatsappLogo} alt="WhatsApp" className="w-7 h-7 object-contain shrink-0" />
            <span className="text-sm font-semibold flex-1">WhatsApp</span>
            {whatsappConnected && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground mb-2.5">Le canal au meilleur taux de lecture.</p>
          {!whatsappConnected && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleHostedConnect('whatsapp', 'WHATSAPP')}
              disabled={connectingId === 'whatsapp'}
              className="w-full h-8 text-xs"
            >
              {connectingId === 'whatsapp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Scanner le QR code'}
            </Button>
          )}
        </motion.div>
      </div>

      {/* Confiance + refresh */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex items-center justify-center gap-4 flex-wrap"
      >
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Lock className="w-3 h-3" /> Chiffré de bout en bout
        </span>
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Unplug className="w-3 h-3" /> Déconnectable à tout moment
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || linkedInLoading}
          className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Actualiser les connexions"
        >
          <RefreshCw className={`w-3 h-3 ${(refreshing || linkedInLoading) ? 'animate-spin' : ''}`} />
          {totalConnected}/3 connectés — actualiser
        </button>
      </motion.div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <div className="flex items-center gap-2">
          {totalConnected === 0 && (
            <Button variant="ghost" onClick={() => onNext(0)} className="text-sm text-muted-foreground">
              Connecter plus tard
            </Button>
          )}
          <Button
            onClick={() => onNext(totalConnected)}
            disabled={totalConnected === 0}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            Continuer <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
