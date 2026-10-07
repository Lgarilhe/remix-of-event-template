import { parseSourcingMemoryConflicts, type SourcingMemoryContext, type SourcingMemoryConflict } from './sourcing-memory.ts';

export function stableScoringContextKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableScoringContextKey).join(',') + ']';
  return '{' + Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + stableScoringContextKey(item)).join(',') + '}';
}

export interface ScoringContextMetadata {
  fingerprint: string;
  inputVersionKey: string;
  memory: Pick<SourcingMemoryContext, 'fingerprint' | 'versionKey' | 'provenance'>;
}

export async function createScoringContextMetadata(
  job: unknown, instructions: unknown, model: string, memory: SourcingMemoryContext,
  options: Omit<ScoringInputContextOptions, 'memoryVersionKey'>,
): Promise<ScoringContextMetadata> {
  const inputVersionKey = buildScoringInputVersionKey(job, instructions, { ...options, memoryVersionKey: memory.versionKey });
  const key = stableScoringContextKey({ engine: 'sourcing-memory-v2', inputVersionKey, model,
    memoryFingerprint: memory.fingerprint });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return {
    fingerprint: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    inputVersionKey,
    memory: { fingerprint: memory.fingerprint, versionKey: memory.versionKey, provenance: memory.provenance },
  };
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
    job: normalizeScoringJob(job, options.projectId),
    organizationId: options.organizationId ?? null, projectId: options.projectId ?? null,
    customScoringInstructions: instructions === '' || instructions === null ? undefined : instructions,
    scoringModel: options.requestModel, memoryVersionKey: options.memoryVersionKey,
  });
}


export type ScoringMemoryConflict = SourcingMemoryConflict;

/** Missing review is not consent to resolve a conflict in silence. Only known shared decisions can be cited. */
export function parseScoringMemoryConflicts(raw: unknown, memory: SourcingMemoryContext): {
  valid: boolean; conflicts: ScoringMemoryConflict[];
} {
  try { return { valid: true, conflicts: parseSourcingMemoryConflicts(raw, memory.memories) }; }
  catch { return { valid: false, conflicts: [] }; }
}
