import { useState, useEffect } from 'react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrganizationIntegrations } from '@/hooks/useOrganizationIntegrations';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import {
  Eye,
  EyeOff,
  Check,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  RefreshCw,
  Linkedin,
  Trash2,
} from 'lucide-react';
import { WebhookManager } from '@/components/outreach/WebhookManager';
import { ProxyConfigPanel } from '@/components/outreach/ProxyConfigPanel';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { BrutalLoader } from '@/components/ui/brutal-loader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

import notionLogo from '@/assets/notion-logo.webp';
import calendlyLogo from '@/assets/calendly-logo.webp';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import airtableLogo from '@/assets/airtable-logo.svg';
import aircallLogo from '@/assets/aircall-logo.webp';

interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

interface IntegrationConfig {
  id: string;
  name: string;
  description: string;
  logoSrc: string;
  connectedKey: string;
  fields: IntegrationField[];
  hostedAuth?: boolean;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'notion',
    name: 'Notion',
    description: 'Synchronisation des postes, candidats et shortlists avec vos bases Notion.',
    logoSrc: notionLogo,
    connectedKey: 'notion_connected',
    fields: [
      { key: 'notion_api_key', label: 'Clé API Notion', placeholder: 'ntn_...', secret: true },
      { key: 'notion_postes_db_id', label: 'ID base Postes', placeholder: 'xxxxxxxx-xxxx-...' },
      { key: 'notion_candidats_db_id', label: 'ID base Candidats', placeholder: 'xxxxxxxx-xxxx-...' },
      { key: 'notion_shortlist_db_id', label: 'ID base Shortlist', placeholder: 'xxxxxxxx-xxxx-...' },
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Synchronisation automatique des rendez-vous de qualification.',
    logoSrc: calendlyLogo,
    connectedKey: 'calendly_connected',
    fields: [
      { key: 'calendly_api_key', label: 'Clé API Calendly', placeholder: 'eyJ...', secret: true },
    ],
  },
  {
    id: 'unipile',
    name: 'LinkedIn',
    description: 'Connectez votre compte LinkedIn pour la recherche de profils, l\'envoi de messages et InMails.',
    logoSrc: linkedinLogo,
    connectedKey: 'unipile_connected',
    hostedAuth: true,
    fields: [],
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Synchronisation des données avec vos bases Airtable (candidats, placements, KPIs).',
    logoSrc: airtableLogo,
    connectedKey: 'airtable_connected',
    fields: [
      { key: 'airtable_api_key', label: 'Clé API Airtable', placeholder: 'pat...', secret: true },
      { key: 'airtable_base_id', label: 'ID Base principale', placeholder: 'app...' },
      { key: 'airtable_base_id_2', label: 'ID Base secondaire (optionnel)', placeholder: 'app...' },
    ],
  },
  {
    id: 'aircall',
    name: 'Aircall',
    description: 'Suivi des appels et correspondance automatique avec les candidats.',
    logoSrc: aircallLogo,
    connectedKey: 'aircall_connected',
    fields: [
      { key: 'aircall_api_id', label: 'API ID Aircall', placeholder: 'xxx...' },
      { key: 'aircall_api_token', label: 'API Token Aircall', placeholder: 'xxx...', secret: true },
    ],
  },
];
/* ──────────────────────────────────────────────
 *  LinkedIn Hosted Auth Card (white-label)
 * ────────────────────────────────────────────── */
const LinkedInHostedAuthCard = ({
  config,
}: {
  config: IntegrationConfig;
  values: Record<string, string | null>;
  onSave: (updates: Record<string, any>) => Promise<void>;
  isSaving: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { accounts: linkedInAccounts, loading: loadingAccounts, reload: loadAccounts } = useLinkedInAccounts();
  const { organization } = useOrganization();
  const { mappings, getMappingForAccount } = useMemberLinkedInAccounts();
  const [proxyCache, setProxyCache] = useState<Record<string, { country: string | null; mode: string | null }>>({});
  const [disconnecting, setDisconnecting] = useState<string | null>(null);

  // Initialize proxy cache from mappings (use JSON key to avoid infinite loop)
  const mappingsKey = JSON.stringify(mappings.map(m => [m.linkedin_account_id, m.proxy_country, m.proxy_mode]));
  useEffect(() => {
    const cache: Record<string, { country: string | null; mode: string | null }> = {};
    mappings.forEach(m => {
      cache[m.linkedin_account_id] = { country: m.proxy_country, mode: m.proxy_mode ?? null };
    });
    setProxyCache(cache);
  }, [mappingsKey]);
  const handleConnectLinkedIn = async () => {
    setGenerating(true);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'hosted_auth_link',
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });

      if (data?.success && (data as any).url) {
        window.open((data as any).url, '_blank', 'noopener,noreferrer');
        toast.info('Une fenêtre de connexion LinkedIn s\'est ouverte. Revenez ici une fois la connexion effectuée.');
      } else {
        throw new Error((data as any)?.error || 'Erreur lors de la génération du lien');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la connexion');
    } finally {
      setGenerating(false);
    }
  };

  const handleDisconnectAccount = async (accountId: string) => {
    setDisconnecting(accountId);
    try {
      const { data } = await invokeEdgeFunction('unipile-accounts', {
        action: 'disconnect',
        account_id: accountId,
      });
      if (data?.success) {
        toast.success('Compte LinkedIn déconnecté');
        await loadAccounts();
      } else {
        throw new Error((data as any)?.error || 'Erreur');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erreur lors de la déconnexion');
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <Card>
      <button
        className="w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 flex items-center justify-center rounded-lg overflow-hidden">
                <img src={config.logoSrc} alt={config.name} className="w-10 h-10 object-contain" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">{config.name}</CardTitle>
                <CardDescription className="text-xs">{config.description}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {loadingAccounts && linkedInAccounts.length === 0 ? (
                <Badge variant="secondary" className="text-xs px-2">
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Vérification…
                </Badge>
              ) : linkedInAccounts.length > 0 ? (
                <Badge
                  variant="default"
                  className="text-xs px-2 bg-green-600 text-white hover:bg-green-700"
                >
                  {linkedInAccounts.length} compte{linkedInAccounts.length > 1 ? 's' : ''} connecté{linkedInAccounts.length > 1 ? 's' : ''}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs px-2">
                  Non connecté
                </Badge>
              )}
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-4 space-y-4">
          {/* Connected accounts list */}
          {loadingAccounts ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Chargement des comptes...</span>
            </div>
          ) : linkedInAccounts.length > 0 ? (
          <div className="space-y-2">
              {linkedInAccounts.map((account: any) => (
                <div key={account.id} className="p-3 bg-muted/50 rounded-lg space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {account.profile_picture_url ? (
                        <img src={account.profile_picture_url} alt={account.name || 'Photo de profil'} className="w-8 h-8 rounded-full" />
                      ) : (
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                          <Linkedin className="w-4 h-4 text-primary" />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground">{account.name}</p>
                        <div className="flex items-center gap-1.5">
                          <div className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            account.status === 'OK' ? 'bg-green-500' : 'bg-amber-500'
                          )} />
                          <span className="text-xs text-muted-foreground">
                            {account.status === 'OK' ? 'Actif' : account.status}
                          </span>
                        </div>
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          disabled={disconnecting === account.id}
                        >
                          {disconnecting === account.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Déconnecter ce compte LinkedIn ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Le compte <strong>{account.name}</strong> sera supprimé de la plateforme. Vous pourrez le reconnecter ultérieurement.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDisconnectAccount(account.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Déconnecter
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  {account.status === 'OK' && (() => {
                    const mapping = getMappingForAccount(account.id);
                    const cached = proxyCache[account.id];
                    return (
                      <ProxyConfigPanel
                        accountId={account.id}
                        accountName={account.name || account.id}
                        currentCountry={cached?.country ?? mapping?.proxy_country ?? null}
                        currentMode={cached?.mode ?? mapping?.proxy_mode ?? null}
                        currentHost={mapping?.proxy_host ?? null}
                        currentPort={mapping?.proxy_port ?? null}
                        currentProtocol={mapping?.proxy_protocol ?? null}
                        proxyIsActive={mapping?.proxy_is_active ?? null}
                        proxyLastError={mapping?.proxy_last_error ?? null}
                        onUpdated={(country, mode) => setProxyCache(prev => ({ ...prev, [account.id]: { country, mode } }))}
                      />
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              Aucun compte LinkedIn connecté.
            </p>
          )}

          {/* Connect button */}
          <div className="flex gap-2">
            <Button
              onClick={handleConnectLinkedIn}
              disabled={generating}
              className="flex-1"
              size="sm"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ExternalLink className="w-4 h-4 mr-2" />
              )}
              Connecter un compte LinkedIn
            </Button>
            {linkedInAccounts.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={loadAccounts}
                disabled={loadingAccounts}
              >
                <RefreshCw className={cn('w-4 h-4', loadingAccounts && 'animate-spin')} />
              </Button>
            )}
          </div>

          {/* Webhook management */}
          {linkedInAccounts.length > 0 && (
            <WebhookManager />
          )}
        </CardContent>
      )}
    </Card>
  );
};




/* ──────────────────────────────────────────────
 *  Generic integration card (API key based)
 * ────────────────────────────────────────────── */
const IntegrationCard = ({
  config,
  values,
  onSave,
  isSaving,
}: {
  config: IntegrationConfig;
  values: Record<string, string | null>;
  onSave: (updates: Record<string, any>) => Promise<void>;
  isSaving: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const isConnected = !!values[config.connectedKey];
  

  useEffect(() => {
    const initial: Record<string, string> = {};
    config.fields.forEach(f => {
      initial[f.key] = values[f.key] || '';
    });
    setLocalValues(initial);
  }, [values, config.fields]);

  const hasChanges = config.fields.some(f => (localValues[f.key] || '') !== (values[f.key] || ''));

  const handleSave = async () => {
    const updates: Record<string, any> = {};
    config.fields.forEach(f => {
      updates[f.key] = localValues[f.key] || null;
    });
    const allFilled = config.fields.every(f =>
      f.key.includes('_2') || !!localValues[f.key]?.trim()
    );
    updates[config.connectedKey] = allFilled;
    await onSave(updates);
  };

  return (
    <Card>
      <button
        className="w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 flex items-center justify-center rounded-lg overflow-hidden">
                <img src={config.logoSrc} alt={config.name} className="w-10 h-10 object-contain" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">{config.name}</CardTitle>
                <CardDescription className="text-xs">{config.description}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={isConnected ? 'default' : 'secondary'}
                className={cn(
                  'text-xs px-2',
                  isConnected && 'bg-green-600 text-white hover:bg-green-700'
                )}
              >
                {isConnected ? 'Connecté' : 'Non configuré'}
              </Badge>
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="pt-0 pb-4 space-y-4">
          {config.fields.map(field => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">{field.label}</label>
              <div className="relative">
                <Input
                  type={field.secret && !showSecrets[field.key] ? 'password' : 'text'}
                  placeholder={field.placeholder}
                  value={localValues[field.key] || ''}
                  onChange={(e) =>
                    setLocalValues(prev => ({ ...prev, [field.key]: e.target.value }))
                  }
                  className="pr-10 text-sm border-foreground/15"
                />
                {field.secret && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setShowSecrets(prev => ({ ...prev, [field.key]: !prev[field.key] }))
                    }
                  >
                    {showSecrets[field.key] ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="w-full mt-2"
            size="sm"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            Enregistrer
          </Button>
        </CardContent>
      )}
    </Card>
  );
};

/* ──────────────────────────────────────────────
 *  Main settings component
 * ────────────────────────────────────────────── */
export const IntegrationsSettings = () => {
  const { integrations, isLoading, updateIntegration, isUpdating } = useOrganizationIntegrations();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [manuallyAdded, setManuallyAdded] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <BrutalLoader compact />
      </div>
    );
  }

  const values = (integrations || {}) as Record<string, any>;

  // Only show API-key integrations (Notion, Airtable, Calendly, Aircall) if already configured
  const visibleIntegrations = INTEGRATIONS.filter(config => {
    if (config.hostedAuth) return true;
    return !!values[config.connectedKey];
  });

  const hiddenIntegrations = INTEGRATIONS.filter(config => 
    !config.hostedAuth && !values[config.connectedKey]
  );

  const allVisible = [
    ...visibleIntegrations,
    ...INTEGRATIONS.filter(c => manuallyAdded.has(c.id) && !visibleIntegrations.some(v => v.id === c.id)),
  ];

  const remainingHidden = hiddenIntegrations.filter(c => !manuallyAdded.has(c.id));

  return (
    <div className="space-y-3">
      {allVisible.map(config =>
        config.hostedAuth ? (
          <LinkedInHostedAuthCard
            key={config.id}
            config={config}
            values={values}
            onSave={updateIntegration}
            isSaving={isUpdating}
          />
        ) : (
          <IntegrationCard
            key={config.id}
            config={config}
            values={values}
            onSave={updateIntegration}
            isSaving={isUpdating}
          />
        )
      )}

      {/* Add integration button */}
      {remainingHidden.length > 0 && (
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="w-full border-dashed border-2 text-muted-foreground hover:text-foreground"
          >
            + Ajouter une intégration
          </Button>
          {showAddMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-lg shadow-lg z-10 p-2 space-y-1">
              {remainingHidden.map(config => (
                <button
                  key={config.id}
                  onClick={() => {
                    setManuallyAdded(prev => new Set(prev).add(config.id));
                    setShowAddMenu(false);
                  }}
                  className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-muted text-left"
                >
                  <img src={config.logoSrc} alt={config.name} className="w-6 h-6 object-contain" />
                  <div>
                    <p className="text-sm font-medium">{config.name}</p>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
