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

// ─── Tool 2 — add_to_shortlist ──────────────────────────────────────────────
// Raccourci sémantique : alias de update_candidate_stage avec stage='Pressenti'
// (= shortlist business). Existe séparément car Claude le comprend mieux quand
// l'user dit "ajoute X à ma shortlist" sans connaître le nom exact du stage.

const addToShortlist: AgentTool = {
  name: 'add_to_shortlist',
  description:
    "Add a candidate to the user's shortlist for a specific mission. Internally moves the candidate to the 'Pressenti' pipeline stage. " +
    "Use this when the user says 'ajoute X à la shortlist', 'shortliste Y', 'mets-le dans mes pressentis'.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: { type: 'string', description: 'Stable candidate ID, must already exist in job_candidate_status for this job.' },
      job_id: { type: 'string', description: 'The mission UUID.' },
      reason: { type: 'string', description: 'Optional note explaining why the candidate is shortlisted.' },
    },
    required: ['candidate_id', 'job_id'],
  },

  verifyAccess: (params, ctx) => updateCandidateStage.verifyAccess(params, ctx),

  async dryRun(params, ctx) {
    return updateCandidateStage.dryRun({ ...params, new_stage: 'Pressenti' }, ctx);
  },

  async execute(params, ctx) {
    return updateCandidateStage.execute({ ...params, new_stage: 'Pressenti' }, ctx);
  },
};

// ─── Tool 3 — create_mission ────────────────────────────────────────────────
// INSERT dans sourcing_projects. Le created_by est l'user, organization_id
// dérivé de l'auth context. Status par défaut 'active'.

const createMission: AgentTool = {
  name: 'create_mission',
  description:
    "Create a new recruitment mission (sourcing project) in the user's workspace. " +
    "Use when the user says 'crée une mission pour X', 'nouveau poste de Y chez Z'. " +
    "Always proposes for approval — the mission won't appear in the kanban until the user approves.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short mission name (≤80 chars), e.g. "DevOps Senior — Acme Series B".' },
      job_title: { type: 'string', description: 'The role being recruited for, e.g. "DevOps Engineer".' },
      client_name: { type: 'string', description: 'Optional client / company name.' },
      description: { type: 'string', description: 'Optional 1-3 sentence brief.' },
    },
    required: ['name', 'job_title'],
  },

  async verifyAccess(_params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    return { allowed: true };
  },

  async dryRun(params, _ctx) {
    return {
      summary: `Créer la mission « ${params.name} » (${params.job_title})${params.client_name ? ` chez ${params.client_name}` : ''}`,
      details: {
        name: params.name,
        job_title: params.job_title,
        client_name: params.client_name ?? null,
        description: params.description ?? null,
        status: 'active',
      },
    };
  },

  async execute(params, ctx) {
    const { data, error } = await ctx.adminClient
      .from('sourcing_projects')
      .insert({
        name: String(params.name).slice(0, 200),
        job_title: String(params.job_title).slice(0, 200),
        client_name: params.client_name ? String(params.client_name).slice(0, 200) : null,
        description: params.description ? String(params.description).slice(0, 2000) : null,
        organization_id: ctx.organizationId,
        created_by: ctx.userId,
        status: 'active',
        filters_snapshot: {},
      })
      .select('id, name, job_title')
      .single();

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: { mission_id: data.id, name: data.name, job_title: data.job_title },
    };
  },
};

// ─── Tool 4 — enroll_in_sequence ────────────────────────────────────────────
// INSERT dans sequence_enrollments. Le candidat doit déjà exister
// (job_candidate_status row), et la séquence doit appartenir à l'org.

const enrollInSequence: AgentTool = {
  name: 'enroll_in_sequence',
  description:
    "Enroll a candidate into an outreach sequence. The sequence steps will start being processed by the cron. " +
    "Use when the user says 'enrôle X dans ma séquence Y', 'lance la séquence sur ce candidat'. " +
    "Requires the candidate to already exist on the mission and the sequence to belong to the user's org.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      sequence_id: { type: 'string', description: 'UUID of the outreach_sequences row.' },
      candidate_id: { type: 'string', description: 'Provider/Unipile ID of the candidate (used as provider_id).' },
      profile_url: { type: 'string', description: 'LinkedIn URL of the candidate.' },
      profile_name: { type: 'string', description: 'Display name (e.g. "Marie Martin").' },
      account_id: { type: 'string', description: 'Unipile LinkedIn account_id of the recruiter who will send.' },
      job_id: { type: 'string', description: 'Mission UUID this enrollment is tied to.' },
    },
    required: ['sequence_id', 'candidate_id', 'account_id', 'job_id'],
  },

  async verifyAccess(params, ctx) {
    const sequenceId = String(params.sequence_id || '');
    const jobId = String(params.job_id || '');
    if (!sequenceId || !jobId) return { allowed: false, reason: 'sequence_id and job_id required' };

    // Sequence must belong to the user's org
    const { data: seq } = await ctx.adminClient
      .from('outreach_sequences')
      .select('id, organization_id, name, is_active')
      .eq('id', sequenceId)
      .maybeSingle();
    if (!seq) return { allowed: false, reason: `Séquence ${sequenceId} introuvable` };
    if (seq.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette séquence appartient à une autre organisation' };
    }
    if (!seq.is_active) return { allowed: false, reason: `La séquence "${seq.name}" est désactivée` };

    // Job must also belong to org
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();
    if (!project || project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Mission inaccessible' };
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const [{ data: seq }, { data: project }] = await Promise.all([
      ctx.adminClient
        .from('outreach_sequences')
        .select('name')
        .eq('id', String(params.sequence_id))
        .maybeSingle(),
      ctx.adminClient
        .from('sourcing_projects')
        .select('name, job_title')
        .eq('id', String(params.job_id))
        .maybeSingle(),
    ]);

    // Check if already enrolled
    const { data: existing } = await ctx.adminClient
      .from('sequence_enrollments')
      .select('id, current_step_order')
      .eq('sequence_id', String(params.sequence_id))
      .eq('provider_id', String(params.candidate_id))
      .maybeSingle();

    return {
      summary: existing
        ? `${params.profile_name ?? params.candidate_id} est déjà enrôlé dans « ${seq?.name ?? 'cette séquence'} »`
        : `Enrôler ${params.profile_name ?? params.candidate_id} dans « ${seq?.name ?? 'cette séquence'} » pour la mission ${project?.job_title ?? project?.name ?? params.job_id}`,
      details: {
        sequence_name: seq?.name ?? null,
        candidate: params.profile_name ?? params.candidate_id,
        job: project?.job_title ?? project?.name ?? null,
        already_enrolled: !!existing,
      },
      warning: existing ? 'Ce candidat est déjà dans cette séquence — pas de double enrôlement.' : undefined,
    };
  },

  async execute(params, ctx) {
    const { data, error } = await ctx.adminClient
      .from('sequence_enrollments')
      .insert({
        sequence_id: String(params.sequence_id),
        provider_id: String(params.candidate_id),
        profile_url: params.profile_url ? String(params.profile_url) : null,
        profile_name: params.profile_name ? String(params.profile_name) : null,
        account_id: String(params.account_id),
        job_id: String(params.job_id),
        organization_id: ctx.organizationId,
        created_by: ctx.userId,
        current_step_order: 0,
      })
      .select('id, current_step_order')
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, data: { enrollment_id: data.id } };
  },
};

// ─── Tool 5 — draft_outreach_message ────────────────────────────────────────
// Génère un draft de message LinkedIn/email pour un candidat (via Claude).
// Le message est sauvegardé dans dry_run_result.draft. À l'approbation,
// l'execute() le copie dans le clipboard de l'user (pas d'envoi auto pour
// l'instant — l'envoi via Unipile/Resend nécessite une UX dédiée et un canal
// résolu, on l'ajoute en v3).

const draftOutreachMessage: AgentTool = {
  name: 'draft_outreach_message',
  description:
    "Draft a personalized outreach message for a candidate (LinkedIn DM or email). " +
    "Returns a polished draft that the user can review, edit, and copy/send manually. Does NOT send automatically — sending via integrated channels comes in v3. " +
    "Use when the user says 'écris un message pour X', 'rédige une approche pour Y', 'prépare un DM personnalisé'.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: { type: 'string', description: 'Stable candidate ID (already on the mission).' },
      job_id: { type: 'string', description: 'Mission UUID.' },
      tone: {
        type: 'string',
        enum: ['casual', 'professional', 'enthusiastic', 'concise'],
        description: 'Tone of the message (default: casual).',
      },
      channel: {
        type: 'string',
        enum: ['linkedin_dm', 'linkedin_inmail', 'email'],
        description: 'Channel — affects length and format (default: linkedin_dm).',
      },
      angle: {
        type: 'string',
        description: 'Optional specific angle (e.g. "mention his recent open-source contribution").',
      },
    },
    required: ['candidate_id', 'job_id'],
  },

  async verifyAccess(params, ctx) {
    return updateCandidateStage.verifyAccess(params, ctx);
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);

    const [{ data: row }, { data: project }] = await Promise.all([
      ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_name, candidate_headline, linkedin_profile_data')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .eq('created_by', ctx.userId)
        .maybeSingle(),
      ctx.adminClient
        .from('sourcing_projects')
        .select('name, job_title, client_name, description, job_details')
        .eq('id', jobId)
        .maybeSingle(),
    ]);

    const tone = String(params.tone ?? 'casual');
    const channel = String(params.channel ?? 'linkedin_dm');
    const candidateName = row?.candidate_name ?? candidateId;

    return {
      summary: `Rédiger un ${channel === 'email' ? 'email' : channel === 'linkedin_inmail' ? 'InMail LinkedIn' : 'DM LinkedIn'} en ton « ${tone} » à ${candidateName} pour ${project?.job_title ?? 'cette mission'}`,
      details: {
        candidate: candidateName,
        candidate_headline: row?.candidate_headline ?? null,
        job_title: project?.job_title ?? null,
        client_name: project?.client_name ?? null,
        tone,
        channel,
        angle: params.angle ?? null,
        // Note : la génération du message n'a pas lieu en dry-run. Elle se fait
        // dans execute() pour économiser les tokens si l'user reject.
      },
    };
  },

  async execute(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const tone = String(params.tone ?? 'casual');
    const channel = String(params.channel ?? 'linkedin_dm');
    const angle = params.angle ? String(params.angle) : null;

    // Fetch context
    const [{ data: row }, { data: project }] = await Promise.all([
      ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_name, candidate_headline, linkedin_profile_data')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .eq('created_by', ctx.userId)
        .maybeSingle(),
      ctx.adminClient
        .from('sourcing_projects')
        .select('name, job_title, client_name, description, job_details')
        .eq('id', jobId)
        .maybeSingle(),
    ]);

    if (!row || !project) {
      return { success: false, error: 'Candidat ou mission introuvable' };
    }

    // Use the existing _shared/call-claude helper to draft the message
    const { callClaudeCompat } = await import('./call-claude.ts');
    const profile = (row.linkedin_profile_data as Record<string, unknown>) ?? {};
    const jd = (project.job_details as Record<string, unknown>) ?? {};

    const lengthHint =
      channel === 'linkedin_dm'
        ? '300 caractères max (LinkedIn DM = ultra court)'
        : channel === 'linkedin_inmail'
        ? '600 caractères max avec sujet (InMail)'
        : '120-150 mots avec sujet (email)';

    const systemPrompt = `Tu es un recruteur expert qui rédige des messages d'approche très personnalisés. Ton: ${tone}. Tu réponds UNIQUEMENT en JSON valide: {"subject": "...", "body": "..."}. Pour LinkedIn DM, "subject" peut être null.`;
    const userPrompt = `Rédige un message ${channel} en ${tone} pour:

CANDIDAT: ${row.candidate_name}
HEADLINE: ${row.candidate_headline ?? 'non spécifiée'}
PROFIL: ${JSON.stringify(profile).slice(0, 1500)}

POSTE: ${project.job_title} ${project.client_name ? `chez ${project.client_name}` : ''}
DESCRIPTION: ${project.description ?? jd.description ?? 'voir brief'}

${angle ? `ANGLE D'ATTAQUE: ${angle}` : ''}

CONTRAINTES:
- ${lengthHint}
- Personnaliser via 1 élément précis du profil (pas du blabla générique)
- Pas de "j'espère que vous allez bien", pas de copywriting cringe
- Tutoiement
- CTA clair en fin de message`;

    try {
      const result = await callClaudeCompat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 600,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        timeoutMs: 25000,
      });
      const parsed = JSON.parse(result.content.replace(/```json\n?|```/g, '').trim());
      return {
        success: true,
        data: {
          channel,
          tone,
          subject: parsed.subject ?? null,
          body: parsed.body ?? '',
          candidate_name: row.candidate_name,
          // Note pour l'UI : ce draft est à copier-coller manuellement.
          // L'envoi automatisé via Unipile/Resend viendra en v3.
          action_required: 'copy_to_clipboard',
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Draft generation failed' };
    }
  },
};

// ─── Tool : enrich_candidate_contact ───────────────────────────────────────
// Permet à l'agent IA de récupérer email + téléphone d'un candidat via
// la cascade waterfall (sources gratuites Unipile/cache/ATS d'abord, puis
// Better Contact payant en dernier recours).
//
// Usage typique côté chat :
//   - User : "Trouve l'email de Marie Dupont chez Stripe"
//   - Agent appelle enrich_candidate_contact(linkedin_url, with_email=true)
//   - User valide → enrichment lancé, retour async avec request_id
//
// requiresApproval=true car coûte des crédits Konekt (1 cr email, 10 cr phone).

const enrichCandidateContact: AgentTool = {
  name: 'enrich_candidate_contact',
  description:
    "Retrieve a candidate's professional email and/or mobile phone via a waterfall cascade " +
    "(free sources first: Unipile contact_info, org cache 30j, ATS sync ; then paid Better Contact " +
    "in last resort). Use this when the user explicitly says things like 'trouve l'email de X', " +
    "'récupère le téléphone de Y', 'enrichis ce candidat'. " +
    "Cost : 1 Konekt credit per email found, 10 credits per mobile found. ZERO credit if not found " +
    "or if already in cache. Always proposes for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      linkedin_url: {
        type: 'string',
        description:
          "The candidate's full LinkedIn profile URL (e.g. 'https://linkedin.com/in/marie-dupont'). REQUIRED.",
      },
      first_name: { type: 'string', description: "Candidate's first name (helps the cascade resolve)." },
      last_name: { type: 'string', description: "Candidate's last name (helps the cascade resolve)." },
      company: { type: 'string', description: "Current company name (helps domain inference for email lookup)." },
      with_email: {
        type: 'boolean',
        description: "Whether to search for the professional email. Default true. 1 credit if found.",
      },
      with_phone: {
        type: 'boolean',
        description: "Whether to search for the mobile phone. Default false (10× more expensive than email). 10 credits if found.",
      },
    },
    required: ['linkedin_url'],
  },

  async verifyAccess(params, _ctx) {
    const linkedinUrl = String(params.linkedin_url || '').trim();
    if (!linkedinUrl) return { allowed: false, reason: 'linkedin_url is required' };
    if (!/linkedin\.com\/in\//i.test(linkedinUrl)) {
      return { allowed: false, reason: 'linkedin_url must point to a /in/ profile URL' };
    }
    return { allowed: true };
  },

  async execute(params, ctx) {
    const linkedinUrl = String(params.linkedin_url);
    const withEmail = params.with_email !== false; // default true
    const withPhone = params.with_phone === true;  // default false

    if (!withEmail && !withPhone) {
      return { success: false, error: 'with_email ou with_phone doit être true' };
    }

    // Appel interne à l'edge function enrich-candidate-contact
    // (réutilise le cascade lookup + cache + pre-auth crédits + BC trigger)
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!supabaseUrl) return { success: false, error: 'SUPABASE_URL not configured' };

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/enrich-candidate-contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Service role pour bypass auth, on a déjà vérifié l'org de l'user via ctx
          'Authorization': `Bearer ${Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          linkedin_url: linkedinUrl,
          first_name: params.first_name || null,
          last_name: params.last_name || null,
          company: params.company || null,
          with_email: withEmail,
          with_phone: withPhone,
          organization_id: ctx.organizationId, // explicite (auth bypass)
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        return {
          success: false,
          error: data.error || `Enrichment failed: HTTP ${response.status}`,
          data: { error_code: data.error_code },
        };
      }

      // Si cached/source gratuite → retour direct
      if (data.cached && data.contact) {
        return {
          success: true,
          data: {
            status: 'terminated',
            source: data.source,
            email: data.contact.email,
            phone: data.contact.phone,
            email_provider: data.contact.email_provider_source,
            phone_provider: data.contact.phone_provider_source,
            credits_used: 0,
            note: data.source === 'cache'
              ? 'Profil déjà enrichi (cache 30j) — gratuit'
              : `Trouvé dans ${data.source} — gratuit`,
          },
        };
      }

      // Sinon : enrichment async démarré
      return {
        success: true,
        data: {
          status: 'pending',
          request_id: data.request_id,
          note: `Enrichment lancé via cascade (Unipile → cache → ATS → fournisseurs payants). ` +
                `Résultat dans 30s à 3min — l'utilisateur peut continuer son sourcing en attendant. ` +
                `Le contact apparaîtra automatiquement sur la card du candidat dans la liste sourcing.`,
          estimated_max_credits: (withEmail ? 1 : 0) + (withPhone ? 10 : 0),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error during enrichment',
      };
    }
  },
};

// ─── Tool 7 — add_candidate_note ────────────────────────────────────────────
// Ajoute une note libre attachée à un candidat (table candidate_notes, niveau
// org, cross-mission). Le candidat doit avoir été "découvert" au moins une
// fois (présent dans job_candidate_status pour l'org de l'user).

const addCandidateNote: AgentTool = {
  name: 'add_candidate_note',
  description:
    "Add a free-text note attached to a candidate (org-wide, cross-mission). " +
    "Use this when the user says things like 'ajoute une note à X', 'note pour Marie : appelé ce matin, à recontacter mardi', " +
    "'mémo : Théo est en vacances jusqu'au 15'. The note becomes visible on the candidate's pipeline card. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: {
        type: 'string',
        description:
          "The candidate's stable identifier (Unipile LinkedIn provider_id like 'ACoAA...', or notion_candidate_id, or whichever ID was stored when the candidate was first discovered). MUST already exist in job_candidate_status for the user's org.",
      },
      content: {
        type: 'string',
        description: "The note content in French (free text, plain or markdown). Max 4000 chars.",
      },
    },
    required: ['candidate_id', 'content'],
  },

  async verifyAccess(params, ctx) {
    const candidateId = String(params.candidate_id || '');
    const content = String(params.content || '').trim();
    if (!candidateId) return { allowed: false, reason: 'candidate_id is required' };
    if (!content) return { allowed: false, reason: 'content is required and cannot be empty' };
    if (content.length > 4000) return { allowed: false, reason: 'content too long (max 4000 chars)' };

    // Candidate must exist at least once in this org's pipeline
    const { data: row } = await ctx.adminClient
      .from('job_candidate_status')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('organization_id', ctx.organizationId)
      .limit(1)
      .maybeSingle();

    if (!row) {
      return {
        allowed: false,
        reason: `Le candidat ${candidateId} n'est encore associé à aucune mission de votre organisation. Découvrez-le d'abord via une recherche LinkedIn.`,
      };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id);
    const content = String(params.content);

    const { data: candidate } = await ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_name, candidate_headline')
      .eq('candidate_id', candidateId)
      .eq('organization_id', ctx.organizationId)
      .limit(1)
      .maybeSingle();

    const candidateLabel = candidate?.candidate_name || candidateId;
    const preview = content.length > 80 ? content.slice(0, 77) + '…' : content;

    return {
      summary: `Ajouter une note sur ${candidateLabel} : « ${preview} »`,
      details: {
        candidate_id: candidateId,
        candidate_name: candidate?.candidate_name ?? null,
        candidate_headline: candidate?.candidate_headline ?? null,
        content_preview: preview,
        content_full: content,
        content_length: content.length,
      },
    };
  },

  async execute(params, ctx) {
    const candidateId = String(params.candidate_id);
    const content = String(params.content);

    const { data, error } = await ctx.adminClient
      .from('candidate_notes')
      .insert({
        candidate_id: candidateId,
        content,
        organization_id: ctx.organizationId,
        created_by: ctx.userId,
      })
      .select('id, created_at')
      .single();

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        note_id: data.id,
        created_at: data.created_at,
        message: 'Note ajoutée. Visible sur la card pipeline du candidat.',
      },
    };
  },
};

// ─── Tool 8 — dismiss_candidate ─────────────────────────────────────────────
// Marque un candidat comme "écarté" pour une mission spécifique (status=
// 'dismissed' dans job_candidate_status). N'utilise PAS pipeline_stage='Perdu'
// car ce stade signifie "process abouti puis perdu en fin de tunnel", alors
// que dismissed = "pas pertinent dès le départ pour cette mission".

const dismissCandidate: AgentTool = {
  name: 'dismiss_candidate',
  description:
    "Mark a candidate as dismissed (not relevant) for a specific mission. " +
    "Use this when the user says 'écarte X de cette mission', 'pas intéressant pour cette mission', 'retire Y du sourcing'. " +
    "Different from 'Perdu' (which means the candidate went through the funnel and was lost at the end) — dismissed means filtered out upfront. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: {
        type: 'string',
        description: "The candidate's stable identifier. MUST already exist in job_candidate_status for the given mission.",
      },
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID this dismissal applies to.',
      },
      reason: {
        type: 'string',
        description: "Optional short note explaining why (stored in skip_reason).",
      },
    },
    required: ['candidate_id', 'job_id'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    const candidateId = String(params.candidate_id || '');
    if (!jobId || !candidateId) return { allowed: false, reason: 'job_id and candidate_id are required' };

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();

    if (!project) return { allowed: false, reason: `Mission ${jobId} introuvable` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }

    const { data: row } = await ctx.adminClient
      .from('job_candidate_status')
      .select('id, status')
      .eq('job_id', jobId)
      .eq('candidate_id', candidateId)
      .maybeSingle();

    if (!row) {
      return {
        allowed: false,
        reason: `Le candidat ${candidateId} n'est pas associé à cette mission.`,
      };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const reason = params.reason ? String(params.reason) : null;

    const [{ data: current }, { data: project }] = await Promise.all([
      ctx.adminClient
        .from('job_candidate_status')
        .select('status, candidate_name, candidate_headline')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .maybeSingle(),
      ctx.adminClient
        .from('sourcing_projects')
        .select('name, job_title, client_name')
        .eq('id', jobId)
        .maybeSingle(),
    ]);

    const jobLabel = project?.job_title || project?.name || jobId;
    const candidateLabel = current?.candidate_name || candidateId;
    const isNoOp = current?.status === 'dismissed';

    return {
      summary: isNoOp
        ? `${candidateLabel} est déjà écarté de "${jobLabel}"`
        : `Écarter ${candidateLabel} de la mission "${jobLabel}"`,
      details: {
        candidate_id: candidateId,
        candidate_name: current?.candidate_name ?? null,
        candidate_headline: current?.candidate_headline ?? null,
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        from_status: current?.status ?? null,
        to_status: 'dismissed',
        reason,
        is_no_op: isNoOp,
      },
      warning: isNoOp ? 'Aucun changement — déjà écarté.' : undefined,
    };
  },

  async execute(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const reason = params.reason ? String(params.reason) : null;

    const updatePayload: Record<string, unknown> = { status: 'dismissed' };
    if (reason) updatePayload.skip_reason = reason;

    const { data, error } = await ctx.adminClient
      .from('job_candidate_status')
      .update(updatePayload)
      .eq('job_id', jobId)
      .eq('candidate_id', candidateId)
      .select('id, status, skip_reason, updated_at')
      .single();

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        row_id: data.id,
        new_status: data.status,
        skip_reason: data.skip_reason,
        updated_at: data.updated_at,
      },
    };
  },
};

// ─── Tool 9 — assign_candidate_to_member ────────────────────────────────────
// Assigne un candidat à un membre de l'équipe pour une mission donnée.
// Idempotent : UPSERT sur (candidate_id, job_id, organization_id) → si déjà
// assigné, update l'assigned_to. Le membre cible doit appartenir à l'org.

const assignCandidateToMember: AgentTool = {
  name: 'assign_candidate_to_member',
  description:
    "Assign a candidate to a specific team member for a given mission. " +
    "Use this when the user says 'assigne X à Marie', 'donne ce candidat à Théo', 'mets Sophie sur Y'. " +
    "The target member must be in the user's organization. " +
    "If the candidate is already assigned to someone else, this reassigns. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: {
        type: 'string',
        description: "The candidate's stable identifier. MUST already exist in job_candidate_status for the given mission.",
      },
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID this assignment applies to.',
      },
      assigned_to_user_id: {
        type: 'string',
        description:
          "UUID of the team member who will own this candidate. Use `get_team_overview` first to fetch valid member IDs. MUST be a member of the user's organization.",
      },
    },
    required: ['candidate_id', 'job_id', 'assigned_to_user_id'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    const candidateId = String(params.candidate_id || '');
    const assigneeId = String(params.assigned_to_user_id || '');
    if (!jobId || !candidateId || !assigneeId) {
      return { allowed: false, reason: 'job_id, candidate_id and assigned_to_user_id are required' };
    }

    // 1. Mission in user's org
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();
    if (!project) return { allowed: false, reason: `Mission ${jobId} introuvable` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }

    // 2. Candidate exists in this mission
    const { data: row } = await ctx.adminClient
      .from('job_candidate_status')
      .select('id')
      .eq('job_id', jobId)
      .eq('candidate_id', candidateId)
      .maybeSingle();
    if (!row) {
      return {
        allowed: false,
        reason: `Le candidat ${candidateId} n'est pas associé à cette mission.`,
      };
    }

    // 3. Assignee is a member of the org
    const { data: member } = await ctx.adminClient
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', ctx.organizationId)
      .eq('user_id', assigneeId)
      .maybeSingle();
    if (!member) {
      return {
        allowed: false,
        reason: `L'utilisateur ${assigneeId} n'est pas membre de votre organisation.`,
      };
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const assigneeId = String(params.assigned_to_user_id);

    const [{ data: current }, { data: project }, { data: assignee }, { data: existing }] = await Promise.all([
      ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_name, candidate_headline')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .maybeSingle(),
      ctx.adminClient
        .from('sourcing_projects')
        .select('name, job_title, client_name')
        .eq('id', jobId)
        .maybeSingle(),
      ctx.adminClient
        .from('profiles')
        .select('full_name, email')
        .eq('id', assigneeId)
        .maybeSingle(),
      ctx.adminClient
        .from('candidate_assignments')
        .select('assigned_to, status')
        .eq('candidate_id', candidateId)
        .eq('job_id', jobId)
        .eq('organization_id', ctx.organizationId)
        .maybeSingle(),
    ]);

    const jobLabel = project?.job_title || project?.name || jobId;
    const candidateLabel = current?.candidate_name || candidateId;
    const assigneeLabel = assignee?.full_name || assignee?.email || assigneeId;
    const isReassignment = existing && existing.assigned_to !== assigneeId;
    const isNoOp = existing?.assigned_to === assigneeId && existing?.status === 'active';

    let summary: string;
    if (isNoOp) {
      summary = `${candidateLabel} est déjà assigné à ${assigneeLabel} sur "${jobLabel}"`;
    } else if (isReassignment) {
      summary = `Réassigner ${candidateLabel} à ${assigneeLabel} sur "${jobLabel}" (était assigné à quelqu'un d'autre)`;
    } else {
      summary = `Assigner ${candidateLabel} à ${assigneeLabel} sur "${jobLabel}"`;
    }

    return {
      summary,
      details: {
        candidate_id: candidateId,
        candidate_name: current?.candidate_name ?? null,
        candidate_headline: current?.candidate_headline ?? null,
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        assigned_to_user_id: assigneeId,
        assigned_to_name: assignee?.full_name ?? null,
        assigned_to_email: assignee?.email ?? null,
        previously_assigned_to: existing?.assigned_to ?? null,
        is_reassignment: !!isReassignment,
        is_no_op: !!isNoOp,
      },
      warning: isNoOp ? 'Aucun changement — déjà assigné à cette personne.' : undefined,
    };
  },

  async execute(params, ctx) {
    const candidateId = String(params.candidate_id);
    const jobId = String(params.job_id);
    const assigneeId = String(params.assigned_to_user_id);

    // Fetch candidate_name for the assignment row (denormalized for UI lookups)
    const { data: current } = await ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_name')
      .eq('candidate_id', candidateId)
      .eq('job_id', jobId)
      .maybeSingle();

    // Check if assignment already exists
    const { data: existing } = await ctx.adminClient
      .from('candidate_assignments')
      .select('id')
      .eq('candidate_id', candidateId)
      .eq('job_id', jobId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();

    const payload = {
      candidate_id: candidateId,
      candidate_name: current?.candidate_name ?? null,
      job_id: jobId,
      organization_id: ctx.organizationId,
      assigned_to: assigneeId,
      assigned_by: ctx.userId,
      assignment_method: 'ai_copilot',
      status: 'active',
    };

    if (existing) {
      const { data, error } = await ctx.adminClient
        .from('candidate_assignments')
        .update(payload)
        .eq('id', existing.id)
        .select('id, assigned_to, status, updated_at')
        .single();
      if (error) return { success: false, error: error.message };
      return { success: true, data: { assignment_id: data.id, action: 'reassigned', assigned_to: data.assigned_to, status: data.status, updated_at: data.updated_at } };
    }

    const { data, error } = await ctx.adminClient
      .from('candidate_assignments')
      .insert(payload)
      .select('id, assigned_to, status, created_at')
      .single();
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        assignment_id: data.id,
        action: 'assigned',
        assigned_to: data.assigned_to,
        status: data.status,
        created_at: data.created_at,
      },
    };
  },
};

// ─── Tool 10 — update_mission_status ────────────────────────────────────────
// Bascule le statut d'une mission entre active/paused/archived/completed.

const MISSION_STATUSES = ['active', 'paused', 'archived', 'completed'] as const;
type MissionStatus = (typeof MISSION_STATUSES)[number];

const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  active: 'Active',
  paused: 'En pause',
  archived: 'Archivée',
  completed: 'Clôturée (pourvue)',
};

const updateMissionStatus: AgentTool = {
  name: 'update_mission_status',
  description:
    "Change the status of a mission (active/paused/archived/completed). " +
    "Use this when the user says 'mets cette mission en pause', 'archive cette mission', 'cette mission est pourvue', 'réactive la mission X'. " +
    "'paused' = temporary stop (resumable). 'archived' = no longer needed (kept for history). 'completed' = position filled. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID.',
      },
      new_status: {
        type: 'string',
        enum: MISSION_STATUSES as unknown as string[],
        description: "New status. One of: active, paused, archived, completed.",
      },
    },
    required: ['job_id', 'new_status'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    const newStatus = String(params.new_status || '');
    if (!jobId || !newStatus) return { allowed: false, reason: 'job_id and new_status are required' };
    if (!(MISSION_STATUSES as readonly string[]).includes(newStatus)) {
      return { allowed: false, reason: `new_status must be one of: ${MISSION_STATUSES.join(', ')}` };
    }

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();
    if (!project) return { allowed: false, reason: `Mission ${jobId} introuvable` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const jobId = String(params.job_id);
    const newStatus = String(params.new_status) as MissionStatus;

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name, job_title, client_name, status')
      .eq('id', jobId)
      .maybeSingle();

    const jobLabel = project?.job_title || project?.name || jobId;
    const fromStatus = project?.status as MissionStatus | undefined;
    const isNoOp = fromStatus === newStatus;

    return {
      summary: isNoOp
        ? `La mission "${jobLabel}" est déjà au statut "${MISSION_STATUS_LABELS[newStatus]}"`
        : `Passer la mission "${jobLabel}" : "${fromStatus ? MISSION_STATUS_LABELS[fromStatus] ?? fromStatus : '(non défini)'}" → "${MISSION_STATUS_LABELS[newStatus]}"`,
      details: {
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        from_status: fromStatus ?? null,
        to_status: newStatus,
        is_no_op: isNoOp,
      },
      warning: isNoOp
        ? 'Aucun changement.'
        : newStatus === 'archived'
        ? "Mission archivée : elle sera masquée des vues actives mais conservée pour l'historique."
        : newStatus === 'completed'
        ? "Mission clôturée : marquée comme pourvue."
        : undefined,
    };
  },

  async execute(params, ctx) {
    const jobId = String(params.job_id);
    const newStatus = String(params.new_status) as MissionStatus;

    const { data, error } = await ctx.adminClient
      .from('sourcing_projects')
      .update({ status: newStatus })
      .eq('id', jobId)
      .eq('organization_id', ctx.organizationId)
      .select('id, status, updated_at')
      .single();

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: {
        mission_id: data.id,
        new_status: data.status,
        updated_at: data.updated_at,
      },
    };
  },
};

// ─── Tool 11 — update_mission_brief ─────────────────────────────────────────
// Patch partiel sur sourcing_projects.job_details (JSONB). Whitelist stricte
// des champs : on ne laisse pas l'IA toucher pedigree/calibration/evaluation_*
// (changements lourds qui impactent le scoring). Pour ces champs, redirection
// vers l'UI brief wizard.

const BRIEF_UPDATABLE_FIELDS = [
  'title',
  'reference',
  'contract_type',
  'urgency',
  'location',
  'remote_policy',
  'remote_days',
  'team_size',
  'context',
  'mission_description',
  'seniority',
  'experience_min',
  'experience_max',
  'salary_min',
  'salary_max',
  'salary_currency',
  'salary_type',
  'skills_must_have',
  'skills_should_have',
  'skills_nice_to_have',
  'skills_to_avoid',
] as const;
type BriefField = (typeof BRIEF_UPDATABLE_FIELDS)[number];

const updateMissionBrief: AgentTool = {
  name: 'update_mission_brief',
  description:
    "Patch specific fields of a mission's brief (job_details JSONB). " +
    "Use this when the user says 'mets le salaire de cette mission à 70-90k', 'change la localisation pour Lyon', 'ajoute Kubernetes aux skills must-have'. " +
    "Updatable fields: title, contract_type, urgency, location, remote_policy, remote_days, salary_min/max/currency, seniority, experience_min/max, skills_must_have, skills_should_have, skills_nice_to_have, skills_to_avoid, mission_description, context. " +
    "Other fields (pedigree, calibration profiles, evaluation criteria) require the brief wizard — DO NOT propose to change them here. " +
    "Skills are arrays — pass the full new array (this REPLACES the existing one). " +
    "After updating a field that affects sourcing (skills, location, seniority), it is good practice to suggest regenerating the search filters via the `regenerate_search_filters` tool. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID.',
      },
      updates: {
        type: 'object',
        description:
          "Object containing ONLY the fields to update. Must be a subset of the updatable fields list. " +
          "For skills arrays, pass the COMPLETE new array (not a delta).",
        additionalProperties: true,
      },
    },
    required: ['job_id', 'updates'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    if (!jobId) return { allowed: false, reason: 'job_id is required' };

    const updates = params.updates && typeof params.updates === 'object' ? params.updates as Record<string, unknown> : null;
    if (!updates || Object.keys(updates).length === 0) {
      return { allowed: false, reason: 'updates is required and must contain at least one field' };
    }

    const invalidFields = Object.keys(updates).filter((k) => !(BRIEF_UPDATABLE_FIELDS as readonly string[]).includes(k));
    if (invalidFields.length > 0) {
      return {
        allowed: false,
        reason: `Champs non modifiables via le copilot : ${invalidFields.join(', ')}. Ces champs nécessitent l'éditeur brief.`,
      };
    }

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', jobId)
      .maybeSingle();
    if (!project) return { allowed: false, reason: `Mission ${jobId} introuvable` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const jobId = String(params.job_id);
    const updates = params.updates as Record<string, unknown>;

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name, job_title, client_name, job_details')
      .eq('id', jobId)
      .maybeSingle();

    const jobLabel = project?.job_title || project?.name || jobId;
    const currentDetails = (project?.job_details as Record<string, unknown> | null) ?? {};

    // Build a per-field diff
    const diff: Array<{ field: string; from: unknown; to: unknown }> = [];
    for (const [field, newValue] of Object.entries(updates)) {
      diff.push({ field, from: currentDetails[field] ?? null, to: newValue });
    }

    const fieldsChanged = diff.map((d) => d.field).join(', ');
    const touchesSourcing = diff.some((d) =>
      ['skills_must_have', 'skills_should_have', 'skills_nice_to_have', 'location', 'seniority', 'experience_min', 'experience_max'].includes(d.field),
    );

    return {
      summary: `Mettre à jour le brief de "${jobLabel}" — champs : ${fieldsChanged}`,
      details: {
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        diff,
        touches_sourcing: touchesSourcing,
      },
      warning: touchesSourcing
        ? "Ce changement affecte le sourcing. Pense à régénérer les filtres LinkedIn après (outil regenerate_search_filters)."
        : undefined,
    };
  },

  async execute(params, ctx) {
    const jobId = String(params.job_id);
    const updates = params.updates as Record<string, unknown>;

    // Fetch current job_details, merge with updates (only whitelisted fields kept)
    const { data: project, error: fetchError } = await ctx.adminClient
      .from('sourcing_projects')
      .select('job_details')
      .eq('id', jobId)
      .eq('organization_id', ctx.organizationId)
      .single();

    if (fetchError) return { success: false, error: fetchError.message };

    const currentDetails = (project.job_details as Record<string, unknown> | null) ?? {};
    const filteredUpdates: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(updates)) {
      if ((BRIEF_UPDATABLE_FIELDS as readonly string[]).includes(field)) {
        filteredUpdates[field] = value;
      }
    }
    const merged = { ...currentDetails, ...filteredUpdates };

    const { data, error } = await ctx.adminClient
      .from('sourcing_projects')
      .update({ job_details: merged })
      .eq('id', jobId)
      .eq('organization_id', ctx.organizationId)
      .select('id, job_details, updated_at')
      .single();

    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: {
        mission_id: data.id,
        updated_fields: Object.keys(filteredUpdates),
        updated_at: data.updated_at,
      },
    };
  },
};

// ─── Tool 12 — regenerate_search_filters ────────────────────────────────────
// Régénère les filtres LinkedIn (filters_snapshot) en appelant
// generate-search-filters en interne. Écrase la version actuelle —
// requiresApproval=true pour éviter de perdre une tweak custom de l'user.

const regenerateSearchFilters: AgentTool = {
  name: 'regenerate_search_filters',
  description:
    "Regenerate the LinkedIn search filters for a mission by re-running the AI based on the latest brief. " +
    "Use this when the user says 'régénère les filtres', 'refait les filtres LinkedIn de cette mission', " +
    "or right after `update_mission_brief` changed skills/location/seniority. " +
    "OVERWRITES the existing filters_snapshot — if the user has manually tweaked filters, they will be lost. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID.',
      },
    },
    required: ['job_id'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    if (!jobId) return { allowed: false, reason: 'job_id is required' };

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id, job_details')
      .eq('id', jobId)
      .maybeSingle();
    if (!project) return { allowed: false, reason: `Mission ${jobId} introuvable` };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }

    // Need at least minimal brief content for the AI to work with
    const details = (project.job_details as Record<string, unknown> | null) ?? {};
    const hasContent = Boolean(
      details.title ||
      details.mission_description ||
      (Array.isArray(details.skills_must_have) && (details.skills_must_have as unknown[]).length > 0),
    );
    if (!hasContent) {
      return {
        allowed: false,
        reason: 'Le brief de cette mission est trop vide pour régénérer des filtres. Ajoute au moins un titre ou une description.',
      };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const jobId = String(params.job_id);
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name, job_title, client_name, filters_snapshot')
      .eq('id', jobId)
      .maybeSingle();

    const jobLabel = project?.job_title || project?.name || jobId;
    const hasExistingFilters = !!project?.filters_snapshot;

    return {
      summary: `Régénérer les filtres LinkedIn pour "${jobLabel}"`,
      details: {
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        has_existing_filters: hasExistingFilters,
      },
      warning: hasExistingFilters
        ? "Les filtres actuels seront écrasés. Tweaks manuels perdus."
        : undefined,
    };
  },

  async execute(params, ctx) {
    const jobId = String(params.job_id);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return { success: false, error: 'Supabase env not configured' };

    // 1. Load the mission's job_details (used as `job` payload for generate-search-filters)
    const { data: project, error: fetchError } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, name, job_title, job_details')
      .eq('id', jobId)
      .eq('organization_id', ctx.organizationId)
      .single();
    if (fetchError) return { success: false, error: fetchError.message };

    const details = (project.job_details as Record<string, unknown> | null) ?? {};
    const synthJob = {
      id: `project:${jobId}`,
      title: details.title || project.job_title || project.name,
      description: details.mission_description || details.context || '',
      mustHave: Array.isArray(details.skills_must_have) ? details.skills_must_have : [],
      shouldHave: Array.isArray(details.skills_should_have) ? details.skills_should_have : [],
      niceToHave: Array.isArray(details.skills_nice_to_have) ? details.skills_nice_to_have : [],
      seniority: details.seniority || null,
      location: details.location || null,
      experience_min: details.experience_min ?? null,
      experience_max: details.experience_max ?? null,
    };

    // 2. Invoke generate-search-filters in Mode B (service-role + user_id_override)
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/generate-search-filters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          job: synthJob,
          user_id_override: ctx.userId,
        }),
      });
      const data = await response.json();
      if (!response.ok) return { success: false, error: data.error || `generate-search-filters HTTP ${response.status}` };

      // 3. Persist as filters_snapshot
      const { error: updateError } = await ctx.adminClient
        .from('sourcing_projects')
        .update({ filters_snapshot: data })
        .eq('id', jobId)
        .eq('organization_id', ctx.organizationId);
      if (updateError) return { success: false, error: updateError.message };

      return {
        success: true,
        data: {
          mission_id: jobId,
          message: 'Filtres LinkedIn régénérés. Visibles dans la mission → sourcing.',
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  },
};

// ============================================================================
// Registration
// ============================================================================

let registered = false;

export function registerMutatingTools(): void {
  if (registered) return;
  registerTool(updateCandidateStage);
  registerTool(addToShortlist);
  registerTool(createMission);
  registerTool(enrollInSequence);
  registerTool(draftOutreachMessage);
  registerTool(enrichCandidateContact);
  // Phase A.1 — Pipeline candidat
  registerTool(addCandidateNote);
  registerTool(dismissCandidate);
  registerTool(assignCandidateToMember);
  // Phase A.2 — Mission management
  registerTool(updateMissionStatus);
  registerTool(updateMissionBrief);
  registerTool(regenerateSearchFilters);
  // schedule_interview reporté : pas de calendar branché, table events
  // existe mais le flow Google/Outlook arrive en Sprint 5 du plan.
  registered = true;
}
