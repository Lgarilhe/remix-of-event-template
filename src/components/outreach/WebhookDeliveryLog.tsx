import { useCallback, useEffect, useRef, useState } from 'react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';
import { cn } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type DeliveryStatus = 'delivered' | 'failed' | 'no_response';

interface Delivery {
  id: string;
  event_id: string;
  event_type: string;
  status: DeliveryStatus;
  http_status: number | null;
  created_at: string;
  first_attempt: boolean;
}

interface DeliveriesResponse {
  endpoint_id?: string | null;
  deliveries?: Delivery[];
  has_more?: boolean;
  next_offset?: number | null;
}

const PAGE_SIZE = 10;

/** Nom lisible d'un type d'événement ; le type brut sinon (le journal ne s'adresse qu'aux administrateurs de la plateforme). */
export function eventLabel(eventType: string): string {
  if (eventType === 'message.new') return 'Nouveau message';
  if (eventType === 'email.new') return 'Nouvel e-mail';
  if (eventType === 'message.receipt.read') return 'Message lu';
  if (eventType === 'message.reaction.new') return 'Réaction à un message';
  if (eventType === 'relation.new') return 'Invitation acceptée';
  if (eventType.startsWith('account.')) return 'État d’un compte';
  return eventType;
}

/** Issue d'une livraison en mots : la couleur ne porte jamais seule l'information. */
export function statusLabel(delivery: Pick<Delivery, 'status' | 'http_status'>): string {
  if (delivery.status === 'delivered') return 'Reçue';
  if (delivery.status === 'failed') return delivery.http_status ? `Échec (${delivery.http_status})` : 'Échec';
  return 'Sans réponse';
}

/** Phrase française du serveur quand il y en a une, sinon `null`. */
function serverSentence(error: unknown): string | null {
  const message = error instanceof Error ? error.message.trim() : '';
  return message && message !== 'undefined' ? message : null;
}

/** Délai avant de relire le journal après un rejeu : la livraison est asynchrone. */
const REFRESH_AFTER_REPLAY_MS = 3000;

/**
 * Journal des notifications reçues, réservé aux administrateurs de la plateforme.
 * Le serveur décide : une réponse 403 (ou une absence de droit) ne montre rien,
 * sans message d'erreur. Le rejeu garde l'identifiant d'origine de l'événement :
 * le serveur refuse un événement que Konekt a déjà reçu, un événement dont le
 * traitement avait échoué est repris.
 */
export function WebhookDeliveryLog() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [endpointId, setEndpointId] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [replayTarget, setReplayTarget] = useState<Delivery | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Décalage de la dernière lecture demandée : « Réessayer » rejoue la même lecture.
  const lastOffset = useRef(0);
  const refreshTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async (offset: number) => {
    const append = offset > 0;
    lastOffset.current = offset;
    if (append) setLoadingMore(true);
    else setLoading(true);
    if (!append) setAnnouncement('Chargement du journal…');
    try {
      const response = await invokeEdgeFunction<DeliveriesResponse>('unipile-manage-webhooks', {
        action: 'list_deliveries',
        limit: PAGE_SIZE,
        offset,
      });
      // Pas le droit de lire le journal : la rubrique n'existe pas pour cette personne.
      if (response.error?.status === 403) {
        setAllowed(false);
        setLoadError(false);
        return;
      }
      // Un refus du serveur après la porte (réponse 200, success faux) dit que la personne a le droit : l'erreur s'affiche.
      if (!response.error && !response.data?.success) {
        setAllowed(true);
        throw new Error(response.data?.error);
      }
      if (response.error) throw response.error;
      const page = response.data.deliveries ?? [];
      setAllowed(true);
      setLoadError(false);
      setEndpointId(response.data.endpoint_id ?? null);
      setNextOffset(response.data.has_more ? (response.data.next_offset ?? null) : null);
      setDeliveries((current) => (append ? [...current, ...page] : page));
      setAnnouncement(append ? `${plural(page.length, 'livraison ajoutée', 'livraisons ajoutées')}.` : 'Journal actualisé.');
    } catch (error) {
      console.error('Error fetching webhook deliveries:', error);
      setLoadError(true);
      setAnnouncement('');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(0);
    return () => window.clearTimeout(refreshTimer.current);
  }, [load]);

  const handleReplay = async (delivery: Delivery) => {
    if (replayingId) return;
    setReplayingId(delivery.id);
    try {
      const response = await invokeEdgeFunction('unipile-manage-webhooks', {
        action: 'replay_event',
        event_id: delivery.event_id,
        ...(endpointId ? { endpoint_id: endpointId } : {}),
      });
      if (response.error || !response.data?.success) throw response.error ?? new Error(response.data?.error);
      toast.success('Rejeu demandé. Le journal va se mettre à jour.');
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => { void load(0); }, REFRESH_AFTER_REPLAY_MS);
    } catch (error) {
      console.error('Error replaying webhook event:', error);
      // Le serveur écrit une phrase neutre (déjà reçue, événement introuvable, rien à rejouer) : on la montre.
      toast.error(serverSentence(error) ?? 'Le rejeu n’a pas pu être demandé. Réessayez.');
    } finally {
      setReplayingId(null);
    }
  };

  // Tant que le serveur n'a pas dit oui, rien ne s'affiche (ni squelette, ni erreur) : la plupart des personnes n'ont pas ce droit.
  if (!allowed) return null;

  const failed = deliveries.filter((d) => d.status !== 'delivered').length;
  // Un événement reçu à une nouvelle tentative : sa première tentative en échec n'a plus rien à rejouer.
  const receivedEvents = new Set(deliveries.filter((d) => d.status === 'delivered').map((d) => d.event_id));

  return (
    <section aria-labelledby="journal-notifications" className="space-y-3 border-t border-border pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h6 id="journal-notifications" className="text-sm font-semibold text-foreground">
            Journal des notifications reçues
          </h6>
          <p className="text-xs text-muted-foreground">
            Les dernières livraisons faites à Konekt.
            {deliveries.length > 0 && failed > 0 ? ` ${plural(failed, 'livraison en échec', 'livraisons en échec')} parmi ${plural(deliveries.length, 'affichée', 'affichées')}.` : ''}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0 max-md:h-11 max-md:w-11"
              onClick={() => { void load(0); }}
              disabled={loading}
              aria-label="Actualiser le journal des notifications"
            >
              <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Actualiser</TooltipContent>
        </Tooltip>
      </div>

      <p role="status" className="sr-only">{announcement}</p>

      {loading && deliveries.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full rounded-lg" aria-hidden="true" />
          <Skeleton className="h-10 w-full rounded-lg" aria-hidden="true" />
        </div>
      ) : loadError && deliveries.length === 0 ? (
        <ErrorBox title="Impossible de lire le journal." onRetry={() => { void load(0); }} />
      ) : deliveries.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">Aucune livraison enregistrée pour le moment.</p>
      ) : (
        <>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {deliveries.map((delivery) => {
              const when = timeAgo(delivery.created_at);
              const ok = delivery.status === 'delivered';
              const receivedLater = !ok && receivedEvents.has(delivery.event_id);
              const replaying = replayingId === delivery.id;
              return (
                <li key={delivery.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-danger')}
                        aria-hidden="true"
                      />
                      <span className="truncate">{eventLabel(delivery.event_type)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {statusLabel(delivery)}
                      {when ? `, ${when}` : ''}
                      {delivery.first_attempt ? '' : ', nouvelle tentative'}
                      {receivedLater ? ', reçue ensuite' : ''}
                    </p>
                  </div>
                  {!ok && !receivedLater && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 max-md:h-11"
                      onClick={() => { if (!replayingId) setReplayTarget(delivery); }}
                      aria-busy={replaying || undefined}
                      aria-label={`Rejouer la notification « ${eventLabel(delivery.event_type)} »${when ? `, ${when}` : ''}`}
                    >
                      {replaying ? 'Rejeu…' : 'Rejouer'}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {loadError && (
            <ErrorBox
              title={lastOffset.current > 0 ? 'Impossible de charger la suite du journal.' : 'Impossible d’actualiser le journal.'}
              onRetry={() => { void load(lastOffset.current); }}
            />
          )}
          {nextOffset !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full max-md:h-11"
              onClick={() => { void load(nextOffset); }}
              disabled={loadingMore}
              loading={loadingMore}
            >
              Afficher les suivantes
            </Button>
          )}
        </>
      )}

      <AlertDialog open={!!replayTarget} onOpenChange={(open) => !open && setReplayTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejouer cette notification ?</AlertDialogTitle>
            <AlertDialogDescription>
              L’événement « {replayTarget ? eventLabel(replayTarget.event_type) : ''} » sera renvoyé à Konekt avec son identifiant d’origine.
              {' '}Un événement que Konekt a déjà reçu n’est pas rejoué. Un événement dont le traitement avait échoué est repris.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (replayTarget) void handleReplay(replayTarget);
              }}
            >
              Rejouer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
