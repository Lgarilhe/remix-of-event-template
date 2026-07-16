import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import notionLogo from '@/assets/notion-logo.webp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

interface StartResponse extends Record<string, unknown> {
  success?: boolean;
  authorization_url?: string;
  error?: string;
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Connexion Notion annulée. Aucun accès n’a été ajouté.',
  state_expired: 'Le lien de connexion a expiré. Clique sur Reconnecter pour recommencer.',
  state_missing: 'Le retour de Notion est incomplet. Relance la connexion.',
  permission_changed: 'Tu n’as plus les droits nécessaires pour connecter Notion.',
  exchange_failed: 'Notion n’a pas pu finaliser la connexion. Réessaie dans un instant.',
  authorization_failed: 'Notion a refusé la connexion. Réessaie ou choisis un autre workspace.',
  callback_failed: 'La connexion n’a pas pu être finalisée. Réessaie dans un instant.',
};

export function NotionConnectionCard() {
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
      toast.success('Notion est connecté à l’assistant IA.');
      queryClient.invalidateQueries({ queryKey: notionMcpStatusQueryKey(organizationId, user?.id) });
    } else {
      toast.error(OAUTH_ERROR_MESSAGES[oauthError || ''] || 'La connexion Notion a échoué. Réessaie.');
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
      toast.success('Notion est déconnecté de l’assistant IA.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Déconnexion impossible.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-white shadow-sm">
                <img src={notionLogo} alt="" className="h-7 w-7 object-contain" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Notion</h3>
                  {statusQuery.isLoading ? (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <Loader2 className="h-3 w-3 animate-spin" /> Vérification
                    </Badge>
                  ) : statusQuery.isError ? (
                    <Badge variant="destructive" className="text-[10px]">Statut indisponible</Badge>
                  ) : connected ? (
                    <Badge className="gap-1 bg-success text-[10px] text-success-foreground hover:bg-success/90">
                      <CheckCircle2 className="h-3 w-3" /> Connecté
                    </Badge>
                  ) : needsReconnect ? (
                    <Badge variant="destructive" className="text-[10px]">À reconnecter</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">Non connecté</Badge>
                  )}
                </div>
                <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Connecte ton compte Notion personnel pour que ton assistant puisse chercher et lire les contenus auxquels tu as accès.
                </p>
              </div>
            </div>

            {canManage && !statusQuery.isLoading && !statusQuery.isError && (
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={connecting || disconnecting}
                variant={connected ? 'outline' : 'default'}
                className="shrink-0"
              >
                {connecting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : connected ? (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                )}
                {connected ? 'Modifier l’accès' : needsReconnect ? 'Reconnecter' : 'Connecter'}
              </Button>
            )}
          </div>

          {statusQuery.isError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
              <p className="text-xs text-destructive">Impossible de vérifier la connexion Notion.</p>
              <Button size="sm" variant="ghost" onClick={() => statusQuery.refetch()}>
                Réessayer
              </Button>
            </div>
          )}

          {connected && (
            <div className="mt-4 rounded-xl border border-success/25 bg-success/5 p-3.5">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    Disponible immédiatement dans le chat IA
                    {connection?.email_domain ? ` · workspace @${connection.email_domain}` : ''}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Cette connexion t’est personnelle : les autres membres ne peuvent pas utiliser tes accès Notion.
                    Konekt autorise uniquement la recherche et la lecture, jamais la modification.
                  </p>
                </div>
                {canManage && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                        disabled={disconnecting}
                      >
                        {disconnecting ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Unplug className="mr-1 h-3 w-3" />
                        )}
                        Déconnecter
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Déconnecter Notion ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          L’assistant perdra immédiatement l’accès aux contenus Notion. Tu pourras le reconnecter plus tard.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDisconnect}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Déconnecter
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          )}

          {!canManage && !statusQuery.isLoading && !statusQuery.isError && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              La connexion Notion n’est pas disponible pour ce compte.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
