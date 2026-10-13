import { useMemo, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ErrorState } from '@/components/layout/ErrorState';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useMemberEmailAccounts } from '@/hooks/useMemberEmailAccounts';
import { useAuthReady } from '@/hooks/useAuthReady';
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
  ConnectionSkeleton,
  DetailLine,
  HostedError,
  ReconnectButton,
  RemovalDialog,
} from '@/components/connections/ConnectionParts';
import { NativeConnectSlot } from '@/components/connections/NativeConnectSlot';
import { useHostedConnect, type UseHostedConnect } from '@/components/connections/useHostedConnect';
import { useMemberEmailList } from '@/components/connections/useMemberEmailList';
import { buildMailboxRows, type MailboxMapping, type MailboxRow } from '@/components/connections/mailboxRows';
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
 *
 * Toutes les boîtes reliées à la personne sont listées, chacune avec son état et ses
 * gestes (reconnecter, dissocier) : une seule boîte donne la même ligne compacte qu'avant,
 * et celle qui demande un geste passe devant (src/components/connections/mailboxRows.ts).
 * La liste du serveur est une requête partagée (useMemberEmailList), relue à chaque ouverture de la page.
 * Chaque geste d'une ligne nomme sa boîte (confirmation et nom accessible) : plusieurs boîtes portent les mêmes boutons.
 */

/** Les deux messageries qu'une personne peut connecter depuis cette carte. */
const CONNECTABLE: ReadonlyArray<ConnectionProviderId> = ['google', 'outlook'];

/** Une boîte reliée : son identité, son état, et le geste que cet état demande. */
function MyMailbox({
  row,
  hosted,
  extraAction,
  onUnlink,
  unlinkDisabled,
  onRetry,
  retryDisabled,
}: {
  row: MailboxRow;
  hosted: UseHostedConnect;
  /** Bouton d'actualisation placé dans la ligne quand elle est seule. */
  extraAction?: ReactNode;
  onUnlink: (mapping: MailboxMapping) => void;
  unlinkDisabled: boolean;
  onRetry: () => void;
  /** Lecture de la liste en cours : « Réessayer » attend la fin au lieu d'en relancer une seconde. */
  retryDisabled: boolean;
}) {
  const { view } = row;
  const myMapping = row.mapping;
  const myProvider = row.provider;
  return (
    <div className="space-y-2">
      <AccountRow
        leading={(
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background" aria-hidden="true">
            <ChannelIcon channel="email" size="md" decorative />
          </span>
        )}
        name={row.address}
        view={view}
        inline={myProvider ? <span className="text-muted-foreground">· {PROVIDER_NAME[myProvider]}</span> : undefined}
        details={view.reason ? <DetailLine>{view.reason}</DetailLine> : undefined}
        actions={(
          <>
            {view.action === 'reconnect' && (
              <ReconnectButton
                hosted={hosted}
                provider={myProvider ?? 'imap'}
                accountId={myMapping.email_account_id}
                startsNew={view.reconnect === 'new_link'}
                label={view.actionLabel ?? ACTION_LABEL.reconnect}
                ariaLabel={EMAIL_CARD.reconnectAria(row.address)}
                className="max-sm:flex-1"
              />
            )}
            {view.action === 'refresh' && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retryDisabled}
                aria-label={EMAIL_CARD.retryAria(row.address)}
                className="max-sm:flex-1 max-md:h-11"
              >
                <RefreshCw className={cn(retryDisabled && 'animate-spin')} aria-hidden="true" />
                {view.actionLabel ?? CARD_COMMON.refresh}
              </Button>
            )}
            {extraAction}
            {/* Dissocier retire la liaison : confirmation qui nomme la boîte visée, comme pour LinkedIn (F-21). */}
            <RemovalDialog
              title={EMAIL_CARD.unlinkTitle(row.address)}
              body={EMAIL_CARD.unlinkBody}
              triggerLabel={CARD_COMMON.unlink}
              triggerAriaLabel={EMAIL_CARD.unlinkAria(row.address)}
              confirmLabel={CARD_COMMON.unlink}
              disabled={unlinkDisabled}
              onConfirm={() => onUnlink(myMapping)}
            />
          </>
        )}
      />
      {/* Gmail et Outlook se reconnectent par le bouton ci-dessus ; seule une boîte à mot de passe a besoin de l'assistant. */}
      {view.action === 'reconnect' && view.reconnect === 'in_place' && (myProvider ?? 'imap') === 'imap' && (
        <NativeConnectSlot provider="imap" reconnectAccountId={myMapping.email_account_id} />
      )}
    </div>
  );
}

export const MyEmailAccount = () => {
  const hosted = useHostedConnect();
  const {
    mappings,
    isLoading: mappingsLoading,
    isError: mappingsError,
    refetch: refetchMappings,
    unlinkAccount,
    isUnlinking,
  } = useMemberEmailAccounts();
  // Utilisateur de la session partagée : prêt ou non, jamais un faux « non relié » en attendant.
  const { user, isReady: authReady } = useAuthReady();
  const currentUserId = user?.id ?? null;
  // Boîtes de la personne dans l'organisation courante : la liste du serveur est lue une seule fois (requête partagée).
  // Relue à chaque ouverture de Connexions : l'état d'une boîte se lit au moment de l'afficher, comme LinkedIn et WhatsApp.
  const list = useMemberEmailList({ rereadOnMount: true });
  const listFailed = list.isError && !list.data;

  const myMappings = useMemo<MailboxMapping[]>(
    () => (currentUserId ? mappings.filter((m) => m.user_id === currentUserId) : []),
    [mappings, currentUserId],
  );
  const rows = useMemo(
    () => buildMailboxRows(myMappings, list.data ?? [], listFailed),
    [myMappings, list.data, listFailed],
  );

  const handleRefresh = () => {
    void Promise.all([list.refetch(), refetchMappings()]);
  };
  const handleUnlink = (mapping: MailboxMapping) => {
    unlinkAccount({ mappingId: mapping.id, expectedAccountId: mapping.email_account_id });
  };

  const busy = list.isFetching;
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

  const initialLoad = !authReady || mappingsLoading || list.isPending;

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
        ) : rows.length > 0 ? (
          // Une ligne par boîte reliée, celle qui demande un geste d'abord. Liste non reçue : chaque ligne
          // dit « État à vérifier » avec « Réessayer », jamais un état deviné.
          <div className="space-y-3">
            {rows.map((row) => (
              <MyMailbox
                key={row.key}
                row={row}
                hosted={hosted}
                extraAction={rows.length === 1 ? refreshButton : undefined}
                onUnlink={handleUnlink}
                unlinkDisabled={isUnlinking}
                onRetry={handleRefresh}
                retryDisabled={busy}
              />
            ))}
            {connectErrorLine}
            {rows.length > 1 && (
              <div className="flex justify-end">{refreshButton}</div>
            )}
          </div>
        ) : listFailed ? (
          // Liste non reçue : on ne sait pas quels comptes existent, seul « Réessayer » a un sens (F-06).
          <ErrorState
            variant="compact"
            title={EMAIL_CARD.listErrorTitle}
            description={EMAIL_CARD.errorBody}
            onRetry={handleRefresh}
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
