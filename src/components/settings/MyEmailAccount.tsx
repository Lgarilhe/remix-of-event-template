import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorState } from '@/components/layout/ErrorState';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { classifyConnectionHealth } from '@/lib/linkedinStatus';
import {
  ACTION_LABEL,
  CARD_COMMON,
  EMAIL_CARD,
  HOSTED_BUTTON,
  PROVIDER_NAME,
  connectLabel,
  startBody,
  type ConnectionProviderId,
} from '@/lib/connectionCopy';
import {
  AccountRow,
  ConnectionNotice,
  ConnectionSkeleton,
  HostedError,
  ReconnectButton,
  RemovalDialog,
  SupportLink,
} from '@/components/connections/ConnectionParts';
import { NativeConnectSlot } from '@/components/connections/NativeConnectSlot';
import { emailProviderOf, viewOfHealth } from '@/components/connections/connectionView';
import { useHostedConnect } from '@/components/connections/useHostedConnect';
import { cn } from '@/lib/utils';

/**
 * Mon compte e-mail (Paramètres › Connexions, #email).
 *
 * Connexion standard : « Connecter Gmail », « Connecter Outlook » et
 * « Reconnecter » envoient l'onglet vers la page de connexion de la messagerie
 * (même onglet, retour sur /settings/account/connections/retour). Plus de
 * relecture toutes les 10 secondes : la page de retour suit la tentative.
 *
 * Lot 12 du chantier design : une liste non reçue s'affiche en erreur avec
 * « Réessayer », jamais comme un compte à connecter (F-06) ; état et fournisseur
 * en mots, jamais le code du prestataire (F-25) ; dissociation confirmée (F-21).
 * Un geste par cause, comme LinkedIn (src/components/connections/connectionView.ts).
 */

interface EmailAccount {
  id: string;
  name?: string;
  identifier?: string;
  status?: string;
  type?: string;
}

/** Les deux messageries qu'une personne peut connecter depuis cette carte. */
const CONNECTABLE: ReadonlyArray<ConnectionProviderId> = ['google', 'outlook'];

export const MyEmailAccount = () => {
  const [refreshing, setRefreshing] = useState(false);
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  // Première lecture en cours dès le montage : pas de faux « connectez votre compte ».
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [listError, setListError] = useState(false);
  const hosted = useHostedConnect();
  const {
    isLoading: mappingsLoading,
    isError: mappingsError,
    refetch: refetchMappings,
    unlinkAccount,
    isUnlinking,
    getMappingForUser,
  } = useMemberEmailAccounts();
  const { organizationId } = useOrganization();
  // Utilisateur de la session partagée : prêt ou non, jamais un faux « non relié » en attendant.
  const { user, isReady: authReady } = useAuthReady();
  const currentUserId = user?.id ?? null;
  const scopeKey = `${authReady}:${organizationId ?? ''}:${currentUserId ?? ''}`;
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const scope = scopeRef.current;
  // Object identity also rejects late responses after an A → B → A switch.
  const isCurrentScope = useCallback(() => scopeRef.current === scope, [scope]);

  // Lit les boîtes reliées à la personne dans l'organisation courante.
  const loadEmailAccounts = useCallback(async () => {
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
      setListError(true);
    } catch (err) {
      if (!isCurrentScope()) return null;
      console.warn('Failed to load email accounts:', err);
      setListError(true);
    } finally {
      if (isCurrentScope()) setLoadingAccounts(false);
    }
    return null;
  }, [authReady, organizationId, currentUserId, isCurrentScope]);

  useEffect(() => {
    setEmailAccounts([]);
    setAccountsLoaded(false);
    setListError(false);
    setRefreshing(false);
    setLoadingAccounts(true);
    if (!authReady || !organizationId || !currentUserId) return;
    void loadEmailAccounts();
  }, [authReady, organizationId, currentUserId, loadEmailAccounts]);

  const myMapping = currentUserId ? getMappingForUser(currentUserId) : null;
  const myAccount = myMapping
    ? emailAccounts.find(a => a.id === myMapping.email_account_id)
    : null;

  const handleRefresh = async () => {
    if (!isCurrentScope()) return;
    setRefreshing(true);
    try {
      await loadEmailAccounts();
      if (!isCurrentScope()) return;
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
          aria-label={EMAIL_CARD.refreshAria}
        >
          <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{CARD_COMMON.refresh}</TooltipContent>
    </Tooltip>
  );
  // Dissocier retire la liaison : confirmation, comme pour LinkedIn (F-21).
  const unlinkButton = (
    <RemovalDialog
      title={EMAIL_CARD.unlinkTitle}
      body={EMAIL_CARD.unlinkBody}
      triggerLabel={CARD_COMMON.unlink}
      confirmLabel={CARD_COMMON.unlink}
      disabled={isUnlinking}
      onConfirm={handleUnlink}
    />
  );

  const hostedLabel = (provider: ConnectionProviderId, label: string) =>
    hosted.provider === provider && hosted.phase === 'redirecting'
      ? HOSTED_BUTTON.redirecting
      : hosted.provider === provider && hosted.phase === 'starting'
        ? HOSTED_BUTTON.starting
        : label;
  const connectErrorLine = <HostedError hosted={hosted} />;
  const connectButtons = (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {CONNECTABLE.map((provider) => (
          <Button
            key={provider}
            variant="outline"
            size="sm"
            onClick={() => { void hosted.start({ provider }); }}
            loading={hosted.busy && hosted.provider === provider}
            disabled={hosted.busy}
            className="max-md:h-11 sm:flex-1"
          >
            {!(hosted.busy && hosted.provider === provider) && <ExternalLink aria-hidden="true" />}
            {hostedLabel(provider, connectLabel(provider))}
          </Button>
        ))}
      </div>
      {connectErrorLine}
    </div>
  );

  const initialLoad = !authReady || mappingsLoading || (!accountsLoaded && !listError);
  const myProvider = emailProviderOf(myMapping?.provider);
  const myView = myAccount
    ? viewOfHealth(classifyConnectionHealth({ status: myAccount.status }), myProvider ?? 'imap')
    : null;
  const myAddress = myMapping?.email_address || myAccount?.identifier || myAccount?.name || '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ChannelIcon channel="email" size="sm" decorative />
          {EMAIL_CARD.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {initialLoad ? (
          <ConnectionSkeleton label={EMAIL_CARD.loading} />
        ) : mappingsError ? (
          // Associations non lues : on ne sait pas si un compte vous est relié (F-06).
          <ErrorState
            variant="compact"
            title={EMAIL_CARD.mappingErrorTitle}
            description={EMAIL_CARD.errorBody}
            onRetry={() => { void refetchMappings(); }}
          />
        ) : myMapping && myAccount && myView ? (
          <div className="space-y-2">
            <AccountRow
              leading={(
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background" aria-hidden="true">
                  <ChannelIcon channel="email" size="md" decorative />
                </span>
              )}
              name={myAddress}
              view={myView}
              inline={myProvider ? <span className="text-muted-foreground">· {PROVIDER_NAME[myProvider]}</span> : undefined}
              details={myView.reason ? <p className="text-xs text-muted-foreground">{myView.reason}</p> : undefined}
              actions={(
                <>
                  {myView.action === 'reconnect' && (
                    <ReconnectButton
                      hosted={hosted}
                      provider={myProvider ?? 'imap'}
                      accountId={myMapping.email_account_id}
                      label={myView.actionLabel ?? ACTION_LABEL.reconnect}
                      className="max-sm:flex-1"
                    />
                  )}
                  {myView.action === 'contact_support' && <SupportLink channel="email" className="max-sm:flex-1" />}
                  {refreshButton}
                  {unlinkButton}
                </>
              )}
            />
            {connectErrorLine}
            {/* Gmail et Outlook se reconnectent par le bouton ci-dessus ; seule une boîte à mot de passe a besoin de l'assistant. */}
            {myView.action === 'reconnect' && (myProvider ?? 'imap') === 'imap' && (
              <NativeConnectSlot provider="imap" reconnectAccountId={myMapping.email_account_id} />
            )}
          </div>
        ) : myMapping && !myAccount ? (
          // Relié, compte absent de la liste : liste non reçue (panne) ou compte disparu.
          <div className="space-y-3">
            {listError ? (
              <ConnectionNotice tone="danger" title={EMAIL_CARD.checkErrorTitle}>
                {EMAIL_CARD.keptBody(myMapping.email_address || myMapping.email_account_id)}
              </ConnectionNotice>
            ) : (
              <>
                <ConnectionNotice title={EMAIL_CARD.missingTitle}>
                  {EMAIL_CARD.missingBody(myMapping.email_address || myMapping.email_account_id)}
                </ConnectionNotice>
                {connectButtons}
              </>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={busy} className="max-md:h-11">
                <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
                {listError ? CARD_COMMON.retry : CARD_COMMON.refreshAccounts}
              </Button>
              {unlinkButton}
            </div>
          </div>
        ) : listError ? (
          // Liste non reçue : on ne sait pas quels comptes existent, seul « Réessayer » a un sens (F-06).
          <ErrorState
            variant="compact"
            title={EMAIL_CARD.listErrorTitle}
            description={EMAIL_CARD.errorBody}
            onRetry={() => { void handleRefresh(); }}
            retrying={busy}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {startBody('google')}
            </p>

            {connectButtons}
            <p className="text-xs text-muted-foreground">{HOSTED_BUTTON.help('google')}</p>
            <NativeConnectSlot provider="google" />

            <Button variant="ghost" size="sm" className="max-md:h-11" onClick={handleRefresh} disabled={busy}>
              <RefreshCw className={cn(busy && 'animate-spin')} aria-hidden="true" />
              {CARD_COMMON.refreshAccounts}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
