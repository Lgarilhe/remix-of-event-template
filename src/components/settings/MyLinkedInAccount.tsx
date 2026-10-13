import { lazy, Suspense, useState, useCallback, useEffect, useId } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { Illustration } from '@/components/ui/illustration';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/layout/ErrorState';
import { RefreshCw, AlertTriangle, Gauge, CirclePause } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useLinkedInQuotaStatus, rampStageLabel } from '@/hooks/useLinkedInQuotaStatus';
import { useAuthReady } from '@/hooks/useAuthReady';
import { resolveMyLinkedInStatus, classifyLinkedInStatus, healthOfState } from '@/lib/linkedinStatus';
import { CARD_COMMON, LINKEDIN_CARD, connectLabel, readableConnectionName } from '@/lib/connectionCopy';
import {
  AccountRow,
  ConnectionNotice,
  ConnectionSkeleton,
  DetailLine,
  HostedConnectButton,
  HostedError,
  ReconnectButton,
  RemovalDialog,
} from '@/components/connections/ConnectionParts';
import { useHostedConnect } from '@/components/connections/useHostedConnect';
import { NativeConnectSlot } from '@/components/connections/NativeConnectSlot';
import { offerLabelOf, sinceDate, viewOfAccount, viewOfHealth } from '@/components/connections/connectionView';
import { cn } from '@/lib/utils';
import { LinkedInSafetySettings, TimeZoneName } from './LinkedInSafetySettings';

// Invitations en attente et choix du contrat : chargés à la demande, seulement pour un compte utilisable.
const LinkedInExtras = lazy(() => import('@/components/connections/LinkedInExtras'));

/**
 * MyLinkedInAccount : Paramètres, Connexions, « Mon compte LinkedIn ».
 *
 * Connexion standard : « Connecter » et « Reconnecter » envoient l'onglet vers
 * la page de connexion sécurisée (jamais une fenêtre ouverte après un appel),
 * qui revient sur /settings/account/connections/retour. Il n'y a plus de
 * formulaire de cookie ni d'agent utilisateur : la connexion directe viendra
 * dans NativeConnectSlot.
 *
 * Un geste par cause (src/components/connections/connectionView.ts) :
 * - à reconnecter : « Reconnecter » (même compte, même historique), avec la phrase de
 *   sa cause (session expirée, panne de connexion, authentification partielle,
 *   identifiant à refaire) ;
 * - connexion limitée : rien, la reprise est automatique ;
 * - compte restreint par LinkedIn : rien, les envois sont en pause et se reconnecter n'y change
 *   rien (même phrase que le bandeau du tableau de bord et la notification) ;
 * - état non lu chez le prestataire : « État à vérifier » et « Réessayer », jamais
 *   « Actif » ni une offre devinée.
 * Un compte relié qui a disparu se lit comme sur les deux autres cartes : « À
 * reconnecter », et « Reconnecter » ouvre une nouvelle connexion qui le remplace.
 *
 * Liaison stricte par utilisateur (resolveMyLinkedInStatus). Liaison et
 * dissociation passent par le serveur (claim_linkedin_account,
 * unlink_linkedin_account) et la dissociation est confirmée.
 */
export const MyLinkedInAccount = () => {
  const [refreshing, setRefreshing] = useState(false);
  const hosted = useHostedConnect();
  const {
    accounts, loading: loadingAccounts, ready: accountsReady, loadError: accountsLoadError, reload: reloadAccounts,
  } = useLinkedInAccounts();
  const {
    mappings, isReady: mappingsReady, isError: mappingsError, refetch: refetchMappings,
    linkAccount, unlinkAccount, isUnlinking, getMappingForAccount,
  } = useMemberLinkedInAccounts();
  const { user, isReady: authReady } = useAuthReady();
  const currentUserId = authReady ? user?.id ?? null : null;

  const li = resolveMyLinkedInStatus({
    userId: currentUserId, mappings, mappingsLoaded: mappingsReady, mappingsFailed: mappingsError,
    accounts, accountsLoaded: accountsReady, accountsFailed: accountsLoadError,
  });
  const myMapping = li.mapping;
  const myAccount = li.account;
  // Compte que le prestataire n'a pas répondu : la liste ne porte alors que le dernier état connu et une offre
  // par défaut. Il s'affiche « État à vérifier », jamais « Actif » ni une offre qui n'a pas été lue.
  const unverified = myAccount?.unverified === true;
  const view = viewOfAccount({
    health: healthOfState(li.state),
    // Compte relié absent d'une liste reçue : il n'existe plus chez le prestataire (même état que sur les deux autres cartes).
    status: li.state === 'missing' ? 'DELETED' : myAccount?.status,
    accountId: myMapping?.linkedin_account_id,
    unverified,
  }, 'linkedin');

  // Compte en synchronisation ou en connexion : relecture de la liste toutes les 10 s
  // (deux minutes au plus) pour que « Actif » apparaisse sans recharger la page.
  const settling = li.state === 'syncing' || li.state === 'connecting';
  useEffect(() => {
    if (!settling) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt > 2 * 60 * 1000) {
        window.clearInterval(timer);
        return;
      }
      void reloadAccounts().catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [settling, reloadAccounts]);

  const handleRefreshAndLink = useCallback(async () => {
    if (!currentUserId) return;
    setRefreshing(true);
    try {
      // include_org_accounts: true : le serveur ne l'honore que pour les administrateurs de la
      // plateforme (dépannage), qui voient alors les comptes sans propriétaire sous « Compte
      // disponible ». Un membre ordinaire relie son compte par le bouton de connexion.
      await reloadAccounts(true);
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      setRefreshing(false);
    }
  }, [currentUserId, reloadAccounts]);

  // Liaisons non lues : relit les liaisons et la liste, sans rien écrire.
  const handleRetryLoad = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetchMappings(), reloadAccounts()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchMappings, reloadAccounts]);

  const unlinkedAccounts = accounts.filter((acc) => !getMappingForAccount(acc.id));

  const handleLinkAccount = (accountId: string) => {
    if (!currentUserId) return;
    // Le serveur vérifie le compte et prend son nom chez le prestataire.
    linkAccount({ userId: currentUserId, linkedinAccountId: accountId });
  };

  const handleUnlink = () => {
    if (!myMapping) return;
    // La session LinkedIn n'est jamais fermée : le serveur retire la liaison et
    // arrête les envois du compte. expectedAccountId : le compte affiché, une
    // liaison repointée entre-temps est refusée. Un seul message, émis par le
    // hook après la réponse.
    unlinkAccount(
      { mappingId: myMapping.id, expectedAccountId: myMapping.linkedin_account_id },
      { onSuccess: () => { void reloadAccounts(); } },
    );
  };

  const accountName = readableConnectionName(myAccount?.name || myMapping?.linkedin_account_name, 'linkedin');
  const offer = unverified ? null : offerLabelOf(myAccount?.subscriptions);
  const since = sinceDate(myMapping?.linked_at);

  return (
    <div className="space-y-6">
      <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ChannelIcon channel="linkedin" size="sm" decorative />
          {LINKEDIN_CARD.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {li.state === 'loading' ? (
          // Liaison ou liste pas encore reçue : jamais de faux « introuvable » ni de faux « non relié »
          <ConnectionSkeleton label={LINKEDIN_CARD.loading} />
        ) : li.state === 'load_error' && !myMapping ? (
          // Liaisons non lues : on ne sait pas si un compte est relié, seul « Réessayer » a un sens
          <div className="space-y-3">
            <LinkedInLoadError />
            <Button variant="outline" size="sm" onClick={handleRetryLoad} disabled={refreshing} className="max-md:h-11">
              <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
              {CARD_COMMON.retry}
            </Button>
          </div>
        ) : myMapping && myAccount ? (
          // Connected and linked
          <>
            <AccountRow
              leading={<PersonAvatar name={accountName} src={myAccount.profile_picture_url} size={40} />}
              name={accountName}
              view={view}
              details={(
                <>
                  {view.reason && <DetailLine>{view.reason}</DetailLine>}
                  {(offer || since) && (
                    <DetailLine>
                      {[offer ? CARD_COMMON.offer(offer) + '.' : null, since ? CARD_COMMON.since(since) : null].filter(Boolean).join(' ')}
                    </DetailLine>
                  )}
                </>
              )}
              actions={(
                <>
                  {view.action === 'reconnect' && (
                    <ReconnectButton
                      hosted={hosted}
                      provider="linkedin"
                      accountId={myMapping.linkedin_account_id}
                      startsNew={view.reconnect === 'new_link'}
                      label={view.actionLabel ?? 'Reconnecter'}
                      className="max-sm:flex-1"
                    />
                  )}
                  {view.action === 'refresh' && (
                    <Button variant="ghost" size="sm" onClick={handleRefreshAndLink} disabled={refreshing} className="max-sm:flex-1 max-md:h-11">
                      <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
                      {view.actionLabel ?? CARD_COMMON.refresh}
                    </Button>
                  )}
                  <RemovalDialog
                    title={LINKEDIN_CARD.unlinkTitle}
                    body={LINKEDIN_CARD.unlinkBody}
                    triggerLabel={CARD_COMMON.unlink}
                    confirmLabel={CARD_COMMON.unlink}
                    disabled={isUnlinking}
                    onConfirm={handleUnlink}
                  />
                </>
              )}
            />
            <HostedError hosted={hosted} />
            {view.action === 'reconnect' && (
              <NativeConnectSlot provider="linkedin" reconnectAccountId={myMapping.linkedin_account_id} />
            )}
          </>
        ) : myMapping && !myAccount && li.state === 'missing' ? (
          // Relié, compte absent d'une liste reçue : il n'existe plus chez le prestataire. Même ligne, même
          // phrase et même geste (« Reconnecter », qui ouvre une nouvelle connexion) que la messagerie et WhatsApp.
          <>
            <AccountRow
              leading={<PersonAvatar name={accountName} src={null} size={40} />}
              name={accountName}
              view={view}
              details={view.reason ? <DetailLine>{view.reason}</DetailLine> : undefined}
              actions={(
                <>
                  <ReconnectButton
                    hosted={hosted}
                    provider="linkedin"
                    accountId={myMapping.linkedin_account_id}
                    startsNew={view.reconnect === 'new_link'}
                    label={view.actionLabel ?? 'Reconnecter'}
                    className="max-sm:flex-1"
                  />
                  {/* Relances mises en pause, InMails annulés : confirmation obligatoire */}
                  <RemovalDialog
                    title={LINKEDIN_CARD.unlinkTitle}
                    body={LINKEDIN_CARD.unlinkMissingBody}
                    triggerLabel={CARD_COMMON.unlink}
                    confirmLabel={CARD_COMMON.unlink}
                    disabled={isUnlinking}
                    onConfirm={handleUnlink}
                  />
                </>
              )}
            />
            <HostedError hosted={hosted} />
          </>
        ) : myMapping && !myAccount ? (
          // Relié, liste non reçue (« load_error », panne passagère : aucun conseil de dissocier,
          // mais Réessayer et Dissocier restent utilisables).
          <div className="space-y-3">
            <LinkedInLoadError accountName={accountName} />
            <div className="flex flex-wrap items-start gap-2">
              <Button variant="outline" size="sm" onClick={handleRefreshAndLink} disabled={refreshing} className="max-md:h-11">
                <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
                {CARD_COMMON.retry}
              </Button>
              {/* Relances mises en pause, InMails annulés : confirmation obligatoire */}
              <RemovalDialog
                title={LINKEDIN_CARD.unlinkTitle}
                body={LINKEDIN_CARD.unlinkBody}
                triggerLabel={CARD_COMMON.unlink}
                confirmLabel={CARD_COMMON.unlink}
                disabled={isUnlinking}
                onConfirm={handleUnlink}
              />
            </div>
          </div>
        ) : (
          // Not linked (no mapping)
          <div className="space-y-4">
            {unlinkedAccounts.length === 0 ? (
              // Aucun compte relié ni disponible : le dessin « connexion » (§ Illustrations), jamais à côté de la
              // liste des comptes disponibles. Déjà posé sur la carte des Paramètres : sans tuile.
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <Illustration name="connexion" size="md" tile={false} />
                <p className="text-sm text-muted-foreground">{LINKEDIN_CARD.notLinked}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{LINKEDIN_CARD.notLinked}</p>
            )}
            <div className="mx-auto w-full max-w-sm space-y-2">
              <HostedConnectButton provider="linkedin" label={connectLabel('linkedin')} help />
              <NativeConnectSlot provider="linkedin" />
            </div>

            {unlinkedAccounts.length > 0 && (
              // Comptes de l'organisation sans propriétaire : le bouton de connexion reste au-dessus,
              // la liste n'est jamais le seul geste proposé.
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-xs font-medium text-foreground">
                  {unlinkedAccounts.length > 1 ? LINKEDIN_CARD.availableMany : LINKEDIN_CARD.availableOne}
                </p>
                <p className="text-xs text-muted-foreground">{LINKEDIN_CARD.availableHelp}</p>
                <ul className="space-y-2">
                  {unlinkedAccounts.map((acc) => (
                    <li key={acc.id} className="flex flex-col gap-2 rounded-lg bg-muted p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <ChannelIcon channel="linkedin" size="md" decorative />
                        <span className="truncate text-sm text-foreground">{readableConnectionName(acc.name || acc.identifier, 'linkedin')}</span>
                        {classifyLinkedInStatus(acc.status) === 'connected' && (
                          <span className="shrink-0 text-xs text-muted-foreground">{viewOfHealth('connected', 'linkedin').label}</span>
                        )}
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleLinkAccount(acc.id)} className="shrink-0 max-md:h-11">
                        {LINKEDIN_CARD.claim}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                className="max-md:h-11"
                onClick={handleRefreshAndLink}
                disabled={refreshing || loadingAccounts}
              >
                <RefreshCw className={cn((refreshing || loadingAccounts) && 'animate-spin')} aria-hidden="true" />
                {CARD_COMMON.refreshAccounts}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>

    {/* Invitations en attente et contrat LinkedIn (section chargée à la demande) */}
    {myMapping && myAccount && li.isUsable && !unverified && (
      <Suspense fallback={null}>
        <LinkedInExtras
          accountId={myMapping.linkedin_account_id}
          subscriptions={myAccount.subscriptions}
          onContractChanged={() => { void reloadAccounts(); }}
        />
      </Suspense>
    )}

    {/* Plafonds du jour : compteurs serveur du compte rattaché */}
    {myMapping && <LinkedInQuotaCard accountId={myMapping.linkedin_account_id} />}

    {/* Plages horaires & cap journalier — conformité LinkedIn warning #260513-007211 */}
    <LinkedInSafetySettings />
  </div>
  );
};

/** Lecture ratée de la liste ou des liaisons : une erreur, jamais un chargement sans fin. */
function LinkedInLoadError({ accountName }: { accountName?: string }) {
  return (
    <ConnectionNotice tone="danger" title={LINKEDIN_CARD.loadErrorTitle}>
      {accountName ? `${LINKEDIN_CARD.loadErrorKept(accountName)} ` : ''}
      {LINKEDIN_CARD.loadErrorBody}
    </ConnectionNotice>
  );
}

/** Heure locale HH:MM dans le fuseau du compte (repli : fuseau du navigateur). */
function formatHourMinute(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}

/** Vrai si la date ISO tombe un autre jour civil qu'aujourd'hui, dans le fuseau donné. */
function isAnotherDay(iso: string, timeZone: string): boolean {
  try {
    const opts: Intl.DateTimeFormatOptions = { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Date(iso).toLocaleDateString('fr-FR', opts) !== new Date().toLocaleDateString('fr-FR', opts);
  } catch {
    return false;
  }
}

/**
 * Consommation d'un plafond : barre neutre, la couleur ne signale que l'approche du plafond (F-14).
 * Design simplifié (règle 8) : rien d'utilisé, ni « 0 / 40 » ni barre vide, seulement le plafond.
 */
function QuotaRow({ label, used, cap }: { label: string; used: number; cap: number }) {
  const labelId = useId();
  const percent = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const isWarning = percent >= 80;
  const isCritical = percent >= 95;
  if (used <= 0) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">jusqu’à {cap}</span>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span id={labelId} className="text-muted-foreground">{label}</span>
        <span className={cn(
          'font-medium tabular-nums',
          isCritical ? 'text-danger' : isWarning ? 'text-warning' : 'text-foreground',
        )}>
          {used} / {cap}
        </span>
      </div>
      <Progress
        value={percent}
        aria-labelledby={labelId}
        className={cn(
          'h-1.5',
          isCritical ? '[&>div]:bg-danger' : isWarning ? '[&>div]:bg-warning' : '[&>div]:bg-muted-foreground',
        )}
      />
    </div>
  );
}

/**
 * Carte « Plafonds du jour » : compteurs serveur (RPC get_linkedin_quota_status)
 * du compte LinkedIn rattaché, plafonds effectifs après palier de montée en
 * charge, pause en cours, compte déconnecté.
 */
function LinkedInQuotaCard({ accountId }: { accountId: string }) {
  const { data: status, isLoading, isError, isFetching, refetch } = useLinkedInQuotaStatus(accountId);

  if (isLoading) {
    return (
      <Card>
        <CardContent role="status" className="space-y-3 py-5">
          <Skeleton className="h-4 w-32" aria-hidden="true" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-2 w-full" aria-hidden="true" />)}
          <span className="sr-only">Chargement des plafonds…</span>
        </CardContent>
      </Card>
    );
  }
  // Lecture ratée : une erreur avec « Réessayer », jamais rien. Une pause en cours explique pourquoi rien ne part.
  if (isError && !status) {
    return (
      <Card>
        <CardContent className="py-5">
          <ErrorState
            variant="compact"
            title={LINKEDIN_CARD.quotaErrorTitle}
            description={LINKEDIN_CARD.quotaErrorBody}
            onRetry={() => { void refetch(); }}
            retrying={isFetching}
          />
        </CardContent>
      </Card>
    );
  }
  // Compte non rattaché à un membre : rien à afficher.
  if (!status) return null;

  // Même classement que « Mon compte LinkedIn » (STOPPED, PERMISSIONS, DELETED compris).
  const disconnected = classifyLinkedInStatus(status.account_status) === 'needs_reconnect';
  const paused = !!status.paused_until && new Date(status.paused_until).getTime() > Date.now();
  const pad = (h: number) => String(h).padStart(2, '0');

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          Plafonds du jour
        </CardTitle>
        {/* Design simplifié : le palier en texte, absent une fois le compte mature (rien à savoir). */}
        {status.ramp_stage && status.ramp_stage !== 'mature' && (
          <span className="text-xs text-muted-foreground">{rampStageLabel(status.ramp_stage)}</span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {disconnected && (
          <div className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-muted p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="text-foreground">
              <span className="font-medium">Compte déconnecté, reconnectez-le.</span>{' '}
              <span className="text-foreground-secondary">
                Les séquences qui utilisent ce compte sont en pause et reprendront automatiquement après reconnexion.
              </span>
            </p>
          </div>
        )}

        {paused && status.paused_until && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted p-2.5 text-xs">
            <CirclePause className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-foreground">
              <span className="font-medium">
                Pause en cours jusqu'à {isAnotherDay(status.paused_until, status.timezone) ? 'demain ' : ''}
                {formatHourMinute(status.paused_until, status.timezone)}.
              </span>{' '}
              <span className="text-foreground-secondary">
                Une limite a été approchée ou signalée par LinkedIn : les actions reprendront d'elles-mêmes.
              </span>
            </p>
          </div>
        )}

        <div className="space-y-2.5">
          <QuotaRow label="Actions visibles" used={status.today.visible_actions} cap={status.caps.visible_actions} />
          <QuotaRow label="Visites de profils" used={status.today.profile_views} cap={status.caps.profile_views} />
          <QuotaRow label="Recherches" used={status.today.searches} cap={status.caps.searches} />
          <QuotaRow label="InMails" used={status.today.inmails} cap={status.caps.inmails} />
          <QuotaRow label="Invitations sur 7 jours" used={status.week.invitations} cap={status.caps.weekly_invitations} />
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Heures ouvrées : {pad(status.business_hours.start)}:00 à {pad(status.business_hours.end)}:00, fuseau <TimeZoneName timeZone={status.timezone} />,
          du lundi au vendredi. Compteurs du jour remis à zéro à {formatHourMinute(status.day_resets_at, status.timezone)}.
        </p>
      </CardContent>
    </Card>
  );
}
