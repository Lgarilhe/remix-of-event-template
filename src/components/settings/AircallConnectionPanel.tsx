import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { confirmAlert } from '@/lib/confirmAlert';
import { plural } from '@/lib/plural';
import { useAircallConnectionActions, useTelephonyStatus } from '@/hooks/useTelephonyStatus';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null;

/**
 * Liaison du compte Aircall de l'organisation : relier, état, délier.
 * Rendu sous les champs d'identifiants de la carte Aircall (réglages).
 */
export const AircallConnectionPanel = ({
  hasCredentials,
  hasUnsavedChanges,
}: {
  /** Identifiant et jeton enregistrés. */
  hasCredentials: boolean;
  /** Champs modifiés et pas encore enregistrés : la liaison lit les valeurs enregistrées. */
  hasUnsavedChanges: boolean;
}) => {
  const { data: status, isLoading, isError, refetch } = useTelephonyStatus();
  const { connect, disconnect, busy } = useAircallConnectionActions();

  const handleConnect = async () => {
    try {
      await connect();
      toast.success('Aircall est relié. Les appels terminés remonteront dans les fiches candidats.');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'La liaison avec Aircall a échoué. Réessayez.');
    }
  };

  const handleDisconnect = async () => {
    const ok = await confirmAlert({
      title: 'Délier Aircall ?',
      description: "Les nouveaux appels ne remonteront plus dans Konekt. L'historique déjà reçu est conservé.",
      confirmLabel: 'Délier',
      destructive: true,
    });
    if (!ok) return;
    try {
      const remoteRemoved = await disconnect();
      if (remoteRemoved) toast.success('Aircall est délié.');
      else toast.warning('Aircall est délié de Konekt. Supprimez aussi la liaison « Konekt » dans les réglages Aircall si elle y figure encore.');
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'La liaison n\'a pas pu être retirée. Réessayez.');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <p role="status" className="sr-only">Chargement de l'état de la liaison…</p>
        <Skeleton className="h-9 w-full rounded-lg" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-xs text-muted-foreground">
        L'état de la liaison est indisponible.{' '}
        <Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs" onClick={() => { void refetch(); }}>
          Réessayer
        </Button>
      </p>
    );
  }

  if (status?.connected) {
    const since = formatDate(status.connectedAt);
    const last = formatDate(status.lastCallAt);
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground">
          Aircall est relié{since ? ` depuis le ${since}` : ''}.{' '}
          {status.callsCount > 0
            ? `${plural(status.callsCount, 'appel reçu', 'appels reçus')}${last ? `, le dernier le ${last}` : ''}.`
            : "Aucun appel reçu pour l'instant. Les appels terminés apparaissent dans les fiches candidats dès qu'Aircall les envoie."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-md:h-11"
            disabled={busy !== null || hasUnsavedChanges}
            loading={busy === 'connect'}
            onClick={handleConnect}
          >
            Relier à nouveau
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-danger max-md:h-11"
            disabled={busy !== null}
            loading={busy === 'disconnect'}
            onClick={handleDisconnect}
          >
            Délier
          </Button>
        </div>
        {hasUnsavedChanges && (
          <p className="text-xs text-muted-foreground">Enregistrez vos modifications avant de relier à nouveau.</p>
        )}
      </div>
    );
  }

  if (!hasCredentials) {
    return (
      <p className="text-xs text-muted-foreground">
        Dans Aircall, ouvrez Intégrations et API, créez une clé et recopiez l'identifiant et le jeton ci-dessus. Enregistrez, puis reliez Aircall.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Reliez Aircall pour que vos appels remontent dans les fiches candidats, rattachés par leur numéro de téléphone.
      </p>
      <Button
        type="button"
        size="sm"
        className="w-full max-md:h-11"
        disabled={busy !== null || hasUnsavedChanges}
        loading={busy === 'connect'}
        onClick={handleConnect}
      >
        Relier Aircall
      </Button>
      {hasUnsavedChanges && (
        <p className="text-xs text-muted-foreground">Enregistrez vos modifications avant de relier.</p>
      )}
    </div>
  );
};
