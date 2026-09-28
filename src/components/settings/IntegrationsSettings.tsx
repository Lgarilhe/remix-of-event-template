import { useState, useEffect, useId, type ReactNode } from 'react';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorBox } from '@/components/marketplace/ErrorBox';
import { useOrganizationIntegrations } from '@/hooks/useOrganizationIntegrations';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { classifyLinkedInStatus, type LinkedInHealth } from '@/lib/linkedinStatus';
import { plural } from '@/lib/plural';
import {
  Check,
  ChevronDown,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { WebhookManager } from '@/components/outreach/WebhookManager';
import { ProxyConfigPanel } from '@/components/outreach/ProxyConfigPanel';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { confirmAlert } from '@/lib/confirmAlert';
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
  /** Retirée de « Ajouter une intégration » : la carte ne reste que si une clé est posée, pour pouvoir la retirer. */
  retired?: boolean;
}

const INTEGRATIONS: IntegrationConfig[] = [
  // Notion par clé API : retiré, la carte reste visible tant qu'une clé est
  // enregistrée pour pouvoir la retirer (jusqu'à la suppression des colonnes).
  {
    id: 'notion',
    name: 'Notion',
    description: 'Synchronisation par clé API retirée. Retirez la clé pour arrêter toute écriture dans vos bases Notion.',
    logoSrc: notionLogo,
    connectedKey: 'notion_connected',
    retired: true,
    fields: [
      { key: 'notion_api_key', label: 'Clé API Notion', placeholder: 'ntn_…', secret: true },
    ],
  },
  {
    id: 'calendly',
    name: 'Calendly',
    description: 'Synchronisation automatique des rendez-vous de qualification.',
    logoSrc: calendlyLogo,
    connectedKey: 'calendly_connected',
    retired: true,
    fields: [
      { key: 'calendly_api_key', label: 'Clé API Calendly', placeholder: 'eyJ…', secret: true },
    ],
  },
  {
    id: 'unipile',
    name: 'Comptes LinkedIn de l\'organisation',
    description: 'Gérez tous les comptes LinkedIn connectés par les membres : statut, proxys par compte, dissociation admin. Pour connecter votre propre compte, allez dans Connexions.',
    logoSrc: linkedinLogo,
    connectedKey: 'unipile_connected',
    hostedAuth: true,
    fields: [],
  },
  {
    id: 'aircall',
    name: 'Aircall',
    description: 'Suivi des appels et correspondance automatique avec les candidats.',
    logoSrc: aircallLogo,
    connectedKey: 'aircall_connected',
    retired: true,
    fields: [
      { key: 'aircall_api_id', label: 'Identifiant API Aircall', placeholder: 'xxx…' },
      { key: 'aircall_api_token', label: 'Jeton API Aircall', placeholder: 'xxx…', secret: true },
    ],
  },
];
/* ──────────────────────────────────────────────
 *  État et en-tête communs aux cartes
 * ────────────────────────────────────────────── */
type StatusTone = 'success' | 'warning' | 'danger' | 'muted';
const DOT: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  muted: 'bg-muted-foreground',
};

/** Revue design (F-14) : un état se lit en mot, précédé d'une pastille de 6 px ; plus de badge plein. */
const StatusText = ({ tone, children }: { tone: StatusTone; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
    {children}
  </span>
);

/** Même lecture du statut que la carte « Mon compte LinkedIn » (src/lib/linkedinStatus.ts), jamais le code brut. */
const LINKEDIN_HEALTH: Record<LinkedInHealth, { label: string; tone: StatusTone }> = {
  connected: { label: 'Connecté', tone: 'success' },
  connecting: { label: 'Connexion en cours', tone: 'warning' },
  needs_reconnect: { label: 'À reconnecter', tone: 'danger' },
  unknown: { label: 'État à vérifier', tone: 'muted' },
};

/**
 * En-tête repliable d'une carte d'outil. Revue design (F-15, F-24) : titre de
 * niveau 4 sous « Outils reliés », bouton du kit avec aria-expanded (posé par
 * CollapsibleTrigger), logo dans une tuile qui ne se comprime pas.
 */
const IntegrationHeader = ({ config, open, status }: { config: IntegrationConfig; open: boolean; status: ReactNode }) => (
  <h4>
    <CollapsibleTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-3 whitespace-normal rounded-xl p-4 text-left font-normal active:scale-100"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
          <img src={config.logoSrc} alt="" className="h-7 w-7 object-contain" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{config.name}</span>
          <span className="block text-xs text-muted-foreground">{config.description}</span>
          <span className="mt-1 flex sm:hidden">{status}</span>
        </span>
        <span className="hidden shrink-0 sm:flex">{status}</span>
        <ChevronDown className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </Button>
    </CollapsibleTrigger>
  </h4>
);

/* ──────────────────────────────────────────────
 *  LinkedIn Hosted Auth Card (white-label)
 * ────────────────────────────────────────────── */
const LinkedInHostedAuthCard = ({
  config,
}: {
  config: IntegrationConfig;
  values: Record<string, string | null>;
  onSave: (updates: Record<string, string | boolean | null>) => Promise<void>;
  isSaving: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const {
    accounts: linkedInAccounts, loading: loadingAccounts, ready: accountsReady, loadError: accountsError, reload: loadAccounts,
  } = useLinkedInAccounts();
  const { organization } = useOrganization();
  const { mappings, getMappingForAccount } = useMemberLinkedInAccounts();
  const [proxyCache, setProxyCache] = useState<Record<string, { country: string | null; mode: string | null }>>({});
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // Liste jamais reçue : ni « Aucun compte » ni « Non connecté », qui seraient faux.
  const listFailed = accountsError && !accountsReady;

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
      const { data } = await invokeEdgeFunction<{ url?: string }>('unipile-accounts', {
        action: 'hosted_auth_link',
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });

      if (data?.success && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        toast.info('Une fenêtre de connexion LinkedIn s\'est ouverte. Revenez ici une fois la connexion effectuée.');
      } else {
        throw new Error(data?.error || 'Le lien de connexion n\'a pas pu être créé. Réessayez.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : 'La connexion n\'a pas pu démarrer. Réessayez.');
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
        throw new Error(data?.error || 'Le compte n\'a pas pu être déconnecté. Réessayez.');
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error && e.message ? e.message : 'Le compte n\'a pas pu être déconnecté. Réessayez.');
    } finally {
      setDisconnecting(null);
    }
  };

  // Un compte à reconnecter est l'écart à signaler : il prend le pas sur le nombre de comptes.
  const toReconnect = linkedInAccounts.filter((a) => classifyLinkedInStatus(a.status) === 'needs_reconnect').length;
  const status = loadingAccounts && linkedInAccounts.length === 0 ? (
    <StatusText tone="muted">Vérification…</StatusText>
  ) : listFailed ? (
    <StatusText tone="muted">État indisponible</StatusText>
  ) : toReconnect > 0 ? (
    <StatusText tone="danger">{plural(toReconnect, 'compte à reconnecter', 'comptes à reconnecter')}</StatusText>
  ) : linkedInAccounts.length > 0 ? (
    <StatusText tone="success">{plural(linkedInAccounts.length, 'compte connecté', 'comptes connectés')}</StatusText>
  ) : (
    <StatusText tone="muted">Non connecté</StatusText>
  );

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <IntegrationHeader config={config} open={expanded} status={status} />

        <CollapsibleContent className="space-y-4 px-4 pb-4">
          {/* Connected accounts list */}
          {loadingAccounts && linkedInAccounts.length === 0 ? (
            <div className="space-y-2">
              <p role="status" className="sr-only">Chargement des comptes LinkedIn…</p>
              <Skeleton className="h-14 w-full rounded-lg" aria-hidden="true" />
              <Skeleton className="h-14 w-full rounded-lg" aria-hidden="true" />
            </div>
          ) : listFailed ? (
            <ErrorBox title="Impossible de charger les comptes LinkedIn." onRetry={() => { void loadAccounts(); }} />
          ) : linkedInAccounts.length > 0 ? (
            <div className="space-y-2">
              {linkedInAccounts.map((account) => {
                const health = LINKEDIN_HEALTH[classifyLinkedInStatus(account.status)];
                const accountName = account.name || 'Compte LinkedIn';
                return (
                <div key={account.id} className="space-y-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {account.profile_picture_url ? (
                        <img src={account.profile_picture_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-background text-xs font-semibold text-foreground-secondary" aria-hidden="true">
                          {accountName.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{accountName}</p>
                        <StatusText tone={health.tone}>{health.label}</StatusText>
                      </div>
                    </div>
                    <AlertDialog>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertDialogTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                              disabled={disconnecting === account.id}
                              loading={disconnecting === account.id}
                              aria-label={`Déconnecter le compte ${accountName}`}
                            >
                              {disconnecting !== account.id && <Trash2 aria-hidden="true" />}
                            </Button>
                          </AlertDialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Déconnecter</TooltipContent>
                      </Tooltip>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Déconnecter ce compte LinkedIn ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Le compte <strong>{accountName}</strong> sera supprimé de la plateforme. Vous pourrez le reconnecter ultérieurement.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDisconnectAccount(account.id)}
                            className="bg-destructive"
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
                    // Lot 3 : réglage du proxy montré seulement là où un proxy est posé (mode, pays ou hôte), réglage de la session compris.
                    const proxyMode = cached?.mode ?? mapping?.proxy_mode ?? null;
                    const hasProxy = (!!proxyMode && proxyMode !== 'none') || !!(cached?.country ?? mapping?.proxy_country) || !!mapping?.proxy_host;
                    if (!hasProxy) return null;
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
                );
              })}
            </div>
          ) : (
            <p className="py-2 text-center text-sm text-muted-foreground">
              Aucun compte LinkedIn connecté.
            </p>
          )}

          {/* Connect button */}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleConnectLinkedIn}
              disabled={generating}
              loading={generating}
              className="flex-1 max-md:h-11"
              size="sm"
            >
              {!generating && <ExternalLink aria-hidden="true" />}
              Connecter un compte LinkedIn
            </Button>
            {linkedInAccounts.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="max-md:h-11 max-md:w-11"
                    onClick={() => { void loadAccounts(); }}
                    disabled={loadingAccounts}
                    aria-label="Actualiser la liste des comptes"
                  >
                    <RefreshCw className={cn(loadingAccounts && 'animate-spin')} aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Actualiser</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* Webhook management */}
          {linkedInAccounts.length > 0 && (
            <WebhookManager />
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};


/* ──────────────────────────────────────────────
 *  Generic integration card (API key based)
 * ────────────────────────────────────────────── */
// Référence stable quand l'organisation n'a pas encore de ligne d'intégrations :
// un `{}` recréé à chaque rendu réinitialisait les champs en cours de saisie.
const EMPTY_VALUES: Record<string, never> = {};

const IntegrationCard = ({
  config,
  values,
  onSave,
  isSaving,
}: {
  config: IntegrationConfig;
  values: Record<string, string | null>;
  onSave: (updates: Record<string, string | boolean | null>) => Promise<void>;
  isSaving: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const isConnected = !!values[config.connectedKey];
  const fieldIdPrefix = useId();

  useEffect(() => {
    const initial: Record<string, string> = {};
    config.fields.forEach(f => {
      initial[f.key] = values[f.key] || '';
    });
    setLocalValues(initial);
  }, [values, config.fields]);

  const hasChanges = config.fields.some(f => (localValues[f.key] || '') !== (values[f.key] || ''));

  const handleSave = async () => {
    const updates: Record<string, string | boolean | null> = {};
    config.fields.forEach(f => {
      if (f.secret) {
        // Write-only : champ vide = inchangé (le retrait passe par « Retirer la clé »)
        const v = localValues[f.key]?.trim();
        if (v) updates[f.key] = v;
      } else {
        updates[f.key] = localValues[f.key] || null;
      }
    });
    // Un secret déjà enregistré (hint présent) compte comme rempli même si le champ est vide
    const allFilled = config.fields.every(f =>
      f.key.includes('_2') ||
      !!localValues[f.key]?.trim() ||
      (!!f.secret && !!values[`${f.key}_hint`])
    );
    updates[config.connectedKey] = allFilled;
    await onSave(updates);
  };

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <IntegrationHeader
          config={config}
          open={expanded}
          status={isConnected
            ? <StatusText tone="success">Connecté</StatusText>
            : <StatusText tone="muted">Non configuré</StatusText>}
        />

        <CollapsibleContent className="space-y-4 px-4 pb-4">
          {config.fields.map(field => {
            const fieldId = `${fieldIdPrefix}-${field.key}`;
            return (
            <div key={field.key} className="space-y-1.5">
              <label htmlFor={fieldId} className="text-xs font-medium text-foreground">{field.label}</label>
              <Input
                id={fieldId}
                type={field.secret ? 'password' : 'text'}
                autoComplete={field.secret ? 'new-password' : undefined}
                placeholder={
                  field.secret && values[`${field.key}_hint`]
                    ? `Clé enregistrée (${values[`${field.key}_hint`]}), saisir pour remplacer`
                    : field.placeholder
                }
                value={localValues[field.key] || ''}
                onChange={(e) =>
                  setLocalValues(prev => ({ ...prev, [field.key]: e.target.value }))
                }
                className="max-md:h-11"
              />
              {field.secret && !!values[`${field.key}_hint`] && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  disabled={isSaving}
                  className="h-auto px-0 text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-danger max-md:min-h-11"
                  onClick={async () => {
                    const ok = await confirmAlert({
                      title: 'Retirer cette clé ?',
                      description: "L'intégration sera déconnectée jusqu'à la saisie d'une nouvelle clé.",
                      confirmLabel: 'Retirer',
                      destructive: true,
                    });
                    if (ok) await onSave({ [field.key]: null, [config.connectedKey]: false });
                  }}
                >
                  Retirer la clé
                </Button>
              )}
            </div>
            );
          })}

          <Button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            loading={isSaving}
            className="mt-2 w-full max-md:h-11"
            size="sm"
          >
            {!isSaving && <Check aria-hidden="true" />}
            Enregistrer
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

/* ──────────────────────────────────────────────
 *  Main settings component
 * ────────────────────────────────────────────── */
export const IntegrationsSettings = () => {
  const { integrations, isLoading, updateIntegration, isUpdating } = useOrganizationIntegrations();
  const [manuallyAdded, setManuallyAdded] = useState<Set<string>>(new Set());

  if (isLoading) {
    return (
      <div className="space-y-3">
        <p role="status" className="sr-only">Chargement des outils reliés…</p>
        <Skeleton className="h-[72px] w-full rounded-xl" aria-hidden="true" />
      </div>
    );
  }

  // Les colonnes *_connected sont des booléens : les cartes ne les lisent que par !!.
  const values = (integrations ?? EMPTY_VALUES) as unknown as Record<string, string | null>;

  // Only show API-key integrations (Notion, Calendly, Aircall) if already configured
  const visibleIntegrations = INTEGRATIONS.filter(config => {
    if (config.hostedAuth) return true;
    if (values[config.connectedKey]) return true;
    // Une clé encore enregistrée garde la carte retirée, pour pouvoir la retirer.
    return !!config.retired && config.fields.some(f => f.secret && !!values[`${f.key}_hint`]);
  });

  const hiddenIntegrations = INTEGRATIONS.filter(config => 
    !config.hostedAuth && !config.retired && !values[config.connectedKey]
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

      {/* Revue design (F-24) : menu du kit (clavier, Échap, clic extérieur), icône Plus, filet plein. */}
      {remainingHidden.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full max-md:h-11">
              <Plus aria-hidden="true" />
              Ajouter une intégration
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            {remainingHidden.map(config => (
              <DropdownMenuItem
                key={config.id}
                className="items-start gap-3 max-md:min-h-11"
                onSelect={() => setManuallyAdded(prev => new Set(prev).add(config.id))}
              >
                <img src={config.logoSrc} alt="" className="h-6 w-6 shrink-0 object-contain" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{config.name}</span>
                  <span className="block text-xs text-muted-foreground">{config.description}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};
