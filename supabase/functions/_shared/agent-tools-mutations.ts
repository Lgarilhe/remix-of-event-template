// ============================================================================
// Mutating tools — Sprint 1
// ============================================================================
// Tools que l'agent IA peut PROPOSER. Toutes en requiresApproval=true.
// Pattern : voir _shared/agent-tools.ts.
//
// Ajouter un nouveau tool :
//   1. Définir l'objet AgentTool ci-dessous
//   2. registerTool(monNouveauTool) dans `registerMutatingTools()` plus bas
//   3. Le tool est automatiquement exposé à Claude via getAnthropicToolDefinitions()
// ============================================================================

import type { AgentTool, ToolContext } from './agent-tools.ts';
import { registerTool } from './agent-tools.ts';

// ─── Tool 1 — update_candidate_stage ────────────────────────────────────────
// MVP : seul tool implémenté pour valider la mécanique end-to-end.
//
// Updates `pipeline_stage` (the business-facing kanban stage seen in the ATS
// view), NOT `status` (the technical state machine). The frontend ATS calls
// computeEffectiveStage(pipeline_stage, status) to combine both — see
// useATSData.ts:96. Updating pipeline_stage is the right "user-facing"
// mutation : moves the card across the kanban board.
//
// MVP refuse to UPSERT — it requires the row to already exist. This avoids
// Claude hallucinating candidate_ids and creating orphan rows. The candidate
// must have been "discovered" first (via LinkedIn search) before we can move
// it on the pipeline.

// Business pipeline stages (matches STAGE_ORDER in useATSData.ts).
// Final states: Gagné = won, Perdu = lost.
const ALLOWED_STAGES = [
  'Nouveau',
  'Contacté',
  'Répondu',
  'Pressenti',
  'Pré-qualif',
  'CV envoyé',
  'ITW en cours',
  'Offre',
  'Gagné',
  'Perdu',
] as const;
type PipelineStage = (typeof ALLOWED_STAGES)[number];

const updateCandidateStage: AgentTool = {
  name: 'update_candidate_stage',
  description:
    "Move a candidate forward or backward in the recruitment pipeline (kanban) for a specific job. " +
    "Use this when the user explicitly says things like 'passe Marie en pré-qualif', 'archive John', 'CV de Paul est parti', 'on a perdu ce candidat'. " +
    "The candidate MUST have been discovered first (via LinkedIn search) — this tool refuses unknown candidate IDs to avoid orphan rows. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: {
        type: 'string',
        description:
          "The candidate's stable identifier (Unipile LinkedIn provider_id like 'ACoAA...', or notion_candidate_id, or whichever ID was stored when the candidate was first discovered on this job). MUST already exist in job_candidate_status for this job.",
      },
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID this stage change applies to.',
      },
      new_stage: {
        type: 'string',
        enum: ALLOWED_STAGES as unknown as string[],
        description:
          "Business pipeline stage. One of: Nouveau, Contacté, Répondu, Pressenti, Pré-qualif, CV envoyé, ITW en cours, Offre, Gagné, Perdu.",
      },
      reason: {
        type: 'string',
        description: "Optional short note explaining the change (stored as skip_reason if stage = 'Perdu').",
      },
    },
    required: ['candidate_id', 'job_id', 'new_stage'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    const candidateId = String(params.candidate_id || '');
    if (!jobId || !candidateId) return { allowed: false, reason: 'job_id and candidate_id are required' };

    // 1. Job must belong to the user's org
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();

    if (!project) return { allowed: false, reason: `Mission ${jobId} introuvable` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }

    // 2. Row must already exist (we don't create candidates from chat)
    const { data: row } = await ctx.adminClient
      .from('job_candidate_status')
      .select('id')
      .eq('job_id', jobId)
      .eq('candidate_id', candidateId)
      .eq('created_by', ctx.userId)
      .maybeSingle();

    if (!row) {
      return {
        allowed: false,
        reason: `Le candidat ${candidateId} n'est pas encore associé à cette mission. Lance d'abord une recherche LinkedIn ou ajoute-le manuellement avant de modifier son stade.`,
      };
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const newStage = String(params.new_stage) as PipelineStage;
    const reason = params.reason ? String(params.reason) : null;

    // Fetch current row + project metadata in parallel
    const [{ data: current }, { data: project }] = await Promise.all([
      ctx.adminClient
        .from('job_candidate_status')
        .select('pipeline_stage, status, candidate_name, candidate_headline, updated_at')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .eq('created_by', ctx.userId)
        .maybeSingle(),
      ctx.adminClient
        .from('sourcing_projects')
        .select('name, job_title, client_name')
        .eq('id', jobId)
        .maybeSingle(),
    ]);

    const jobLabel = project?.job_title || project?.name || jobId;
    const clientLabel = project?.client_name ? ` (${project.client_name})` : '';
    const candidateLabel = current?.candidate_name || candidateId;
    const fromStage = current?.pipeline_stage || '(non défini)';
    const isNoOp = current?.pipeline_stage === newStage;

    return {
      summary: isNoOp
        ? `${candidateLabel} est déjà au stade « ${newStage} » sur "${jobLabel}${clientLabel}"`
        : `Déplacer ${candidateLabel} : « ${fromStage} » → « ${newStage} » sur "${jobLabel}${clientLabel}"`,
      details: {
        candidate_id: candidateId,
        candidate_name: current?.candidate_name ?? null,
        candidate_headline: current?.candidate_headline ?? null,
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        from_stage: fromStage,
        to_stage: newStage,
        underlying_status: current?.status ?? null,
        reason,
        is_no_op: isNoOp,
      },
      warning: isNoOp
        ? 'Aucun changement — le candidat est déjà à ce stade.'
        : newStage === 'Perdu'
        ? 'Stade terminal : ce candidat sera marqué comme perdu pour cette mission.'
        : undefined,
    };
  },

  async execute(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const newStage = String(params.new_stage) as PipelineStage;
    const reason = params.reason ? String(params.reason) : null;

    // UPDATE only — row existence already verified in verifyAccess
    const updatePayload: Record<string, unknown> = { pipeline_stage: newStage };
    if (newStage === 'Perdu' && reason) {
      updatePayload.skip_reason = reason;
    }

    const { data, error } = await ctx.adminClient
      .from('job_candidate_status')
      .update(updatePayload)
      .eq('job_id', jobId)
      .eq('candidate_id', candidateId)
      .eq('created_by', ctx.userId)
      .select('id, pipeline_stage, status, updated_at')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        row_id: data.id,
        new_pipeline_stage: data.pipeline_stage,
        underlying_status: data.status,
        updated_at: data.updated_at,
      },
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

let registered = false;

export function registerMutatingTools(): void {
  if (registered) return;
  registerTool(updateCandidateStage);
  // TODO Sprint 1 v2 :
  //   - add_to_shortlist
  //   - send_outreach_message (avec mode draft)
  //   - create_mission (avec mode draft)
  //   - enroll_in_sequence
  //   - schedule_interview (quand calendar branché)
  registered = true;
}
