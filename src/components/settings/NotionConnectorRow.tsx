import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import notionLogo from '@/assets/notion-logo.webp';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import {
  isUsableNotionConnection,
  notionMcpStatusQueryKey,
  useNotionMcpStatus,
} from '@/hooks/useNotionMcpStatus';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { cn } from '@/lib/utils';

interface StartResponse extends Record<string, unknown> {
  success?: boolean;
  authorization_url?: string;
  error?: string;
}

/** Retours de la connexion Notion, au vouvoiement (revue design F-11). */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Connexion Notion annulée. Aucun accès n’a été ajouté.',
  state_expired: 'Le lien de connexion a expiré. Cliquez sur « Reconnecter » pour recommencer.',
  state_missing: 'Le retour de Notion est incomplet. Relancez la connexion.',
  permission_changed: 'Vous n’avez plus les droits nécessaires pour connecter Notion.',
  exchange_failed: 'Notion n’a pas pu finaliser la connexion. Réessayez dans un instant.',
  authorization_failed: 'Notion a refusé la connexion. Réessayez ou choisissez un autre espace de travail.',
  callback_failed: 'La connexion n’a pas pu être finalisée. Réessayez dans un instant.',
};

type NotionState = 'loading' | 'error' | 'connected' | 'reconnect' | 'disconnected';

/** État en mots et en pastille : neutre par défaut, la couleur pour un écart (revue design F-14). */
const NOTION_STATE: Record<Exclude<NotionState, 'loading'>, { label: string; dot: string; text: string }> = {
  connected: { label: 'Connecté', dot: 'bg-success', text: 'text-foreground-secondary' },
  reconnect: { label: 'À reconnecter', dot: 'bg-danger', text: 'font-medium text-danger' },
  disconnected: { label: 'Non connecté', dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  error: { label: 'Statut indisponible', dot: 'bg-danger', text: 'font-medium text-danger' },
};

function NotionStatus({ state }: { state: NotionState }) {
  if (state === 'loading') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Vérification…
      </span>
    );
  }
  const { label, dot, text } = NOTION_STATE[state];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs', text)}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)} aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Notion, une ligne de la liste « Applications connectées » (AssistantConnectorsCard) :
 * un connecteur parmi d'autres, sans carte à part (décision du 04/10/2026).
 * Seul lecteur du retour de connexion (notion_oauth, notion_error).
 */
export function NotionConnectorRow() {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const handledOAuthResult = useRef<string | null>(null);

  const statusQuery = useNotionMcpStatus(organizationId, user?.id);

  const oauthOutcome = searchParams.get('notion_oauth');
  const oauthError = searchParams.get('notion_error');
  useEffect(() => {
    if (!oauthOutcome) return;
    const resultKey = `${oauthOutcome}:${oauthError || ''}`;
    if (handledOAuthResult.current === resultKey) return;
    handledOAuthResult.current = resultKey;

    if (oauthOutcome === 'connected') {
      toast.success('Notion est connecté à l’assistant.');
      queryClient.invalidateQueries({ queryKey: notionMcpStatusQueryKey(organizationId, user?.id) });
    } else {
      toast.error(OAUTH_ERROR_MESSAGES[oauthError || ''] || 'La connexion Notion a échoué. Réessayez.');
    }

    const next = new URLSearchParams(searchParams);
    next.delete('notion_oauth');
    next.delete('notion_error');
    setSearchParams(next, { replace: true });
  }, [oauthError, oauthOutcome, organizationId, queryClient, searchParams, setSearchParams, user?.id]);

  const connection = statusQuery.data?.connection ?? null;
  const connected = isUsableNotionConnection(connection);
  const needsReconnect = connection?.needs_reauthorization === true
    || (connection?.connected === true && connection.has_error);
  const canManage = statusQuery.data?.can_manage === true;
  const state: NotionState = statusQuery.isLoading ? 'loading'
    : statusQuery.isError ? 'error'
    : connected ? 'connected'
    : needsReconnect ? 'reconnect'
    : 'disconnected';
  const ready = !statusQuery.isLoading && !statusQuery.isError;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.delete('notion_oauth');
      returnUrl.searchParams.delete('notion_error');
      const { data, error } = await invokeEdgeFunction<StartResponse>('notion-mcp-oauth', {
        action: 'start',
        return_to: returnUrl.toString(),
      });
      if (error || !data.authorization_url) {
        throw error ?? new Error(data.error || 'Lien Notion indisponible');
      }
      window.location.assign(data.authorization_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Impossible d’ouvrir Notion.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await invokeEdgeFunction('notion-mcp-oauth', { action: 'disconnect' });
      if (error || data.success === false) throw error ?? new Error(data.error || 'Déconnexion impossible');
      await queryClient.invalidateQueries({ queryKey: notionMcpStatusQueryKey(organizationId, user?.id) });
      toast.success('Notion est déconnecté de l’assistant.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Déconnexion impossible.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-2 px-3 py-3">
      {/* Anatomie des lignes de la liste : logo, nom et état, actions à droite. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Logo officiel, noir : posé sur sa plaque blanche pour rester lisible en thème sombre. */}
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-white" aria-hidden="true">
            <img src={notionLogo} alt="" className="h-5 w-5 object-contain" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground">Notion</h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <NotionStatus state={state} />
              {connected && connection?.email_domain && (
                <span className="text-xs text-muted-foreground">{`Espace @${connection.email_domain}`}</span>
              )}
            </div>
          </div>
        </div>

        {canManage && ready && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleConnect}
              loading={connecting}
              disabled={disconnecting}
              className="max-md:h-11"
            >
              {!connecting && (connected ? <RefreshCw aria-hidden="true" /> : <ExternalLink aria-hidden="true" />)}
              {connected ? 'Modifier l’accès' : needsReconnect ? 'Reconnecter' : 'Connecter'}
            </Button>
            {connected && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={disconnecting}
                    disabled={connecting}
                    className="text-muted-foreground hover:text-danger max-md:h-11"
                  >
                    {!disconnecting && <Unplug aria-hidden="true" />}
                    Déconnecter
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Déconnecter Notion ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      L’assistant perdra immédiatement l’accès aux contenus Notion. Vous pourrez le reconnecter plus tard.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisconnect} className="bg-destructive">
                      Déconnecter
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      {statusQuery.isError && (
        <ErrorState
          variant="compact"
          title="Impossible de vérifier la connexion Notion."
          description="Vérifiez votre connexion, puis réessayez."
          onRetry={() => { void statusQuery.refetch(); }}
          retrying={statusQuery.isFetching}
        />
      )}

      {!canManage && ready && (
        <p className="text-xs text-muted-foreground">
          La connexion Notion n’est pas disponible pour ce compte.
        </p>
      )}
    </div>
  );
}
