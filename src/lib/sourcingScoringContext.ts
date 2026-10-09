import type { AgentMemory } from '@/types/agentMemory';
import type { Job } from '@/types/jobs';
import type { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import type { JobCandidateStatus } from '@/hooks/useJobCandidateStatus';

/** Exact, stable comparison key: no lossy client hash can reuse another brief's score. */
export const SOURCING_SCORING_ENGINE_VERSION = 'sourcing-v3';

export function stableScoringContextKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableScoringContextKey).join(',') + ']';
  return '{' + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + stableScoringContextKey(item)).join(',') + '}';
}

export interface ScoringInputContextOptions {
  organizationId?: string | null;
  projectId?: string | null;
  requestModel: string;
  memoryVersionKey: string;
}

function isScoringRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Remove representation-only differences between worker and UI: storage aliases
 * for a verified mission, absent/empty optional text, TJM alias, and client/company
 * identifiers not used by scoring. Business criteria and the complete brief stay exact.
 */
export function normalizeScoringJob(job: unknown, projectId?: string | null): Record<string, unknown> {
  const values = isScoringRecord(job) ? job : {};
  const keys = [
    'id', 'title', 'requirements', 'description', 'seniority', 'location', 'remote',
    'xpMin', 'xpMax', 'salaryMin', 'salaryMax', 'tjmMax', 'contractType', 'mustHave', 'shouldHave', 'niceToHave',
    'bodyContent', 'originalBriefText', 'sourcingCriteria', 'transversalCriteria', 'evaluationCriteria',
    'evaluationWeights', 'targetCompanies', 'calibrationProfiles', 'skillsToAvoid', 'requiredLanguages',
    'requiredCertifications', 'urgency', 'teamSize', 'reportsTo', 'manages', 'pedigreeRequirements',
    'pedigreePresetName',
  ];
  const normalized: Record<string, unknown> = Object.fromEntries(keys
    .filter(key => values[key] !== undefined && values[key] !== null && values[key] !== '')
    .map(key => [key, values[key]]));
  if (projectId) normalized.id = 'project:' + projectId;
  normalized.skills = values.skills || [];
  const tjmMin = values.tjmMin ?? values.tjm;
  if (tjmMin !== undefined && tjmMin !== null) normalized.tjmMin = tjmMin;
  if (isScoringRecord(values.client)) {
    const clientValues = values.client;
    const client = Object.fromEntries(['name', 'sector', 'size', 'cultureNotes']
      .filter(key => clientValues[key] !== undefined && clientValues[key] !== null && clientValues[key] !== '')
      .map(key => [key, clientValues[key]]));
    if (Object.keys(client).length) normalized.client = client;
  }
  if (Array.isArray(values.clientCompetitors) && values.clientCompetitors.length) {
    normalized.clientCompetitors = values.clientCompetitors.map(company => {
      if (!isScoringRecord(company)) return company;
      return { name: company.name, relationKind: company.relationKind || 'direct' };
    });
    normalized.restrictSearchToCompetitors = Boolean(values.restrictSearchToCompetitors);
  }
  return normalized;
}

/** Built from actual server inputs; a caller-supplied browser key is never trusted. */
export function buildScoringInputVersionKey(
  job: unknown, instructions: unknown, options: ScoringInputContextOptions,
): string {
  return stableScoringContextKey({
    scoringEngineVersion: SOURCING_SCORING_ENGINE_VERSION,
    job: normalizeScoringJob(job, options.projectId),
    organizationId: options.organizationId ?? null, projectId: options.projectId ?? null,
    customScoringInstructions: instructions === '' || instructions === null ? undefined : instructions,
    scoringModel: options.requestModel, memoryVersionKey: options.memoryVersionKey,
  });
}


/** Mirrors the server's shared, effect-specific context; private writing preferences never rank candidates. */
export function getSourcingMemoryVersionKey(memories: AgentMemory[], effect: 'search' | 'scoring'): string {
  const provenance = memories.filter(memory => memory.scope !== 'user' && memory.effects.includes(effect))
    .map(memory => ({
      id: memory.id, version: memory.version, content: memory.content, scope: memory.scope,
      project_id: memory.project_id ?? null, kind: memory.kind,
      effects: [...new Set(memory.effects)].sort(),
    })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ effect, memories: provenance });
}

export function getScoringMemoryVersionKey(memories: AgentMemory[]): string {
  return getSourcingMemoryVersionKey(memories, 'scoring');
}

/** One payload for individual and batch evaluations; the complete sourcing request remains available. */
export function buildScoringJobPayload(job: Job): Record<string, unknown> {
  const keys = [
    'id', 'title', 'client', 'requirements', 'description', 'seniority', 'location', 'remote',
    'xpMin', 'xpMax', 'salaryMin', 'salaryMax', 'tjmMax', 'contractType', 'mustHave', 'shouldHave', 'niceToHave',
    'bodyContent', 'originalBriefText', 'sourcingCriteria', 'transversalCriteria', 'evaluationCriteria',
    'evaluationWeights', 'targetCompanies', 'calibrationProfiles', 'skillsToAvoid', 'requiredLanguages',
    'requiredCertifications', 'urgency', 'teamSize', 'reportsTo', 'manages', 'pedigreeRequirements',
    'pedigreePresetName', 'clientCompetitors', 'restrictSearchToCompetitors',
  ];
  const values: Record<string, unknown> = { ...job };
  return {
    ...Object.fromEntries(keys.filter(key => values[key] !== undefined).map(key => [key, values[key]])),
    skills: job.skills || [],
    tjmMin: values.tjmMin ?? job.tjm,
  };
}

export function getCurrentJobScores(
  scores: Record<string, JobMatchResult>, contextKey: string | null, memoryVersionKey: string,
): Record<string, JobMatchResult> {
  if (!contextKey) return {};
  return Object.fromEntries(Object.entries(scores).filter(([, score]) =>
    isCurrentScoringContext(score?.scoringContext, contextKey, memoryVersionKey)));
}

/** Persisted server notes and live responses require the same complete, shared provenance. */
export function isCurrentScoringContext(metadata: unknown, contextKey: string | null, memoryVersionKey: string): boolean {
  if (!contextKey || !isScoringRecord(metadata) || metadata.inputVersionKey !== contextKey
    || typeof metadata.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.fingerprint)
    || !isScoringRecord(metadata.memory)) return false;
  const memory = metadata.memory;
  if (memory.versionKey !== memoryVersionKey || typeof memory.fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(memory.fingerprint) || !Array.isArray(memory.provenance)) return false;
  const provenance: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  for (const row of memory.provenance) {
    if (!isScoringRecord(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1
      || typeof row.content !== 'string' || row.content.trim().length < 5 || row.content.length > 2000
      || (row.scope !== 'organization' && row.scope !== 'project')
      || (row.scope === 'organization' ? row.project_id != null : typeof row.project_id !== 'string' || !row.project_id)
      || !['constraint', 'preference', 'method', 'context'].includes(String(row.kind))
      || !Array.isArray(row.effects) || !row.effects.includes('scoring')
      || !row.effects.every(effect => typeof effect === 'string' && ['assistant', 'search', 'scoring', 'presentation'].includes(effect))) return false;
    ids.add(row.id);
    provenance.push({ id: row.id, version: row.version, content: row.content, scope: row.scope,
      project_id: row.project_id ?? null, kind: row.kind, effects: [...new Set(row.effects)].sort() });
  }
  provenance.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return JSON.stringify({ effect: 'scoring', memories: provenance }) === memoryVersionKey;
}

/** Display-only projection: recruiting decisions survive, stale evaluations cannot become fallback scores. */
export function getCurrentScoreStatuses(
  statuses: Map<string, JobCandidateStatus>, scores: Record<string, JobMatchResult>,
): Map<string, JobCandidateStatus> {
  return new Map(Array.from(statuses, ([id, status]) => {
    const current = scores[id];
    return [id, {
      ...status,
      status: status.status === 'scored' && !current ? 'discovered' : status.status,
      score: current?.match_score ?? null,
      recommendation: current?.recommendation ?? null,
      scoring_details: current ?? null,
      skip_reason: status.status === 'scored' || status.status === 'discovered'
        ? current?.scoring_details?.skipReason ?? null : status.skip_reason,
    }];
  }));
}
