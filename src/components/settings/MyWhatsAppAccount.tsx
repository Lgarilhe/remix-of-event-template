import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ErrorState } from '@/components/layout/ErrorState';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useMemberWhatsAppAccounts } from '@/hooks/useMemberWhatsAppAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { classifyLinkedInStatus } from '@/lib/linkedinStatus';
import { toast } from 'sonner';

const STATE_LABELS = {
  connected: 'Actif', connecting: 'Connexion en cours…', needs_reconnect: 'À reconnecter', unknown: 'État à vérifier',
};

/** QR authentication is hosted; only the signed server callback binds ownership. */
export function MyWhatsAppAccount() {
  const { accounts, authReady, isPending, isError, isRefetchError, isFetching, refetch, disconnect } = useMemberWhatsAppAccounts();
  const { organizationId } = useOrganization();
  const [connecting, setConnecting] = useState(false);
  const availableAccounts = accounts.filter(account => account.status !== 'DELETED');

  const connect = async (accountId?: string) => {
    setConnecting(true);
    try {
      const returnUrl = new URL('/settings/account/connections#whatsapp', window.location.origin).toString();
      const { data, error } = await invokeEdgeFunction<{ url?: string }>('unipile-accounts', {
        action: 'hosted_auth_link', organization_id: organizationId,
        providers: ['WHATSAPP'], reconnect_account_id: accountId,
        success_redirect_url: returnUrl, failure_redirect_url: returnUrl,
      });
      if (error || !data.success || !data.url) throw error ?? new Error(data.error || 'Impossible d’ouvrir la connexion WhatsApp');
      // Redirect avoids blocked asynchronous popups and works on mobile too.
      window.location.assign(data.url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible d’ouvrir la connexion WhatsApp');
    } finally { setConnecting(false); }
  };

  const onDisconnect = async (accountId: string) => {
    try {
      await disconnect.mutateAsync(accountId);
      toast.success('Compte WhatsApp déconnecté');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible de déconnecter votre compte WhatsApp');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ServiceLogo service="whatsapp" decorative /> Mon compte WhatsApp
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!authReady || isPending ? (
          <div role="status" className="space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" aria-hidden="true" />
            <Skeleton className="h-3 w-32 max-w-full" aria-hidden="true" />
            <span className="sr-only">Chargement de votre compte WhatsApp…</span>
          </div>
        ) : isError && accounts.length === 0 ? (
          <ErrorState variant="compact" title="Impossible de lire votre compte WhatsApp."
            description="Vérifiez votre connexion, puis réessayez." onRetry={() => { void refetch(); }} retrying={isFetching} />
        ) : (
          <>
            {isRefetchError && <p role="status" className="text-sm text-danger">Actualisation impossible. Les derniers comptes reçus restent affichés.</p>}
            {availableAccounts.map(account => {
              const health = classifyLinkedInStatus(account.status);
              return (
                <div key={account.id} className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <ServiceLogo service="whatsapp" size="lg" decorative />
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-foreground">{account.identifier || account.name || 'Compte WhatsApp'}</p>
                      <p className="text-xs text-muted-foreground">{STATE_LABELS[health]}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {health === 'needs_reconnect' && (
                      <Button variant="outline" size="sm" className="max-md:h-11" disabled={connecting || disconnect.isPending} onClick={() => { void connect(account.id); }}>
                        Reconnecter
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-danger hover:text-danger max-md:h-11" disabled={connecting || disconnect.isPending}>Déconnecter</Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Déconnecter ce compte WhatsApp ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Konekt ne pourra plus envoyer ni recevoir de messages avec ce compte. Les échanges déjà enregistrés dans les fiches candidat seront conservés. Vous pourrez le connecter de nouveau.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="max-md:h-11">Annuler</AlertDialogCancel>
                          <AlertDialogAction variant="destructive" className="max-md:h-11" onClick={() => { void onDisconnect(account.id); }}>Déconnecter</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
            {availableAccounts.length === 0 && (
              <>
                <p className="text-sm text-muted-foreground">Reliez votre compte avec le QR code de WhatsApp pour envoyer et retrouver vos échanges avec les candidats dans leur fiche.</p>
                <p className="text-xs text-muted-foreground">Le service de connexion peut recevoir les conversations de ce compte personnel. Seuls les échanges rattachés à vos candidats sont enregistrés dans Konekt.</p>
                <Button variant="outline" size="sm" className="max-md:h-11" loading={connecting} disabled={disconnect.isPending} onClick={() => { void connect(); }}>
                  <ServiceLogo service="whatsapp" decorative /> Connecter WhatsApp <ExternalLink aria-hidden="true" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" className="max-md:h-11" disabled={isFetching || connecting || disconnect.isPending} onClick={() => { void refetch(); }}>
              <RefreshCw aria-hidden="true" /> Actualiser les comptes
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
