/**
 * AgentPoliciesSettings — Politiques d'autonomie de l'agent IA (P2.1).
 *
 * Rendu dans l'onglet /settings?tab=agent-actions, au-dessus de l'audit.
 * Une ligne par action de l'agent : Automatique / Avec approbation / Désactivée.
 *
 * - Défaut (aucune row en base) : « Avec approbation ».
 * - Les actions sensibles (envois externes, destructives) ne peuvent PAS
 *   passer en automatique — le sélecteur est bridé ET le serveur clampe de
 *   toute façon (agent-tools.ts, resolveEffectivePolicy).
 * - Ligne spéciale « Digest matinal » : pseudo-tool daily_digest (auto = activé).
 * - Écriture réservée owner/admin (RLS) — l'UI masque les contrôles sinon.
 */
import { useCallback } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ShieldCheck, Zap, Lock, Sunrise } from 'lucide-react';
import { toast } from 'sonner';

type ToolPolicy = 'auto' | 'approve' | 'off';

interface PolicyTool {
  name: string;
  label: string;
  /** false = approbation obligatoire (clamp serveur) — sélecteur bridé */
  autoEligible: boolean;
  description?: string;
}

// Miroir de agent-tools.ts (NEVER_AUTO_TOOLS + catégorie mutation_external).
// Le serveur reste la garantie : ce tableau ne fait que piloter l'UI.
const POLICY_TOOLS: PolicyTool[] = [
  { name: 'update_candidate_stage', label: 'Modifier le stade candidat', autoEligible: true },
  { name: 'add_to_shortlist', label: 'Ajouter à la shortlist', autoEligible: true },
  { name: 'add_candidate_note', label: 'Ajouter une note candidat', autoEligible: true },
  { name: 'assign_candidate_to_member', label: 'Assigner un candidat', autoEligible: true },
  { name: 'create_mission', label: 'Créer une mission', autoEligible: true },
  { name: 'update_mission_brief', label: 'Modifier le brief mission', autoEligible: true },
  { name: 'regenerate_search_filters', label: 'Régénérer les filtres LinkedIn', autoEligible: true },
  { name: 'apply_search_filters_to_mission', label: 'Appliquer les filtres de recherche', autoEligible: true },
  { name: 'enroll_in_sequence', label: 'Enrôler dans une séquence', autoEligible: true },
  { name: 'create_sequence', label: 'Créer une séquence', autoEligible: true },
  { name: 'pause_sequence', label: 'Mettre en pause une séquence', autoEligible: true },
  { name: 'resume_sequence', label: 'Reprendre une séquence', autoEligible: true },
  { name: 'draft_outreach_message', label: "Rédiger un message d'approche", autoEligible: true },
  { name: 'enrich_candidate_contact', label: 'Enrichir un contact', autoEligible: true },
  { name: 'schedule_interview', label: 'Planifier un entretien', autoEligible: true },
  { name: 'bulk_update_stage', label: 'Déplacer plusieurs candidats', autoEligible: true },
  { name: 'start_background_scoring', label: 'Scorer une mission en tâche de fond', autoEligible: true, description: 'Consomme des crédits (scoring en masse) — par défaut soumis à approbation' },
  // Approbation obligatoire (envois externes / destructif / équipe)
  { name: 'send_linkedin_message', label: 'Envoyer un message LinkedIn', autoEligible: false, description: 'Envoi externe — approbation obligatoire' },
  { name: 'send_email', label: 'Envoyer un email', autoEligible: false, description: 'Envoi externe — approbation obligatoire' },
  { name: 'launch_search', label: 'Lancer la recherche autonome', autoEligible: false, description: 'Consomme crédits + compte LinkedIn — approbation obligatoire' },
  { name: 'dismiss_candidate', label: 'Écarter un candidat', autoEligible: false, description: 'Destructif — approbation obligatoire' },
  { name: 'bulk_dismiss', label: 'Écarter plusieurs candidats', autoEligible: false, description: 'Destructif — approbation obligatoire' },
  { name: 'update_mission_status', label: 'Modifier le statut mission', autoEligible: false, description: 'Archivage/clôture — approbation obligatoire' },
  { name: 'invite_team_member', label: 'Inviter un membre', autoEligible: false, description: 'Équipe — approbation obligatoire' },
  { name: 'update_member_quota', label: "Modifier les quotas d'un membre", autoEligible: false, description: 'Équipe — approbation obligatoire' },
];

const DAILY_DIGEST_TOOL = 'daily_digest';

export function AgentPoliciesSettings() {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();

  const { data: policies = new Map<string, ToolPolicy>() } = useQuery({
    queryKey: ['agent-tool-policies', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_tool_policies')
        .select('tool_name, policy')
        .eq('organization_id', organizationId);
      if (error) throw error;
      const map = new Map<string, ToolPolicy>();
      for (const row of data ?? []) {
        map.set(row.tool_name, row.policy as ToolPolicy);
      }
      return map;
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const setPolicy = useCallback(
    async (toolName: string, policy: ToolPolicy) => {
      if (!organizationId) return;
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('agent_tool_policies')
        .upsert(
          {
            organization_id: organizationId,
            tool_name: toolName,
            policy,
            updated_by: user?.id ?? null,
          },
          { onConflict: 'organization_id,tool_name' },
        );
      if (error) {
        toast.error(`Impossible d'enregistrer la politique : ${error.message}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['agent-tool-policies', organizationId] });
      toast.success('Politique enregistrée. Prise en compte sous ~1 minute.');
    },
    [organizationId, queryClient],
  );

  const digestEnabled = policies.get(DAILY_DIGEST_TOOL) === 'auto';

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" />
            Politiques d'autonomie
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Pour chaque action, choisissez si le copilot l'exécute directement (visible dans
            l'audit ci-dessous) ou attend votre approbation. Les envois externes et les actions
            destructives exigent toujours une approbation.
            {!isAdmin && ' Réservé aux administrateurs.'}
          </p>
        </div>

        {/* Digest matinal (agent proactif) */}
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sunrise className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium">Digest matinal</div>
              <div className="text-[11px] text-muted-foreground truncate">
                Chaque matin, le copilot résume missions actives, relances dues, entretiens du jour
                et actions en attente dans une conversation.
              </div>
            </div>
          </div>
          <Switch
            checked={digestEnabled}
            disabled={!isAdmin}
            onCheckedChange={(checked) => setPolicy(DAILY_DIGEST_TOOL, checked ? 'auto' : 'off')}
          />
        </div>

        <div className="divide-y divide-border rounded-lg border border-border">
          {POLICY_TOOLS.map((tool) => {
            const current: ToolPolicy = policies.get(tool.name) ?? 'approve';
            return (
              <div key={tool.name} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium flex items-center gap-1.5">
                    {tool.label}
                    {!tool.autoEligible && <Lock className="w-3 h-3 text-muted-foreground" />}
                  </div>
                  {tool.description && (
                    <div className="text-[11px] text-muted-foreground">{tool.description}</div>
                  )}
                </div>
                {isAdmin ? (
                  <Select
                    value={current}
                    onValueChange={(v) => setPolicy(tool.name, v as ToolPolicy)}
                  >
                    <SelectTrigger className="w-[190px] h-8 text-xs shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {tool.autoEligible && (
                        <SelectItem value="auto">
                          <span className="flex items-center gap-1.5">
                            <Zap className="w-3 h-3" /> Automatique
                          </span>
                        </SelectItem>
                      )}
                      <SelectItem value="approve">Avec approbation</SelectItem>
                      <SelectItem value="off">Désactivée</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="text-[11px] shrink-0">
                    {current === 'auto' ? 'Automatique' : current === 'off' ? 'Désactivée' : 'Avec approbation'}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
