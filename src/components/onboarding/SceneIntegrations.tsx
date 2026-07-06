import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, ExternalLink, RefreshCw, Mail } from 'lucide-react';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { Button } from '@/components/ui/button';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

import integrationsIcon from '@/assets/icon-integrations-3d.webp';
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

  const rows: {
    id: string;
    name: string;
    description: string;
    logo?: string;
    icon?: React.ReactNode;
    essential?: boolean;
    connected: boolean;
    actions: { label: string; provider: HostedProvider }[];
  }[] = [
    {
      id: 'linkedin',
      name: 'LinkedIn',
      description: 'Sourcing, messages et InMails directement depuis la plateforme.',
      logo: linkedinLogo,
      essential: true,
      connected: linkedInConnected,
      actions: [{ label: 'Connecter', provider: 'LINKEDIN' }],
    },
    {
      id: 'email',
      name: 'Email professionnel',
      description: 'Envoyez et suivez vos séquences email depuis votre adresse.',
      icon: <Mail className="w-4 h-4 text-foreground" strokeWidth={2} />,
      connected: emailConnected,
      actions: [
        { label: 'Gmail', provider: 'GOOGLE' },
        { label: 'Outlook', provider: 'OUTLOOK' },
      ],
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      description: 'Envoyez des messages WhatsApp dans vos séquences multicanales.',
      logo: whatsappLogo,
      connected: whatsappConnected,
      actions: [{ label: 'Connecter', provider: 'WHATSAPP' }],
    },
  ];

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Connectez vos comptes</h2>
        <p className="text-muted-foreground text-sm">
          LinkedIn est essentiel pour le sourcing. L'email et WhatsApp démultiplient vos séquences multicanales.
        </p>
      </div>

      <motion.img
        src={integrationsIcon}
        alt=""
        aria-hidden="true"
        className="mx-auto w-16 h-16 drop-shadow-md"
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
      />

      {/* Compteur de connexions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="flex items-center justify-center gap-2"
      >
        <div className="flex items-center gap-1" aria-hidden="true">
          {rows.map((r) => (
            <motion.span
              key={r.id}
              className="w-6 h-1 rounded-full"
              animate={{ background: r.connected ? 'hsl(var(--success))' : 'hsl(var(--foreground) / 0.12)' }}
              transition={{ duration: 0.4 }}
            />
          ))}
        </div>
        <span className="text-2xs font-mono text-muted-foreground">
          {totalConnected}/{rows.length} canaux connectés
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          disabled={refreshing || linkedInLoading}
          className="h-6 w-6 p-0"
          aria-label="Actualiser les connexions"
        >
          <RefreshCw className={`w-3 h-3 ${(refreshing || linkedInLoading) ? 'animate-spin' : ''}`} />
        </Button>
      </motion.div>

      {/* Integration cards */}
      <div className="space-y-3">
        {rows.map((def, i) => {
          const isLoading = connectingId === def.id;

          return (
            <motion.div
              key={def.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className={`rounded-lg border overflow-hidden transition-colors duration-300 ${
                def.connected ? 'border-success/40 bg-success/5' : 'border-border'
              }`}
            >
              <div className="flex items-center gap-3 p-3">
                {def.logo ? (
                  <img src={def.logo} alt={def.name} className="w-8 h-8 object-contain shrink-0" />
                ) : (
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-500/15 shrink-0">
                    {def.icon}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{def.name}</span>
                    {def.essential && (
                      <span className="text-xs uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-foreground">
                        Essentiel
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{def.description}</p>
                </div>

                {def.connected ? (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider shrink-0 text-success"
                  >
                    <Check className="w-3.5 h-3.5" /> Connecté
                  </motion.div>
                ) : (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {def.actions.map((action) => (
                      <Button
                        key={action.provider}
                        size="sm"
                        onClick={() => handleHostedConnect(def.id, action.provider)}
                        disabled={isLoading}
                        className="text-xs uppercase tracking-wider font-bold border border-border bg-foreground text-background hover:bg-foreground/90 h-8 px-3"
                      >
                        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-1" />}
                        {action.label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} className="gap-2 border border-border text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={() => onNext(totalConnected)}
          className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
        >
          <ArrowRight className="w-4 h-4" />
          {totalConnected > 0 ? 'Continuer' : 'Passer'}
        </Button>
      </div>
    </div>
  );
};
