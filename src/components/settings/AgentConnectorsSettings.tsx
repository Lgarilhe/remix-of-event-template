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
 * - Chaque connecteur est fail-closed : il n'est actif qu'avec une liste
 *   blanche explicite d'outils MCP en lecture seule.
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Plug, Plus, Trash2, AlertTriangle, Loader2, Pencil, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { NotionConnectionCard } from './NotionConnectionCard';

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  allowed_tools: string[];
  enabled: boolean;
  created_at: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MUTATING_TOOL_SEGMENT_RE = /(?:^|[_.:-])(create|write|update|delete|remove|send|patch|edit|modify|move|rename|archive|invite|add|upload|execute|run|trigger|publish|approve|reject|assign|enroll|dismiss|cancel|reply)(?:[_.:-]|$)/i;

function parseAllowedTools(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter((name) => TOOL_NAME_RE.test(name) && !MUTATING_TOOL_SEGMENT_RE.test(name)),
  )].slice(0, 50);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'erreur';
}

export function AgentConnectorsSettings() {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [allowedToolsText, setAllowedToolsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingToolsId, setEditingToolsId] = useState<string | null>(null);
  const [editingToolsText, setEditingToolsText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<McpServerRow | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: servers = [] } = useQuery({
    queryKey: ['org-mcp-servers', organizationId],
    queryFn: async () => {
      // Colonnes explicites obligatoires (token write-only, cf. en-tête)
      const { data, error } = await supabase
        .from('organization_mcp_servers')
        .select('id, name, url, allowed_tools, enabled, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['org-mcp-servers', organizationId] });

  const handleAdd = async () => {
    const slug = name.trim().toLowerCase();
    const allowedTools = parseAllowedTools(allowedToolsText);
    if (!NAME_RE.test(slug)) {
      toast.error('Nom invalide : 2-40 caractères, minuscules/chiffres/tirets (ex : notion, slack-recrutement).');
      return;
    }
    if (!url.trim().startsWith('https://')) {
      toast.error("L'URL du connecteur doit commencer par https://");
      return;
    }
    if (allowedTools.length === 0) {
      toast.error('Ajoutez au moins un nom d’outil MCP en lecture seule à la liste blanche.');
      return;
    }
    if (servers.length >= 5) {
      toast.error('Maximum 5 connecteurs par organisation.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('organization_mcp_servers').insert({
        organization_id: organizationId,
        name: slug,
        url: url.trim(),
        authorization_token: token.trim() || null,
        allowed_tools: allowedTools,
        enabled: true,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success(`Connecteur « ${slug} » ajouté. Actif dans le chat immédiatement.`);
      setName(''); setUrl(''); setToken(''); setAllowedToolsText(''); setShowForm(false);
      invalidate();
    } catch (e: unknown) {
      const errorMessage = getErrorMessage(e);
      toast.error(errorMessage.includes('unique')
        ? 'Un connecteur porte déjà ce nom.'
        : `Ajout impossible : ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (row: McpServerRow, enabled: boolean) => {
    if (enabled && row.allowed_tools.length === 0) {
      toast.error('Définissez d’abord les outils en lecture seule autorisés.');
      return;
    }
    const { error } = await supabase
      .from('organization_mcp_servers')
      .update({ enabled })
      .eq('id', row.id);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  const handleSaveAllowedTools = async (row: McpServerRow) => {
    const allowedTools = parseAllowedTools(editingToolsText);
    if (allowedTools.length === 0) {
      toast.error('Ajoutez au moins un nom d’outil MCP en lecture seule.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('organization_mcp_servers')
        .update({ allowed_tools: allowedTools })
        .eq('id', row.id);
      if (error) throw error;
      toast.success('Liste blanche mise à jour. Vous pouvez activer le connecteur.');
      setEditingToolsId(null);
      setEditingToolsText('');
      invalidate();
    } catch (e: unknown) {
      toast.error(`Mise à jour impossible : ${getErrorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('organization_mcp_servers')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Connecteur « ${deleteTarget.name} » supprimé.`);
    setDeleteTarget(null);
    invalidate();
  };

  return (
    <div className="space-y-3">
      <NotionConnectionCard />

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40"
          >
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Options avancées pour développeurs
            </span>
            <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
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
            Sécurité renforcée : seuls les outils en lecture seule inscrits dans la liste blanche
            sont exposés au copilot. Les écritures via MCP sont interdites ; utilisez les actions
            Konekt avec approbation pour modifier ou envoyer des données.
          </span>
        </div>

        {isAdmin && showForm && (
          <div className="rounded-lg border border-border p-3 space-y-2.5">
            <div className="grid sm:grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="mcp-connector-name" className="sr-only">Nom court du connecteur</label>
                <Input
                  id="mcp-connector-name"
                  placeholder="Nom court (ex : notion)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label htmlFor="mcp-connector-url" className="sr-only">URL du serveur MCP</label>
                <Input
                  id="mcp-connector-url"
                  placeholder="URL du serveur MCP (https://…)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <label htmlFor="mcp-connector-token" className="sr-only">Token d’autorisation</label>
            <Input
              id="mcp-connector-token"
              type="password"
              placeholder="Token d'autorisation (optionnel — jamais réaffiché)"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="h-8 text-xs"
              autoComplete="off"
            />
            <div className="space-y-1">
              <label htmlFor="mcp-connector-tools" className="sr-only">Outils autorisés en lecture seule</label>
              <Input
                id="mcp-connector-tools"
                placeholder="Outils autorisés en lecture seule (ex : search read_page)"
                value={allowedToolsText}
                onChange={(e) => setAllowedToolsText(e.target.value)}
                className="h-8 text-xs"
                autoComplete="off"
              />
              <p className="text-[10px] text-muted-foreground">
                Noms exacts fournis par le serveur MCP, séparés par des espaces ou des virgules. 50 maximum.
              </p>
            </div>
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
              <div key={s.id} className="px-3 py-2 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium flex items-center gap-2">
                      {s.name}
                      {!s.enabled && <Badge variant="outline" className="text-[10px]">désactivé</Badge>}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{s.url}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {s.allowed_tools.length} outil{s.allowed_tools.length > 1 ? 's' : ''} autorisé{s.allowed_tools.length > 1 ? 's' : ''} en lecture
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={s.enabled}
                        onCheckedChange={(v) => handleToggle(s, v)}
                        aria-label={`${s.enabled ? 'Désactiver' : 'Activer'} le connecteur ${s.name}`}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Modifier la liste blanche"
                        aria-label={`Modifier les outils autorisés pour ${s.name}`}
                        className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => {
                          setEditingToolsId(s.id);
                          setEditingToolsText(s.allowed_tools.join(' '));
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Supprimer le connecteur ${s.name}`}
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {isAdmin && editingToolsId === s.id && (
                  <div className="flex flex-col sm:flex-row gap-2 rounded-md bg-muted/30 p-2">
                    <label htmlFor={`mcp-tools-${s.id}`} className="sr-only">
                      Outils autorisés pour {s.name}
                    </label>
                    <Input
                      id={`mcp-tools-${s.id}`}
                      value={editingToolsText}
                      onChange={(e) => setEditingToolsText(e.target.value)}
                      placeholder="search read_page"
                      className="h-8 text-xs flex-1"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingToolsId(null)}>
                        Annuler
                      </Button>
                      <Button size="sm" disabled={saving} onClick={() => handleSaveAllowedTools(s)}>
                        Enregistrer
                      </Button>
                    </div>
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
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
