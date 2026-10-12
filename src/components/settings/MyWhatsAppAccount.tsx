import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { ErrorState } from '@/components/layout/ErrorState';
import { RefreshCw } from 'lucide-react';
import { useMemberWhatsAppAccounts } from '@/hooks/useMemberWhatsAppAccounts';
import { classifyConnectionHealth } from '@/lib/linkedinStatus';
import {
  CARD_COMMON,
  DISCONNECT_WHATSAPP,
  WHATSAPP_CARD,
  connectLabel,
  readableConnectionName,
} from '@/lib/connectionCopy';
import {
  AccountRow,
  ConnectionSkeleton,
  HostedConnectButton,
  HostedError,
  ReconnectButton,
  RemovalDialog,
  SupportLink,
} from '@/components/connections/ConnectionParts';
import { NativeConnectSlot } from '@/components/connections/NativeConnectSlot';
import { useHostedConnect } from '@/components/connections/useHostedConnect';
import { viewOfAccount, withoutSupersededRemoved } from '@/components/connections/connectionView';
import { createSingleFlight } from '@/components/connections/singleFlight';
import { toast } from 'sonner';

/**
 * Mon compte WhatsApp (Paramètres › Connexions, #whatsapp).
 *
 * Connexion standard : la page de connexion propose un QR code ou un code
 * d'association (un téléphone ne scanne pas son propre écran), puis revient sur
 * /settings/account/connections/retour. Seul le retour signé du serveur
 * rattache le compte à la personne.
 *
 * « Déconnecter » retire le compte chez le prestataire : la ligne disparaît de la
 * liste et la reprise passe par une nouvelle connexion. « Reconnecter » ne
 * concerne qu'un compte à reconnecter (même compte, même historique).
 *
 * Un compte retiré chez le prestataire (autrement que par « Déconnecter ») se lit comme
 * celui des deux autres cartes : « À reconnecter », même phrase, « Reconnecter » ouvre une
 * nouvelle connexion. Une lecture ratée reste une erreur avec « Réessayer », jamais l'état
 * d'un compte à relier.
 */
export function MyWhatsAppAccount() {
  const { accounts, authReady, isPending, isError, isRefetchError, isFetching, refetch, disconnect } = useMemberWhatsAppAccounts();
  const hosted = useHostedConnect();
  // Comptes déconnectés à l'instant par la personne : la liste les rend « retirés », la carte les oublie aussitôt.
  const [justDisconnected, setJustDisconnected] = useState<ReadonlySet<string>>(() => new Set());
  // Un seul « Déconnecter » à la fois : le second clic d'un double clic ne part pas.
  const once = useMemo(() => createSingleFlight(), []);
  const listedAccounts = withoutSupersededRemoved(accounts.filter(account => !justDisconnected.has(account.id)), 'whatsapp');

  const onDisconnect = async (accountId: string) => {
    try {
      await disconnect.mutateAsync(accountId);
      setJustDisconnected(previous => new Set(previous).add(accountId));
      toast.success(WHATSAPP_CARD.disconnectedToast);
    } catch (error) {
      console.error('[MyWhatsAppAccount] déconnexion impossible :', error);
      toast.error(WHATSAPP_CARD.disconnectFailed);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ChannelIcon channel="whatsapp" size="sm" decorative /> {WHATSAPP_CARD.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!authReady || isPending ? (
          <ConnectionSkeleton label={WHATSAPP_CARD.loading} />
        ) : isError && accounts.length === 0 ? (
          <ErrorState variant="compact" title={WHATSAPP_CARD.loadFailedTitle}
            description={WHATSAPP_CARD.errorBody} onRetry={() => { void refetch(); }} retrying={isFetching} />
        ) : (
          <>
            {isRefetchError && <p role="status" className="text-sm text-danger">{CARD_COMMON.staleList}</p>}
            {listedAccounts.map(account => {
              const view = viewOfAccount(
                { health: classifyConnectionHealth({ status: account.status }), status: account.status, accountId: account.id },
                'whatsapp',
              );
              const name = readableConnectionName(account.identifier || account.name, 'whatsapp');
              return (
                <AccountRow
                  key={account.id}
                  leading={(
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background" aria-hidden="true">
                      <ChannelIcon channel="whatsapp" size="md" decorative />
                    </span>
                  )}
                  name={name}
                  view={view}
                  details={view.reason ? <p className="text-xs text-muted-foreground">{view.reason}</p> : undefined}
                  actions={(
                    <>
                      {view.action === 'reconnect' && (
                        <ReconnectButton
                          hosted={hosted}
                          provider="whatsapp"
                          accountId={account.id}
                          startsNew={view.reconnect === 'new_link'}
                          label={view.actionLabel ?? 'Reconnecter'}
                          disabled={disconnect.isPending}
                          className="max-sm:flex-1"
                        />
                      )}
                      {view.action === 'contact_support' && <SupportLink channel="whatsapp" className="max-sm:flex-1" />}
                      {/* Un compte retiré chez le prestataire n'a plus rien à déconnecter : seule la reconnexion a un sens. */}
                      {view.cause !== 'removed' && (
                        <RemovalDialog
                          title={DISCONNECT_WHATSAPP.title}
                          body={DISCONNECT_WHATSAPP.body}
                          triggerLabel={DISCONNECT_WHATSAPP.confirm}
                          confirmLabel={DISCONNECT_WHATSAPP.confirm}
                          disabled={disconnect.isPending || hosted.busy}
                          icon={false}
                          onConfirm={() => { void once(() => onDisconnect(account.id)); }}
                        />
                      )}
                    </>
                  )}
                />
              );
            })}
            <HostedError hosted={hosted} />
            {listedAccounts.length === 0 && (
              <>
                <p className="text-sm text-muted-foreground">{WHATSAPP_CARD.intro}</p>
                <p className="text-xs text-muted-foreground">{WHATSAPP_CARD.privacy}</p>
                <div className="space-y-2">
                  <HostedConnectButton
                    provider="whatsapp"
                    label={connectLabel('whatsapp')}
                    variant="outline"
                    icon={<ChannelIcon channel="whatsapp" size="sm" decorative />}
                    disabled={disconnect.isPending}
                    className="sm:max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground">{WHATSAPP_CARD.hostedHelp}</p>
                  <NativeConnectSlot provider="whatsapp" />
                </div>
              </>
            )}
            <Button variant="ghost" size="sm" className="max-md:h-11" disabled={isFetching || disconnect.isPending || hosted.busy} onClick={() => { void refetch(); }}>
              <RefreshCw aria-hidden="true" /> {WHATSAPP_CARD.refreshAccounts}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
