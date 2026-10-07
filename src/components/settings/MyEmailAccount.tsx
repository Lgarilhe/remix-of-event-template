import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/layout/ErrorState';
import { AlertTriangle, ExternalLink, RefreshCw, Unlink } from 'lucide-react';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { classifyLinkedInStatus } from '@/lib/linkedinStatus';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Mon compte e-mail (Paramètres › Connexions, #email).
 *
 * Lot 12 du chantier design : une liste non reçue s'affiche en erreur avec
 * « Réessayer », jamais comme un compte à connecter (F-06) ; état et fournisseur
 * en mots, jamais le code du prestataire (F-25) ; dissociation confirmée (F-21).
 */

interface EmailAccount {
  id: string;
  name?: string;
  identifier?: string;
  status?: string;
  type?: string;
}

type Provider = 'GOOGLE' | 'OUTLOOK' | 'IMAP';

/** Fournisseur d'un compte, en clair ; null pour un type inconnu (jamais le code brut). */
function providerLabel(raw?: string | null): string | null {
  const value = (raw ?? '').toUpperCase();
  if (!value) return null;
  if (value.includes('GOOGLE') || value.includes('GMAIL')) return 'Gmail';
  if (value.includes('OUTLOOK') || value.includes('MICROSOFT') || value.includes('OFFICE')) return 'Outlook';
  if (value.includes('IMAP') || value === 'MAIL') return 'IMAP';
  return null;
}

/**
 * État d'un compte e-mail en mots. Le prestataire emploie les mêmes codes d'état
 * pour tous les comptes : même classement que LinkedIn (src/lib/linkedinStatus.ts).
 */
function emailStateDisplay(status?: string | null): { label: string; dot: string; text: string } {
  switch (classifyLinkedInStatus(status)) {
    case 'connected': return { label: 'Actif', dot: 'bg-success', text: 'text-muted-foreground' };
    case 'connecting': return { label: 'Connexion en cours…', dot: 'bg-info', text: 'text-muted-foreground' };
    case 'needs_reconnect': return { label: 'Connexion expirée', dot: 'bg-danger', text: 'font-medium text-danger' };
    default: return { label: 'État à vérifier', dot: 'bg-warning', text: 'font-medium text-warning' };
  }
}

export const MyEmailAccount = () => {
  const [generating, setGenerating] = useState<Provider | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  // Première lecture en cours dès le montage : pas de faux « connectez votre compte ».
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [listError, setListError] = useState(false);
  const {
    isLoading: mappingsLoading,
    isError: mappingsError,
    refetch: refetchMappings,
    unlinkAccount,
    isUnlinking,
    getMappingForUser,
  } = useMemberEmailAccounts();
  const { organization, organizationId } = useOrganization();
  // Utilisateur de la session partagée : prêt ou non, jamais un faux « non relié » en attendant.
  const { user, isReady: authReady } = useAuthReady();
  const currentUserId = user?.id ?? null;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousCountRef = useRef<number>(0);
  const scopeKey = `${authReady}:${organizationId ?? ''}:${currentUserId ?? ''}`;
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const scope = scopeRef.current;
  // Object identity also rejects late responses after an A → B → A switch.
  const isCurrentScope = useCallback(() => scopeRef.current === scope, [scope]);

  // Fetch email accounts from Unipile. background : relecture de la détection
  // automatique, dont un échec passager ne remplace pas l'écran par une erreur.
  const loadEmailAccounts = useCallback(async (options?: { background?: boolean }) => {
    if (!authReady || !organizationId || !currentUserId || !isCurrentScope()) return null;
    setLoadingAccounts(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ accounts?: EmailAccount[] }>('unipile-accounts', {
        action: 'list_email',
        organization_id: organizationId,
      });
      if (!isCurrentScope()) return null;
      if (!error && data?.success && data.accounts) {
        setEmailAccounts(data.accounts);
        setAccountsLoaded(true);
        setListError(false);
        return data.accounts;
      }
      if (!options?.background) setListError(true);
    } catch (err) {
      if (!isCurrentScope()) return null;
      console.warn('Failed to load email accounts:', err);
      if (!options?.background) setListError(true);
    } finally {
      if (isCurrentScope()) setLoadingAccounts(false);
    }
    return null;
  }, [authReady, organizationId, currentUserId, isCurrentScope]);

  useEffect(() => {
    setEmailAccounts([]);
    setAccountsLoaded(false);
    setListError(false);
    setGenerating(null);
    setRefreshing(false);
    setLoadingAccounts(true);
    previousCountRef.current = 0;
    if (!authReady || !organizationId || !currentUserId) return;
    loadEmailAccounts().then(accounts => {
      if (accounts) previousCountRef.current = accounts.length;
    });
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [authReady, organizationId, currentUserId, loadEmailAccounts]);

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const myMapping = currentUserId ? getMappingForUser(currentUserId) : null;
  const myAccount = myMapping
    ? emailAccounts.find(a => a.id === myMapping.email_account_id)
    : null;

  // Start polling after hosted auth window opens — detect new account
  const startPolling = useCallback(() => {
    if (!isCurrentScope()) return;
    if (pollingRef.current) clearInterval(pollingRef.current);
    let attempts = 0;
    const maxAttempts = 30; // ~5 minutes (every 10s)
    pollingRef.current = setInterval(async () => {
      if (!isCurrentScope()) return;
      attempts++;
      if (attempts > maxAttempts) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        return;
      }
      try {
        const accounts = await loadEmailAccounts({ background: true });
        if (!isCurrentScope()) return;
        if (accounts) await refetchMappings();
        if (!isCurrentScope()) return;
        if (accounts && accounts.length > previousCountRef.current) {
          previousCountRef.current = accounts.length;
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          toast.success('Votre compte e-mail est connecté.');
        }
      } catch {
        // ignore polling errors
      }
    }, 10000);
  }, [loadEmailAccounts, refetchMappings, isCurrentScope]);

  const handleConnect = async (provider: Provider) => {
    if (!isCurrentScope()) return;
    setGenerating(provider);
    try {
      const currentUrl = window.location.href;
      const { data } = await invokeEdgeFunction<{ url?: string }>('unipile-accounts', {
        action: 'hosted_auth_link',
        organization_id: organizationId,
        providers: [provider],
        success_redirect_url: currentUrl,
        failure_redirect_url: currentUrl,
        org_name: organization?.name || undefined,
      });
      if (!isCurrentScope()) return;

      if (data?.success && data.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        const providerName = provider === 'GOOGLE' ? 'Gmail' : provider === 'OUTLOOK' ? 'Outlook' : 'IMAP';
        toast.info(`Une fenêtre de connexion ${providerName} s'est ouverte. Le compte sera détecté automatiquement.`);
        // Start auto-polling to detect new account
        startPolling();
      } else {
        throw new Error(data?.error || 'Erreur lors de la génération du lien');
      }
    } catch (e) {
      if (isCurrentScope()) toast.error(e instanceof Error && e.message ? e.message : 'Erreur lors de la connexion');
    } finally {
      if (isCurrentScope()) setGenerating(null);
    }
  };

  const handleRefresh = async () => {
    if (!isCurrentScope()) return;
    setRefreshing(true);
    try {
      const accounts = await loadEmailAccounts();
      if (!isCurrentScope()) return;
      if (accounts) previousCountRef.current = accounts.length;
      await refetchMappings();
      await new Promise(r => setTimeout(r, 500));
    } finally {
      if (isCurrentScope()) setRefreshing(false);
    }
  };

  const handleUnlink = () => {
    if (myMapping) {
      unlinkAccount({ mappingId: myMapping.id, expectedAccountId: myMapping.email_account_id });
    }
  };

  const busy = refreshing || loadingAccounts;
  const refreshButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleRefresh}
          disabled={busy}
          className="max-md:h-11 max-md:w-11"
          aria-label="Actualiser la liste des comptes e-mail"
        >
          <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Actualiser</TooltipContent>
    </Tooltip>
  );
  // Dissocier retire la liaison : confirmation, comme pour LinkedIn (F-21).
  const unlinkButton = (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={isUnlinking} className="text-danger hover:text-danger max-sm:flex-1 max-md:h-11">
          <Unlink aria-hidden="true" />
          Dissocier
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dissocier ce compte e-mail ?</AlertDialogTitle>
          <AlertDialogDescription>
            L'adresse ne sera plus rattachée à votre profil Konekt. Votre boîte e-mail et ses messages
            ne sont pas touchés, et vous pourrez la relier de nouveau.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={handleUnlink} className="bg-destructive" disabled={isUnlinking}>
            Dissocier
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const connectButtons = (
    <div className="flex flex-col gap-2 sm:flex-row">
      {(['GOOGLE', 'OUTLOOK'] as const).map((provider) => (
        <Button
          key={provider}
          variant="outline"
          size="sm"
          onClick={() => handleConnect(provider)}
          loading={generating === provider}
          disabled={generating !== null}
          className="max-md:h-11 sm:flex-1"
        >
          {generating !== provider && <ExternalLink aria-hidden="true" />}
          {provider === 'GOOGLE' ? 'Connecter Gmail' : 'Connecter Outlook'}
        </Button>
      ))}
    </div>
  );

  const initialLoad = !authReady || mappingsLoading || (!accountsLoaded && !listError);
  const myState = myAccount ? emailStateDisplay(myAccount.status) : null;
  const myProvider = providerLabel(myMapping?.provider);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ChannelIcon channel="email" size="sm" decorative />
          Mon compte e-mail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {initialLoad ? (
          <div role="status" className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" aria-hidden="true" />
            <div className="flex-1 space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <span className="sr-only">Chargement de votre compte e-mail…</span>
          </div>
        ) : mappingsError ? (
          // Associations non lues : on ne sait pas si un compte vous est relié (F-06).
          <ErrorState
            variant="compact"
            title="Impossible de lire l'association de votre compte e-mail."
            description="Vérifiez votre connexion, puis réessayez."
            onRetry={() => { void refetchMappings(); }}
          />
        ) : myMapping && myAccount && myState ? (
          <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background" aria-hidden="true">
                <ChannelIcon channel="email" size="md" decorative />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {myMapping.email_address || myAccount.identifier || myAccount.name}
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', myState.dot)} aria-hidden="true" />
                  <span className={myState.text}>{myState.label}</span>
                  {myProvider && <span className="text-muted-foreground">· {myProvider}</span>}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {refreshButton}
              {unlinkButton}
            </div>
          </div>
        ) : myMapping && !myAccount ? (
          // Relié, compte absent de la liste : liste non reçue (panne) ou compte disparu.
          <div className="space-y-3">
            {/* Même anatomie que l'état d'erreur du kit (ErrorState compact). */}
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                  listError ? 'bg-danger-muted text-danger' : 'bg-warning-muted text-warning',
                )}
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-foreground">
                  {listError ? 'Impossible de vérifier votre compte e-mail pour le moment.' : 'Compte e-mail introuvable'}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Le compte <span className="font-medium text-foreground">{myMapping.email_address || myMapping.email_account_id}</span>
                  {listError
                    ? ' reste relié à votre profil. Réessayez dans un instant.'
                    : " n'est plus disponible. Dissociez-le puis connectez de nouveau votre messagerie."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={busy} className="max-md:h-11">
                <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
                {listError ? 'Réessayer' : 'Rafraîchir'}
              </Button>
              {unlinkButton}
            </div>
          </div>
        ) : listError ? (
          // Liste non reçue : on ne sait pas quels comptes existent, seul « Réessayer » a un sens (F-06).
          <ErrorState
            variant="compact"
            title="Impossible de charger vos comptes e-mail."
            description="Vérifiez votre connexion, puis réessayez."
            onRetry={() => { void handleRefresh(); }}
            retrying={busy}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connectez votre compte e-mail pour envoyer des e-mails de prospection depuis vos séquences.
            </p>

            {connectButtons}

            <Button variant="ghost" size="sm" className="max-md:h-11" onClick={handleRefresh} disabled={busy}>
              <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
              Rafraîchir les comptes
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
