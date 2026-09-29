/**
 * AgentPoliciesSettings — Politiques d'autonomie de l'agent IA (P2.1).
 *
 * Rendu dans Paramètres › Règles de l’assistant (ancre #resume), sous les consignes
 * de l'organisation. L'audit des actions est dans Journal de l’assistant.
 * Une ligne par action de l'agent : Automatique / Avec approbation / Désactivée.
 *
 * - Défaut (aucune row en base) : « Avec approbation ».
 * - Les actions sensibles (envois externes, destructives, changements d'étape
 *   d'un candidat) ne peuvent PAS passer en automatique — le sélecteur est
 *   bridé ET le serveur clampe de toute façon (agent-tools.ts,
 *   resolveEffectivePolicy).
 * - Ligne spéciale « Résumé du matin » (ex-« Digest matinal ») : pseudo-tool daily_digest (auto = activé).
 * - Écriture réservée owner/admin (RLS) — l'UI masque les contrôles sinon.
 * - Revue design (F-06, F-09) : une lecture ratée s'affiche en erreur avec
 *   « Réessayer », jamais comme les valeurs par défaut ; chaque changement
 *   s'enregistre aussitôt et l'annonce sur sa ligne (« Enregistré »).
 */
import { useCallback, useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { ErrorBox } from '@/components/marketplace/ErrorBox';
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
  { name: 'update_candidate_stage', label: 'Modifier l’étape du candidat', autoEligible: false, description: "Change l'étape d'un candidat : approbation obligatoire" },
  { name: 'add_to_shortlist', label: 'Ajouter à la shortlist', autoEligible: false, description: "Change l'étape d'un candidat : approbation obligatoire" },
  { name: 'add_candidate_note', label: 'Ajouter une note au candidat', autoEligible: true },
  { name: 'assign_candidate_to_member', label: 'Assigner un candidat', autoEligible: true },
  { name: 'create_mission', label: 'Créer une mission', autoEligible: true },
  { name: 'update_mission_brief', label: 'Modifier le brief de la mission', autoEligible: true },
  { name: 'regenerate_search_filters', label: 'Régénérer les filtres LinkedIn', autoEligible: true },
  { name: 'apply_search_filters_to_mission', label: 'Appliquer les filtres de recherche', autoEligible: true },
  { name: 'enroll_in_sequence', label: 'Inscrire dans une séquence', autoEligible: true },
  { name: 'create_sequence', label: 'Créer une séquence', autoEligible: true },
  { name: 'pause_sequence', label: 'Mettre en pause une séquence', autoEligible: true },
  { name: 'resume_sequence', label: 'Reprendre une séquence', autoEligible: true },
  { name: 'draft_outreach_message', label: "Rédiger un message d'approche", autoEligible: true },
  { name: 'enrich_candidate_contact', label: 'Enrichir un contact', autoEligible: true },
  { name: 'schedule_interview', label: 'Planifier un entretien', autoEligible: true },
  { name: 'bulk_update_stage', label: 'Déplacer plusieurs candidats', autoEligible: false, description: "Change l'étape de plusieurs candidats : approbation obligatoire" },
  { name: 'start_background_scoring', label: 'Évaluer les candidats d’une mission en arrière-plan', autoEligible: true, description: 'Consomme des crédits (évaluation en masse) : soumis à approbation par défaut' },
  // Approbation obligatoire (envois externes / destructif / équipe)
  { name: 'send_linkedin_message', label: 'Envoyer un message LinkedIn', autoEligible: false, description: 'Envoi externe : approbation obligatoire' },
  { name: 'send_email', label: 'Envoyer un e-mail', autoEligible: false, description: 'Envoi externe : approbation obligatoire' },
  { name: 'launch_search', label: 'Lancer la recherche autonome', autoEligible: false, description: 'Consomme des crédits et le compte LinkedIn : approbation obligatoire' },
  { name: 'dismiss_candidate', label: 'Écarter un candidat', autoEligible: false, description: 'Action irréversible : approbation obligatoire' },
  { name: 'bulk_dismiss', label: 'Écarter plusieurs candidats', autoEligible: false, description: 'Action irréversible : approbation obligatoire' },
  { name: 'update_mission_status', label: 'Modifier le statut de la mission', autoEligible: false, description: 'Archivage ou clôture : approbation obligatoire' },
  { name: 'invite_team_member', label: 'Inviter un membre', autoEligible: false, description: 'Équipe : approbation obligatoire' },
  { name: 'update_member_quota', label: "Modifier les quotas d'un membre", autoEligible: false, description: 'Équipe : approbation obligatoire' },
];

const DAILY_DIGEST_TOOL = 'daily_digest';

const POLICY_LABELS: Record<ToolPolicy, string> = {
  auto: 'Automatique',
  approve: 'Avec approbation',
  off: 'Désactivée',
};

export function AgentPoliciesSettings() {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  // État d'enregistrement de la dernière modification de chaque ligne (F-09).
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});

  const { data: policies = new Map<string, ToolPolicy>(), isPending, isError, refetch } = useQuery({
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
      setSaveStates((prev) => ({ ...prev, [toolName]: 'saving' }));
      try {
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
        if (error) throw error;
      } catch (error) {
        // Détail technique en console seulement : jamais le message brut de la base à l'écran.
        console.error('[AgentPoliciesSettings] upsert failed:', error);
        setSaveStates((prev) => ({ ...prev, [toolName]: 'error' }));
        toast.error('La règle n’a pas été enregistrée. Réessayez.');
        return;
      }
      setSaveStates((prev) => ({ ...prev, [toolName]: 'saved' }));
      queryClient.invalidateQueries({ queryKey: ['agent-tool-policies', organizationId] });
    },
    [organizationId, queryClient],
  );

  const digestEnabled = policies.get(DAILY_DIGEST_TOOL) === 'auto';

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Politiques d'autonomie
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Pour chaque action, choisissez si l'assistant l'exécute directement
            (visible dans le journal de l’assistant) ou attend votre approbation. Les envois externes, les actions
            destructives et les changements d'étape d'un candidat exigent toujours une approbation.
            {' '}Un changement s’enregistre aussitôt et s’applique en moins d’une minute.
            {!isAdmin && ' Réservé aux administrateurs.'}
          </p>
        </div>

        {isPending ? (
          <div className="space-y-2">
            <p role="status" className="sr-only">Chargement des politiques…</p>
            <Skeleton className="h-14 w-full rounded-lg" aria-hidden="true" />
            <Skeleton className="h-40 w-full rounded-lg" aria-hidden="true" />
          </div>
        ) : isError ? (
          // Lecture ratée : pas de « Avec approbation » par défaut affiché comme la vraie valeur.
          <ErrorBox title="Impossible de charger les politiques de l’assistant." onRetry={() => { void refetch(); }} />
        ) : (
        <>
        {/* Résumé du matin (agent proactif) */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sunrise className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <label htmlFor="policy-daily-digest" className="text-sm font-medium text-foreground">Résumé du matin</label>
              <p id="policy-daily-digest-help" className="text-xs text-muted-foreground">
                Chaque matin de semaine, l'assistant résume vos missions actives, les entretiens des
                prochaines 24 h et les actions de l’assistant en attente d'approbation dans une conversation, et
                envoie ce résumé par e-mail au propriétaire de l'organisation (ou à un administrateur).
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {saveStates[DAILY_DIGEST_TOOL] && <SaveStatus state={saveStates[DAILY_DIGEST_TOOL]} />}
            <Switch
              id="policy-daily-digest"
              aria-describedby="policy-daily-digest-help"
              checked={digestEnabled}
              disabled={!isAdmin}
              onCheckedChange={(checked) => setPolicy(DAILY_DIGEST_TOOL, checked ? 'auto' : 'off')}
            />
          </div>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border">
          {POLICY_TOOLS.map((tool) => {
            // Une valeur « auto » enregistrée pour un outil non éligible s'affiche
            // comme le serveur l'applique (resolveEffectivePolicy) : « approve ».
            const stored: ToolPolicy = policies.get(tool.name) ?? 'approve';
            const current: ToolPolicy = !tool.autoEligible && stored === 'auto' ? 'approve' : stored;
            return (
              <div key={tool.name} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    {tool.label}
                    {!tool.autoEligible && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                  </div>
                  {tool.description && (
                    <div className="text-xs text-muted-foreground">{tool.description}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {saveStates[tool.name] && <SaveStatus state={saveStates[tool.name]} />}
                  {isAdmin ? (
                    <Select
                      value={current}
                      onValueChange={(v) => setPolicy(tool.name, v as ToolPolicy)}
                    >
                      <SelectTrigger className="h-8 w-full text-xs sm:w-48 max-md:h-11" aria-label={`Politique : ${tool.label}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tool.autoEligible && (
                          <SelectItem value="auto">
                            <span className="flex items-center gap-1.5">
                              <Zap className="h-3 w-3" aria-hidden="true" /> Automatique
                            </span>
                          </SelectItem>
                        )}
                        <SelectItem value="approve">Avec approbation</SelectItem>
                        <SelectItem value="off">Désactivée</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{POLICY_LABELS[current]}</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
        )}
      </CardContent>
    </Card>
  );
}
