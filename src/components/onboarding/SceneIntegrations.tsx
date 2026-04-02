import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { Button } from '@/components/ui/button';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

import integrationsIcon from '@/assets/icon-integrations-3d.webp';
import linkedinLogo from '@/assets/linkedin-logo.webp';

interface Props {
  onNext: () => void;
  onBack: () => void;
}

interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  logo: string;
  essential?: boolean;
  hostedAuth?: boolean;
  fields?: { key: string; label: string; placeholder: string; secret?: boolean }[];
  connectedKey?: string;
}

const INTEGRATIONS: IntegrationDef[] = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Sourcing, messages et InMails directement depuis la plateforme.',
    logo: linkedinLogo,
    essential: true,
    hostedAuth: true,
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Envoyez des messages WhatsApp dans vos séquences multicanales.',
    logo: whatsappLogo,
    hostedAuth: true,
  },
];

export const SceneIntegrations: React.FC<Props> = ({ onNext, onBack }) => {
  const { accounts, loading: linkedInLoading, reload: reloadLinkedIn } = useLinkedInAccounts();
  const { organization } = useOrganization();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set());
  const [refreshingLinkedIn, setRefreshingLinkedIn] = useState(false);

  const linkedInConnected = accounts.some((a: any) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP');
  const whatsappConnected = accounts.some((a: any) => a.type === 'WHATSAPP' || a.provider === 'WHATSAPP');
  const totalConnected = (linkedInConnected ? 1 : 0) + (whatsappConnected ? 1 : 0);

  const isConnected = (def: IntegrationDef) => {
    if (def.id === 'linkedin') return linkedInConnected;
    if (def.id === 'whatsapp') return whatsappConnected;
    return connectedIds.has(def.id);
  };

  const handleHostedConnect = async (provider: 'LINKEDIN' | 'WHATSAPP') => {
    const defId = provider.toLowerCase();
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
          : 'Fenêtre de connexion LinkedIn ouverte. Revenez ici après connexion.';
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

  const handleRefreshLinkedIn = useCallback(async () => {
    setRefreshingLinkedIn(true);
    try { await reloadLinkedIn(); } finally { setRefreshingLinkedIn(false); }
  }, [reloadLinkedIn]);

  // handleFieldSave is no longer needed — only LinkedIn is shown in onboarding

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-[0.2em] font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          04 — Vos outils
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Connectez vos comptes</h2>
        <p className="text-muted-foreground text-sm">
          LinkedIn est essentiel pour le sourcing. WhatsApp permet d'enrichir vos séquences multicanales.
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

      {/* Integration cards */}
      <div className="space-y-3">
        {INTEGRATIONS.map((def, i) => {
          const connected = isConnected(def);
          const isExpanded = expandedId === def.id;
          const isLoading = connectingId === def.id;

          return (
            <motion.div
              key={def.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 }}
              className="border-2 border-border overflow-hidden"
            >
              <div className="flex items-center gap-3 p-3">
                <img src={def.logo} alt={def.name} className="w-8 h-8 object-contain shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{def.name}</span>
                    {def.essential && (
                      <span
                        className="text-xs uppercase tracking-wider font-bold px-1.5 py-0.5 border border-border"
                        style={{ background: 'hsl(var(--landing-accent-yellow))' }}
                      >
                        Essentiel
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{def.description}</p>
                </div>

                {connected ? (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider shrink-0"
                    style={{ color: 'hsl(var(--skalr-green))' }}
                  >
                    <Check className="w-3.5 h-3.5" /> Connecté
                  </div>
                ) : def.hostedAuth ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleHostedConnect(def.id === 'whatsapp' ? 'WHATSAPP' : 'LINKEDIN')}
                      disabled={isLoading}
                      className="text-xs uppercase tracking-wider font-bold border-2 border-border bg-foreground text-background hover:bg-foreground/90 h-8 px-3"
                      style={{ boxShadow: '2px 2px 0px 0px hsl(var(--primary))' }}
                    >
                      {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 mr-1" />}
                      Connecter
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRefreshLinkedIn}
                      disabled={refreshingLinkedIn || linkedInLoading}
                      className="h-8 w-8 p-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${(refreshingLinkedIn || linkedInLoading) ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setExpandedId(isExpanded ? null : def.id)}
                    className="text-xs uppercase tracking-wider font-bold border-2 border-border bg-foreground text-background hover:bg-foreground/90 h-8 px-3 shrink-0"
                    style={{ boxShadow: '2px 2px 0px 0px hsl(var(--primary))' }}
                  >
                    Connecter
                  </Button>
                )}
              </div>

            </motion.div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} className="gap-2 border-2 border-border text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={onNext}
          className="gap-2 border-2 border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
        >
          <ArrowRight className="w-4 h-4" />
          {totalConnected > 0 ? 'Continuer' : 'Passer'}
        </Button>
      </div>
    </div>
  );
};
