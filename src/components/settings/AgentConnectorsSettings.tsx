/**
 * AgentConnectorsSettings — Connecteurs MCP du Copilot (P3.1).
 *
 * Rendu dans /settings?tab=agent-actions, sous les politiques d'autonomie.
 * Un connecteur = un serveur MCP distant (Model Context Protocol, standard
 * ouvert) : Notion, Slack, calendrier, outil interne… Ses outils deviennent
 * disponibles dans le chat du Copilot.
 *
 * - Écriture réservée owner/admin (RLS) ; lecture pour tous les membres.
 * - Le token d'autorisation est WRITE-ONLY : jamais relu côté client (grants
 *   par colonne en base) — le champ reste vide à l'affichage.
 * - ⚠️ SELECT toujours en colonnes explicites (jamais '*') : la colonne token
 *   n'est pas lisible par authenticated, un '*' ferait une permission denied.
 * - Max 5 connecteurs actifs par organisation (limite backend).
 */
import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { Plug, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

export function AgentConnectorsSettings() {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<McpServerRow | null>(null);

  const { data: servers = [] } = useQuery({
    queryKey: ['org-mcp-servers', organizationId],
    queryFn: async () => {
      // Colonnes explicites obligatoires (token write-only, cf. en-tête)
      const { data, error } = await supabase
        .from('organization_mcp_servers' as any)
        .select('id, name, url, enabled, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as McpServerRow[];
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['org-mcp-servers', organizationId] });

  const handleAdd = async () => {
    const slug = name.trim().toLowerCase();
    if (!NAME_RE.test(slug)) {
      toast.error('Nom invalide : 2-40 caractères, minuscules/chiffres/tirets (ex : notion, slack-recrutement).');
      return;
    }
    if (!url.trim().startsWith('https://')) {
      toast.error("L'URL du connecteur doit commencer par https://");
      return;
    }
    if (servers.length >= 5) {
      toast.error('Maximum 5 connecteurs par organisation.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('organization_mcp_servers' as any).insert({
        organization_id: organizationId,
        name: slug,
        url: url.trim(),
        authorization_token: token.trim() || null,
        enabled: true,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success(`Connecteur « ${slug} » ajouté. Actif dans le chat immédiatement.`);
      setName(''); setUrl(''); setToken(''); setShowForm(false);
      invalidate();
    } catch (e: any) {
      toast.error(e?.message?.includes('unique')
        ? 'Un connecteur porte déjà ce nom.'
        : `Ajout impossible : ${e?.message || 'erreur'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (row: McpServerRow, enabled: boolean) => {
    const { error } = await supabase
      .from('organization_mcp_servers' as any)
      .update({ enabled })
      .eq('id', row.id);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('organization_mcp_servers' as any)
      .delete()
      .eq('id', deleteTarget.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Connecteur « ${deleteTarget.name} » supprimé.`);
    setDeleteTarget(null);
    invalidate();
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Plug className="w-4 h-4" />
              Connecteurs du copilot (MCP)
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Branchez des serveurs MCP (Notion, Slack, calendrier, outils internes…) : leurs
              outils deviennent utilisables par le copilot dans le chat.
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} className="shrink-0">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Ajouter
            </Button>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
          <span>
            Les outils d'un connecteur s'exécutent <b>sans bandeau d'approbation</b> (contrairement
            aux actions Konekt). Ne connectez que des services de confiance, avec des tokens aux
            droits minimaux.
          </span>
        </div>

        {isAdmin && showForm && (
          <div className="rounded-lg border border-border p-3 space-y-2.5">
            <div className="grid sm:grid-cols-2 gap-2.5">
              <Input
                placeholder="Nom court (ex : notion)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 text-xs"
              />
              <Input
                placeholder="URL du serveur MCP (https://…)"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <Input
              type="password"
              placeholder="Token d'autorisation (optionnel — jamais réaffiché)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="h-8 text-xs"
              autoComplete="off"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Annuler</Button>
              <Button size="sm" onClick={handleAdd} disabled={saving}>
                {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Ajouter le connecteur
              </Button>
            </div>
          </div>
        )}

        {servers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun connecteur configuré.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {servers.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium flex items-center gap-2">
                    {s.name}
                    {!s.enabled && <Badge variant="outline" className="text-[10px]">désactivé</Badge>}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{s.url}</div>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={s.enabled} onCheckedChange={(v) => handleToggle(s, v)} />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer le connecteur ?</AlertDialogTitle>
              <AlertDialogDescription>
                Le copilot perdra immédiatement l'accès aux outils de
                « {deleteTarget?.name} ». Cette action est irréversible (le token devra être
                ressaisi pour le rebrancher).
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive" onClick={handleDelete}>
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
