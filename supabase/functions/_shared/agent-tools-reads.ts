// ============================================================================
// Read tools — Phase B (omniscience, role-scoped)
// ============================================================================
// Outils LECTURE SEULE sur les données propres de l'org. requiresApproval=false
// → exécutés inline par handleProposedToolCall (pas de bandeau).
//
// ⚠️ ctx.adminClient = service-role (bypass RLS). Le cloisonnement par RÔLE
// est donc appliqué EXPLICITEMENT ici (décision produit "selon le rôle") :
//   - owner / admin       → toutes les missions & candidats de l'org
//   - collaborator (autre) → uniquement ses missions (created_by = lui
//     OU membre de mission_team)
// ============================================================================

import type { AgentTool, ToolContext } from './agent-tools.ts';
import { registerTool } from './agent-tools.ts';

type OrgRole = 'owner' | 'admin' | 'collaborator';

async function resolveRole(ctx: ToolContext): Promise<OrgRole> {
  const { data } = await ctx.adminClient
    .from('organization_members')
    .select('role')
    .eq('organization_id', ctx.organizationId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  const r = String((data as { role?: string } | null)?.role || '').toLowerCase();
  return r === 'owner' || r === 'admin' ? (r as OrgRole) : 'collaborator';
}

const isPrivileged = (role: OrgRole) => role === 'owner' || role === 'admin';

interface MissionRow {
  id: string;
  name: string;
  job_title: string | null;
  client_name: string | null;
  status: string;
  created_by: string;
  organization_id: string | null;
}

async function loadMission(
  ctx: ToolContext,
  missionId: string,
): Promise<MissionRow | null> {
  const { data } = await ctx.adminClient
    .from('sourcing_projects')
    .select('id, name, job_title, client_name, status, created_by, organization_id')
    .eq('id', missionId)
    .maybeSingle();
  return (data as MissionRow | null) ?? null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Résout une mission par UUID OU par nom/intitulé (scopé org). Indispensable :
 * entre deux tours, l'agent ne garde que le NOM des missions (les résultats
 * d'outils ne sont pas persistés dans l'historique agent_messages), pas leur
 * UUID. Le cloisonnement par rôle reste assuré par canAccessMission côté
 * verifyAccess — ici on se contente de localiser la mission dans l'org.
 */
async function resolveMissionRef(
  ctx: ToolContext,
  params: Record<string, unknown>,
): Promise<MissionRow | null> {
  const rawId = String((params.mission_id ?? '') as string).trim();
  const rawName = String((params.mission_name ?? '') as string).trim();
  for (const cand of [rawId, rawName]) {
    if (cand && UUID_RE.test(cand)) {
      const m = await loadMission(ctx, cand);
      if (m) return m;
    }
  }
  const nameRef =
    (rawName && !UUID_RE.test(rawName) ? rawName : '') ||
    (rawId && !UUID_RE.test(rawId) ? rawId : '');
  if (!nameRef || !ctx.organizationId) return null;
  const pat = `%${nameRef.slice(0, 80)}%`;
  const sel = 'id, name, job_title, client_name, status, created_by, organization_id';
  const [a, b] = await Promise.all([
    ctx.adminClient
      .from('sourcing_projects')
      .select(sel)
      .eq('organization_id', ctx.organizationId)
      .ilike('name', pat)
      .order('updated_at', { ascending: false })
      .limit(5),
    ctx.adminClient
      .from('sourcing_projects')
      .select(sel)
      .eq('organization_id', ctx.organizationId)
      .ilike('job_title', pat)
      .order('updated_at', { ascending: false })
      .limit(5),
  ]);
  const rows: MissionRow[] = [];
  const seen = new Set<string>();
  for (const r of [
    ...(((a.data as MissionRow[] | null) ?? [])),
    ...(((b.data as MissionRow[] | null) ?? [])),
  ]) {
    if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  }
  if (rows.length === 0) return null;
  const lc = nameRef.toLowerCase();
  return (
    rows.find(
      (r) =>
        (r.name ?? '').toLowerCase() === lc ||
        (r.job_title ?? '').toLowerCase() === lc,
    ) ?? rows[0]
  );
}

/** Role-scoped access check for a single mission. */
async function canAccessMission(
  ctx: ToolContext,
  role: OrgRole,
  mission: MissionRow,
): Promise<boolean> {
  if (mission.organization_id !== ctx.organizationId) return false;
  if (isPrivileged(role)) return true;
  if (mission.created_by === ctx.userId) return true;
  const { data } = await ctx.adminClient
    .from('mission_team')
    .select('id')
    .eq('project_id', mission.id)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  return !!data;
}

/** Mission ids the collaborator may see (own + team). Null for privileged (= all org). */
async function collaboratorMissionIds(ctx: ToolContext): Promise<string[]> {
  const [own, team] = await Promise.all([
    ctx.adminClient
      .from('sourcing_projects')
      .select('id')
      .eq('organization_id', ctx.organizationId)
      .eq('created_by', ctx.userId),
    ctx.adminClient
      .from('mission_team')
      .select('project_id')
      .eq('user_id', ctx.userId),
  ]);
  const ids = new Set<string>();
  for (const r of (own.data as Array<{ id: string }> | null) ?? []) ids.add(r.id);
  for (const r of (team.data as Array<{ project_id: string }> | null) ?? []) {
    if (r.project_id) ids.add(r.project_id);
  }
  return [...ids];
}

const trivialDryRun = (summary: string) => async () => ({ summary, details: {} });

// ─── Tool — get_my_missions ────────────────────────────────────────────────
const getMyMissions: AgentTool = {
  name: 'get_my_missions',
  description:
    "List the recruitment missions (sourcing projects) the user can see, with status, sourcing stats AND the real " +
    "candidate count per mission (plus a total_candidates aggregate). " +
    "Use when the user asks 'mes missions', 'quelles missions actives', 'sur quoi je bosse', 'combien de postes ouverts', " +
    "AND for any cross-mission / aggregate question like 'combien de candidats au total', 'combien de candidats sur mes " +
    "missions', 'lesquelles ont des candidats' — answer those from this tool, do NOT drill into each mission. " +
    "Read-only, results are scoped to the user's role automatically.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: "Optional filter, e.g. 'active', 'paused', 'archived', 'completed'." },
      limit: { type: 'number', description: 'Max missions to return (default 25, hard cap 50).' },
    },
    required: [],
  },
  async verifyAccess(_p, ctx) {
    return ctx.organizationId ? { allowed: true } : { allowed: false, reason: 'No active organization' };
  },
  dryRun: trivialDryRun('Lecture : liste des missions visibles'),
  async execute(params, ctx) {
    const role = await resolveRole(ctx);
    const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 50);
    let q = ctx.adminClient
      .from('sourcing_projects')
      .select('id, name, job_title, client_name, status, stats_total_found, stats_scored, stats_shortlisted, updated_at')
      .eq('organization_id', ctx.organizationId);
    if (params.status) q = q.eq('status', String(params.status));
    if (!isPrivileged(role)) {
      const ids = await collaboratorMissionIds(ctx);
      if (ids.length === 0) return { success: true, data: { role, missions: [], note: 'Aucune mission assignée.' } };
      q = q.in('id', ids);
    }
    const { data, error } = await q
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return { success: false, error: error.message };
    const missions: Array<Record<string, unknown>> = (data ?? []) as Array<Record<string, unknown>>;

    // Compteur RÉEL de candidats par mission. La liaison mission→candidats est
    // `job_candidate_status.project_id = sourcing_projects.id` (cf. le hook app
    // useProjectCandidates) — PAS `job_id`, qui est l'id de job/recherche,
    // souvent synthétique (« project:<uuid> »). Permet de répondre aux
    // questions agrégées sans drill-in par mission.
    const missionIds = missions.map((m) => m.id as string).filter(Boolean);
    let totalCandidates = 0;
    let countsTruncated = false;
    if (missionIds.length > 0) {
      const { data: cand, error: candErr } = await ctx.adminClient
        .from('job_candidate_status')
        .select('project_id')
        .in('project_id', missionIds)
        .limit(5000);
      if (!candErr && Array.isArray(cand)) {
        const tally: Record<string, number> = {};
        for (const r of cand as Array<{ project_id: string | null }>) {
          if (r.project_id) tally[r.project_id] = (tally[r.project_id] || 0) + 1;
        }
        for (const m of missions) {
          const c = tally[m.id as string] || 0;
          m.candidate_count = c;
          totalCandidates += c;
        }
        countsTruncated = cand.length === 5000;
      }
    }
    return {
      success: true,
      data: {
        role,
        count: missions.length,
        total_candidates: totalCandidates,
        ...(countsTruncated ? { counts_truncated: true } : {}),
        missions,
      },
    };
  },
};

// ─── Tool — get_mission_overview ───────────────────────────────────────────
const getMissionOverview: AgentTool = {
  name: 'get_mission_overview',
  description:
    "Get a snapshot of ONE mission: meta (title, client, status), sourcing stats, pipeline breakdown by stage, " +
    "and the top candidates by score. Use for 'où en est cette mission', 'résume le pipeline', 'combien de candidats à chaque étape'. " +
    "Pass mission_id (UUID) if you have it, OR mission_name (the mission's exact name/title as shown to the user). " +
    "If you only know mission names from earlier in the conversation, pass mission_name — the tool resolves it.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: { type: 'string', description: 'sourcing_projects UUID (si tu le connais).' },
      mission_name: { type: 'string', description: "Nom ou intitulé EXACT de la mission (ex: « Lead Developer Go ») — utilise-le si tu n'as pas l'UUID (cas fréquent entre deux tours de conversation)." },
    },
    required: [],
  },
  async verifyAccess(params, ctx) {
    const ref = String((params.mission_id ?? params.mission_name ?? '') as string).trim();
    if (!ref) return { allowed: false, reason: 'Précise la mission (nom ou id).' };
    const mission = await resolveMissionRef(ctx, params);
    if (!mission) {
      return {
        allowed: false,
        reason: `Mission « ${ref} » introuvable — donne le nom exact, ou appelle d'abord get_my_missions pour lister les missions.`,
      };
    }
    const role = await resolveRole(ctx);
    return (await canAccessMission(ctx, role, mission))
      ? { allowed: true }
      : { allowed: false, reason: "Tu n'as pas accès à cette mission (rôle/portée)." };
  },
  dryRun: trivialDryRun('Lecture : aperçu de la mission'),
  async execute(params, ctx) {
    const resolved = await resolveMissionRef(ctx, params);
    if (!resolved) return { success: false, error: "Mission introuvable — donne le nom exact ou appelle get_my_missions." };
    const missionId = resolved.id;
    const [{ data: mission, error: missionErr }, { data: rows, error: rowsErr }] = await Promise.all([
      ctx.adminClient
        .from('sourcing_projects')
        .select('id, name, job_title, client_name, status, stats_total_found, stats_scored, stats_shortlisted, stats_messaged, stats_dismissed')
        .eq('id', missionId)
        .maybeSingle(),
      // Liaison candidats : project_id = sourcing_projects.id (cf.
      // useProjectCandidates app-side). `job_id` est l'id de recherche,
      // souvent synthétique « project:<uuid> » → ne matcherait rien ici.
      ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_id, candidate_name, pipeline_stage, status, score')
        .eq('project_id', missionId)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(300),
    ]);
    const list = (rows as Array<{ candidate_id: string | null; candidate_name: string | null; pipeline_stage: string | null; status: string; score: number | null }> | null) ?? [];
    const byStage: Record<string, number> = {};
    for (const r of list) {
      const k = r.pipeline_stage || '(non défini)';
      byStage[k] = (byStage[k] || 0) + 1;
    }
    const scored = list.filter((r) => typeof r.score === 'number');
    const avgScore = scored.length
      ? Math.round((scored.reduce((s, r) => s + (r.score as number), 0) / scored.length) * 10) / 10
      : null;
    return {
      success: true,
      data: {
        mission,
        pipeline_by_stage: byStage,
        candidates_loaded: list.length,
        truncated: list.length === 300,
        avg_score: avgScore,
        top_candidates: list.slice(0, 8).map((r) => ({
          name: r.candidate_name, stage: r.pipeline_stage, status: r.status, score: r.score,
          profile_path: r.candidate_id ? `/ats/scorecard/${r.candidate_id}` : null,
        })),
        ...((missionErr || rowsErr)
          ? { data_errors: { mission: missionErr?.message ?? null, candidates: rowsErr?.message ?? null } }
          : {}),
      },
    };
  },
};

// ─── Tool — get_mission_candidates ─────────────────────────────────────────
const getMissionCandidates: AgentTool = {
  name: 'get_mission_candidates',
  description:
    "List candidates of ONE mission (their NAMES, headline, pipeline stage, status, score, recommendation). " +
    "Optional filters by stage or minimum score. Use for 'montre les candidats', 'donne-moi leurs noms', " +
    "'qui sont les meilleurs profils', 'liste des shortlistés'. " +
    "Pass mission_id (UUID) if you have it, OR mission_name (exact name/title) — if you only know the mission " +
    "name from earlier in the conversation, pass mission_name.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: { type: 'string', description: 'sourcing_projects UUID (si tu le connais).' },
      mission_name: { type: 'string', description: "Nom ou intitulé EXACT de la mission (ex: « Lead Developer Go ») — utilise-le si tu n'as pas l'UUID (cas fréquent entre deux tours)." },
      stage: { type: 'string', description: "Optional pipeline stage filter (e.g. 'Pressenti', 'Pré-qualif')." },
      min_score: { type: 'number', description: 'Optional minimum score (0-100).' },
      limit: { type: 'number', description: 'Max candidates (default 25, hard cap 50).' },
    },
    required: [],
  },
  verifyAccess: (params, ctx) => getMissionOverview.verifyAccess(params, ctx),
  dryRun: trivialDryRun('Lecture : candidats de la mission'),
  async execute(params, ctx) {
    const resolved = await resolveMissionRef(ctx, params);
    if (!resolved) return { success: false, error: "Mission introuvable — donne le nom exact ou appelle get_my_missions." };
    const missionId = resolved.id;
    const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 50);
    let q = ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_id, candidate_name, candidate_headline, pipeline_stage, status, score, recommendation')
      // project_id = sourcing_projects.id (cf. useProjectCandidates) — pas job_id.
      .eq('project_id', missionId);
    if (params.stage) q = q.eq('pipeline_stage', String(params.stage));
    if (params.min_score != null) q = q.gte('score', Number(params.min_score));
    const { data, error } = await q
      .order('score', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) return { success: false, error: error.message };
    const candidates = ((data as Array<{ candidate_id: string | null }> | null) ?? []).map((c) => ({
      ...c,
      // Profil in-app : route /ats/scorecard/:candidateId → .eq('candidate_id', …).
      profile_path: c.candidate_id ? `/ats/scorecard/${c.candidate_id}` : null,
    }));
    return { success: true, data: { count: candidates.length, candidates } };
  },
};

// ─── Tool — get_mission_process ────────────────────────────────────────────
const getMissionProcess: AgentTool = {
  name: 'get_mission_process',
  description:
    "Get the evaluation/interview process of ONE mission: ordered steps (name, duration, interviewer, " +
    "eliminatory, objectives) and the team size. Use for 'c'est quoi le process', 'combien d'étapes d'entretien', " +
    "'quels sont les critères éliminatoires'.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: { type: 'string', description: 'sourcing_projects UUID (si tu le connais).' },
      mission_name: { type: 'string', description: "Nom ou intitulé EXACT de la mission (ex: « Lead Developer Go ») — utilise-le si tu n'as pas l'UUID (cas fréquent entre deux tours de conversation)." },
    },
    required: [],
  },
  verifyAccess: (params, ctx) => getMissionOverview.verifyAccess(params, ctx),
  dryRun: trivialDryRun('Lecture : process de la mission'),
  async execute(params, ctx) {
    const resolved = await resolveMissionRef(ctx, params);
    if (!resolved) return { success: false, error: "Mission introuvable — donne le nom exact ou appelle get_my_missions." };
    const missionId = resolved.id;
    const [{ data: steps }, { data: team }] = await Promise.all([
      ctx.adminClient
        .from('mission_process_steps')
        .select('step_order, name, description, duration_minutes, interviewer_type, interviewer_name, is_eliminatory, objectives')
        .eq('project_id', missionId)
        .order('step_order', { ascending: true }),
      ctx.adminClient
        .from('mission_team')
        .select('role')
        .eq('project_id', missionId),
    ]);
    return {
      success: true,
      data: {
        steps: steps ?? [],
        step_count: (steps ?? []).length,
        team_size: (team ?? []).length,
        team_roles: (team as Array<{ role: string }> | null ?? []).map((t) => t.role),
      },
    };
  },
};

// ─── Tool — get_sequences_status ───────────────────────────────────────────
const getSequencesStatus: AgentTool = {
  name: 'get_sequences_status',
  description:
    "Get the outreach status for ONE mission: how many candidates are enrolled in sequences, broken down by " +
    "enrollment status, reply/connection counts, AND `to_follow_up` (enrolled, no reply yet, sequence still " +
    "active = candidates « à relancer ») + `no_reply`. Use for 'où en est la prospection', 'combien ont répondu', " +
    "'qui est en séquence', and 'combien de candidats à relancer' (for a global 'à relancer' total, call " +
    "get_my_missions then this tool per mission and sum `to_follow_up`).",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: { type: 'string', description: 'sourcing_projects UUID (si tu le connais).' },
      mission_name: { type: 'string', description: "Nom ou intitulé EXACT de la mission (ex: « Lead Developer Go ») — utilise-le si tu n'as pas l'UUID (cas fréquent entre deux tours de conversation)." },
    },
    required: [],
  },
  verifyAccess: (params, ctx) => getMissionOverview.verifyAccess(params, ctx),
  dryRun: trivialDryRun('Lecture : statut prospection de la mission'),
  async execute(params, ctx) {
    const resolved = await resolveMissionRef(ctx, params);
    if (!resolved) return { success: false, error: "Mission introuvable — donne le nom exact ou appelle get_my_missions." };
    const missionId = resolved.id;
    const { data, error } = await ctx.adminClient
      .from('sequence_enrollments')
      .select('status, connection_status, replied_at, completed_at')
      .eq('job_id', missionId)
      .limit(1000);
    if (error) return { success: false, error: error.message };
    const rows = (data as Array<{ status: string; connection_status: string | null; replied_at: string | null; completed_at: string | null }> | null) ?? [];
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status || '(?)'] = (byStatus[r.status || '(?)'] || 0) + 1;
    // « À relancer » = inscrit en séquence, pas encore de réponse, séquence non
    // terminée/arrêtée. no_reply = contacté mais silencieux (réponse absente).
    const TERMINAL = new Set([
      'replied', 'completed', 'stopped', 'failed', 'bounced', 'unsubscribed', 'cancelled',
    ]);
    const toFollowUp = rows.filter(
      (r) => !r.replied_at && !r.completed_at && !TERMINAL.has((r.status || '').toLowerCase()),
    ).length;
    return {
      success: true,
      data: {
        total_enrolled: rows.length,
        by_status: byStatus,
        replied: rows.filter((r) => !!r.replied_at).length,
        no_reply: rows.filter((r) => !r.replied_at).length,
        to_follow_up: toFollowUp,
        connected: rows.filter((r) => r.connection_status === 'connected').length,
        completed: rows.filter((r) => !!r.completed_at).length,
        truncated: rows.length === 1000,
      },
    };
  },
};

// ============================================================================
// Phase C — candidate-level read tools
// ============================================================================

interface CandRow {
  id: string;
  candidate_id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  linkedin_profile_url: string | null;
  linkedin_profile_data: unknown;
  scoring_details: unknown;
  score: number | null;
  recommendation: string | null;
  pipeline_stage: string | null;
  status: string;
  project_id: string | null;
  created_by: string;
  updated_at: string;
}

const CAND_COLS =
  'id, candidate_id, candidate_name, candidate_headline, linkedin_profile_url, ' +
  'linkedin_profile_data, scoring_details, score, recommendation, pipeline_stage, ' +
  'status, project_id, created_by, updated_at';

const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Date LinkedIn : string OU objet { year, month }. */
function ldate(d: unknown): string {
  if (!d) return '';
  if (typeof d === 'object') {
    const o = d as Record<string, unknown>;
    return String(o.year ?? o.month ?? '');
  }
  return String(d);
}

/**
 * Normalise le blob `linkedin_profile_data` (forme variable selon la source :
 * LinkedIn live / Base Konekt). Mêmes clés de repli que `_shared/rag-adapters.ts`
 * (référence backend faisant autorité) — ne pas deviner, refléter l'existant.
 */
function summarizeProfile(pd: unknown): Record<string, unknown> | null {
  if (!pd || typeof pd !== 'object') return null;
  const p = pd as Record<string, any>;
  const name = `${p.first_name || p.name || ''} ${p.last_name || ''}`.trim();
  const expRaw =
    [p.work_experience, p.experiences, p.positions?.values]
      .map(asArr)
      .find((a) => a.length) || [];
  const eduRaw = [p.education, p.educations].map(asArr).find((a) => a.length) || [];
  const experiences = expRaw.slice(0, 12).map((x: any) => {
    const start = ldate(x.start_date ?? x.starts_at);
    const end = x.end_date || x.ends_at ? ldate(x.end_date ?? x.ends_at) : (start ? 'présent' : '');
    return {
      title: String(x.title || x.role || '').trim(),
      company: String(x.company_name || x.company || '').trim(),
      period: start ? `${start} - ${end}` : '',
      description: String(x.description || '').trim().slice(0, 280),
    };
  }).filter((e) => e.title || e.company);
  const education = eduRaw.slice(0, 8).map((x: any) => {
    const start = ldate(x.start_date ?? x.starts_at);
    const end = x.end_date || x.ends_at ? ldate(x.end_date ?? x.ends_at) : '';
    return {
      school: String(x.school || x.school_name || x.institution || x.name || '').trim(),
      degree: String(x.degree || x.degree_name || x.field_of_study || x.field || '').trim(),
      period: start ? `${start} - ${end}`.trim() : '',
    };
  }).filter((e) => e.school || e.degree);
  const skills = asArr(p.skills)
    .map((s: any) => (typeof s === 'string' ? s : s?.name || ''))
    .filter(Boolean)
    .slice(0, 25);
  const languages = asArr(p.languages)
    .map((l: any) => (typeof l === 'string' ? l : l?.name || l?.language || ''))
    .filter(Boolean)
    .slice(0, 10);
  return {
    name: name || null,
    headline: String(p.headline || p.occupation || '').trim() || null,
    location: String(p.location || p.city || '').trim() || null,
    about: String(p.about || p.summary || '').trim().slice(0, 1200) || null,
    skills,
    experiences,
    education,
    languages,
    profile_picture_url: p.profile_picture_url || p.profile_pic_url || p.picture || null,
  };
}

/** Extrait un scoring lisible depuis `scoring_details` (clés tolérantes). */
function summarizeScoring(
  sd: unknown,
  row: { score: number | null; recommendation: string | null },
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (typeof row.score === 'number') out.score = row.score;
  if (row.recommendation) out.recommendation = row.recommendation;
  if (sd && typeof sd === 'object') {
    const o = sd as Record<string, any>;
    const pick = (...keys: string[]) => {
      for (const k of keys) if (o[k] != null) return o[k];
      return undefined;
    };
    const cap = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : v);
    if (out.score == null) {
      const ms = pick('match_score', 'llmScore', 'score');
      if (ms != null) out.score = ms;
    }
    const matching = pick('matching_skills', 'matched_skills');
    const missing = pick('missing_skills', 'missingSkills');
    const strengths = pick('strengths');
    const weaknesses = pick('weaknesses', 'concerns');
    const summary = pick('summary', 'reasoning', 'explanation');
    const expM = pick('experience_match', 'experienceMatch');
    const locM = pick('location_match', 'locationMatch');
    if (matching != null) out.matching_skills = cap(matching, 25);
    if (missing != null) out.missing_skills = cap(missing, 25);
    if (strengths != null) out.strengths = cap(strengths, 15);
    if (weaknesses != null) out.weaknesses = cap(weaknesses, 15);
    if (summary != null) out.summary = String(summary).slice(0, 1000);
    if (expM != null) out.experience_match = expM;
    if (locM != null) out.location_match = locM;
  }
  return Object.keys(out).length ? out : null;
}

function pickPrimary(rows: CandRow[]): CandRow {
  return [...rows].sort((a, b) => {
    const ad = a.linkedin_profile_data ? 1 : 0;
    const bd = b.linkedin_profile_data ? 1 : 0;
    if (ad !== bd) return bd - ad;
    const as = typeof a.score === 'number' ? a.score : -1;
    const bs = typeof b.score === 'number' ? b.score : -1;
    if (as !== bs) return bs - as;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  })[0];
}

type CandResolve =
  | { primary: CandRow; all: CandRow[] }
  | { ambiguous: Array<{ candidate_id: string; name: string | null; headline: string | null }> }
  | null;

/**
 * Résout un candidat par `candidate_id` (= id de profil LinkedIn, opaque — PAS
 * un UUID) OU par `candidate_name` (ilike), scopé org + rôle. Optionnellement
 * désambiguïsé par mission. Un même candidat peut avoir N lignes (1 par
 * mission) → on renvoie la ligne « primaire » (profil enrichi > score > récence)
 * + toutes ses lignes. Si plusieurs candidats distincts matchent un nom → liste
 * d'ambiguïté pour que l'agent demande lequel.
 */
async function resolveCandidateRef(
  ctx: ToolContext,
  params: Record<string, unknown>,
  role: OrgRole,
): Promise<CandResolve> {
  if (!ctx.organizationId) return null;
  const candId = String((params.candidate_id ?? '') as string).trim();
  const candName = String((params.candidate_name ?? '') as string).trim();
  let q = ctx.adminClient
    .from('job_candidate_status')
    .select(CAND_COLS)
    .eq('organization_id', ctx.organizationId);
  if (candId) q = q.eq('candidate_id', candId);
  else if (candName) q = q.ilike('candidate_name', `%${candName.slice(0, 80)}%`);
  else return null;
  const mission = (params.mission_id || params.mission_name)
    ? await resolveMissionRef(ctx, params)
    : null;
  if (mission) q = q.eq('project_id', mission.id);
  const { data } = await q.order('updated_at', { ascending: false }).limit(60);
  let rows = ((data as CandRow[] | null) ?? []);
  if (!isPrivileged(role)) {
    const ids = new Set(await collaboratorMissionIds(ctx));
    rows = rows.filter(
      (r) => r.created_by === ctx.userId || (!!r.project_id && ids.has(r.project_id)),
    );
  }
  if (rows.length === 0) return null;
  const byCand = new Map<string, CandRow[]>();
  for (const r of rows) {
    const list = byCand.get(r.candidate_id) ?? [];
    list.push(r);
    byCand.set(r.candidate_id, list);
  }
  if (byCand.size > 1 && !candId) {
    const lc = candName.toLowerCase();
    const exact = [...byCand.values()].filter((rs) =>
      rs.some((r) => (r.candidate_name || '').toLowerCase() === lc),
    );
    if (exact.length === 1) return { primary: pickPrimary(exact[0]), all: exact[0] };
    return {
      ambiguous: [...byCand.values()].slice(0, 10).map((rs) => ({
        candidate_id: rs[0].candidate_id,
        name: rs[0].candidate_name,
        headline: rs[0].candidate_headline,
      })),
    };
  }
  const all = [...byCand.values()][0];
  return { primary: pickPrimary(all), all };
}

const candidateArg = {
  candidate_id: { type: 'string', description: "Id de profil du candidat (si tu l'as)." },
  candidate_name: { type: 'string', description: 'Nom EXACT du candidat (sinon).' },
  mission_id: { type: 'string', description: 'UUID mission pour lever une ambiguïté (optionnel).' },
  mission_name: { type: 'string', description: 'Nom de mission pour lever une ambiguïté (optionnel).' },
};

function requireCandidateArg(params: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.organizationId) return { allowed: false as const, reason: 'No active organization' };
  const ref = String((params.candidate_id ?? params.candidate_name ?? '') as string).trim();
  return ref
    ? { allowed: true as const }
    : { allowed: false as const, reason: 'Précise le candidat (nom exact ou id).' };
}

// ─── Tool — get_candidate_detail ───────────────────────────────────────────
const getCandidateDetail: AgentTool = {
  name: 'get_candidate_detail',
  description:
    "Deep-dive on ONE candidate: parcours (expériences, formation), compétences, langues, headline, " +
    "scoring détaillé (score, points forts/faibles, skills manquants, adéquation expérience/localisation), " +
    "évaluations d'entretien et notes internes, et la liste des missions où il apparaît (avec étape/statut). " +
    "Use for 'tu peux m'en dire plus sur lui/elle', 'parle-moi de <nom>', 'son parcours', 'pourquoi ce score', " +
    "'ses points forts'. Pass candidate_name (or candidate_id); add mission_name to disambiguate. " +
    "Returns profile_path → render the name as a markdown link.",
  category: 'read',
  requiresApproval: false,
  inputSchema: { type: 'object', properties: { ...candidateArg }, required: [] },
  verifyAccess: (params, ctx) => Promise.resolve(requireCandidateArg(params, ctx)),
  dryRun: trivialDryRun('Lecture : fiche détaillée du candidat'),
  async execute(params, ctx) {
    const role = await resolveRole(ctx);
    const ref = await resolveCandidateRef(ctx, params, role);
    if (!ref) return { success: false, error: "Candidat introuvable — donne le nom exact (ou l'id), éventuellement avec la mission." };
    if ('ambiguous' in ref) {
      return { success: true, data: { ambiguous: true, candidates: ref.ambiguous, note: 'Plusieurs candidats correspondent — précise lequel (ou la mission).' } };
    }
    const { primary, all } = ref;
    const projectIds = [...new Set(all.map((r) => r.project_id).filter(Boolean))] as string[];
    const missionNames: Record<string, string> = {};
    if (projectIds.length) {
      const { data: ms } = await ctx.adminClient
        .from('sourcing_projects')
        .select('id, name, job_title')
        .in('id', projectIds);
      for (const m of (ms as Array<{ id: string; name: string | null; job_title: string | null }> | null) ?? []) {
        missionNames[m.id] = m.name || m.job_title || m.id;
      }
    }
    const [{ data: evals }, { data: notes }] = await Promise.all([
      ctx.adminClient
        .from('candidate_evaluations')
        .select('interview_stage, overall_score, recommendation, summary, ai_generated, created_at')
        .eq('organization_id', ctx.organizationId)
        .eq('candidate_id', primary.candidate_id)
        .order('created_at', { ascending: false })
        .limit(10),
      ctx.adminClient
        .from('candidate_notes')
        .select('content, created_at')
        .eq('organization_id', ctx.organizationId)
        .eq('candidate_id', primary.candidate_id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    return {
      success: true,
      data: {
        candidate: {
          name: primary.candidate_name,
          headline: primary.candidate_headline,
          linkedin_profile_url: primary.linkedin_profile_url,
          profile_path: primary.candidate_id ? `/ats/scorecard/${primary.candidate_id}` : null,
        },
        profile: summarizeProfile(primary.linkedin_profile_data),
        scoring: summarizeScoring(primary.scoring_details, primary),
        missions: all.map((r) => ({
          mission: r.project_id ? (missionNames[r.project_id] || null) : null,
          stage: r.pipeline_stage,
          status: r.status,
          score: r.score,
          recommendation: r.recommendation,
        })),
        evaluations: ((evals as Array<Record<string, unknown>> | null) ?? []).map((e) => ({
          ...e,
          summary: e.summary ? String(e.summary).slice(0, 600) : null,
        })),
        notes: ((notes as Array<{ content: string; created_at: string }> | null) ?? []).map((n) => ({
          content: String(n.content || '').slice(0, 600),
          created_at: n.created_at,
        })),
      },
    };
  },
};

// ─── Tool — get_upcoming_interviews ────────────────────────────────────────
const getUpcomingInterviews: AgentTool = {
  name: 'get_upcoming_interviews',
  description:
    "List scheduled interviews / qualification sessions in a date window (default: next 7 days). " +
    "Use for 'j'ai des entretiens cette semaine ?', 'mes prochains entretiens', 'qui je vois bientôt', " +
    "'entretiens prévus sur la mission X'. Optional: days (window length), from/to (ISO), mission_name, " +
    "candidate_name. Returns candidate, créneau, lieu, statut, mission, profile_path.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Taille de la fenêtre en jours à partir de maintenant (défaut 7, max 60).' },
      from: { type: 'string', description: 'Début de fenêtre ISO (optionnel, défaut = maintenant).' },
      to: { type: 'string', description: 'Fin de fenêtre ISO (optionnel, défaut = maintenant + days).' },
      mission_id: { type: 'string', description: 'UUID mission (optionnel).' },
      mission_name: { type: 'string', description: 'Nom de mission (optionnel).' },
      candidate_name: { type: 'string', description: 'Filtrer sur un candidat (optionnel).' },
    },
    required: [],
  },
  async verifyAccess(_p, ctx) {
    return ctx.organizationId ? { allowed: true } : { allowed: false, reason: 'No active organization' };
  },
  dryRun: trivialDryRun('Lecture : entretiens à venir'),
  async execute(params, ctx) {
    const role = await resolveRole(ctx);
    const days = Math.min(Math.max(Number(params.days) || 7, 1), 60);
    const now = new Date();
    const safeISO = (v: unknown, fallback: Date): string => {
      try {
        const d = new Date(String(v));
        return isNaN(d.getTime()) ? fallback.toISOString() : d.toISOString();
      } catch { return fallback.toISOString(); }
    };
    const fromISO = params.from ? safeISO(params.from, now) : now.toISOString();
    const toISO = params.to
      ? safeISO(params.to, new Date(now.getTime() + days * 864e5))
      : new Date(now.getTime() + days * 864e5).toISOString();
    let q = ctx.adminClient
      .from('qualification_sessions')
      .select('candidate_name, candidate_headline, candidate_profile_id, candidate_linkedin_url, event_name, event_location, event_start_at, event_end_at, status, verdict, job_title, project_id, created_by')
      .eq('organization_id', ctx.organizationId)
      .gte('event_start_at', fromISO)
      .lte('event_start_at', toISO);
    const mission = (params.mission_id || params.mission_name)
      ? await resolveMissionRef(ctx, params)
      : null;
    if (mission) q = q.eq('project_id', mission.id);
    if (params.candidate_name) {
      q = q.ilike('candidate_name', `%${String(params.candidate_name).slice(0, 80)}%`);
    }
    const { data, error } = await q.order('event_start_at', { ascending: true }).limit(100);
    if (error) return { success: false, error: error.message };
    let rows = ((data as Array<Record<string, any>> | null) ?? []);
    if (!isPrivileged(role)) {
      const ids = new Set(await collaboratorMissionIds(ctx));
      rows = rows.filter(
        (r) => r.created_by === ctx.userId || (!!r.project_id && ids.has(r.project_id)),
      );
    }
    const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as string[];
    const missionNames: Record<string, string> = {};
    if (projectIds.length) {
      const { data: ms } = await ctx.adminClient
        .from('sourcing_projects')
        .select('id, name, job_title')
        .in('id', projectIds);
      for (const m of (ms as Array<{ id: string; name: string | null; job_title: string | null }> | null) ?? []) {
        missionNames[m.id] = m.name || m.job_title || m.id;
      }
    }
    return {
      success: true,
      data: {
        range: { from: fromISO, to: toISO },
        count: rows.length,
        interviews: rows.map((r) => ({
          candidate_name: r.candidate_name,
          candidate_headline: r.candidate_headline,
          event_name: r.event_name,
          event_location: r.event_location,
          start_at: r.event_start_at,
          end_at: r.event_end_at,
          status: r.status,
          verdict: r.verdict,
          mission: r.project_id ? (missionNames[r.project_id] || null) : (r.job_title || null),
          profile_path: r.candidate_profile_id ? `/ats/scorecard/${r.candidate_profile_id}` : null,
        })),
        truncated: rows.length === 100,
      },
    };
  },
};

// ─── Tool — get_candidate_outreach ─────────────────────────────────────────
const getCandidateOutreach: AgentTool = {
  name: 'get_candidate_outreach',
  description:
    "Outreach history for ONE candidate: am I/we already in touch? Returns sequence enrollments (status, " +
    "replied, connection, step), InMails sent, and any message-analysis (intent/sentiment/summary). " +
    "Use for 'je l'ai déjà contacté ?', 'on a échangé avec lui ?', 'j'ai déjà discuté avec <nom> ?', " +
    "'qu'est-ce qu'il a répondu ?', 'résume notre échange', 'où en est la prospection sur ce candidat'. " +
    "Now ALSO returns the recent VERBATIM LinkedIn thread (who said what, chronological) when a connected " +
    "LinkedIn account holds the conversation. Sequence/analysis↔candidate matching stays best-effort (by " +
    "name). Pass candidate_name (or candidate_id).",
  category: 'read',
  requiresApproval: false,
  inputSchema: { type: 'object', properties: { ...candidateArg }, required: [] },
  verifyAccess: (params, ctx) => Promise.resolve(requireCandidateArg(params, ctx)),
  dryRun: trivialDryRun('Lecture : historique de prospection du candidat'),
  async execute(params, ctx) {
    const role = await resolveRole(ctx);
    const ref = await resolveCandidateRef(ctx, params, role);
    if (!ref) return { success: false, error: "Candidat introuvable — donne le nom exact (ou l'id)." };
    if ('ambiguous' in ref) {
      return { success: true, data: { ambiguous: true, candidates: ref.ambiguous, note: 'Plusieurs candidats correspondent — précise lequel.' } };
    }
    const { primary } = ref;
    const cid = primary.candidate_id;
    const url = (primary.linkedin_profile_url || '').trim();
    const idSafe = /^[\w.-]+$/.test(cid);
    const orParts = idSafe
      ? [`profile_id.eq.${cid}`, `provider_id.eq.${cid}`, `resolved_profile_id.eq.${cid}`].join(',')
      : '';
    const enrollSel =
      'status, connection_status, replied_at, completed_at, current_step_order, ' +
      'sequence_id, job_id, job_title, created_by, profile_url';
    const enrollByIdQ = orParts
      ? ctx.adminClient
          .from('sequence_enrollments')
          .select(enrollSel)
          .eq('organization_id', ctx.organizationId)
          .or(orParts)
          .limit(50)
      : Promise.resolve({ data: [] as Array<Record<string, any>> });
    const enrollByUrlQ = url
      ? ctx.adminClient
          .from('sequence_enrollments')
          .select(enrollSel)
          .eq('organization_id', ctx.organizationId)
          .eq('profile_url', url)
          .limit(50)
      : Promise.resolve({ data: [] as Array<Record<string, any>> });
    const inmailQ = idSafe
      ? ctx.adminClient
          .from('inmail_queue')
          .select('subject, status, sent_at, scheduled_at, created_by')
          .eq('organization_id', ctx.organizationId)
          .eq('recipient_profile_id', cid)
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as Array<Record<string, any>> });
    const nameForMsg = (primary.candidate_name || '').trim();
    const msgQ = nameForMsg
      ? ctx.adminClient
          .from('message_analysis_cache')
          .select('analysis, recipient_name, updated_at')
          .eq('organization_id', ctx.organizationId)
          .ilike('recipient_name', `%${nameForMsg.slice(0, 60)}%`)
          .order('updated_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as Array<Record<string, any>> });
    const [eById, eByUrl, inm, msg] = await Promise.all([enrollByIdQ, enrollByUrlQ, inmailQ, msgQ]);
    const seen = new Set<string>();
    let enrollments: Array<Record<string, any>> = [];
    for (const r of [...((eById.data as any[]) ?? []), ...((eByUrl.data as any[]) ?? [])]) {
      const k = `${r.sequence_id}|${r.status}|${r.current_step_order}|${r.replied_at ?? ''}`;
      if (!seen.has(k)) { seen.add(k); enrollments.push(r); }
    }
    if (!isPrivileged(role)) {
      const ids = new Set(await collaboratorMissionIds(ctx));
      enrollments = enrollments.filter(
        (r) => r.created_by === ctx.userId || (!!r.job_id && ids.has(r.job_id)),
      );
    }
    const inmails = ((inm.data as any[]) ?? []).filter(
      (r) => isPrivileged(role) || r.created_by === ctx.userId,
    );
    const analyses = ((msg.data as any[]) ?? []).map((m) => {
      const a = (m.analysis && typeof m.analysis === 'object') ? m.analysis as Record<string, unknown> : {};
      return {
        intent: a.intent ?? null,
        sentiment: a.sentiment ?? null,
        summary: a.summary ? String(a.summary).slice(0, 400) : null,
        recipient_name: m.recipient_name,
        updated_at: m.updated_at,
      };
    });
    const replied = enrollments.some((e) => !!e.replied_at) || analyses.length > 0;
    const contacted = enrollments.length > 0 || inmails.some((i) => i.status === 'sent' || !!i.sent_at);
    // Gap B — fil LinkedIn verbatim (live, fail-soft, jamais bloquant).
    const thread = await fetchLinkedInThread(ctx, cid).catch(() => null);
    const note = thread
      ? 'Fil LinkedIn verbatim ci-dessous (messages récents, ordre chronologique). ' +
        'Le rapprochement séquence/analyse↔candidat reste approximatif (par nom).'
      : 'Fil LinkedIn verbatim indisponible (aucun compte LinkedIn connecté ne contient ' +
        "cette conversation, ou conversation introuvable). Rapprochement message↔candidat " +
        'approximatif (par nom).';
    return {
      success: true,
      data: {
        candidate: {
          name: primary.candidate_name,
          headline: primary.candidate_headline,
          profile_path: cid ? `/ats/scorecard/${cid}` : null,
        },
        contacted,
        replied,
        enrollments: enrollments.map((e) => ({
          status: e.status,
          connection_status: e.connection_status,
          replied: !!e.replied_at,
          replied_at: e.replied_at,
          completed_at: e.completed_at,
          step: e.current_step_order,
          mission: e.job_title || null,
        })),
        inmails: inmails.map((i) => ({
          subject: i.subject, status: i.status, sent_at: i.sent_at, scheduled_at: i.scheduled_at,
        })),
        message_analyses: analyses,
        linkedin_thread: thread,
        note,
      },
    };
  },
};

// ─── Tool — search_knowledge (RAG sémantique : ciblé candidat OU transverse) ─
// Invoque l'edge fn `retrieve-context` (recherche vectorielle sur le
// knowledge lake, alimenté en temps réel par triggers : notes, commentaires,
// comptes-rendus d'appel, évaluations, profil/expériences LinkedIn, échanges).
// Appel interne edge→edge en SERVICE ROLE (Mode B de retrieve-context) — PAS
// anon : l'anon key n'est ni JWT user ni service key → requireAuth 401.
// Pattern qui marche = generate-outreach-message / process-sequences.
// La base est indexée par entity_id = job_candidate_status.candidate_id
// (vérifié dans auto-ingest-context) = exactement primary.candidate_id.
function ragFetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 25000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Gap B — fil LinkedIn verbatim. Résout le(s) compte(s) LinkedIn de l'org
// (ceux de l'utilisateur courant d'abord) puis interroge le service de
// connexion LinkedIn EN INTERNE (clé service-role, Mode B) : get_chats par
// attendee (= id de profil LinkedIn du candidat = job_candidate_status.
// candidate_id, cf. CardMessageThread côté front) → get_messages. Fail-soft :
// renvoie null si pas de compte / pas de conversation / erreur. AUCUNE
// mention de fournisseur dans le texte (règle branding : on dit "LinkedIn").
async function fetchLinkedInThread(
  ctx: ToolContext,
  candidateId: string,
): Promise<{ message_count: number; messages: Array<{ from: string; date: string | null; text: string }> } | null> {
  const candId = String(candidateId || '').trim();
  if (!candId) return null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return null;

  const { data: accRows } = await ctx.adminClient
    .from('member_linkedin_accounts')
    .select('linkedin_account_id, user_id')
    .eq('organization_id', ctx.organizationId)
    .limit(20);
  const rows = (accRows as Array<{ linkedin_account_id: string | null; user_id: string | null }> | null) ?? [];
  const accounts: string[] = [];
  const seenAcc = new Set<string>();
  for (const r of rows) {
    const id = (r.linkedin_account_id || '').trim();
    if (id && r.user_id === ctx.userId && !seenAcc.has(id)) { seenAcc.add(id); accounts.push(id); }
  }
  for (const r of rows) {
    const id = (r.linkedin_account_id || '').trim();
    if (id && !seenAcc.has(id)) { seenAcc.add(id); accounts.push(id); }
  }
  if (accounts.length === 0) return null;

  const callUnipile = async (body: Record<string, unknown>): Promise<any | null> => {
    try {
      const res = await ragFetchWithTimeout(`${supabaseUrl}/functions/v1/unipile-search`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 12000);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  for (const accountId of accounts.slice(0, 3)) {
    const chatsResp = await callUnipile({
      action: 'get_chats',
      organization_id: ctx.organizationId,
      account_id: accountId,
      attendee_provider_id: candId,
      limit: 5,
    });
    const chats = chatsResp && Array.isArray(chatsResp.chats) ? chatsResp.chats : [];
    const chatId = chats[0]?.id;
    if (!chatId) continue;
    const msgResp = await callUnipile({
      action: 'get_messages',
      organization_id: ctx.organizationId,
      account_id: accountId,
      chat_id: chatId,
      limit: 20,
    });
    const raw = msgResp && Array.isArray(msgResp.messages) ? msgResp.messages : [];
    if (!raw.length) continue;
    const messages = raw
      .map((m: any) => ({
        from: m?.is_sender ? 'nous' : 'candidat',
        date: (m?.timestamp || m?.date || null) as string | null,
        text: String(m?.text ?? m?.text_content ?? '').trim().slice(0, 800),
      }))
      .filter((m: { text: string }) => m.text.length > 0)
      .sort((a: { date: string | null }, b: { date: string | null }) =>
        new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
      .slice(-20);
    if (messages.length === 0) continue;
    return { message_count: messages.length, messages };
  }
  return null;
}

const searchKnowledge: AgentTool = {
  name: 'search_knowledge',
  description:
    "Recherche SÉMANTIQUE (texte libre) dans la base de connaissance Konekt : notes internes, " +
    "commentaires d'équipe, comptes-rendus d'appel, évaluations d'entretien, profil/expériences " +
    "LinkedIn, échanges. Par DÉFAUT cherche À TRAVERS TOUS les candidats accessibles (toute " +
    "l'organisation pour owner/admin ; tes missions pour un collaborateur) — idéal pour les " +
    "questions TRANSVERSES qui ne nomment pas de candidat : « quels candidats ont parlé de " +
    "télétravail », « qui a des réserves sur leur dispo », « des retours mentionnant un préavis " +
    "long ». Pour cibler UN candidat précis, passe candidate_name OU candidate_id (réduit la " +
    "recherche à lui : « qu'a-t-on dit sur X », « nos réserves sur X »). Passe entity:'job' " +
    "pour chercher dans les BRIEFS DE MISSIONS (poste, client, compétences, séniorité, " +
    "télétravail, rémunération, contexte) au lieu des candidats : « ai-je une mission qui " +
    "cherche du Go senior », « des missions full remote », « quelles missions chez tel " +
    "client ». À utiliser pour les " +
    "questions OUVERTES qu'aucun outil structuré ne couvre. Pour des faits structurés (score, " +
    "étape, missions, entretiens, prospection) préfère get_candidate_detail / get_*.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'La question / les mots-clés en texte libre à rechercher sémantiquement.' },
      entity: { type: 'string', description: "OPTIONNEL — 'candidate' (défaut) = cherche dans les candidats ; 'job' = cherche dans les BRIEFS DE MISSIONS (poste/client/compétences/contexte). Mets 'job' pour toute question sur les missions ou postes ouverts." },
      candidate_id: { type: 'string', description: "OPTIONNEL — restreint la recherche à CE candidat (id de profil). Laisse vide pour chercher à travers tous les candidats accessibles." },
      candidate_name: { type: 'string', description: "OPTIONNEL — restreint la recherche à CE candidat (nom EXACT). Laisse vide pour une recherche transverse." },
      mission_id: { type: 'string', description: "UUID mission pour lever une ambiguïté de nom (optionnel, seulement si tu cibles un candidat)." },
      mission_name: { type: 'string', description: 'Nom de mission pour lever une ambiguïté (optionnel, seulement si tu cibles un candidat).' },
      limit: { type: 'number', description: "Nb max d'extraits (défaut 8, max 15)." },
    },
    required: ['query'],
  },
  async verifyAccess(params, ctx) {
    if (!ctx.organizationId) return { allowed: false, reason: 'No active organization' };
    if (!String((params.query ?? '') as string).trim()) return { allowed: false, reason: 'Précise la recherche (query).' };
    return { allowed: true };
  },
  dryRun: trivialDryRun('Lecture : recherche sémantique base de connaissance'),
  async execute(params, ctx) {
    const role = await resolveRole(ctx);
    const query = String(params.query ?? '').slice(0, 500);
    const limit = Math.min(Math.max(Number(params.limit) || 8, 1), 15);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    // SERVICE ROLE (pas anon) : appel interne edge→edge. retrieve-context
    // exige requireAuth → l'anon key n'est NI un JWT user NI la service key
    // donc getUser échoue → 401. Le pattern qui marche (generate-outreach-
    // message, process-sequences) = service role → Mode B (auth.method
    // 'service_role' + organization_id du body, déjà vérifié côté appelant).
    const serviceKey = Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return { success: false, error: 'Service indisponible.' };

    // Appel fail-soft à retrieve-context (service role, Mode B interne).
    const callRetrieve = async (
      payload: Record<string, unknown>,
    ): Promise<Array<Record<string, any>>> => {
      const res = await ragFetchWithTimeout(`${supabaseUrl}/functions/v1/retrieve-context`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.chunks) ? data.chunks : [];
    };

    // ── entity:'job' → recherche transverse dans les briefs de missions ──
    // (RAG v3). owner/admin → toute l'org ; collaborateur → allow-list de
    // ses missions (own + team). Attribution par mission via entity_id.
    const entity = String((params.entity ?? 'candidate') as string).toLowerCase() === 'job'
      ? 'job'
      : 'candidate';
    if (entity === 'job') {
      let jobAllowList: string[] | null = null;
      let jscope: 'org' | 'missions' = 'org';
      if (!isPrivileged(role)) {
        const ids = await collaboratorMissionIds(ctx);
        jscope = 'missions';
        if (ids.length === 0) {
          return { success: true, data: { scope: jscope, entity: 'job', query, found: 0, extracts: [], note: 'Aucune mission accessible.' } };
        }
        jobAllowList = ids.slice(0, 3000);
      }
      try {
        const chunks = await callRetrieve({
          organization_id: ctx.organizationId,
          org_wide: true,
          entity_type: 'job',
          ...(jobAllowList ? { entity_ids: jobAllowList } : {}),
          query,
          limit,
        });
        const mIds = [...new Set(
          chunks.map((c) => c.entity_id).filter((x): x is string => typeof x === 'string' && x.length > 0),
        )];
        const missionMap = new Map<string, { name: string | null; job_title: string | null; client_name: string | null }>();
        if (mIds.length > 0) {
          const { data: ms } = await ctx.adminClient
            .from('sourcing_projects')
            .select('id, name, job_title, client_name')
            .eq('organization_id', ctx.organizationId)
            .in('id', mIds.slice(0, 200));
          for (const r of (ms as Array<{ id: string; name: string | null; job_title: string | null; client_name: string | null }> | null) ?? []) {
            if (!missionMap.has(r.id)) missionMap.set(r.id, { name: r.name, job_title: r.job_title, client_name: r.client_name });
          }
        }
        return {
          success: true,
          data: {
            scope: jscope,
            entity: 'job',
            query,
            found: chunks.length,
            extracts: chunks.slice(0, limit).map((c) => {
              const m = c.entity_id ? missionMap.get(c.entity_id) : undefined;
              return {
                mission: c.entity_id
                  ? {
                      name: m?.name ?? null,
                      job_title: m?.job_title ?? null,
                      client: m?.client_name ?? null,
                      mission_path: `/missions/${c.entity_id}`,
                    }
                  : null,
                type: c.chunk_type,
                content: String(c.content || '').slice(0, 700),
                similarity: typeof c.similarity === 'number' ? Math.round(c.similarity * 100) / 100 : undefined,
              };
            }),
            ...(chunks.length === 0
              ? { note: jscope === 'missions'
                  ? 'Rien trouvé dans tes missions pour cette requête.'
                  : "Rien trouvé dans les missions de l'organisation pour cette requête." }
              : {}),
          },
        };
      } catch (e) {
        console.warn('[search_knowledge] job retrieve-context error:', e);
        return { success: false, error: 'Recherche sémantique momentanément indisponible.' };
      }
    }

    const hasCandidate = Boolean(
      String((params.candidate_id ?? params.candidate_name ?? '') as string).trim(),
    );

    // ── Ancré sur UN candidat (comportement v1, inchangé) ──────────────
    if (hasCandidate) {
      const ref = await resolveCandidateRef(ctx, params, role);
      if (!ref) return { success: false, error: "Candidat introuvable — donne le nom exact (ou l'id)." };
      if ('ambiguous' in ref) {
        return { success: true, data: { ambiguous: true, candidates: ref.ambiguous, note: 'Plusieurs candidats correspondent — précise lequel.' } };
      }
      const { primary } = ref;
      try {
        const chunks = await callRetrieve({
          organization_id: ctx.organizationId,
          entity_type: 'candidate',
          entity_id: primary.candidate_id,
          query,
          limit,
        });
        return {
          success: true,
          data: {
            scope: 'candidate',
            candidate: {
              name: primary.candidate_name,
              headline: primary.candidate_headline,
              profile_path: primary.candidate_id ? `/ats/scorecard/${primary.candidate_id}` : null,
            },
            query,
            found: chunks.length,
            extracts: chunks.slice(0, limit).map((c) => ({
              type: c.chunk_type,
              date: c.metadata?.date ?? c.metadata?.last_message_date ?? null,
              content: String(c.content || '').slice(0, 700),
              similarity: typeof c.similarity === 'number' ? Math.round(c.similarity * 100) / 100 : undefined,
            })),
            ...(chunks.length === 0
              ? { note: 'Rien trouvé dans la base de connaissance pour ce candidat sur cette requête.' }
              : {}),
          },
        };
      } catch (e) {
        console.warn('[search_knowledge] retrieve-context error:', e);
        return { success: false, error: 'Recherche sémantique momentanément indisponible.' };
      }
    }

    // ── Transverse (aucun candidat nommé) : rappel cross-candidats ─────
    // owner/admin → toute l'org ; collaborateur → allow-list des candidats
    // de ses missions (own + team), même règle que resolveCandidateRef.
    let allowList: string[] | null = null;
    let scope: 'org' | 'missions' = 'org';
    if (!isPrivileged(role)) {
      const missionIds = await collaboratorMissionIds(ctx);
      let cq = ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_id')
        .eq('organization_id', ctx.organizationId);
      cq = missionIds.length > 0
        ? cq.or(`created_by.eq.${ctx.userId},project_id.in.(${missionIds.join(',')})`)
        : cq.eq('created_by', ctx.userId);
      const { data: rows } = await cq.limit(5000);
      const ids = new Set<string>();
      for (const r of (rows as Array<{ candidate_id: string | null }> | null) ?? []) {
        if (r.candidate_id) ids.add(r.candidate_id);
      }
      scope = 'missions';
      if (ids.size === 0) {
        return { success: true, data: { scope, query, found: 0, extracts: [], note: 'Aucun candidat accessible dans tes missions.' } };
      }
      allowList = [...ids].slice(0, 3000);
    }

    try {
      const chunks = await callRetrieve({
        organization_id: ctx.organizationId,
        org_wide: true,
        entity_type: 'candidate',
        ...(allowList ? { entity_ids: allowList } : {}),
        query,
        limit,
      });
      // Attribue chaque extrait à son candidat (résolution de noms en lot).
      const entIds = [...new Set(
        chunks.map((c) => c.entity_id).filter((x): x is string => typeof x === 'string' && x.length > 0),
      )];
      const nameMap = new Map<string, { name: string | null; headline: string | null }>();
      if (entIds.length > 0) {
        const { data: cands } = await ctx.adminClient
          .from('job_candidate_status')
          .select('candidate_id, candidate_name, candidate_headline')
          .eq('organization_id', ctx.organizationId)
          .in('candidate_id', entIds.slice(0, 200));
        for (const r of (cands as Array<{ candidate_id: string; candidate_name: string | null; candidate_headline: string | null }> | null) ?? []) {
          if (!nameMap.has(r.candidate_id)) nameMap.set(r.candidate_id, { name: r.candidate_name, headline: r.candidate_headline });
        }
      }
      return {
        success: true,
        data: {
          scope,
          query,
          found: chunks.length,
          extracts: chunks.slice(0, limit).map((c) => {
            const cand = c.entity_id ? nameMap.get(c.entity_id) : undefined;
            return {
              candidate: c.entity_id
                ? {
                    name: cand?.name ?? null,
                    headline: cand?.headline ?? null,
                    profile_path: `/ats/scorecard/${c.entity_id}`,
                  }
                : null,
              type: c.chunk_type,
              date: c.metadata?.date ?? c.metadata?.last_message_date ?? null,
              content: String(c.content || '').slice(0, 700),
              similarity: typeof c.similarity === 'number' ? Math.round(c.similarity * 100) / 100 : undefined,
            };
          }),
          ...(chunks.length === 0
            ? { note: scope === 'missions'
                ? 'Rien trouvé dans la base de connaissance sur tes missions pour cette requête.'
                : "Rien trouvé dans la base de connaissance de l'organisation pour cette requête." }
            : {}),
        },
      };
    } catch (e) {
      console.warn('[search_knowledge] org-wide retrieve-context error:', e);
      return { success: false, error: 'Recherche sémantique momentanément indisponible.' };
    }
  },
};

// ============================================================================
// Registration
// ============================================================================
let registered = false;

export function registerReadTools(): void {
  if (registered) return;
  registerTool(getMyMissions);
  registerTool(getMissionOverview);
  registerTool(getMissionCandidates);
  registerTool(getMissionProcess);
  registerTool(getSequencesStatus);
  registerTool(getCandidateDetail);
  registerTool(getUpcomingInterviews);
  registerTool(getCandidateOutreach);
  registerTool(searchKnowledge);
  registered = true;
}
