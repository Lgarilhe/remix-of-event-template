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
import { viewOfHealth } from '@/components/connections/connectionView';
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
 * concerne qu'un compte dont la session a expiré (même compte, même historique).
 */
export function MyWhatsAppAccount() {
  const { accounts, authReady, isPending, isError, isRefetchError, isFetching, refetch, disconnect } = useMemberWhatsAppAccounts();
  const hosted = useHostedConnect();
  const availableAccounts = accounts.filter(account => account.status !== 'DELETED');

  const onDisconnect = async (accountId: string) => {
    try {
      await disconnect.mutateAsync(accountId);
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
            {availableAccounts.map(account => {
              const view = viewOfHealth(classifyConnectionHealth({ status: account.status }), 'whatsapp');
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
                          label={view.actionLabel ?? 'Reconnecter'}
                          disabled={disconnect.isPending}
                          className="max-sm:flex-1"
                        />
                      )}
                      {view.action === 'contact_support' && <SupportLink channel="whatsapp" className="max-sm:flex-1" />}
                      <RemovalDialog
                        title={DISCONNECT_WHATSAPP.title}
                        body={DISCONNECT_WHATSAPP.body}
                        triggerLabel={DISCONNECT_WHATSAPP.confirm}
                        confirmLabel={DISCONNECT_WHATSAPP.confirm}
                        disabled={disconnect.isPending || hosted.busy}
                        icon={false}
                        onConfirm={() => { void onDisconnect(account.id); }}
                      />
                    </>
                  )}
                />
              );
            })}
            <HostedError hosted={hosted} />
            {availableAccounts.length === 0 && (
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
