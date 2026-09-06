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
import { checkLinkedInQuota, getUserQuotas, nextBusinessHoursStart } from './linkedin-quotas.ts';
import { resolveUnipileCredentials } from './resolve-org-credentials.ts';

// ─── Helper — fetch avec timeout (15s par défaut, pattern standard) ─────────
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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
    "Crée une nouvelle mission de recrutement (sourcing project) ET remplit le brief avec " +
    "TOUT ce qui a été clarifié pendant la conversation (localisation, remote, salaire, " +
    "expérience, stack, skills must/should-have, description, contexte client, urgence, etc.). " +
    "UTILISATION OBLIGATOIRE : quand l'utilisateur a passé du temps à clarifier les critères " +
    "(« je cherche un Data Scientist 3-7 ans à Paris, 60-75K, Python/ML classique, pas de remote »), " +
    "tu DOIS passer TOUS ces champs en paramètres — pas juste name/job_title. Le brief sera " +
    "ainsi pré-rempli et l'user n'aura plus qu'à compléter les champs experts (pedigree, " +
    "critères d'évaluation détaillés) via l'éditeur brief. " +
    "Ne JAMAIS dire « je ne peux pas remplir le brief » — c'est faux, ce tool le fait. " +
    "Toujours proposé pour approbation — la mission n'apparaît dans le kanban qu'après le clic Approuver.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      // ── Identité ─────────────────────────────────────────────
      name: { type: 'string', description: "Nom court de la mission (≤80 chars), e.g. « Data Scientist confirmé — Eleven Strategy »." },
      job_title: { type: 'string', description: "Intitulé du poste, e.g. « Data Scientist »." },
      client_name: { type: 'string', description: "Nom du client / entreprise externe (optionnel si recrutement interne)." },
      client_sector: { type: 'string', description: "Secteur du client (e.g. « Conseil stratégique IA & Data »)." },
      client_size: {
        type: 'string',
        enum: ['startup', 'scale-up', 'mid-market', 'enterprise'],
        description: "Taille du client.",
      },
      description: { type: 'string', description: "Pitch court (1-3 phrases) — sera mis dans la colonne description ET dans context du brief." },
      contract_type: {
        type: 'string',
        enum: ['cdi', 'cdd', 'freelance', 'alternance', 'stage', 'interim'],
        description: "Type de contrat (défaut CDI si non précisé).",
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'critical'],
        description: "Niveau d'urgence (low/medium/high/critical).",
      },

      // ── Poste & localisation ─────────────────────────────────
      location: { type: 'string', description: "Localisation lisible humain (e.g. « Paris 9ème + proche banlieue (30min max) »)." },
      remote_policy: {
        type: 'string',
        enum: ['onsite', 'hybrid', 'full_remote'],
        description: "Politique remote. « onsite » = 100% présentiel, « hybrid » = X jours/sem, « full_remote » = full distanciel.",
      },
      remote_days: { type: 'integer', description: "Si hybrid : nombre de jours remote par semaine (0-5)." },
      mission_description: { type: 'string', description: "Description longue de la mission (ce que la personne va faire au quotidien)." },
      context: { type: 'string', description: "Contexte client / contexte du recrutement (pourquoi ce poste maintenant, équipe, etc.)." },

      // ── Profil & rémun ──────────────────────────────────────
      seniority: { type: 'string', description: "Niveau (e.g. « confirmé », « senior », « junior »)." },
      experience_min: { type: 'integer', description: "Années d'expérience minimum requises." },
      experience_max: { type: 'integer', description: "Années d'expérience maximum souhaitées." },
      salary_min: { type: 'integer', description: "Rémun min en milliers (60 = 60K€)." },
      salary_max: { type: 'integer', description: "Rémun max en milliers (75 = 75K€)." },
      salary_currency: { type: 'string', description: "Devise (défaut EUR)." },

      // ── Skills ───────────────────────────────────────────────
      skills_must_have: { type: 'array', items: { type: 'string' }, description: "Skills strictement requis (e.g. [\"Python\", \"scikit-learn\", \"pandas\"])." },
      skills_should_have: { type: 'array', items: { type: 'string' }, description: "Skills fortement souhaités." },
      skills_nice_to_have: { type: 'array', items: { type: 'string' }, description: "Skills bonus." },
      skills_to_avoid: { type: 'array', items: { type: 'string' }, description: "Skills à exclure (e.g. profils ESN si on n'en veut pas)." },
    },
    required: ['name', 'job_title'],
  },

  async verifyAccess(_params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    return { allowed: true };
  },

  async dryRun(params, _ctx) {
    // Build a human-readable list of the brief fields that will be pre-filled
    const briefBits: string[] = [];
    if (params.contract_type) briefBits.push(`contrat ${params.contract_type}`);
    if (params.urgency) briefBits.push(`urgence ${params.urgency}`);
    if (params.location) briefBits.push(String(params.location));
    if (params.remote_policy) briefBits.push(`remote=${params.remote_policy}${params.remote_days != null ? ` (${params.remote_days}j)` : ''}`);
    if (params.seniority) briefBits.push(String(params.seniority));
    if (params.experience_min != null || params.experience_max != null) {
      briefBits.push(`exp ${params.experience_min ?? '?'}-${params.experience_max ?? '?'} ans`);
    }
    if (params.salary_min != null || params.salary_max != null) {
      briefBits.push(`${params.salary_min ?? '?'}-${params.salary_max ?? '?'}K€`);
    }
    const skills = (params.skills_must_have as string[] | undefined) ?? [];
    if (skills.length) briefBits.push(`skills: ${skills.slice(0, 5).join(', ')}${skills.length > 5 ? '…' : ''}`);

    return {
      summary:
        `Créer la mission « ${params.name} » (${params.job_title})` +
        (params.client_name ? ` chez ${params.client_name}` : '') +
        (briefBits.length ? `\nBrief pré-rempli : ${briefBits.join(' · ')}` : ''),
      details: {
        name: params.name,
        job_title: params.job_title,
        client_name: params.client_name ?? null,
        client_sector: params.client_sector ?? null,
        client_size: params.client_size ?? null,
        description: params.description ?? null,
        contract_type: params.contract_type ?? null,
        urgency: params.urgency ?? null,
        location: params.location ?? null,
        remote_policy: params.remote_policy ?? null,
        remote_days: params.remote_days ?? null,
        seniority: params.seniority ?? null,
        experience_min: params.experience_min ?? null,
        experience_max: params.experience_max ?? null,
        salary_min: params.salary_min ?? null,
        salary_max: params.salary_max ?? null,
        salary_currency: params.salary_currency ?? null,
        skills_must_have: params.skills_must_have ?? null,
        skills_should_have: params.skills_should_have ?? null,
        skills_nice_to_have: params.skills_nice_to_have ?? null,
        skills_to_avoid: params.skills_to_avoid ?? null,
        mission_description: params.mission_description ?? null,
        context: params.context ?? null,
        status: 'active',
      },
    };
  },

  async execute(params, ctx) {
    // Build job_details JSONB from all provided fields (snake_case mirrors the
    // JobDetails type in src/types/jobDetails.ts).
    const jobDetails: Record<string, unknown> = {};
    const passThrough: Array<[string, unknown]> = [
      ['title', params.job_title],
      ['contract_type', params.contract_type],
      ['urgency', params.urgency],
      ['location', params.location],
      ['remote_policy', params.remote_policy],
      ['remote_days', params.remote_days],
      ['seniority', params.seniority],
      ['experience_min', params.experience_min],
      ['experience_max', params.experience_max],
      ['salary_min', params.salary_min],
      ['salary_max', params.salary_max],
      ['salary_currency', params.salary_currency ?? (params.salary_min || params.salary_max ? 'EUR' : undefined)],
      ['mission_description', params.mission_description ?? params.description],
      ['context', params.context],
      ['skills_must_have', params.skills_must_have],
      ['skills_should_have', params.skills_should_have],
      ['skills_nice_to_have', params.skills_nice_to_have],
      ['skills_to_avoid', params.skills_to_avoid],
    ];
    for (const [k, v] of passThrough) {
      if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) {
        jobDetails[k] = v;
      }
    }

    // Client nested object — only if we have at least the name
    if (params.client_name) {
      jobDetails.client = {
        name: String(params.client_name),
        ...(params.client_sector ? { sector: String(params.client_sector) } : {}),
        ...(params.client_size ? { size: String(params.client_size) } : {}),
      };
    }

    // Mark brief as AI-structured so downstream UIs can flag it
    if (Object.keys(jobDetails).length > 0) {
      jobDetails.brief_source = 'ai_structured';
    }

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
        ...(Object.keys(jobDetails).length > 0 ? { job_details: jobDetails } : {}),
      })
      .select('id, name, job_title')
      .single();

    if (error) return { success: false, error: error.message };

    const filledFields = Object.keys(jobDetails).filter((k) => k !== 'brief_source');
    return {
      success: true,
      data: {
        mission_id: data.id,
        name: data.name,
        job_title: data.job_title,
        brief_fields_filled: filledFields,
        message: filledFields.length
          ? `Mission créée avec ${filledFields.length} champs du brief pré-remplis. L'user peut compléter pedigree/évaluation/critères dans l'éditeur brief.`
          : 'Mission créée (brief vide).',
      },
    };
  },
};

// ─── Tool 4 — enroll_in_sequence ────────────────────────────────────────────
// INSERT dans sequence_enrollments. Le candidat doit déjà exister
// (job_candidate_status row), et la séquence doit appartenir à l'org.
//
// Anti-doublon organisation (lot P0-D, docs/p0-plan-2026-09-06.md, section 2) :
// un candidat contacté par un membre de l'org dans les 90 derniers jours
// (toute séquence, tout compte, statuts active/paused/replied/completed) est
// refusé, sauf `force: true` posé par un propriétaire ou administrateur. Même
// clé de rapprochement que src/lib/enrollmentDuplicates.ts : profile_id
// normalisé (identifiant LinkedIn ou URL en minuscules sans barre finale),
// repli sur provider_id.

const RECENT_CONTACT_WINDOW_DAYS = 90;
const RECENT_CONTACT_STATUSES = ['active', 'paused', 'replied', 'completed'];

interface RecentOrgContact {
  createdBy: string | null;
  createdByFirstName: string | null;
  createdAt: string;
  sequenceId: string;
  sequenceName: string | null;
}

function normalizeEnrollmentKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\/+$/, '').toLowerCase();
  return normalized || null;
}

function linkedInSlugOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatRecentContact(recent: RecentOrgContact): string {
  const who = recent.createdByFirstName || "un membre de l'équipe";
  const date = new Date(recent.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris',
  });
  const seq = recent.sequenceName ? ` (séquence « ${recent.sequenceName} »)` : '';
  return `Déjà contacté par ${who} le ${date}${seq}`;
}

/** Dernier contact de l'organisation avec ce candidat sur 90 jours, ou null. */
async function findRecentOrgContact(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<RecentOrgContact | null> {
  const rawValues = [params.candidate_id, params.profile_url]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());
  if (rawValues.length === 0) return null;

  const keys = new Set<string>();
  const queryValues = new Set<string>(rawValues);
  for (const value of rawValues) {
    const key = normalizeEnrollmentKey(value);
    if (key) { keys.add(key); queryValues.add(key); }
    const slug = linkedInSlugOf(value);
    if (slug) { keys.add(slug); queryValues.add(slug); }
  }
  const list = Array.from(queryValues).map(quoteFilterValue).join(',');
  const since = new Date(Date.now() - RECENT_CONTACT_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: rows, error } = await ctx.adminClient
    .from('sequence_enrollments')
    .select('profile_id, provider_id, created_by, created_at, status, sequence_id')
    .eq('organization_id', ctx.organizationId)
    .gte('created_at', since)
    .in('status', RECENT_CONTACT_STATUSES)
    .or(`profile_id.in.(${list}),provider_id.in.(${list})`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`Vérification des contacts récents impossible : ${error.message}`);

  const match = (rows ?? []).find((row: Record<string, unknown>) => {
    for (const value of [row.profile_id, row.provider_id]) {
      const key = normalizeEnrollmentKey(value);
      if (key && keys.has(key)) return true;
      const slug = linkedInSlugOf(value);
      if (slug && keys.has(slug)) return true;
    }
    return false;
  });
  if (!match) return null;

  const [{ data: profile }, { data: seq }] = await Promise.all([
    match.created_by
      ? ctx.adminClient.from('profiles').select('display_name').eq('user_id', String(match.created_by)).maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.adminClient.from('outreach_sequences').select('name').eq('id', String(match.sequence_id)).maybeSingle(),
  ]);
  const firstName = String(profile?.display_name ?? '').trim().split(/\s+/)[0] || null;

  return {
    createdBy: match.created_by ? String(match.created_by) : null,
    createdByFirstName: firstName,
    createdAt: String(match.created_at),
    sequenceId: String(match.sequence_id),
    sequenceName: seq?.name ? String(seq.name) : null,
  };
}

const enrollInSequence: AgentTool = {
  name: 'enroll_in_sequence',
  description:
    "Enroll a candidate into an outreach sequence. The sequence steps will start being processed by the cron. " +
    "Use when the user says 'enrôle X dans ma séquence Y', 'lance la séquence sur ce candidat'. " +
    "Requires the candidate to already exist on the mission and the sequence to belong to the user's org. " +
    "Refused when the organization already contacted the candidate in the last 90 days (any sequence, any account); " +
    "only an owner or admin can override with force: true after explicit confirmation.",
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
      force: {
        type: 'boolean',
        description:
          'Set to true only when the user explicitly confirms enrolling a candidate already contacted by the organization in the last 90 days. Owners and admins only.',
      },
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

    // Anti-doublon organisation (90 jours). Rejoué avant execute (SEC-002),
    // donc la règle tient aussi à l'approbation.
    let recent: Awaited<ReturnType<typeof findRecentOrgContact>>;
    try {
      recent = await findRecentOrgContact(params, ctx);
    } catch (err) {
      return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (recent) {
      const candidate = String(params.profile_name ?? params.candidate_id);
      if ('sequenceId' in (recent as object) && String((recent as { sequenceId?: unknown }).sequenceId ?? '') === String(params.sequence_id)) {
        return {
          allowed: false,
          reason: `${candidate} est déjà inscrit dans cette séquence : pas de double inscription.`,
        };
      }
      if (params.force !== true) {
        return {
          allowed: false,
          reason:
            `${candidate} : ${formatRecentContact(recent)}. Inscription refusée pour éviter un double contact. ` +
            `Un propriétaire ou administrateur peut passer outre en relançant avec force: true après confirmation explicite.`,
        };
      }
      const { data: callerRole } = await ctx.adminClient
        .from('organization_members')
        .select('role')
        .eq('organization_id', ctx.organizationId)
        .eq('user_id', ctx.userId)
        .maybeSingle();
      if (callerRole?.role !== 'admin' && callerRole?.role !== 'owner') {
        return {
          allowed: false,
          reason:
            `${candidate} : ${formatRecentContact(recent)}. La dérogation force: true est réservée aux propriétaires et administrateurs.`,
        };
      }
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const [{ data: seq }, { data: project }, recent] = await Promise.all([
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
      findRecentOrgContact(params, ctx),
    ]);

    // Check if already enrolled
    const { data: existing } = await ctx.adminClient
      .from('sequence_enrollments')
      .select('id, current_step_order')
      .eq('sequence_id', String(params.sequence_id))
      .eq('provider_id', String(params.candidate_id))
      .maybeSingle();

    const candidate = String(params.profile_name ?? params.candidate_id);
    const warning = existing
      ? 'Ce candidat est déjà dans cette séquence, pas de double enrôlement.'
      : recent
        ? `${formatRecentContact(recent)}. Inscription forcée par dérogation (force: true).`
        : undefined;

    return {
      summary: existing
        ? `${candidate} est déjà enrôlé dans « ${seq?.name ?? 'cette séquence'} »`
        : `Enrôler ${candidate} dans « ${seq?.name ?? 'cette séquence'} » pour la mission ${project?.job_title ?? project?.name ?? params.job_id}` +
          (recent ? ' malgré un contact récent de l\'organisation' : ''),
      details: {
        sequence_name: seq?.name ?? null,
        candidate,
        job: project?.job_title ?? project?.name ?? null,
        already_enrolled: !!existing,
        recent_contact: recent
          ? {
              contacted_by: recent.createdBy,
              contacted_by_first_name: recent.createdByFirstName,
              contacted_at: recent.createdAt,
              sequence_id: recent.sequenceId,
              sequence_name: recent.sequenceName,
              forced: true,
            }
          : null,
      },
      warning,
    };
  },

  async execute(params, ctx) {
    // Doublon relu ici pour le compte rendu (verifyAccess a déjà tranché) :
    // une erreur de lecture ne fait pas échouer une inscription approuvée.
    let recent: Awaited<ReturnType<typeof findRecentOrgContact>> = null;
    try {
      recent = await findRecentOrgContact(params, ctx);
    } catch {
      recent = null;
    }

    const { data, error } = await ctx.adminClient
      .from('sequence_enrollments')
      .insert({
        sequence_id: String(params.sequence_id),
        profile_id: String(params.candidate_id),
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

    if (error) {
      return {
        success: false,
        error: error.code === '23505' ? 'Ce candidat est déjà inscrit dans cette séquence.' : error.message,
      };
    }
    return {
      success: true,
      data: {
        enrollment_id: data.id,
        ...(recent
          ? {
              recent_contact: {
                contacted_by: recent.createdBy,
                contacted_by_first_name: recent.createdByFirstName,
                contacted_at: recent.createdAt,
                sequence_id: recent.sequenceId,
                sequence_name: recent.sequenceName,
              },
              message: `Inscrit par dérogation : ${formatRecentContact(recent)}.`,
            }
          : {}),
      },
    };
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

// Libellés neutres des sources gratuites de la cascade (clés = `source` renvoyé
// par enrich-candidate-contact). Jamais de nom de fournisseur dans la note.
const FREE_SOURCE_LABELS: Record<string, string> = {
  unipile: 'les informations de contact LinkedIn',
  manual: 'la fiche candidat',
  job_status: 'la fiche candidat',
  airtable: "l'ATS",
};

const enrichCandidateContact: AgentTool = {
  name: 'enrich_candidate_contact',
  description:
    "Retrieve a candidate's professional email and/or mobile phone via a waterfall cascade " +
    "(free sources first: LinkedIn contact info, org cache 30 days, ATS sync; then a paid enrichment provider " +
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

  async dryRun(params, ctx) {
    const linkedinUrl = String(params.linkedin_url).trim();
    const withEmail = params.with_email !== false; // default true (même logique qu'execute)
    const withPhone = params.with_phone === true;  // default false

    // Slug du profil — sert aussi de candidate_id pour les profils sourcés
    const slugMatch = linkedinUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
    const slug = slugMatch ? decodeURIComponent(slugMatch[1]).replace(/\/+$/, '') : null;

    // Label candidat : params explicites d'abord, sinon lookup pipeline, sinon slug
    const paramName = [params.first_name, params.last_name]
      .map((v) => (v ? String(v).trim() : ''))
      .filter(Boolean)
      .join(' ');
    let candidateLabel = paramName || slug || linkedinUrl;
    let isInPipeline = false;
    if (slug) {
      const { data: candidate } = await ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_name')
        .eq('candidate_id', slug)
        .eq('organization_id', ctx.organizationId)
        .limit(1)
        .maybeSingle();
      if (candidate) {
        isInPipeline = true;
        if (!paramName && candidate.candidate_name) candidateLabel = candidate.candidate_name;
      }
    }

    // Coûts alignés sur ai-config.ts : enrich_contact_email floor=1, enrich_contact_phone floor=10
    const maxCredits = (withEmail ? 1 : 0) + (withPhone ? 10 : 0);
    const requested = [withEmail ? 'email pro' : null, withPhone ? 'téléphone mobile' : null]
      .filter(Boolean)
      .join(' + ');

    return {
      summary: requested
        ? `Enrichir ${candidateLabel} — ${requested} (max ${maxCredits} crédit${maxCredits > 1 ? 's' : ''} si trouvé)`
        : `Enrichir ${candidateLabel} — aucun type de contact demandé`,
      details: {
        linkedin_url: linkedinUrl,
        candidate_label: candidateLabel,
        is_in_pipeline: isInPipeline,
        with_email: withEmail,
        with_phone: withPhone,
        company: params.company ? String(params.company) : null,
        cost_email_credits: withEmail ? 1 : 0,
        cost_phone_credits: withPhone ? 10 : 0,
        estimated_max_credits: maxCredits,
        billing_note:
          "Cascade gratuite testée d'abord (contacts LinkedIn, cache 30 jours, ATS). Crédits débités uniquement si le contact est trouvé via un fournisseur payant : 0 crédit si introuvable ou déjà en cache.",
      },
      warning: !withEmail && !withPhone
        ? "Ni email ni téléphone demandé — l'exécution échouera (with_email ou with_phone doit être true)."
        : withPhone
        ? 'La recherche de téléphone mobile coûte 10 crédits si trouvée (10× le coût email).'
        : undefined,
    };
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
      // 30s : la cascade interne peut chaîner Unipile + Better Contact (15s chacun)
      const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/enrich-candidate-contact`, {
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
      }, 30_000);

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
              ? 'Profil déjà enrichi (cache 30 jours), gratuit'
              : `Trouvé via ${FREE_SOURCE_LABELS[String(data.source)] ?? 'une source gratuite'}, gratuit`,
          },
        };
      }

      // Sinon : enrichment async démarré
      return {
        success: true,
        data: {
          status: 'pending',
          request_id: data.request_id,
          note: `Enrichissement lancé via la cascade (sources gratuites, cache, ATS, puis fournisseurs payants). ` +
                `Résultat sous 30 s à 3 min ; l'utilisateur peut continuer son sourcing en attendant. ` +
                `Le contact apparaîtra automatiquement sur la fiche du candidat dans la liste sourcing.`,
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
// org, cross-mission). Le candidat n'a PAS besoin d'être déjà dans le pipeline
// (job_candidate_status) — on accepte aussi les notes sur des prospects/
// contacts LinkedIn hors pipeline (cas Gloria Fils, Adrien Le Marhadour, etc.).
// Si le candidat est en pipeline, on enrichit le dryRun avec son nom/headline ;
// sinon on prend le candidate_id passé tel quel comme label.

const addCandidateNote: AgentTool = {
  name: 'add_candidate_note',
  description:
    "Add a free-text note attached to a candidate or LinkedIn contact (org-wide, cross-mission). " +
    "Use this when the user says things like 'ajoute une note à X', 'note pour Marie : appelé ce matin, à recontacter mardi', " +
    "'mémo : Théo est en vacances jusqu'au 15'. " +
    "The candidate does NOT need to be in the pipeline — works for prospects, LinkedIn contacts, peers, anyone the user mentions by name. " +
    "Pass `candidate_id` = (a) the LinkedIn provider_id if known, (b) the LinkedIn URL slug from a profile link, OR (c) the person's full name as a fallback. " +
    "Pipeline candidates will show the note on their card ; orphan notes are searchable via the RAG / semantic search. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_id: {
        type: 'string',
        description:
          "Stable identifier for the candidate/contact. Preferred order: (1) LinkedIn provider_id ('ACoAA...') if known, (2) LinkedIn URL slug ('marie-dupont' from linkedin.com/in/marie-dupont), (3) the person's full name ('Gloria Fils'). The note attaches to a pipeline card only if this matches an existing job_candidate_status.candidate_id ; otherwise it's an org-wide orphan note (still useful, searchable).",
      },
      content: {
        type: 'string',
        description: "The note content in French (free text, plain or markdown). Max 4000 chars.",
      },
    },
    required: ['candidate_id', 'content'],
  },

  async verifyAccess(params, _ctx) {
    const candidateId = String(params.candidate_id || '').trim();
    const content = String(params.content || '').trim();
    if (!candidateId) return { allowed: false, reason: 'candidate_id is required' };
    if (!content) return { allowed: false, reason: 'content is required and cannot be empty' };
    if (content.length > 4000) return { allowed: false, reason: 'content too long (max 4000 chars)' };
    // No pipeline-existence check : orphan notes are allowed by design.
    // organization_id scoping is enforced at execute-time via ctx.organizationId.
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const candidateId = String(params.candidate_id).trim();
    const content = String(params.content);

    const { data: candidate } = await ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_name, candidate_headline')
      .eq('candidate_id', candidateId)
      .eq('organization_id', ctx.organizationId)
      .limit(1)
      .maybeSingle();

    const isInPipeline = !!candidate;
    const candidateLabel = candidate?.candidate_name || candidateId;
    const preview = content.length > 80 ? content.slice(0, 77) + '…' : content;

    return {
      summary: `Ajouter une note sur ${candidateLabel} : « ${preview} »`,
      details: {
        candidate_id: candidateId,
        candidate_name: candidate?.candidate_name ?? null,
        candidate_headline: candidate?.candidate_headline ?? null,
        is_in_pipeline: isInPipeline,
        content_preview: preview,
        content_full: content,
        content_length: content.length,
      },
      warning: isInPipeline
        ? undefined
        : "Note hors pipeline : ce candidat/contact n'est pas (encore) associé à une de tes missions. La note sera créée et retrouvable via la recherche, mais n'apparaîtra sur aucune card pipeline tant que la personne n'est pas sourcée.",
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

// ─── Tool 13 — send_linkedin_message ────────────────────────────────────────
// Envoi standalone d'un message LinkedIn via l'edge unipile-search (Mode B).
// Quota-gated : check business hours + cap journalier via member_quotas.
// Conformité LinkedIn warning #260513-007211 (license sharing).
// account_id optionnel — fallback sur le 1er compte LinkedIn OK de l'user.

/**
 * Résout l'account_id LinkedIn à utiliser :
 * - Si fourni en param, vérifie qu'il appartient à l'user dans l'org courante.
 * - Sinon, prend le 1er compte LinkedIn de l'user (account_status='OK' prioritaire).
 *
 * ⚠️ Le schéma `member_linkedin_accounts` utilise `linkedin_account_id` (pas
 * `account_id`) et `linked_at` (pas `created_at`) — c'est la convention héritée
 * de unipile-webhook. La signature externe garde `account_id` parce que c'est
 * l'identifiant Unipile partagé partout ailleurs (params, edge function bodies).
 *
 * Retourne { account_id, account_status } | { error }.
 */
async function resolveSendingAccount(
  params: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ account_id: string; account_status: string | null } | { error: string }> {
  const requested = params.account_id ? String(params.account_id).trim() : '';

  if (requested) {
    const { data } = await ctx.adminClient
      .from('member_linkedin_accounts')
      .select('linkedin_account_id, account_status')
      .eq('linkedin_account_id', requested)
      .eq('user_id', ctx.userId)
      .eq('organization_id', ctx.organizationId)
      .maybeSingle();
    if (!data) {
      return { error: `Le compte LinkedIn ${requested} n'est pas rattaché à votre profil dans cette organisation.` };
    }
    return {
      account_id: (data as Record<string, unknown>).linkedin_account_id as string,
      account_status: ((data as Record<string, unknown>).account_status as string | null) ?? null,
    };
  }

  // Fallback : take the user's first LinkedIn account (status=OK first)
  const { data: accounts } = await ctx.adminClient
    .from('member_linkedin_accounts')
    .select('linkedin_account_id, account_status, linked_at')
    .eq('user_id', ctx.userId)
    .eq('organization_id', ctx.organizationId)
    .order('linked_at', { ascending: true });

  const list = (accounts ?? []) as Array<{ linkedin_account_id: string; account_status: string | null; linked_at: string }>;
  if (list.length === 0) {
    return { error: "Aucun compte LinkedIn n'est connecté à votre profil. Connecte-en un via Paramètres → Comptes connectés." };
  }
  // Prefer the first OK account ; otherwise return the first connected (the
  // status check below will reject CREDENTIALS / DISCONNECTED with a clearer
  // error than "no account").
  const okOne = list.find((a) => a.account_status === 'OK');
  const chosen = okOne ?? list[0];
  return { account_id: chosen.linkedin_account_id, account_status: chosen.account_status };
}

const sendLinkedInMessage: AgentTool = {
  name: 'send_linkedin_message',
  description:
    "Send a one-off LinkedIn message to a recipient (NOT through a sequence). " +
    "Use this when the user says 'envoie un message LinkedIn à X disant ...', 'écris à Y pour confirmer l'entretien'. " +
    "Quota-gated : checks the user's business hours (member_quotas) and daily LinkedIn action cap. " +
    "Si on est HORS plage horaire, l'action est AUTOMATIQUEMENT PROGRAMMÉE pour la prochaine ouverture (8h le lendemain ouvré par défaut) — l'user approuve normalement, le cron envoie au bon moment. Ne dis JAMAIS « hors plage, je ne peux pas envoyer » : tu peux toujours, le tool gère le timing. " +
    "Si le cap journalier est atteint, l'action est REFUSED (hard reject — le user doit attendre demain ou monter son cap). " +
    "Two modes : `chat_id` continues an existing conversation, `recipient_provider_id` starts a new chat. " +
    "If the user has an existing LinkedIn thread with the recipient (verified via `get_linkedin_thread`), prefer `chat_id` over `recipient_provider_id` — it appends to the same conversation. " +
    "`account_id` is OPTIONAL — defaults to the user's first connected LinkedIn account (OK status preferred). Only set it explicitly if the user mentions a specific connected account or you know they have multiple. " +
    "Set `is_inmail=true` for Recruiter InMail (requires premium balance, consumes a credit). " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_external',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        description: "OPTIONAL — the user's LinkedIn account_id (from member_linkedin_accounts). If omitted, the tool falls back to the user's first connected LinkedIn account.",
      },
      chat_id: {
        type: 'string',
        description: "ID of an existing LinkedIn conversation to continue (returned by `get_linkedin_thread`). Use this when replying to an ongoing thread.",
      },
      recipient_provider_id: {
        type: 'string',
        description: "LinkedIn provider_id of the recipient (e.g. 'ACoAA...'). Use this when starting a brand new conversation. Mutually exclusive with chat_id.",
      },
      recipient_name: {
        type: 'string',
        description:
          "ALWAYS pass the recipient's display name (e.g. 'Guillaume Valladier') for the approval banner UI label. " +
          "If you just called get_linkedin_thread(person_name=X), pass the same X here. " +
          "Without it, the user sees an opaque chat ID like 'chat EFjEVUgyW8e3ihJGaffqRQ' instead of a name. ",
      },
      text: {
        type: 'string',
        description: "The message body in French (max 1500 chars). Plain text — no markdown.",
      },
      is_inmail: {
        type: 'boolean',
        description: "Set true for Recruiter InMail (2nd/3rd degree contacts not connected). Default false.",
      },
      subject: {
        type: 'string',
        description: "InMail subject line (required when is_inmail=true).",
      },
    },
    required: ['text'],
  },

  async verifyAccess(params, ctx) {
    const text = String(params.text || '').trim();
    const chatId = params.chat_id ? String(params.chat_id) : '';
    const recipientId = params.recipient_provider_id ? String(params.recipient_provider_id) : '';
    const isInmail = params.is_inmail === true;
    const subject = params.subject ? String(params.subject) : '';

    if (!text) return { allowed: false, reason: 'text is required and cannot be empty' };
    if (text.length > 1500) return { allowed: false, reason: 'text too long (max 1500 chars)' };
    if (!chatId && !recipientId) {
      return { allowed: false, reason: 'Either chat_id (existing conversation) or recipient_provider_id (new chat) is required' };
    }
    if (chatId && recipientId) {
      return { allowed: false, reason: 'chat_id and recipient_provider_id are mutually exclusive — pick one' };
    }
    if (isInmail && !subject) {
      return { allowed: false, reason: "subject is required when is_inmail=true" };
    }

    const resolved = await resolveSendingAccount(params, ctx);
    if ('error' in resolved) return { allowed: false, reason: resolved.error };
    if (resolved.account_status && resolved.account_status !== 'OK') {
      return { allowed: false, reason: `Compte LinkedIn ${resolved.account_id} en statut "${resolved.account_status}". Reconnecte-le avant d'envoyer.` };
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const resolved = await resolveSendingAccount(params, ctx);
    if ('error' in resolved) {
      // verifyAccess already gated this — should not reach here, but be safe
      return {
        summary: 'Envoi LinkedIn impossible : compte introuvable',
        details: { error: resolved.error },
        warning: resolved.error,
      };
    }
    const accountId = resolved.account_id;
    const accountWasAutoResolved = !params.account_id;
    const text = String(params.text);
    const chatId = params.chat_id ? String(params.chat_id) : null;
    const recipientId = params.recipient_provider_id ? String(params.recipient_provider_id) : null;
    const isInmail = params.is_inmail === true;
    const subject = params.subject ? String(params.subject) : null;

    // dryRun is a PREVIEW — do NOT log to the ledger (log:false). Only execute() reserves a slot.
    const quotaCheck = await checkLinkedInQuota(ctx.adminClient, ctx.userId, accountId, isInmail ? 'inmail' : 'message', { organizationId: ctx.organizationId, source: 'agent_tool', log: false });
    const userQuotas = await getUserQuotas(ctx.adminClient, ctx.userId, ctx.organizationId);
    // Si on est hors plage MAIS pas au-dessus du cap, on PLANIFIE pour la
    // prochaine ouverture de business hours (au lieu de refuser).
    const isOverCap = quotaCheck.count_today >= quotaCheck.max_per_day;
    const isOutOfHours = !quotaCheck.in_business_hours;
    const scheduledForIso = isOutOfHours && !isOverCap
      ? nextBusinessHoursStart(userQuotas.timezone, userQuotas.business_hours_start, userQuotas.business_hours_end)
      : null;
    const preview = text.length > 120 ? text.slice(0, 117) + '…' : text;

    // Recipient label resolution priority :
    //   1. explicit recipient_name param (Claude passes it from get_linkedin_thread)
    //   2. pipeline lookup by provider_id (if new_chat mode)
    //   3. raw provider_id (least informative)
    //   4. fallback to chat hash (worst case — Claude forgot recipient_name)
    const recipientName = params.recipient_name ? String(params.recipient_name).trim() : '';
    let recipientLabel = recipientName || recipientId || (chatId ? `chat ${chatId}` : 'inconnu');
    if (!recipientName && recipientId) {
      const { data: candidate } = await ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_name')
        .eq('candidate_id', recipientId)
        .eq('organization_id', ctx.organizationId)
        .limit(1)
        .maybeSingle();
      if (candidate?.candidate_name) recipientLabel = candidate.candidate_name;
    }

    // Format scheduled_for for human warning (FR locale, target tz)
    const formattedScheduled = scheduledForIso
      ? new Date(scheduledForIso).toLocaleString('fr-FR', {
          timeZone: userQuotas.timezone,
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const warning = isOverCap
      ? quotaCheck.reason
      : scheduledForIso
      ? `Hors plage horaire ${userQuotas.business_hours_start}h-${userQuotas.business_hours_end}h ${userQuotas.timezone}. À l'approbation, le message sera mis en file et envoyé automatiquement le ${formattedScheduled}.`
      : quotaCheck.count_today >= quotaCheck.max_per_day - 5
      ? `Attention quota : ${quotaCheck.count_today}/${quotaCheck.max_per_day} actions LinkedIn aujourd'hui.`
      : undefined;

    return {
      summary: isInmail
        ? `Envoyer un InMail à ${recipientLabel} — sujet "${subject}"`
        : chatId
        ? `Répondre dans la conversation avec ${recipientLabel}`
        : `Envoyer un message LinkedIn à ${recipientLabel}`,
      details: {
        account_id: accountId,
        account_auto_resolved: accountWasAutoResolved,
        mode: chatId ? 'reply_in_chat' : 'new_chat',
        chat_id: chatId,
        recipient_provider_id: recipientId,
        recipient_label: recipientLabel,
        text_preview: preview,
        text_length: text.length,
        is_inmail: isInmail,
        subject,
        quota_count_today: quotaCheck.count_today,
        quota_max_per_day: quotaCheck.max_per_day,
        in_business_hours: quotaCheck.in_business_hours,
        timezone: quotaCheck.timezone,
        // ↓ Lu par confirmToolExecution : si présent et > now+30s, l'action
        //    est queue au lieu d'être exécutée immédiatement.
        scheduled_for: scheduledForIso,
        scheduled_for_human: formattedScheduled,
      },
      warning,
    };
  },

  async execute(params, ctx) {
    const resolved = await resolveSendingAccount(params, ctx);
    if ('error' in resolved) return { success: false, error: resolved.error };
    const accountId = resolved.account_id;
    const text = String(params.text);
    const chatId = params.chat_id ? String(params.chat_id) : null;
    const recipientId = params.recipient_provider_id ? String(params.recipient_provider_id) : null;
    const isInmail = params.is_inmail === true;
    const subject = params.subject ? String(params.subject) : null;

    // Re-check quota at execute-time (the dryRun might be stale by a few minutes).
    // This is the REAL send → logs the action to the unified ledger (source
    // agent_tool). The downstream unipile-search call is internal (service-role)
    // and is NOT re-gated there, so there is no double count.
    const quotaCheck = await checkLinkedInQuota(ctx.adminClient, ctx.userId, accountId, isInmail ? 'inmail' : 'message', { organizationId: ctx.organizationId, source: 'agent_tool' });
    if (!quotaCheck.allowed) {
      return { success: false, error: quotaCheck.reason };
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return { success: false, error: 'Supabase env not configured' };

    const body: Record<string, unknown> = {
      action: 'send_message',
      account_id: accountId,
      organization_id: ctx.organizationId,
      text,
    };
    if (chatId) body.chat_id = chatId;
    if (recipientId) body.recipient_id = recipientId;
    if (isInmail) {
      body.is_inmail = true;
      if (subject) body.subject = subject;
    }

    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/unipile-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok || data.success === false) {
        return { success: false, error: data.error || `LinkedIn send failed (HTTP ${response.status})` };
      }

      return {
        success: true,
        data: {
          message: chatId
            ? 'Message envoyé dans la conversation existante.'
            : isInmail
            ? 'InMail envoyé.'
            : 'Message LinkedIn envoyé (nouvelle conversation créée).',
          quota_after: {
            count_today: quotaCheck.count_today + 1,
            max_per_day: quotaCheck.max_per_day,
          },
          unipile_response: data,
        },
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error during LinkedIn send' };
    }
  },
};

// ─── Tool 14 — pause_sequence ───────────────────────────────────────────────
// Met en pause une séquence outreach (is_active=false). Les steps en attente
// restent dans sequence_step_executions mais le cron skip les enrollments
// quand is_active=false.

const pauseSequence: AgentTool = {
  name: 'pause_sequence',
  description:
    "Pause an outreach sequence (stops all enrolled candidates from progressing). " +
    "Use this when the user says 'mets en pause la séquence X', 'arrête temporairement Y'. " +
    "Reversible via `resume_sequence`. The enrolled candidates and their progress are preserved. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      sequence_id: {
        type: 'string',
        description: 'The outreach_sequences UUID to pause.',
      },
    },
    required: ['sequence_id'],
  },

  async verifyAccess(params, ctx) {
    const sequenceId = String(params.sequence_id || '');
    if (!sequenceId) return { allowed: false, reason: 'sequence_id is required' };

    const { data: seq } = await ctx.adminClient
      .from('outreach_sequences')
      .select('id, organization_id, is_active')
      .eq('id', sequenceId)
      .maybeSingle();
    if (!seq) return { allowed: false, reason: `Séquence ${sequenceId} introuvable` };
    if (seq.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette séquence appartient à une autre organisation' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const sequenceId = String(params.sequence_id);
    const [{ data: seq }, { count: activeEnrollments }] = await Promise.all([
      ctx.adminClient
        .from('outreach_sequences')
        .select('name, is_active, project_id')
        .eq('id', sequenceId)
        .maybeSingle(),
      ctx.adminClient
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .in('status', ['active', 'pending']),
    ]);

    const seqName = seq?.name || sequenceId;
    const isNoOp = seq?.is_active === false;

    return {
      summary: isNoOp
        ? `La séquence "${seqName}" est déjà en pause`
        : `Mettre en pause la séquence "${seqName}" (${activeEnrollments ?? 0} candidats actifs gelés)`,
      details: {
        sequence_id: sequenceId,
        sequence_name: seqName,
        from_is_active: seq?.is_active ?? null,
        to_is_active: false,
        active_enrollments: activeEnrollments ?? 0,
        is_no_op: isNoOp,
      },
      warning: isNoOp ? 'Aucun changement.' : undefined,
    };
  },

  async execute(params, ctx) {
    const sequenceId = String(params.sequence_id);
    const { data, error } = await ctx.adminClient
      .from('outreach_sequences')
      .update({ is_active: false })
      .eq('id', sequenceId)
      .eq('organization_id', ctx.organizationId)
      .select('id, is_active, updated_at')
      .single();
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: {
        sequence_id: data.id,
        is_active: data.is_active,
        updated_at: data.updated_at,
        message: 'Séquence en pause. Les candidats inscrits ne progresseront plus jusqu\'à la reprise.',
      },
    };
  },
};

// ─── Tool 15 — resume_sequence ──────────────────────────────────────────────
// Réactive une séquence pausée (is_active=true).

const resumeSequence: AgentTool = {
  name: 'resume_sequence',
  description:
    "Resume a paused outreach sequence — enrolled candidates start progressing again on the next cron tick. " +
    "Use this when the user says 'relance la séquence X', 'réactive Y'. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      sequence_id: {
        type: 'string',
        description: 'The outreach_sequences UUID to resume.',
      },
    },
    required: ['sequence_id'],
  },

  async verifyAccess(params, ctx) {
    const sequenceId = String(params.sequence_id || '');
    if (!sequenceId) return { allowed: false, reason: 'sequence_id is required' };
    const { data: seq } = await ctx.adminClient
      .from('outreach_sequences')
      .select('id, organization_id')
      .eq('id', sequenceId)
      .maybeSingle();
    if (!seq) return { allowed: false, reason: `Séquence ${sequenceId} introuvable` };
    if (seq.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette séquence appartient à une autre organisation' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const sequenceId = String(params.sequence_id);
    const [{ data: seq }, { count: enrollments }] = await Promise.all([
      ctx.adminClient
        .from('outreach_sequences')
        .select('name, is_active')
        .eq('id', sequenceId)
        .maybeSingle(),
      ctx.adminClient
        .from('sequence_enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('sequence_id', sequenceId)
        .in('status', ['active', 'pending']),
    ]);

    const seqName = seq?.name || sequenceId;
    const isNoOp = seq?.is_active === true;

    return {
      summary: isNoOp
        ? `La séquence "${seqName}" est déjà active`
        : `Réactiver la séquence "${seqName}" (${enrollments ?? 0} candidats reprendront leur progression)`,
      details: {
        sequence_id: sequenceId,
        sequence_name: seqName,
        from_is_active: seq?.is_active ?? null,
        to_is_active: true,
        enrollments_to_resume: enrollments ?? 0,
        is_no_op: isNoOp,
      },
      warning: isNoOp ? 'Aucun changement.' : undefined,
    };
  },

  async execute(params, ctx) {
    const sequenceId = String(params.sequence_id);
    const { data, error } = await ctx.adminClient
      .from('outreach_sequences')
      .update({ is_active: true })
      .eq('id', sequenceId)
      .eq('organization_id', ctx.organizationId)
      .select('id, is_active, updated_at')
      .single();
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      data: {
        sequence_id: data.id,
        is_active: data.is_active,
        updated_at: data.updated_at,
        message: 'Séquence réactivée. La progression reprendra au prochain tick du cron (toutes les minutes en business hours).',
      },
    };
  },
};

// ─── Tool 16 — invite_team_member ───────────────────────────────────────────
// Crée une invitation dans organization_invitations (email + role + token) PUIS
// envoie l'email d'invitation via send-transactional-email (service-role) —
// même pipeline que l'edge send-team-invitation utilisée par Settings → Team.
// send-team-invitation n'est pas appelable en Mode B (elle exige un JWT user
// via auth.getUser()), d'où la réplication de son envoi ici. Si une invitation
// pending existe déjà pour l'email, elle est réutilisée et l'email renvoyé.

const ALLOWED_INVITE_ROLES = ['admin', 'collaborator'] as const;
type InviteRole = (typeof ALLOWED_INVITE_ROLES)[number];

const inviteTeamMember: AgentTool = {
  name: 'invite_team_member',
  description:
    "Invite a new member to the user's organization by email. " +
    "Use this when the user says 'invite x@y.fr en collaborateur', 'ajoute Marie à mon équipe'. " +
    "Creates an invitation row (expires in 7 days) and immediately sends the invitation email (same pipeline as Settings → Team). " +
    "If a pending invitation already exists for this email, it is reused (original role kept) and the email is re-sent. " +
    "Only `admin` and `collaborator` roles allowed via the copilot — to grant `owner`, use the Settings → Team UI. " +
    "The caller must be admin or owner of the org. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: "Email address of the person to invite. Lowercased and trimmed before insert.",
      },
      role: {
        type: 'string',
        enum: ALLOWED_INVITE_ROLES as unknown as string[],
        description: "Role to grant on acceptance. One of: admin, collaborator. Default: collaborator.",
      },
    },
    required: ['email'],
  },

  async verifyAccess(params, ctx) {
    const email = String(params.email || '').trim().toLowerCase();
    const role = (params.role ? String(params.role) : 'collaborator') as InviteRole;
    if (!email) return { allowed: false, reason: 'email is required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { allowed: false, reason: `Email invalide : "${email}"` };
    }
    if (!(ALLOWED_INVITE_ROLES as readonly string[]).includes(role)) {
      return { allowed: false, reason: `role must be one of: ${ALLOWED_INVITE_ROLES.join(', ')}` };
    }

    // Caller must be admin or owner of the org
    const { data: callerRole } = await ctx.adminClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', ctx.organizationId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (!callerRole) return { allowed: false, reason: "Vous n'êtes pas membre de cette organisation." };
    if (callerRole.role !== 'admin' && callerRole.role !== 'owner') {
      return { allowed: false, reason: `Seuls les admins et owners peuvent inviter (votre rôle: ${callerRole.role}).` };
    }

    // Email must not already be a member (best-effort via profiles)
    const { data: existing } = await ctx.adminClient
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      const { data: alreadyMember } = await ctx.adminClient
        .from('organization_members')
        .select('id')
        .eq('organization_id', ctx.organizationId)
        .eq('user_id', existing.id)
        .maybeSingle();
      if (alreadyMember) {
        return { allowed: false, reason: `${email} est déjà membre de l'organisation.` };
      }
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const email = String(params.email || '').trim().toLowerCase();
    const role = (params.role ? String(params.role) : 'collaborator') as InviteRole;

    const { data: org } = await ctx.adminClient
      .from('organizations')
      .select('name')
      .eq('id', ctx.organizationId)
      .maybeSingle();

    // Check for pending invitation to same email
    const { data: pending } = await ctx.adminClient
      .from('organization_invitations')
      .select('id, created_at, expires_at, status')
      .eq('organization_id', ctx.organizationId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    return {
      summary: pending
        ? `Renvoyer l'email d'invitation à ${email} pour "${org?.name || 'votre organisation'}" (invitation en attente existante)`
        : `Inviter ${email} dans "${org?.name || 'votre organisation'}" en tant que ${role} — l'email d'invitation partira immédiatement`,
      details: {
        email,
        role,
        organization_id: ctx.organizationId,
        organization_name: org?.name ?? null,
        sends_email: true,
        has_pending_invitation: !!pending,
        existing_invitation_id: pending?.id ?? null,
        existing_expires_at: pending?.expires_at ?? null,
      },
      warning: pending
        ? `Une invitation pending existe déjà pour cet email (créée le ${pending.created_at}). Confirmer renverra l'email pour cette invitation existante (son rôle d'origine est conservé, pas de doublon créé).`
        : undefined,
    };
  },

  async execute(params, ctx) {
    const email = String(params.email).trim().toLowerCase();
    const role = (params.role ? String(params.role) : 'collaborator') as InviteRole;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return { success: false, error: 'Supabase env not configured' };

    // Réutilise l'invitation pending existante (même comportement que
    // send-team-invitation) — évite le doublon et le 23505 sur l'unique index.
    const { data: existing } = await ctx.adminClient
      .from('organization_invitations')
      .select('id, expires_at')
      .eq('organization_id', ctx.organizationId)
      .eq('email', email)
      .eq('status', 'pending')
      .maybeSingle();

    let invitationId = existing?.id as string | undefined;
    let expiresAt = (existing?.expires_at as string | undefined) ?? null;
    const isResend = !!existing;

    if (!invitationId) {
      // Token hex 64 chars (256 bits) — même format que send-team-invitation
      const tokenBytes = new Uint8Array(32);
      crypto.getRandomValues(tokenBytes);
      const token = Array.from(tokenBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await ctx.adminClient
        .from('organization_invitations')
        .insert({
          organization_id: ctx.organizationId,
          email,
          role,
          token,
          status: 'pending',
          invited_by: ctx.userId,
          expires_at: newExpiresAt,
        })
        .select('id, expires_at')
        .single();
      if (error) {
        if (error.code === '23505') {
          return { success: false, error: `Une invitation est déjà en cours pour ${email}.` };
        }
        return { success: false, error: error.message };
      }
      invitationId = data.id;
      expiresAt = data.expires_at;
    }

    // Envoi de l'email — réplique du pipeline send-team-invitation (non
    // appelable en Mode B : elle exige un JWT user). send-transactional-email,
    // elle, accepte la service-role (c'est déjà ainsi qu'elle est appelée).
    const { data: org } = await ctx.adminClient
      .from('organizations')
      .select('name')
      .eq('id', ctx.organizationId)
      .maybeSingle();
    const { data: inviterProfile } = await ctx.adminClient
      .from('profiles')
      .select('display_name, email')
      .eq('user_id', ctx.userId)
      .maybeSingle();

    const appOrigin = Deno.env.get('APP_URL') || 'https://konekt-app-navy.vercel.app';
    const orgNameParam = org?.name ? `&org=${encodeURIComponent(org.name)}` : '';
    const inviteUrl = `${appOrigin}/auth?invitation=${invitationId}&email=${encodeURIComponent(email)}${orgNameParam}`;
    // Sur une invitation réutilisée, la clé "team-invite-{id}" a déjà été
    // consommée par l'envoi initial → clé resend unique pour que l'email reparte.
    const idempotencyKey = isResend
      ? `team-invite-resend-${invitationId}-${Date.now()}`
      : `team-invite-${invitationId}`;

    let emailError: string | null = null;
    try {
      const emailResponse = await fetchWithTimeout(`${supabaseUrl}/functions/v1/send-transactional-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
        },
        body: JSON.stringify({
          templateName: 'team-invitation',
          recipientEmail: email,
          idempotencyKey,
          templateData: {
            organizationName: org?.name || 'votre équipe',
            inviterName: inviterProfile?.display_name || inviterProfile?.email || 'Un membre de votre équipe',
            role,
            inviteUrl,
          },
        }),
      });
      if (!emailResponse.ok) {
        emailError = `HTTP ${emailResponse.status}`;
        try {
          const payload = await emailResponse.json();
          const baseErr = payload?.error || payload?.message || emailError;
          emailError = payload?.details ? `${baseErr} (${payload.details})` : String(baseErr);
        } catch { /* body non-JSON — on garde le status HTTP */ }
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'erreur réseau';
    }

    if (emailError) {
      return {
        success: false,
        error: `Invitation créée (visible dans Settings → Équipe) mais l'email n'est pas parti : ${emailError}. Renvoyez-la depuis Settings → Équipe.`,
      };
    }

    return {
      success: true,
      data: {
        invitation_id: invitationId,
        email,
        role,
        expires_at: expiresAt,
        resent: isResend,
        message: isResend
          ? `Email d'invitation renvoyé à ${email} (invitation pending existante réutilisée, rôle d'origine conservé).`
          : `Invitation créée et email envoyé à ${email}. Elle expire dans 7 jours et reste visible dans Settings → Équipe.`,
      },
    };
  },
};

// ─── Tool 17 — update_member_quota ──────────────────────────────────────────
// Modifie les quotas LinkedIn (member_quotas) d'un membre de l'équipe :
// max_actions_per_day, business_hours_start/end, timezone. Utile pour
// rééquilibrer la charge entre Konekt (matin) et leadmagnet (après-midi)
// ou pour caper temporairement un collaborateur. Réservé admin/owner.

const updateMemberQuota: AgentTool = {
  name: 'update_member_quota',
  description:
    "Update a team member's LinkedIn safety quotas (max actions per day, business hours, timezone). " +
    "Use this when the user says 'augmente le cap LinkedIn de X à 100/jour', 'mets Marie en 9h-17h', 'réduis le quota de Théo'. " +
    "Caller must be admin or owner. UPSERTs the member_quotas row (creates if missing). " +
    "max_actions_per_day affects all LinkedIn outbound actions (messages, invitations, InMails) — keep ≤ 100 to respect LinkedIn auto-flag thresholds. " +
    "business_hours_start/end are integer hours 0-23 (e.g. 8=8h00, 19=19h00). Action emitted outside this range is auto-rescheduled. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      target_user_id: {
        type: 'string',
        description: 'UUID of the team member whose quotas are being modified. Use `get_team_overview` first to fetch valid IDs.',
      },
      max_actions_per_day: {
        type: 'integer',
        description: 'Daily cap of visible LinkedIn actions. Soft-bound: keep ≤ 100 to stay under LinkedIn flagging thresholds.',
      },
      business_hours_start: {
        type: 'integer',
        description: 'Start hour (0-23). Actions before this hour are deferred.',
      },
      business_hours_end: {
        type: 'integer',
        description: 'End hour (0-23). Actions after this hour are deferred.',
      },
      timezone: {
        type: 'string',
        description: "IANA timezone string (e.g. 'Europe/Paris', 'America/New_York').",
      },
    },
    required: ['target_user_id'],
  },

  async verifyAccess(params, ctx) {
    const targetUserId = String(params.target_user_id || '');
    if (!targetUserId) return { allowed: false, reason: 'target_user_id is required' };

    // Validate field bounds
    const max = params.max_actions_per_day;
    if (max !== undefined && (typeof max !== 'number' || max < 1 || max > 500)) {
      return { allowed: false, reason: 'max_actions_per_day must be an integer between 1 and 500' };
    }
    const bhStart = params.business_hours_start;
    const bhEnd = params.business_hours_end;
    if (bhStart !== undefined && (typeof bhStart !== 'number' || bhStart < 0 || bhStart > 23)) {
      return { allowed: false, reason: 'business_hours_start must be 0-23' };
    }
    if (bhEnd !== undefined && (typeof bhEnd !== 'number' || bhEnd < 0 || bhEnd > 23)) {
      return { allowed: false, reason: 'business_hours_end must be 0-23' };
    }
    if (bhStart !== undefined && bhEnd !== undefined && (bhStart as number) >= (bhEnd as number)) {
      return { allowed: false, reason: 'business_hours_start must be strictly less than business_hours_end' };
    }
    if (params.timezone !== undefined && typeof params.timezone === 'string') {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: params.timezone });
      } catch {
        return { allowed: false, reason: `Invalid timezone: "${params.timezone}"` };
      }
    }

    // Caller must be admin or owner
    const { data: callerRole } = await ctx.adminClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', ctx.organizationId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    if (!callerRole) return { allowed: false, reason: "Vous n'êtes pas membre de cette organisation." };
    if (callerRole.role !== 'admin' && callerRole.role !== 'owner') {
      return { allowed: false, reason: `Seuls les admins et owners peuvent modifier les quotas (votre rôle: ${callerRole.role}).` };
    }

    // Target must be a member of the same org
    const { data: targetMember } = await ctx.adminClient
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', ctx.organizationId)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (!targetMember) {
      return { allowed: false, reason: `L'utilisateur ${targetUserId} n'est pas membre de votre organisation.` };
    }

    // At least one field to update
    const hasUpdate = ['max_actions_per_day', 'business_hours_start', 'business_hours_end', 'timezone'].some(
      (k) => params[k] !== undefined,
    );
    if (!hasUpdate) {
      return { allowed: false, reason: 'Au moins un champ à modifier doit être fourni.' };
    }

    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const targetUserId = String(params.target_user_id);

    const [{ data: profile }, { data: current }] = await Promise.all([
      ctx.adminClient
        .from('profiles')
        .select('full_name, email')
        .eq('id', targetUserId)
        .maybeSingle(),
      ctx.adminClient
        .from('member_quotas')
        .select('max_actions_per_day, business_hours_start, business_hours_end, timezone')
        .eq('user_id', targetUserId)
        .maybeSingle(),
    ]);

    const memberLabel = profile?.full_name || profile?.email || targetUserId;
    const diff: Array<{ field: string; from: unknown; to: unknown }> = [];
    const fields = ['max_actions_per_day', 'business_hours_start', 'business_hours_end', 'timezone'] as const;
    for (const f of fields) {
      if (params[f] !== undefined) {
        diff.push({ field: f, from: current?.[f] ?? null, to: params[f] });
      }
    }

    return {
      summary: `Mettre à jour les quotas LinkedIn de ${memberLabel} — ${diff.map((d) => d.field).join(', ')}`,
      details: {
        target_user_id: targetUserId,
        target_name: profile?.full_name ?? null,
        target_email: profile?.email ?? null,
        had_existing_row: !!current,
        diff,
      },
      warning: typeof params.max_actions_per_day === 'number' && params.max_actions_per_day > 100
        ? `⚠️ max_actions_per_day > 100 augmente le risque de flag LinkedIn (warning #260513-007211). Préfère ≤ 100.`
        : undefined,
    };
  },

  async execute(params, ctx) {
    const targetUserId = String(params.target_user_id);

    // Build update payload (only the fields explicitly provided)
    const updates: Record<string, unknown> = {};
    for (const k of ['max_actions_per_day', 'business_hours_start', 'business_hours_end', 'timezone'] as const) {
      if (params[k] !== undefined) updates[k] = params[k];
    }

    // Check if row exists → UPDATE, else INSERT (we need org_id on insert)
    const { data: existing } = await ctx.adminClient
      .from('member_quotas')
      .select('id')
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (existing) {
      const { data, error } = await ctx.adminClient
        .from('member_quotas')
        .update(updates)
        .eq('id', existing.id)
        .select('id, max_actions_per_day, business_hours_start, business_hours_end, timezone, updated_at')
        .single();
      if (error) return { success: false, error: error.message };
      return {
        success: true,
        data: {
          quota_id: data.id,
          action: 'updated',
          max_actions_per_day: data.max_actions_per_day,
          business_hours_start: data.business_hours_start,
          business_hours_end: data.business_hours_end,
          timezone: data.timezone,
          updated_at: data.updated_at,
        },
      };
    }

    const { data, error } = await ctx.adminClient
      .from('member_quotas')
      .insert({
        user_id: targetUserId,
        organization_id: ctx.organizationId,
        ...updates,
      })
      .select('id, max_actions_per_day, business_hours_start, business_hours_end, timezone, created_at')
      .single();
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        quota_id: data.id,
        action: 'created',
        max_actions_per_day: data.max_actions_per_day,
        business_hours_start: data.business_hours_start,
        business_hours_end: data.business_hours_end,
        timezone: data.timezone,
        created_at: data.created_at,
      },
    };
  },
};

// ─── Tool 18 — apply_search_filters_to_mission ──────────────────────────────
// Push les filtres LinkedIn calibrés par le copilot directement dans
// sourcing_projects.filters_snapshot. Différent de regenerate_search_filters
// (qui re-prompt Claude à partir du brief sans input user) : ici l'agent passe
// explicitement les filtres convenus avec l'utilisateur en chat (rôle, skills,
// localisation, séniorité, exclusions).
//
// Format attendu = AI format reconnu par useLinkedInSearch (lignes 302-306) :
//   - keywords (Boolean string)
//   - role[] : [{ keywords: string, ... }]
//   - skills_keywords[] : ['Kubernetes', 'Python', ...]
//   - location_keywords[] : ['Paris', 'Île-de-France', ...]
//   - years_of_experience_min / years_of_experience_max
//   - api : 'recruiter' | 'classic' | 'sales_navigator' (défaut: recruiter)
// Le hook front detecte l'AI format au reload et transforme en UI state.

const applySearchFiltersToMission: AgentTool = {
  name: 'apply_search_filters_to_mission',
  description:
    "Push search filters calibrated WITH the user during chat directly into the mission's filters_snapshot. " +
    "Use this after a calibration conversation when the user agreed on titles, skills, location, seniority, exclusions — " +
    "you then push these filters into the live mission so the LinkedIn search panel reflects them on next reload. " +
    "Different from `regenerate_search_filters` (which re-prompts an AI based on the brief alone without user calibration). " +
    "Pass the filters in AI format : { keywords, role[], skills_keywords[], location_keywords[], years_of_experience_min/max, api }. " +
    "Always proposes the change for user approval — never executes silently. " +
    "After execution, prompt the user to reload the Sourcing page to see the filters applied (no auto-reload yet).",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The sourcing_projects (mission) UUID.',
      },
      filters: {
        type: 'object',
        description:
          "Filters object in AI format (recognised by useLinkedInSearch). Common fields: " +
          "`keywords` (Boolean string, e.g. 'Kubernetes AND (MLflow OR Airflow)'), " +
          "`role` (array of {keywords: string}, e.g. [{keywords:'Data Engineer OR MLOps Engineer'}]), " +
          "`skills_keywords` (string[], e.g. ['Kubernetes','Python','Terraform']), " +
          "`location_keywords` (string[], e.g. ['Île-de-France','Paris']), " +
          "`years_of_experience_min`, `years_of_experience_max` (numbers), " +
          "`api` ('recruiter' | 'classic' | 'sales_navigator', default 'recruiter'). " +
          "You can include any extra hints (suggestions[], notes) — they're persisted alongside.",
        additionalProperties: true,
      },
      replace: {
        type: 'boolean',
        description: "If true, REPLACES the existing filters_snapshot entirely. If false (default), MERGES (existing fields are kept unless overwritten by the new payload).",
      },
    },
    required: ['job_id', 'filters'],
  },

  async verifyAccess(params, ctx) {
    const jobId = String(params.job_id || '');
    if (!jobId) return { allowed: false, reason: 'job_id is required' };

    const filters = params.filters && typeof params.filters === 'object' ? params.filters as Record<string, unknown> : null;
    if (!filters || Object.keys(filters).length === 0) {
      return { allowed: false, reason: 'filters must be a non-empty object' };
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
    const filters = params.filters as Record<string, unknown>;
    const replace = params.replace === true;

    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name, job_title, client_name, filters_snapshot')
      .eq('id', jobId)
      .maybeSingle();

    const jobLabel = project?.job_title || project?.name || jobId;
    const hadExisting = !!(project?.filters_snapshot && Object.keys(project.filters_snapshot as Record<string, unknown>).length > 0);

    // Build a concise preview of what's being pushed
    const preview: Record<string, unknown> = {};
    if (filters.role) preview.role = filters.role;
    if (filters.skills_keywords) preview.skills_keywords = filters.skills_keywords;
    if (filters.location_keywords) preview.location_keywords = filters.location_keywords;
    if (filters.years_of_experience_min !== undefined) preview.years_of_experience_min = filters.years_of_experience_min;
    if (filters.years_of_experience_max !== undefined) preview.years_of_experience_max = filters.years_of_experience_max;
    if (filters.keywords) preview.keywords_excerpt = String(filters.keywords).slice(0, 120) + (String(filters.keywords).length > 120 ? '…' : '');

    return {
      summary: `Pousser ${Object.keys(filters).length} champs de filtres LinkedIn vers la mission "${jobLabel}" (${replace ? 'remplace' : 'fusionne'} avec les filtres actuels)`,
      details: {
        job_id: jobId,
        job_label: jobLabel,
        client_label: project?.client_name ?? null,
        had_existing_filters: hadExisting,
        mode: replace ? 'replace' : 'merge',
        preview,
        full_payload: filters,
      },
      warning: hadExisting && replace
        ? "Mode 'replace' : les filtres actuels seront entièrement écrasés (tweaks manuels perdus)."
        : undefined,
    };
  },

  async execute(params, ctx) {
    const jobId = String(params.job_id);
    const filters = params.filters as Record<string, unknown>;
    const replace = params.replace === true;

    let merged: Record<string, unknown>;
    if (replace) {
      merged = { ...filters, generated_at: new Date().toISOString() };
    } else {
      const { data: project, error: fetchError } = await ctx.adminClient
        .from('sourcing_projects')
        .select('filters_snapshot')
        .eq('id', jobId)
        .eq('organization_id', ctx.organizationId)
        .single();
      if (fetchError) return { success: false, error: fetchError.message };
      const current = (project.filters_snapshot as Record<string, unknown> | null) ?? {};
      merged = { ...current, ...filters, generated_at: new Date().toISOString() };
    }

    const { data, error } = await ctx.adminClient
      .from('sourcing_projects')
      .update({ filters_snapshot: merged })
      .eq('id', jobId)
      .eq('organization_id', ctx.organizationId)
      .select('id, updated_at')
      .single();
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        mission_id: data.id,
        updated_at: data.updated_at,
        fields_pushed: Object.keys(filters),
        message:
          "Filtres appliqués sur la mission. Si tu es déjà sur l'onglet Sourcing de cette mission, rafraîchis la page pour les voir charger automatiquement dans le panneau de recherche LinkedIn.",
      },
    };
  },
};

// ─── Tool — schedule_interview ──────────────────────────────────────────────
// Programme un entretien / une session de qualification dans le calendrier
// interne (table qualification_sessions — même insert que CreateEventModal).
// P0.3 audit 2026-07-14 : le label UI existait déjà, le tool manquait.

interface ResolvedInterviewCandidate {
  candidateId: string | null;
  candidateName: string;
  candidateHeadline: string | null;
  inPipeline: boolean;
}

async function resolveInterviewCandidate(
  ctx: ToolContext,
  params: Record<string, unknown>,
): Promise<ResolvedInterviewCandidate> {
  const explicitId = String(params.candidate_id || '').trim();
  const name = String(params.candidate_name || '').trim();

  if (explicitId) {
    const { data } = await ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_id, candidate_name, candidate_headline')
      .eq('organization_id', ctx.organizationId)
      .eq('candidate_id', explicitId)
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        candidateId: data.candidate_id,
        candidateName: data.candidate_name || name || explicitId,
        candidateHeadline: data.candidate_headline ?? null,
        inPipeline: true,
      };
    }
  }
  if (name) {
    const { data } = await ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_id, candidate_name, candidate_headline')
      .eq('organization_id', ctx.organizationId)
      .ilike('candidate_name', `%${name.slice(0, 80)}%`)
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        candidateId: data.candidate_id,
        candidateName: data.candidate_name || name,
        candidateHeadline: data.candidate_headline ?? null,
        inPipeline: true,
      };
    }
  }
  return { candidateId: explicitId || null, candidateName: name || explicitId, candidateHeadline: null, inPipeline: false };
}

async function resolveInterviewMission(
  ctx: ToolContext,
  params: Record<string, unknown>,
): Promise<{ id: string; name: string | null; job_title: string | null; client_name: string | null; job_id: string | null } | null> {
  const missionId = String(params.mission_id || '').trim();
  const missionName = String(params.mission_name || '').trim();
  if (!missionId && !missionName) return null;
  let q = ctx.adminClient
    .from('sourcing_projects')
    .select('id, name, job_title, client_name, job_id')
    .eq('organization_id', ctx.organizationId);
  q = missionId ? q.eq('id', missionId) : q.ilike('name', `%${missionName.slice(0, 80)}%`);
  const { data } = await q.limit(1).maybeSingle();
  return (data as { id: string; name: string | null; job_title: string | null; client_name: string | null; job_id: string | null } | null) ?? null;
}

function parseInterviewSlot(params: Record<string, unknown>): { startAt: Date; endAt: Date; duration: number } | { error: string } {
  const startMs = Date.parse(String(params.start_at || ''));
  if (Number.isNaN(startMs)) return { error: "start_at invalide — attendu un datetime ISO 8601 (ex : 2026-07-16T14:00:00+02:00)" };
  if (startMs < Date.now() - 5 * 60_000) return { error: 'start_at est dans le passé' };
  const duration = Math.min(Math.max(Math.round(Number(params.duration_minutes) || 45), 15), 240);
  const startAt = new Date(startMs);
  return { startAt, endAt: new Date(startMs + duration * 60_000), duration };
}

const frDate = (d: Date) =>
  d.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' });

const scheduleInterview: AgentTool = {
  name: 'schedule_interview',
  description:
    "Schedule an interview / qualification session with a candidate in the Konekt calendar (visible in /calendar and via get_upcoming_interviews). " +
    "Use when the user says 'programme un entretien avec X', 'cale un call avec Marie jeudi 14h', 'planifie la pré-qualif de Théo'. " +
    "Pass start_at as full ISO 8601 datetime WITH timezone (Europe/Paris for French users). Default duration: 45 min. " +
    "Optional mission_id/mission_name links the interview to a mission (recommended when known). " +
    "This creates the calendar slot in Konekt only — it does NOT send any invitation email to the candidate. " +
    "Always proposes the change for user approval — never executes silently.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      candidate_name: { type: 'string', description: "Full name of the candidate (ex : 'Marie Dupont')." },
      candidate_id: { type: 'string', description: "Optional stable candidate id (LinkedIn provider_id 'ACoAA…') if known from a read tool. Never invent it." },
      start_at: { type: 'string', description: "Interview start — ISO 8601 datetime with timezone (ex : '2026-07-16T14:00:00+02:00'). Must be in the future." },
      duration_minutes: { type: 'number', description: 'Duration in minutes (default 45, min 15, max 240).' },
      event_name: { type: 'string', description: "Optional title (default : 'Entretien — {candidate}')." },
      location: { type: 'string', description: "Optional location : visio link, phone, address." },
      mission_id: { type: 'string', description: 'Optional mission UUID to attach the interview to.' },
      mission_name: { type: 'string', description: 'Optional mission name (resolved server-side) if the UUID is unknown.' },
      notes: { type: 'string', description: 'Optional prep notes (free text, max 2000 chars).' },
    },
    required: ['candidate_name', 'start_at'],
  },

  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    if (!String(params.candidate_name || '').trim()) return { allowed: false, reason: 'candidate_name is required' };
    const slot = parseInterviewSlot(params);
    if ('error' in slot) return { allowed: false, reason: slot.error };
    if ((params.mission_id || params.mission_name) && !(await resolveInterviewMission(ctx, params))) {
      return { allowed: false, reason: 'Mission introuvable dans cette organisation' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const slot = parseInterviewSlot(params);
    if ('error' in slot) throw new Error(slot.error);
    const [candidate, mission] = await Promise.all([
      resolveInterviewCandidate(ctx, params),
      resolveInterviewMission(ctx, params),
    ]);
    const eventName = String(params.event_name || '').trim() || `Entretien — ${candidate.candidateName}`;
    const missionLabel = mission ? (mission.name || mission.job_title || mission.id) : null;
    return {
      summary: `Programmer « ${eventName} » avec ${candidate.candidateName} le ${frDate(slot.startAt)} (${slot.duration} min)`,
      details: {
        candidate_name: candidate.candidateName,
        candidate_in_pipeline: candidate.inPipeline,
        event_name: eventName,
        start_at: slot.startAt.toISOString(),
        end_at: slot.endAt.toISOString(),
        duration_minutes: slot.duration,
        location: String(params.location || '').trim() || null,
        mission: missionLabel,
      },
      warning: candidate.inPipeline
        ? undefined
        : "Candidat introuvable dans le pipeline : l'entretien sera créé quand même, mais sans lien vers une card candidat.",
    };
  },

  async execute(params, ctx) {
    const slot = parseInterviewSlot(params);
    if ('error' in slot) return { success: false, error: slot.error };
    const [candidate, mission] = await Promise.all([
      resolveInterviewCandidate(ctx, params),
      resolveInterviewMission(ctx, params),
    ]);
    const eventName = String(params.event_name || '').trim() || `Entretien — ${candidate.candidateName}`;

    const insert: Record<string, unknown> = {
      organization_id: ctx.organizationId,
      created_by: ctx.userId,
      manager_id: ctx.userId,
      candidate_profile_id: candidate.candidateId || crypto.randomUUID(),
      candidate_name: candidate.candidateName,
      candidate_headline: candidate.candidateHeadline,
      event_name: eventName,
      event_start_at: slot.startAt.toISOString(),
      event_end_at: slot.endAt.toISOString(),
      event_location: String(params.location || '').trim() || null,
      notes: String(params.notes || '').trim().slice(0, 2000) || null,
      status: 'scheduled',
    };
    if (mission) {
      insert.project_id = mission.id;
      insert.client_name = mission.client_name || null;
      insert.job_title = mission.job_title || mission.name;
      if (mission.job_id) insert.job_id = mission.job_id;
    }

    const { data, error } = await ctx.adminClient
      .from('qualification_sessions')
      .insert(insert)
      .select('id')
      .single();
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      data: {
        session_id: data.id,
        start_at: slot.startAt.toISOString(),
        message: `Entretien programmé le ${frDate(slot.startAt)} (${slot.duration} min). Visible dans le calendrier Konekt. Aucune invitation n'a été envoyée au candidat.`,
      },
    };
  },
};

// ─── Tool — launch_search ───────────────────────────────────────────────────
// Pont chat → run-agent-search (P0.3 audit 2026-07-14). Avant ce tool, le
// [SEARCH_PLAN] validé laissait la conversation en status='plan_proposed'
// sans AUCUN déclencheur : la vraie recherche était inatteignable depuis le
// chat. Exécution fire-and-forget : run-agent-search tourne jusqu'à ~140s et
// poste sa progression dans agent_messages ; on ne bloque pas l'approbation.

const launchSearch: AgentTool = {
  name: 'launch_search',
  description:
    "Launch the REAL autonomous candidate search for this conversation's validated search plan (the [SEARCH_PLAN] you emitted earlier). " +
    "Use when the user confirms they want the autonomous agent to actually run ('lance la recherche', 'go', 'lance l'agent autonome'). " +
    "REQUIRES a search plan to already exist on this conversation — emit and validate the [SEARCH_PLAN] first. " +
    "The search runs in the background (a few minutes) : it queries LinkedIn with the plan's filters, scores each profile against the brief, " +
    "and adds the best matches to the mission pipeline. Progress messages appear in this conversation. " +
    "Costs AI credits (per-profile scoring) and uses the user's LinkedIn account. " +
    "Always proposes the launch for user approval — never executes silently.",
  category: 'mutation_external',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      confirm: {
        type: 'boolean',
        description: 'Set to true to confirm the launch of the autonomous search.',
      },
    },
    required: [],
  },

  async verifyAccess(_params, ctx) {
    if (!ctx.conversationId) {
      return { allowed: false, reason: "Aucune conversation active — le plan de recherche vit sur la conversation." };
    }
    const { data: conv } = await ctx.adminClient
      .from('agent_conversations')
      .select('organization_id, status, search_config')
      .eq('id', ctx.conversationId)
      .maybeSingle();
    if (!conv) return { allowed: false, reason: 'Conversation introuvable' };
    if (conv.organization_id && conv.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette conversation appartient à une autre organisation' };
    }
    const cfg = (conv.search_config as Record<string, unknown> | null) ?? null;
    if (!cfg || !cfg.filters) {
      return { allowed: false, reason: "Aucun plan de recherche sur cette conversation — génère et valide d'abord un [SEARCH_PLAN]." };
    }
    if (conv.status === 'running') {
      return { allowed: false, reason: 'Une recherche est déjà en cours sur cette conversation.' };
    }
    return { allowed: true };
  },

  async dryRun(_params, ctx) {
    const { data: conv } = await ctx.adminClient
      .from('agent_conversations')
      .select('search_config, job_title')
      .eq('id', ctx.conversationId as string)
      .maybeSingle();
    const cfg = ((conv?.search_config as Record<string, unknown> | null) ?? {});
    const summary = typeof cfg.summary === 'string' ? cfg.summary : null;
    const stop = (cfg.stop_conditions as Record<string, unknown> | null) ?? null;
    return {
      summary: `Lancer la recherche autonome${summary ? ` : ${summary.slice(0, 140)}` : ''}`,
      details: {
        plan_summary: summary,
        job_title: conv?.job_title ?? null,
        stop_conditions: stop,
        filter_keys: Object.keys((cfg.filters as Record<string, unknown> | null) ?? {}),
      },
      warning:
        "Consomme des crédits IA (scoring de chaque profil trouvé) et utilise ton compte LinkedIn pour la recherche. Durée : quelques minutes, progression affichée dans la conversation.",
    };
  },

  async execute(_params, ctx) {
    if (!ctx.conversationId) {
      return { success: false, error: 'Aucune conversation active pour cette exécution.' };
    }
    if (!ctx.userBearer) {
      // Chemin cron (process-scheduled-actions) : pas de JWT user disponible.
      // launch_search ne programme jamais de scheduled_for, donc ce cas ne
      // devrait pas arriver — garde-fou explicite plutôt qu'un 401 opaque.
      return { success: false, error: "Lancement impossible hors session utilisateur (JWT absent). Relance depuis le chat." };
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Fire-and-forget : run-agent-search tourne ~2 min et poste sa progression
    // dans agent_messages. waitUntil garde l'invocation vivante côté runtime.
    const searchPromise = fetchWithTimeout(
      `${supabaseUrl}/functions/v1/run-agent-search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.userBearer}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ conversation_id: ctx.conversationId }),
      },
      150_000,
    ).then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[launch_search] run-agent-search ${res.status}: ${body.slice(0, 300)}`);
      }
    }).catch((e) => console.error('[launch_search] run-agent-search failed:', e));
    try {
      (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(searchPromise);
    } catch { /* no-op */ }

    return {
      success: true,
      data: {
        conversation_id: ctx.conversationId,
        message:
          'Recherche autonome lancée. La progression et les candidats trouvés arrivent dans cette conversation (et dans le pipeline de la mission) dans les prochaines minutes.',
      },
    };
  },
};

// ─── Tools bulk — bulk_update_stage / bulk_dismiss (P2.2 audit 2026-07-14) ──
// Actions multi-candidats (max 50) sur UNE mission. Le dry-run liste CHAQUE
// candidat par son nom pour que l'utilisateur voie exactement ce qui va être
// modifié avant d'approuver. Ne crée jamais de rows : les candidats absents
// de job_candidate_status pour cette mission sont ignorés et signalés.

const BULK_MAX = 50;

interface BulkTarget {
  candidate_id: string;
  candidate_name: string | null;
  current: string | null;
}

async function resolveBulkTargets(
  ctx: ToolContext,
  jobId: string,
  candidateIds: string[],
  field: 'pipeline_stage' | 'status',
): Promise<{ found: BulkTarget[]; missing: string[] }> {
  const { data } = await ctx.adminClient
    .from('job_candidate_status')
    .select(`candidate_id, candidate_name, ${field}`)
    .eq('organization_id', ctx.organizationId)
    .eq('job_id', jobId)
    .in('candidate_id', candidateIds);
  const rows = (data as Array<Record<string, any>> | null) ?? [];
  const foundIds = new Set(rows.map((r) => r.candidate_id));
  return {
    found: rows.map((r) => ({
      candidate_id: r.candidate_id,
      candidate_name: r.candidate_name ?? null,
      current: r[field] ?? null,
    })),
    missing: candidateIds.filter((id) => !foundIds.has(id)),
  };
}

function parseBulkIds(params: Record<string, unknown>): string[] {
  const raw = Array.isArray(params.candidate_ids) ? params.candidate_ids : [];
  return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, BULK_MAX);
}

const bulkUpdateStage: AgentTool = {
  name: 'bulk_update_stage',
  description:
    "Move SEVERAL candidates (2-50) of one mission to a new pipeline stage in a single action. " +
    "Use when the user says 'passe ces 5 candidats en Pressenti', 'déplace tous ceux que je t'ai listés en Contacté'. " +
    "Resolve candidate_ids first via get_mission_candidates — never invent them. " +
    "The approval preview lists every candidate by name. Candidates not in the mission pipeline are skipped and reported. " +
    "For ONE candidate, use update_candidate_stage instead.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The mission id (same as used by get_mission_candidates / update_candidate_stage).' },
      candidate_ids: {
        type: 'array',
        items: { type: 'string' },
        description: `Candidate ids (2-${BULK_MAX}), from get_mission_candidates. Never invented.`,
      },
      new_stage: {
        type: 'string',
        enum: ALLOWED_STAGES as unknown as string[],
        description: 'Target pipeline stage.',
      },
      reason: { type: 'string', description: 'Optional reason (logged).' },
    },
    required: ['job_id', 'candidate_ids', 'new_stage'],
  },
  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    const ids = parseBulkIds(params);
    if (ids.length < 2) return { allowed: false, reason: `candidate_ids doit contenir entre 2 et ${BULK_MAX} candidats (pour un seul : update_candidate_stage)` };
    if (!String(params.job_id || '').trim()) return { allowed: false, reason: 'job_id is required' };
    const stage = String(params.new_stage || '');
    if (!(ALLOWED_STAGES as readonly string[]).includes(stage)) {
      return { allowed: false, reason: `new_stage must be one of: ${ALLOWED_STAGES.join(', ')}` };
    }
    return { allowed: true };
  },
  async dryRun(params, ctx) {
    const ids = parseBulkIds(params);
    const jobId = String(params.job_id);
    const stage = String(params.new_stage);
    const { found, missing } = await resolveBulkTargets(ctx, jobId, ids, 'pipeline_stage');
    const toMove = found.filter((t) => t.current !== stage);
    const noOps = found.length - toMove.length;
    return {
      summary: `Déplacer ${toMove.length} candidat(s) vers « ${stage} »`,
      details: {
        job_id: jobId,
        new_stage: stage,
        reason: String(params.reason || '') || null,
        candidates: found.map((t) => ({
          name: t.candidate_name || t.candidate_id,
          from: t.current,
          to: stage,
          no_op: t.current === stage,
        })),
        skipped_not_in_pipeline: missing,
        no_op_count: noOps,
      },
      warning: missing.length > 0
        ? `${missing.length} candidat(s) introuvable(s) sur cette mission — ils seront ignorés.`
        : noOps > 0
        ? `${noOps} candidat(s) déjà au stade cible (aucun changement pour eux).`
        : undefined,
    };
  },
  async execute(params, ctx) {
    const ids = parseBulkIds(params);
    const jobId = String(params.job_id);
    const stage = String(params.new_stage);
    const { found, missing } = await resolveBulkTargets(ctx, jobId, ids, 'pipeline_stage');
    if (found.length === 0) return { success: false, error: 'Aucun des candidats fournis n\'existe sur cette mission.' };
    const { data, error } = await ctx.adminClient
      .from('job_candidate_status')
      .update({ pipeline_stage: stage })
      .eq('organization_id', ctx.organizationId)
      .eq('job_id', jobId)
      .in('candidate_id', found.map((t) => t.candidate_id))
      .select('candidate_id');
    if (error) return { success: false, error: error.message };
    const updated = (data as Array<{ candidate_id: string }> | null)?.length ?? 0;
    return {
      success: true,
      data: {
        updated,
        skipped: missing.length,
        new_stage: stage,
        message: `${updated} candidat(s) déplacé(s) vers « ${stage} »${missing.length ? ` (${missing.length} ignoré(s), hors pipeline)` : ''}.`,
      },
    };
  },
};

const bulkDismiss: AgentTool = {
  name: 'bulk_dismiss',
  description:
    "Dismiss SEVERAL candidates (2-50) of one mission in a single action (status='dismissed' — filtered out upfront, different from stage 'Perdu'). " +
    "Use when the user says 'écarte tous les candidats sous 40 de score', 'dismiss ces 8 profils'. " +
    "Resolve candidate_ids first via get_mission_candidates — never invent them. reason is REQUIRED (logged as skip_reason on each candidate). " +
    "The approval preview lists every candidate by name. This action always requires user approval.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      job_id: { type: 'string', description: 'The mission id (same as used by get_mission_candidates / dismiss_candidate).' },
      candidate_ids: {
        type: 'array',
        items: { type: 'string' },
        description: `Candidate ids (2-${BULK_MAX}), from get_mission_candidates. Never invented.`,
      },
      reason: { type: 'string', description: 'Why these candidates are dismissed (required, French, logged).' },
    },
    required: ['job_id', 'candidate_ids', 'reason'],
  },
  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    const ids = parseBulkIds(params);
    if (ids.length < 2) return { allowed: false, reason: `candidate_ids doit contenir entre 2 et ${BULK_MAX} candidats (pour un seul : dismiss_candidate)` };
    if (!String(params.job_id || '').trim()) return { allowed: false, reason: 'job_id is required' };
    if (!String(params.reason || '').trim()) return { allowed: false, reason: 'reason is required for bulk dismissal' };
    return { allowed: true };
  },
  async dryRun(params, ctx) {
    const ids = parseBulkIds(params);
    const jobId = String(params.job_id);
    const { found, missing } = await resolveBulkTargets(ctx, jobId, ids, 'status');
    const toDismiss = found.filter((t) => t.current !== 'dismissed');
    return {
      summary: `Écarter ${toDismiss.length} candidat(s) de la mission`,
      details: {
        job_id: jobId,
        reason: String(params.reason),
        candidates: found.map((t) => ({
          name: t.candidate_name || t.candidate_id,
          current_status: t.current,
          already_dismissed: t.current === 'dismissed',
        })),
        skipped_not_in_pipeline: missing,
      },
      warning: `Action destructive : ${toDismiss.length} candidat(s) seront marqués « écartés » sur cette mission.${missing.length ? ` ${missing.length} id(s) introuvable(s) seront ignorés.` : ''}`,
    };
  },
  async execute(params, ctx) {
    const ids = parseBulkIds(params);
    const jobId = String(params.job_id);
    const reason = String(params.reason).slice(0, 500);
    const { found, missing } = await resolveBulkTargets(ctx, jobId, ids, 'status');
    if (found.length === 0) return { success: false, error: 'Aucun des candidats fournis n\'existe sur cette mission.' };
    const { data, error } = await ctx.adminClient
      .from('job_candidate_status')
      .update({ status: 'dismissed', skip_reason: reason })
      .eq('organization_id', ctx.organizationId)
      .eq('job_id', jobId)
      .in('candidate_id', found.map((t) => t.candidate_id))
      .select('candidate_id');
    if (error) return { success: false, error: error.message };
    const updated = (data as Array<{ candidate_id: string }> | null)?.length ?? 0;
    return {
      success: true,
      data: {
        dismissed: updated,
        skipped: missing.length,
        message: `${updated} candidat(s) écarté(s)${missing.length ? ` (${missing.length} ignoré(s), hors pipeline)` : ''}. Motif : ${reason}`,
      },
    };
  },
};

// ─── Tool — send_email (P2.4 audit 2026-07-14) ──────────────────────────────
// Envoie un email depuis la BOÎTE CONNECTÉE du recruteur (member_email_accounts,
// même transport que les étapes email de séquence : POST /api/v1/emails chez le
// provider LinkedIn/email). mutation_external → approbation TOUJOURS obligatoire
// (clamp serveur, jamais auto). Vérifie la liste de suppression — absent du
// chemin séquences historique, ajouté ici.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function textToHtml(s: string): string {
  return `<div>${escapeHtml(s).replace(/\n/g, '<br>')}</div>`;
}

async function resolveSenderEmailAccount(
  ctx: ToolContext,
): Promise<{ email_account_id: string; email_address: string | null } | null> {
  const { data } = await ctx.adminClient
    .from('member_email_accounts')
    .select('email_account_id, email_address, account_status')
    .eq('organization_id', ctx.organizationId)
    .eq('user_id', ctx.userId)
    .or('account_status.is.null,account_status.in.(OK,CONNECTED)')
    .order('linked_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { email_account_id: string; email_address: string | null } | null) ?? null;
}

const sendEmail: AgentTool = {
  name: 'send_email',
  description:
    "Send an email to a candidate or contact FROM the user's connected email inbox (Gmail/Outlook). " +
    "Use when the user says 'envoie un email à X', 'écris un mail à marie@…'. " +
    "Requires to_email (ask the user or resolve via enrich_candidate_contact if unknown — NEVER invent an address). " +
    "body is plain text (French, no markdown) — line breaks preserved. " +
    "This is a REAL external send : always requires user approval, no exception. " +
    "For LinkedIn messages use send_linkedin_message ; for multi-step campaigns use sequences.",
  category: 'mutation_external',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      to_email: { type: 'string', description: "Recipient email address. Never invented — from the user, get_candidate_detail, or enrich_candidate_contact." },
      recipient_name: { type: 'string', description: 'Recipient full name (shown in the approval banner and the email).' },
      subject: { type: 'string', description: 'Email subject (French, concise).' },
      body: { type: 'string', description: 'Email body, PLAIN TEXT French (no markdown, no HTML). Max 5000 chars.' },
    },
    required: ['to_email', 'subject', 'body'],
  },

  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    const to = String(params.to_email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return { allowed: false, reason: `Adresse email invalide : "${to}"` };
    if (!String(params.subject || '').trim()) return { allowed: false, reason: 'subject is required' };
    const body = String(params.body || '').trim();
    if (!body) return { allowed: false, reason: 'body is required' };
    if (body.length > 5000) return { allowed: false, reason: 'body too long (max 5000 chars)' };

    // Liste de suppression (bounces / désabonnements)
    const { data: suppressed } = await ctx.adminClient
      .from('suppressed_emails')
      .select('email')
      .eq('email', to)
      .maybeSingle();
    if (suppressed) {
      return { allowed: false, reason: `${to} est sur la liste de suppression (bounce ou désabonnement) — envoi interdit.` };
    }

    const sender = await resolveSenderEmailAccount(ctx);
    if (!sender) {
      return { allowed: false, reason: "Aucune boîte email connectée sur l'organisation (Réglages → Connecteurs) — impossible d'envoyer." };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const to = String(params.to_email).trim().toLowerCase();
    const sender = await resolveSenderEmailAccount(ctx);
    const body = String(params.body).trim();
    return {
      summary: `Envoyer un email à ${params.recipient_name ? `${params.recipient_name} <${to}>` : to} : « ${String(params.subject).slice(0, 80)} »`,
      details: {
        to_email: to,
        recipient_name: String(params.recipient_name || '') || null,
        from_account: sender?.email_address ?? sender?.email_account_id ?? null,
        subject: String(params.subject),
        body_full: body,
        body_preview: body.length > 160 ? body.slice(0, 157) + '…' : body,
      },
      warning: 'Envoi externe RÉEL depuis ta boîte email connectée — irréversible une fois parti.',
    };
  },

  async execute(params, ctx) {
    const to = String(params.to_email).trim().toLowerCase();
    const sender = await resolveSenderEmailAccount(ctx);
    if (!sender) return { success: false, error: 'Aucune boîte email connectée.' };

    let creds: { apiKey: string; dsn: string } | null = null;
    try {
      creds = await resolveUnipileCredentials(ctx.organizationId, ctx.adminClient);
    } catch (e) {
      console.error('[send_email] credentials error:', e);
    }
    if (!creds) return { success: false, error: 'Connexion au service email impossible (credentials indisponibles).' };
    const baseDsn = creds.dsn.startsWith('http') ? creds.dsn : `https://${creds.dsn}`;

    const res = await fetchWithTimeout(`${baseDsn}/api/v1/emails`, {
      method: 'POST',
      headers: { 'X-API-KEY': creds.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: sender.email_account_id,
        subject: String(params.subject),
        body: textToHtml(String(params.body).trim()),
        to: [{ display_name: String(params.recipient_name || '') || to, identifier: to }],
      }),
    }, 20000);

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error('[send_email] provider error:', res.status, err.slice(0, 300));
      return { success: false, error: `Échec de l'envoi (${res.status}). Vérifie que ta boîte email est bien connectée.` };
    }

    return {
      success: true,
      data: {
        to_email: to,
        from_account: sender.email_address ?? null,
        message: `Email envoyé à ${to} depuis ${sender.email_address ?? 'ta boîte connectée'}.`,
      },
    };
  },
};

// ─── Tool — create_sequence (P2.5 audit 2026-07-14) ─────────────────────────
// Crée une séquence outreach multi-étapes (outreach_sequences + sequence_steps).
// Ne déclenche AUCUN envoi : les envois partent à l'enrollment (enroll_in_sequence,
// lui-même sous approbation). Types d'étapes exposés au modèle = sous-ensemble
// sûr du CHECK action_type.

const SEQ_STEP_TYPES: Record<string, { action_type: string; channel: 'linkedin' | 'email' }> = {
  message: { action_type: 'message', channel: 'linkedin' },
  inmail: { action_type: 'inmail', channel: 'linkedin' },
  connection_request: { action_type: 'connection_request', channel: 'linkedin' },
  email: { action_type: 'email', channel: 'email' },
  wait_reply: { action_type: 'wait_reply', channel: 'linkedin' },
};

interface SeqStepInput {
  type: string;
  delay_days: number;
  subject: string | null;
  message: string | null;
}

function parseSequenceSteps(params: Record<string, unknown>): { steps: SeqStepInput[] } | { error: string } {
  const raw = Array.isArray(params.steps) ? params.steps : [];
  if (raw.length < 1 || raw.length > 8) return { error: 'steps doit contenir entre 1 et 8 étapes' };
  const steps: SeqStepInput[] = [];
  for (const [i, s] of raw.entries()) {
    const st = (s ?? {}) as Record<string, unknown>;
    const type = String(st.type || '').trim();
    if (!SEQ_STEP_TYPES[type]) {
      return { error: `Étape ${i + 1} : type "${type}" invalide (attendu : ${Object.keys(SEQ_STEP_TYPES).join(', ')})` };
    }
    const message = String(st.message || '').trim() || null;
    const subject = String(st.subject || '').trim() || null;
    if (type !== 'wait_reply' && !message) return { error: `Étape ${i + 1} (${type}) : message requis` };
    if ((type === 'email' || type === 'inmail') && !subject) return { error: `Étape ${i + 1} (${type}) : subject requis` };
    steps.push({
      type,
      delay_days: Math.min(Math.max(Math.round(Number(st.delay_days) || 0), 0), 30),
      subject,
      message,
    });
  }
  return { steps };
}

const createSequence: AgentTool = {
  name: 'create_sequence',
  description:
    "Create a multi-step outreach sequence (LinkedIn messages / InMails / connection requests / emails / wait-for-reply). " +
    "Use when the user says 'crée une séquence de relance', 'monte-moi une séquence 3 touches pour la mission X'. " +
    "Creating a sequence sends NOTHING — candidates are added later via enroll_in_sequence (separate approval). " +
    "steps: 1-8 items {type: message|inmail|connection_request|email|wait_reply, delay_days (0-30, since previous step), " +
    "subject (required for email/inmail), message (template text ; variables {{first_name}}, {{company}} supported)}. " +
    "Optional mission_id links the sequence to a mission.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Sequence name (French, ex : "Relance DevOps senior — 3 touches").' },
      description: { type: 'string', description: 'Optional short description.' },
      mission_id: { type: 'string', description: 'Optional sourcing_projects UUID to attach the sequence to.' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: Object.keys(SEQ_STEP_TYPES) },
            delay_days: { type: 'number', description: 'Days to wait after the previous step (0-30, default 0).' },
            subject: { type: 'string', description: 'Subject — required for email and inmail steps.' },
            message: { type: 'string', description: 'Message template (plain text French). Not needed for wait_reply.' },
          },
          required: ['type'],
        },
        description: '1-8 steps, in order.',
      },
    },
    required: ['name', 'steps'],
  },

  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    if (!String(params.name || '').trim()) return { allowed: false, reason: 'name is required' };
    const parsed = parseSequenceSteps(params);
    if ('error' in parsed) return { allowed: false, reason: parsed.error };
    const missionId = String(params.mission_id || '').trim();
    if (missionId) {
      const { data: project } = await ctx.adminClient
        .from('sourcing_projects')
        .select('id, organization_id')
        .eq('id', missionId)
        .maybeSingle();
      if (!project || project.organization_id !== ctx.organizationId) {
        return { allowed: false, reason: 'Mission introuvable dans cette organisation' };
      }
    }
    return { allowed: true };
  },

  async dryRun(params, _ctx) {
    const parsed = parseSequenceSteps(params);
    const steps = 'steps' in parsed ? parsed.steps : [];
    const STEP_LABEL: Record<string, string> = {
      message: 'Message LinkedIn',
      inmail: 'InMail',
      connection_request: 'Demande de connexion',
      email: 'Email',
      wait_reply: 'Attente de réponse',
    };
    return {
      summary: `Créer la séquence « ${String(params.name).slice(0, 80)} » (${steps.length} étape(s))`,
      details: {
        name: String(params.name),
        description: String(params.description || '') || null,
        mission_id: String(params.mission_id || '') || null,
        steps: steps.map((s, i) => ({
          order: i + 1,
          type: STEP_LABEL[s.type] ?? s.type,
          delay: s.delay_days > 0 ? `J+${s.delay_days}` : 'immédiat',
          subject: s.subject,
          message_preview: s.message ? (s.message.length > 120 ? s.message.slice(0, 117) + '…' : s.message) : null,
        })),
      },
      warning: "Aucun envoi ne part à la création : les candidats sont ajoutés ensuite via l'enrollment (validation séparée).",
    };
  },

  async execute(params, ctx) {
    const parsed = parseSequenceSteps(params);
    if ('error' in parsed) return { success: false, error: parsed.error };

    const { data: seq, error: seqErr } = await ctx.adminClient
      .from('outreach_sequences')
      .insert({
        name: String(params.name).trim().slice(0, 200),
        description: String(params.description || '').trim().slice(0, 1000) || null,
        is_active: true,
        created_by: ctx.userId,
        organization_id: ctx.organizationId,
        project_id: String(params.mission_id || '').trim() || null,
      })
      .select('id')
      .single();
    if (seqErr || !seq) return { success: false, error: seqErr?.message || 'sequence insert failed' };

    const stepRows = parsed.steps.map((s, i) => ({
      sequence_id: seq.id,
      step_order: i + 1,
      action_type: SEQ_STEP_TYPES[s.type].action_type,
      step_channel: SEQ_STEP_TYPES[s.type].channel,
      condition_type: 'always',
      delay_days: s.delay_days,
      delay_hours: 0,
      subject_template: s.subject,
      message_template: s.message,
      use_ai_personalization: false,
    }));
    const { error: stepsErr } = await ctx.adminClient.from('sequence_steps').insert(stepRows);
    if (stepsErr) {
      // Cleanup best-effort : pas de séquence orpheline sans étapes
      await ctx.adminClient.from('outreach_sequences').delete().eq('id', seq.id);
      return { success: false, error: `steps insert failed: ${stepsErr.message}` };
    }

    return {
      success: true,
      data: {
        sequence_id: seq.id,
        steps_created: stepRows.length,
        message: `Séquence « ${String(params.name)} » créée avec ${stepRows.length} étape(s). Pour y ajouter des candidats : enroll_in_sequence (validation séparée).`,
      },
    };
  },
};

// ============================================================================
// Registration
// ============================================================================

let registered = false;

// ─── Tool de fond — start_background_scoring (P5 agent de fond 2026-07-15) ───
// Lance le scoring EN TÂCHE DE FOND de tous les profils sourcés NON scorés
// d'une mission. Insère une ligne dans agent_background_tasks ; le worker
// process-agent-tasks (cron chaque minute) traite par lots et notifie à la fin.
// L'utilisateur peut fermer l'app entre-temps.

/** Normalise une référence mission en UUID sourcing_projects (accepte 'project:{uuid}'). */
function normalizeMissionId(raw: unknown): string {
  return String(raw || '').trim().replace(/^project:/, '');
}

async function countUnscoredProfiles(ctx: ToolContext, projectId: string): Promise<number> {
  const { count } = await ctx.adminClient
    .from('job_candidate_status')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .is('score', null)
    .not('linkedin_profile_data', 'is', null);
  return count ?? 0;
}

const startBackgroundScoring: AgentTool = {
  name: 'start_background_scoring',
  description:
    "Score ALL un-scored sourced profiles of a mission IN THE BACKGROUND. " +
    "Use when the user wants to score many profiles at once without waiting ('score les 200 profils de la mission en fond', " +
    "'lance le scoring de tous les candidats non notés', 'évalue tout le vivier de cette mission'). " +
    "The work runs server-side in batches over several minutes; the user can close the app and gets notified when done, " +
    "with live progress meanwhile. Resolve the mission_id first via get_my_missions. " +
    "Costs AI credits (scoring is billed per profile). Only profiles NOT yet scored are processed. " +
    "For scoring a handful of profiles interactively, keep using the normal search/scoring flow instead.",
  category: 'mutation_safe',
  requiresApproval: true,
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: { type: 'string', description: 'sourcing_projects UUID (from get_my_missions).' },
      scoring_instructions: {
        type: 'string',
        description: 'Optional extra scoring guidance for this run (e.g. "priorise l\'expérience scale-up").',
      },
    },
    required: ['mission_id'],
  },

  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    const projectId = normalizeMissionId(params.mission_id);
    if (!projectId) return { allowed: false, reason: 'mission_id est requis' };
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('id, organization_id')
      .eq('id', projectId)
      .maybeSingle();
    if (!project) return { allowed: false, reason: 'Mission introuvable' };
    if (project.organization_id !== ctx.organizationId) {
      return { allowed: false, reason: 'Cette mission appartient à une autre organisation' };
    }
    // Une seule tâche de scoring active par mission à la fois.
    const { data: active } = await ctx.adminClient
      .from('agent_background_tasks')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('kind', 'score_mission_profiles')
      .in('status', ['queued', 'running'])
      .contains('params', { project_id: projectId })
      .limit(1)
      .maybeSingle();
    if (active) {
      return { allowed: false, reason: 'Un scoring de fond est déjà en cours sur cette mission — attends qu\'il se termine.' };
    }
    return { allowed: true };
  },

  async dryRun(params, ctx) {
    const projectId = normalizeMissionId(params.mission_id);
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle();
    const count = await countUnscoredProfiles(ctx, projectId);
    const missionName = project?.name || 'la mission';
    return {
      summary: count > 0
        ? `Scorer ${count} profil${count > 1 ? 's' : ''} de « ${missionName} » en tâche de fond`
        : `Aucun profil à scorer sur « ${missionName} »`,
      details: {
        mission: missionName,
        profiles_to_score: count,
        scoring_instructions: String(params.scoring_instructions || '') || null,
      },
      warning: count > 0
        ? `Consomme des crédits IA (scoring facturé par profil, ~${count} à ${count * 2} crédits selon la richesse des profils). Le traitement tourne en arrière-plan ; tu seras notifié à la fin.`
        : undefined,
    };
  },

  async execute(params, ctx) {
    const projectId = normalizeMissionId(params.mission_id);
    const { data: project } = await ctx.adminClient
      .from('sourcing_projects')
      .select('name')
      .eq('id', projectId)
      .maybeSingle();
    const count = await countUnscoredProfiles(ctx, projectId);
    const missionName = project?.name || 'Mission';
    if (count === 0) {
      return { success: true, data: { message: `Tous les profils de « ${missionName} » sont déjà scorés — rien à lancer.`, profiles_to_score: 0 } };
    }
    const { data: inserted, error } = await ctx.adminClient
      .from('agent_background_tasks')
      .insert({
        organization_id: ctx.organizationId,
        created_by: ctx.userId,
        conversation_id: ctx.conversationId,
        kind: 'score_mission_profiles',
        params: {
          project_id: projectId,
          ...(params.scoring_instructions ? { scoring_instructions: String(params.scoring_instructions).slice(0, 500) } : {}),
        },
        title: missionName,
        progress_total: count,
      })
      .select('id')
      .single();
    if (error) return { success: false, error: `Impossible de lancer la tâche : ${error.message}` };
    return {
      success: true,
      data: {
        task_id: inserted.id,
        profiles_to_score: count,
        message: `C'est lancé : ${count} profil${count > 1 ? 's' : ''} de « ${missionName} » seront scorés en arrière-plan. Tu peux fermer l'app — je te préviens dès que c'est terminé, et la progression s'affiche en temps réel.`,
      },
    };
  },
};

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
  // Phase A.3 — Outreach quota-gated
  registerTool(sendLinkedInMessage);
  registerTool(pauseSequence);
  registerTool(resumeSequence);
  // Phase A.4 — Équipe
  registerTool(inviteTeamMember);
  registerTool(updateMemberQuota);
  // Phase Calibration — Push de filtres de recherche depuis le chat
  registerTool(applySearchFiltersToMission);
  // P0.3 audit 2026-07-14 — calendrier interne + pont vers run-agent-search
  registerTool(scheduleInterview);
  registerTool(launchSearch);
  // P2.2 — actions multi-candidats
  registerTool(bulkUpdateStage);
  registerTool(bulkDismiss);
  // P2.4/P2.5 — email sortant + création de séquences
  registerTool(sendEmail);
  registerTool(createSequence);
  // P5 — agent de fond : scoring en masse en tâche de fond
  registerTool(startBackgroundScoring);
  registered = true;
}
