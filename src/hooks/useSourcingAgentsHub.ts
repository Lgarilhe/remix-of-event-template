import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { validSourcingAgentSettings, type SourcingAgentApi, type SourcingAgentSource, type SourcingAgentState, type SourcingAgentSettings } from '@/types/sourcingAgent';
import type { SourcingAgentHubAgent, SourcingAgentHubCounts, SourcingAgentHubMission, SourcingAgentsHubData } from '@/types/sourcingAgentsHub';

const PAGE_SIZE = 200;
// Literal parsing of long JSON-path selects exceeds the SDK's TS depth limit;
// .returns below gives each projection a narrow schema-backed row contract.
const AGENT_COLUMNS: string = 'id,organization_id,project_id,created_by,source,account_id,api,status,revision,settings,approved_context_key,context_key:context_snapshot->>context_key,next_run_at,last_run_at,lease_until,last_reason,last_error,daily_date,profiles_used,credits_reserved,credits_used,created_at,updated_at';
const MISSION_COLUMNS = 'id,organization_id,created_by,name,status,kind,client_name,job_title,updated_at' as const;

const isState = (value: string): value is SourcingAgentState => ['draft', 'calibrating', 'active', 'paused', 'blocked', 'awaiting_review', 'stopped'].includes(value);
const isSource = (value: string): value is SourcingAgentSource => value === 'pool' || value === 'linkedin';
const isApi = (value: string): value is SourcingAgentApi => ['classic', 'recruiter', 'sales_navigator'].includes(value);
const isCadence = (value: Json | undefined): value is SourcingAgentSettings['cadence_hours'] => value === 2 || value === 6 || value === 12 || value === 24;

function readSettings(value: Json): SourcingAgentSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isCadence(value.cadence_hours)
    || typeof value.daily_profile_limit !== 'number' || typeof value.daily_credit_limit !== 'number'
    || typeof value.max_pending !== 'number' || typeof value.min_score !== 'number' || typeof value.model_id !== 'string') {
    throw new Error('Les réglages d’un agent ne peuvent pas être vérifiés. Actualisez la liste.');
  }
  const settings: SourcingAgentSettings = {
    cadence_hours: value.cadence_hours, daily_profile_limit: value.daily_profile_limit,
    daily_credit_limit: value.daily_credit_limit, max_pending: value.max_pending,
    min_score: value.min_score, model_id: value.model_id,
  };
  if (!validSourcingAgentSettings(settings)) throw new Error('Les réglages d’un agent ne peuvent pas être vérifiés. Actualisez la liste.');
  return settings;
}

type AgentRow = Omit<SourcingAgentHubAgent, 'settings' | 'source' | 'api' | 'status' | 'context_key'> & {
  settings: Json; source: string; api: string | null; status: string; context_key: unknown;
};
type MissionRow = Pick<Database['public']['Tables']['sourcing_projects']['Row'],
  'id' | 'organization_id' | 'created_by' | 'name' | 'status' | 'kind' | 'client_name' | 'job_title' | 'updated_at'>;
function readMission(row: MissionRow, organizationId: string): SourcingAgentHubMission {
  return { id: row.id, organization_id: organizationId, created_by: row.created_by, name: row.name,
    status: row.status, client_name: row.client_name, job_title: row.job_title, updated_at: row.updated_at };
}
function readAgent(row: AgentRow): SourcingAgentHubAgent {
  if (!isState(row.status) || !isSource(row.source) || (row.api !== null && !isApi(row.api))) {
    throw new Error('L’état d’un agent ne peut pas être vérifié. Actualisez la liste.');
  }
  const api: SourcingAgentApi | null = row.api === null ? null : isApi(row.api) ? row.api : null;
  return { ...row, source: row.source, status: row.status, api,
    settings: readSettings(row.settings), context_key: typeof row.context_key === 'string' ? row.context_key : null };
}

function latestDate(...dates: Array<string | null | undefined>): string | null {
  return dates.reduce<string | null>((latest, value) => value && Number.isFinite(Date.parse(value))
    && (!latest || Date.parse(value) > Date.parse(latest)) ? value : latest, null);
}
const emptyCounts = (): SourcingAgentHubCounts => ({ total: 0, discovered: 0, evaluated: 0, proposed: 0, reviewed: 0, fit: 0, rejected: 0, skipped: 0, uncertain: 0 });

async function readAllPages<Row extends { id: string }>(
  requestPage: (cursor: string | null) => PromiseLike<{ data: Row[] | null; error: unknown }>,
  guard: () => void,
): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (;;) {
    guard();
    const { data, error } = await requestPage(cursor);
    guard();
    if (error || !data) throw new Error('La liste des agents ne peut pas être chargée. Réessayez.');
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
    const next = data[data.length - 1]?.id;
    if (!next || next === cursor) throw new Error('La liste des agents est incomplète. Actualisez la page.');
    cursor = next;
  }
}

/** Browser/RLS reads only. No account metadata, Edge Function, LinkedIn or model call. */
export async function fetchSourcingAgentsHub(
  client: SupabaseClient<Database>, organizationId: string, userId: string,
  signal: AbortSignal, isCurrent: () => boolean = () => true,
): Promise<SourcingAgentsHubData> {
  const guard = () => {
    if (signal.aborted || !isCurrent()) throw new Error('Le contexte a changé. Actualisez les agents de cet espace.');
  };
  guard();
  if (!organizationId || !userId) throw new Error('Ouvrez un espace de travail pour consulter vos agents.');
  const [agentRows, missionRows] = await Promise.all([
    readAllPages(cursor => {
      let query = client.from('sourcing_agents').select(AGENT_COLUMNS)
        .eq('organization_id', organizationId).eq('created_by', userId).order('id').limit(PAGE_SIZE);
      if (cursor) query = query.gt('id', cursor);
      return query.abortSignal(signal).returns<AgentRow[]>();
    }, guard),
    readAllPages(cursor => {
      let query = client.from('sourcing_projects').select(MISSION_COLUMNS)
        .eq('organization_id', organizationId).eq('created_by', userId).eq('kind', 'mission').order('id').limit(PAGE_SIZE);
      if (cursor) query = query.gt('id', cursor);
      return query.abortSignal(signal);
    }, guard),
  ]);
  guard();
  // Preserve the personal scope even if a stale cache or permissive admin RLS
  // accidentally includes another actor's records in a response.
  const own = (row: { organization_id: string | null; created_by: string }) => row.organization_id === organizationId && row.created_by === userId;
  const today = new Date().toISOString().slice(0, 10);
  const agents = agentRows.filter(own).map(readAgent).map(agent => agent.daily_date === today ? agent : {
    ...agent, profiles_used: 0, credits_used: 0,
  });
  const missions = missionRows.filter(row => own(row) && row.kind === 'mission').map(row => readMission(row, organizationId));
  const missionById = new Map(missions.map(mission => [mission.id, mission]));
  // A personal agent can operate on a shared mission. Fetch only those linked
  // mission names under RLS; never enumerate other members' mission lists.
  const missingProjectIds = [...new Set(agents.map(agent => agent.project_id).filter(id => !missionById.has(id)))];
  for (let offset = 0; offset < missingProjectIds.length; offset += 100) {
    guard();
    const ids = missingProjectIds.slice(offset, offset + 100);
    const { data, error } = await client.from('sourcing_projects').select(MISSION_COLUMNS)
      .eq('organization_id', organizationId).eq('kind', 'mission').in('id', ids).order('id').limit(100).abortSignal(signal);
    guard();
    if (error || !data) throw new Error('Les missions liées à vos agents ne peuvent pas être chargées. Réessayez.');
    for (const row of data) {
      if (row.organization_id !== organizationId || row.kind !== 'mission' || !ids.includes(row.id)) continue;
      const mission = readMission(row, organizationId);
      missionById.set(mission.id, mission);
    }
  }
  const items = agents.map(agent => ({ agent, mission: missionById.get(agent.project_id) ?? null,
    counts: emptyCounts(), lastActivityAt: latestDate(agent.updated_at, agent.last_run_at) }));
  const itemById = new Map(items.map(item => [item.agent.id, item]));
  // Aggregates are computed under RLS in the database. The browser never
  // walks profile history or downloads one candidate row to populate cards.
  for (let offset = 0; offset < agents.length; offset += 100) {
    guard();
    const ids = agents.slice(offset, offset + 100).map(agent => agent.id);
    const { data, error } = await client.rpc('sourcing_agent_hub_counts', {
      p_organization_id: organizationId, p_agent_ids: ids,
    }).abortSignal(signal);
    guard();
    if (error || !data) throw new Error('Les compteurs des agents ne peuvent pas être chargés. Réessayez.');
    const returned = new Set<string>();
    for (const row of data) {
      const item = itemById.get(row.agent_id);
      if (!item || !ids.includes(row.agent_id) || returned.has(row.agent_id)) {
        throw new Error('Les compteurs reçus ne correspondent pas à vos agents. Actualisez la liste.');
      }
      if (row.context_key !== item.agent.context_key) throw new Error('Le cadrage d’un agent a changé. Actualisez la liste.');
      const counts: SourcingAgentHubCounts = { total: row.total, discovered: row.discovered, evaluated: row.evaluated,
        proposed: row.proposed, reviewed: row.reviewed, fit: row.fit, rejected: row.rejected, skipped: row.skipped, uncertain: row.uncertain };
      if (Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0)) {
        throw new Error('Les compteurs d’un agent ne peuvent pas être vérifiés. Actualisez la liste.');
      }
      item.counts = counts;
      item.lastActivityAt = latestDate(item.lastActivityAt, row.last_activity_at);
      returned.add(row.agent_id);
    }
    if (returned.size !== ids.length) throw new Error('Un agent n’est plus accessible. Actualisez la liste.');
  }
  guard();
  return { agents: items.sort((a, b) => Date.parse(b.lastActivityAt || '') - Date.parse(a.lastActivityAt || '') || a.agent.id.localeCompare(b.agent.id)),
    missions: [...missionById.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id)) };
}

export function useSourcingAgentsHub() {
  const { organizationId, isLoading: organizationLoading, isError: organizationError } = useOrganization();
  const { user, isReady } = useAuthReady();
  const userId = user?.id;
  const available = isReady && !organizationLoading && !organizationError && Boolean(organizationId && userId);
  const key = `${organizationId ?? ''}:${userId ?? ''}:${available}`;
  const scope = useRef({ key, generation: 0 });
  if (scope.current.key !== key) scope.current = { key, generation: scope.current.generation + 1 };
  const generation = scope.current.generation;
  const query = useQuery({
    queryKey: ['sourcing-agents-hub', organizationId, userId], enabled: available,
    queryFn: ({ signal }) => {
      if (!available || !organizationId || !userId) throw new Error('Ouvrez un espace de travail pour consulter vos agents.');
      return fetchSourcingAgentsHub(supabase, organizationId, userId, signal,
        () => scope.current.key === key && scope.current.generation === generation);
    },
    staleTime: 15_000, retry: false, refetchOnMount: 'always',
    refetchInterval: 30_000, refetchIntervalInBackground: false,
  });
  return {
    agents: available ? query.data?.agents ?? [] : [],
    missions: available ? query.data?.missions ?? [] : [],
    isLoading: !isReady || organizationLoading || (available && query.isLoading),
    isFetching: available && query.isFetching,
    isError: organizationError || (available && query.isError),
    error: organizationError ? new Error('Cet espace ne peut pas être vérifié. Réessayez.') : available ? query.error : null,
    refetch: query.refetch,
  };
}
