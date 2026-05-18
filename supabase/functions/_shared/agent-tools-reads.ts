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
    "List the recruitment missions (sourcing projects) the user can see, with status and sourcing stats. " +
    "Use when the user asks 'mes missions', 'quelles missions actives', 'sur quoi je bosse', 'combien de postes ouverts'. " +
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
    return { success: true, data: { role, count: (data ?? []).length, missions: data ?? [] } };
  },
};

// ─── Tool — get_mission_overview ───────────────────────────────────────────
const getMissionOverview: AgentTool = {
  name: 'get_mission_overview',
  description:
    "Get a snapshot of ONE mission: meta (title, client, status), sourcing stats, pipeline breakdown by stage, " +
    "and the top candidates by score. Use for 'où en est cette mission', 'résume le pipeline', 'combien de candidats à chaque étape'. " +
    "Pass the mission id (you know it from the CONTEXTE APPLICATIF block when the user is on a mission).",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: { mission_id: { type: 'string', description: 'sourcing_projects UUID.' } },
    required: ['mission_id'],
  },
  async verifyAccess(params, ctx) {
    const missionId = String(params.mission_id || '');
    if (!missionId) return { allowed: false, reason: 'mission_id requis' };
    const mission = await loadMission(ctx, missionId);
    if (!mission) return { allowed: false, reason: `Mission ${missionId} introuvable` };
    const role = await resolveRole(ctx);
    return (await canAccessMission(ctx, role, mission))
      ? { allowed: true }
      : { allowed: false, reason: "Tu n'as pas accès à cette mission (rôle/portée)." };
  },
  dryRun: trivialDryRun('Lecture : aperçu de la mission'),
  async execute(params, ctx) {
    const missionId = String(params.mission_id);
    const [{ data: mission }, { data: rows }] = await Promise.all([
      ctx.adminClient
        .from('sourcing_projects')
        .select('id, name, job_title, client_name, status, stats_total_found, stats_scored, stats_shortlisted, stats_messaged, stats_dismissed')
        .eq('id', missionId)
        .maybeSingle(),
      ctx.adminClient
        .from('job_candidate_status')
        .select('candidate_name, pipeline_stage, status, score')
        .eq('job_id', missionId)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(300),
    ]);
    const list = (rows as Array<{ candidate_name: string | null; pipeline_stage: string | null; status: string; score: number | null }> | null) ?? [];
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
        })),
      },
    };
  },
};

// ─── Tool — get_mission_candidates ─────────────────────────────────────────
const getMissionCandidates: AgentTool = {
  name: 'get_mission_candidates',
  description:
    "List candidates of ONE mission with their pipeline stage, status, score and recommendation. " +
    "Optional filters by stage or minimum score. Use for 'montre les candidats en pré-qualif', " +
    "'qui sont les meilleurs profils', 'liste des shortlistés'.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: { type: 'string', description: 'sourcing_projects UUID.' },
      stage: { type: 'string', description: "Optional pipeline stage filter (e.g. 'Pressenti', 'Pré-qualif')." },
      min_score: { type: 'number', description: 'Optional minimum score (0-100).' },
      limit: { type: 'number', description: 'Max candidates (default 25, hard cap 50).' },
    },
    required: ['mission_id'],
  },
  verifyAccess: (params, ctx) => getMissionOverview.verifyAccess(params, ctx),
  dryRun: trivialDryRun('Lecture : candidats de la mission'),
  async execute(params, ctx) {
    const missionId = String(params.mission_id);
    const limit = Math.min(Math.max(Number(params.limit) || 25, 1), 50);
    let q = ctx.adminClient
      .from('job_candidate_status')
      .select('candidate_name, candidate_headline, pipeline_stage, status, score, recommendation')
      .eq('job_id', missionId);
    if (params.stage) q = q.eq('pipeline_stage', String(params.stage));
    if (params.min_score != null) q = q.gte('score', Number(params.min_score));
    const { data, error } = await q
      .order('score', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) return { success: false, error: error.message };
    return { success: true, data: { count: (data ?? []).length, candidates: data ?? [] } };
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
    properties: { mission_id: { type: 'string', description: 'sourcing_projects UUID.' } },
    required: ['mission_id'],
  },
  verifyAccess: (params, ctx) => getMissionOverview.verifyAccess(params, ctx),
  dryRun: trivialDryRun('Lecture : process de la mission'),
  async execute(params, ctx) {
    const missionId = String(params.mission_id);
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
    "enrollment status, plus reply/connection counts. Use for 'où en est la prospection', 'combien ont répondu', " +
    "'qui est en séquence'.",
  category: 'read',
  requiresApproval: false,
  inputSchema: {
    type: 'object',
    properties: { mission_id: { type: 'string', description: 'sourcing_projects UUID.' } },
    required: ['mission_id'],
  },
  verifyAccess: (params, ctx) => getMissionOverview.verifyAccess(params, ctx),
  dryRun: trivialDryRun('Lecture : statut prospection de la mission'),
  async execute(params, ctx) {
    const missionId = String(params.mission_id);
    const { data, error } = await ctx.adminClient
      .from('sequence_enrollments')
      .select('status, connection_status, replied_at, completed_at')
      .eq('job_id', missionId)
      .limit(1000);
    if (error) return { success: false, error: error.message };
    const rows = (data as Array<{ status: string; connection_status: string | null; replied_at: string | null; completed_at: string | null }> | null) ?? [];
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[r.status || '(?)'] = (byStatus[r.status || '(?)'] || 0) + 1;
    return {
      success: true,
      data: {
        total_enrolled: rows.length,
        by_status: byStatus,
        replied: rows.filter((r) => !!r.replied_at).length,
        connected: rows.filter((r) => r.connection_status === 'connected').length,
        completed: rows.filter((r) => !!r.completed_at).length,
        truncated: rows.length === 1000,
      },
    };
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
  registered = true;
}
