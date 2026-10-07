import { useState, useEffect } from 'react';
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
import { cn } from '@/lib/utils';
import { Bell, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface WebhookInfo {
  id: string;
  request_url: string;
  source: string;
  account_ids?: string[];
  created_at?: string;
}

interface WebhookListResponse {
  webhooks?: WebhookInfo[] | { items?: WebhookInfo[] };
}

interface WebhookRegisterResponse {
  results?: Array<{ source: string; success: boolean }>;
}

/**
 * Revue design (D-64) : les sources techniques deviennent des noms métier, les
 * états passent par les jetons (pastille et mot), la suppression demande une
 * confirmation, et l'action principale est monochrome, plus au bleu de LinkedIn.
 */
const SOURCES: Record<string, { label: string; description: string; subject: string }> = {
  messaging: {
    label: 'Réponses des candidats',
    description: 'Détecte les réponses des candidats.',
    subject: 'des réponses des candidats',
  },
  users: {
    label: 'Invitations acceptées',
    description: 'Détecte les invitations acceptées.',
    subject: 'des invitations acceptées',
  },
  accounts: {
    label: 'État des comptes',
    description: 'Suit l’état des comptes LinkedIn.',
    subject: 'des changements d’état des comptes LinkedIn',
  },
};
const REQUIRED_SOURCES = ['messaging', 'users', 'accounts'];
const sourceLabel = (source: string) => SOURCES[source]?.label ?? 'Autre notification';

export function WebhookManager() {
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [loading, setLoading] = useState(true);
  // Lecture ratée : sans cet état, la liste vide annonçait trois notifications manquantes.
  const [loadError, setLoadError] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookInfo | null>(null);

  const fetchWebhooks = async () => {
    setLoading(true);
    try {
      const response = await invokeEdgeFunction<WebhookListResponse>('unipile-manage-webhooks', {
        action: 'list',
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      // Normalize source names (Unipile API uses 'account_status' but we display 'accounts')
      const raw = response.data.webhooks;
      const webhooksRaw = (Array.isArray(raw) ? raw : raw?.items) ?? [];
      const normalizedWebhooks = webhooksRaw.map((w: WebhookInfo) => ({
        ...w,
        source: w.source === 'account_status' ? 'accounts' : w.source,
      }));
      setWebhooks(normalizedWebhooks);
      setLoadError(false);
    } catch (error) {
      console.error('Error fetching webhooks:', error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const handleRegister = async () => {
    setRegistering(true);
    try {
      const response = await invokeEdgeFunction<WebhookRegisterResponse>('unipile-manage-webhooks', {
        action: 'register',
      });

      if (response.error) throw response.error;
      if (!response.data?.success) {
        const failedSources = response.data?.results?.filter((r) => !r.success) || [];
        if (failedSources.length > 0) {
          toast.warning(`Certaines notifications n’ont pas pu être activées : ${failedSources.map((r) => sourceLabel(r.source).toLowerCase()).join(', ')}.`);
        } else {
          throw new Error(response.data?.error);
        }
      } else {
        toast.success('Notifications en temps réel activées');
      }

      await fetchWebhooks();
    } catch (error) {
      console.error('Error registering webhooks:', error);
      toast.error('Les notifications n’ont pas pu être activées. Réessayez.');
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (webhookId: string) => {
    setDeletingId(webhookId);
    try {
      const response = await invokeEdgeFunction('unipile-manage-webhooks', {
        action: 'delete', webhook_id: webhookId,
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error);

      toast.success('Notification supprimée');
      await fetchWebhooks();
    } catch (error) {
      console.error('Error deleting webhook:', error);
      toast.error('La notification n’a pas pu être supprimée. Réessayez.');
    } finally {
      setDeletingId(null);
    }
  };

  const registeredSources = webhooks.map(w => w.source);
  const missingSources = REQUIRED_SOURCES.filter(s => !registeredSources.includes(s));

  return (
    <section aria-labelledby="notifications-temps-reel" className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Bell className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h5 id="notifications-temps-reel" className="text-sm font-semibold text-foreground">
              Notifications en temps réel
            </h5>
            <p className="text-xs text-muted-foreground">
              Konekt est prévenu dès qu’un candidat répond ou accepte une invitation.
            </p>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0 max-md:h-11 max-md:w-11"
              onClick={fetchWebhooks}
              disabled={loading}
              aria-label="Actualiser l’état des notifications"
            >
              <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Actualiser</TooltipContent>
        </Tooltip>
      </div>

      {loading && webhooks.length === 0 ? (
        <div className="space-y-2">
          <p role="status" className="sr-only">Chargement des notifications…</p>
          <Skeleton className="h-9 w-full rounded-lg" aria-hidden="true" />
          <Skeleton className="h-12 w-full rounded-lg" aria-hidden="true" />
        </div>
      ) : loadError ? (
        <ErrorBox title="Impossible de lire l’état des notifications." onRetry={() => { void fetchWebhooks(); }} />
      ) : (
        <>
          {/* État d'ensemble : pastille et mot, jamais la couleur seule. */}
          <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground">
            <span
              className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', missingSources.length === 0 ? 'bg-success' : 'bg-warning')}
              aria-hidden="true"
            />
            {missingSources.length === 0
              ? 'Les trois notifications sont actives.'
              : `${plural(missingSources.length, 'notification inactive', 'notifications inactives')} : ${missingSources.map((s) => sourceLabel(s).toLowerCase()).join(', ')}.`}
          </p>

          {/* Webhook list */}
          {webhooks.length > 0 && (
            <ul className="space-y-2">
              {webhooks.map((webhook) => (
                <li
                  key={webhook.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{sourceLabel(webhook.source)}</p>
                    <p className="text-xs text-muted-foreground">
                      {SOURCES[webhook.source]?.description}
                      {SOURCES[webhook.source]?.description ? ' ' : ''}
                      {webhook.account_ids?.length
                        ? `${plural(webhook.account_ids.length, 'compte ciblé', 'comptes ciblés')}.`
                        : 'Tous les comptes.'}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setDeleteTarget(webhook)}
                        disabled={deletingId === webhook.id}
                        loading={deletingId === webhook.id}
                        className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                        aria-label={`Supprimer la notification « ${sourceLabel(webhook.source)} »`}
                      >
                        {deletingId !== webhook.id && <Trash2 aria-hidden="true" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Supprimer</TooltipContent>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}

          {/* Register button */}
          {missingSources.length > 0 && (
            <Button
              type="button"
              variant="primary"
              onClick={handleRegister}
              disabled={registering}
              loading={registering}
              className="w-full max-md:h-11"
            >
              {!registering && <Bell aria-hidden="true" />}
              {registering ? 'Activation…' : 'Activer les notifications en temps réel'}
            </Button>
          )}

          <p className="text-xs text-muted-foreground">
            Ces notifications arrêtent aussitôt la séquence d’un candidat qui répond et mettent son statut à jour.
          </p>
        </>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer la notification « {deleteTarget ? sourceLabel(deleteTarget.source) : ''} » ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Konekt ne sera plus prévenu en temps réel {deleteTarget ? SOURCES[deleteTarget.source]?.subject ?? 'de ces événements' : ''}.
              {' '}Vous pourrez la rétablir avec « Activer les notifications en temps réel ».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={() => {
                if (deleteTarget) void handleDelete(deleteTarget.id);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
