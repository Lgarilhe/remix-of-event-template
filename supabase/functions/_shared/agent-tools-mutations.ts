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
// Met à jour le statut d'un candidat dans job_candidate_status (table locale).
// Sync Notion optionnel (edge function update-candidate-stage existante) — non
// inclus pour le MVP, on l'ajoutera dans v2.

const ALLOWED_STAGES = ['new', 'contacted', 'replied', 'pre_qualified', 'cv_sent', 'interview_in_progress', 'offer', 'won', 'rejected', 'dismissed'] as const;
type CandidateStage = (typeof ALLOWED_STAGES)[number];

const updateCandidateStage: AgentTool = {
  name: 'update_candidate_stage',
  description:
    'Update the recruitment pipeline stage for a candidate on a specific job/mission. ' +
    'Use this when the user explicitly asks to move a candidate forward or backward in the funnel ' +
    '(e.g. "passe Marie en pré-qualifiée", "rejette John pour ce poste"). ' +
    'Always proposes the change for user approval — never executes silently.',
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: {
        type: 'string',
        description: 'The unique candidate identifier (UUID or LinkedIn provider ID).',
      },
      job_id: {
        type: 'string',
        description: 'The job/mission UUID this stage change applies to.',
      },
      new_stage: {
        type: 'string',
        enum: ALLOWED_STAGES as unknown as string[],
        description: 'The new pipeline stage. Must be one of the allowed values.',
      },
      reason: {
        type: 'string',
        description: 'Optional short reason explaining why the stage is changed (visible in audit log).',
      },
    },
    required: ['candidate_id', 'job_id', 'new_stage'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    if (!jobId) return { allowed: false, reason: 'job_id is required' };

    // Verify the job belongs to the user's org
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();

    if (!project) return { allowed: false, reason: `Job ${jobId} not found` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Job belongs to another organization' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const newStage = String(params.new_stage) as CandidateStage;
    const reason = params.reason ? String(params.reason) : null;

    // Fetch current status (for the diff in preview)
    const { data: current } = await ctx.adminClient
      .from('job_candidate_status')
      .select('status, updated_at')
      .eq('candidate_id', candidateId)
      .eq('job_id', jobId)
      .eq('created_by', ctx.userId)
      .maybeSingle();

    // Fetch job + candidate names for human-readable preview
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name, job_title, client_name')
      .eq('id', jobId)
      .maybeSingle();

    const jobLabel = project?.job_title || project?.name || jobId;
    const clientLabel = project?.client_name ? ` (${project.client_name})` : '';
    const fromStage = current?.status || '(aucun)';
    const isNoOp = current?.status === newStage;

    return {
      summary: isNoOp
        ? `Le candidat est déjà au stade « ${newStage} » sur "${jobLabel}${clientLabel}"`
        : `Passe le candidat du stade « ${fromStage} » à « ${newStage} » sur "${jobLabel}${clientLabel}"`,
      details: {
        candidate_id: candidateId,
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        from_stage: fromStage,
        to_stage: newStage,
        reason,
        will_create_row: !current,
        is_no_op: isNoOp,
      },
      warning: isNoOp ? 'Aucun changement à faire — le candidat est déjà à ce stade.' : undefined,
    };
  },

  async execute(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const newStage = String(params.new_stage) as CandidateStage;
    const reason = params.reason ? String(params.reason) : null;

    // Upsert : si la row existe, on update son status. Sinon on la crée.
    // Note : la contrainte UNIQUE est (job_id, candidate_id, created_by) — voir
    // migration 20260421180000_grants_bootstrap_owner_uniques.sql.
    const { data, error } = await ctx.adminClient
      .from('job_candidate_status')
      .upsert(
        {
          job_id: jobId,
          candidate_id: candidateId,
          created_by: ctx.userId,
          status: newStage,
          skip_reason: newStage === 'rejected' || newStage === 'dismissed' ? reason : null,
        },
        { onConflict: 'job_id,candidate_id,created_by' },
      )
      .select('id, status, updated_at')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        row_id: data.id,
        new_status: data.status,
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
