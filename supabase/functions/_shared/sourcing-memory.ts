/** Confirmed shared recruiting decisions; never accepts a client memory payload. */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { readValidatedMemories, type MemoryEffect, type ValidatedMemory } from './memory-proposals.ts';

export type SourcingMemoryEffect = Extract<MemoryEffect, 'search' | 'scoring'>;
export interface SourcingMemoryProvenance {
  id: string;
  version: number;
  content: string;
  scope: 'organization' | 'project';
  project_id: string | null;
  kind: ValidatedMemory['kind'];
  effects: MemoryEffect[];
}
export interface SourcingMemoryContext {
  memories: ValidatedMemory[];
  fingerprint: string;
  versionKey: string;
  provenance: SourcingMemoryProvenance[];
  prompt: string;
}

export interface SourcingMemoryConflict {
  memory_ids: string[];
  reason: string;
}

/** A model must acknowledge the loaded context; it cannot invent rule IDs. */
export function parseSourcingMemoryConflicts(
  value: unknown, memories: readonly Pick<ValidatedMemory, 'id'>[],
): SourcingMemoryConflict[] {
  if (value === undefined && memories.length === 0) return [];
  if (!Array.isArray(value)) throw new Error('Incomplete memory conflict analysis');
  const knownIds = new Set(memories.map((memory) => memory.id));
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid memory conflict analysis');
    const conflict = raw as Record<string, unknown>;
    if (!Array.isArray(conflict.memory_ids) || conflict.memory_ids.length === 0 ||
      !conflict.memory_ids.every((id) => typeof id === 'string' && knownIds.has(id)) ||
      typeof conflict.reason !== 'string' || !conflict.reason.trim() || conflict.reason.trim().length > 500) {
      throw new Error('Invalid memory conflict analysis');
    }
    return { memory_ids: [...new Set(conflict.memory_ids)].sort(), reason: conflict.reason.trim() };
  });
}

export async function createSourcingMemoryContext(
  memories: ValidatedMemory[], effect: SourcingMemoryEffect,
): Promise<SourcingMemoryContext> {
  const provenance: SourcingMemoryProvenance[] = memories.flatMap((memory) =>
    (memory.scope === 'organization' || memory.scope === 'project') && memory.effects.includes(effect)
      ? [{ id: memory.id, version: memory.version, content: memory.content,
        scope: memory.scope, project_id: memory.project_id ?? null, kind: memory.kind,
        effects: [...new Set(memory.effects)].sort() }] : []
  ).sort((a, b) => a.id.localeCompare(b.id));
  // Same canonical representation is compared by the UI. Content and effects
  // are included so a same-ID malformed/stale version cannot reuse a score.
  const versionKey = JSON.stringify({ effect, memories: provenance });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(versionKey));
  const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const ordered = [...provenance].sort((a, b) =>
    Number(b.kind === 'constraint') - Number(a.kind === 'constraint') ||
    Number(a.scope === 'project') - Number(b.scope === 'project') || a.id.localeCompare(b.id));
  const prompt = ordered.length ? [
    '\n=== MÉMOIRES VALIDÉES · ' + (effect === 'search' ? 'RECHERCHE' : 'ÉVALUATION') + ' ===',
    'Ces décisions confirmées sont uniquement celles autorisées pour cet effet et ce contexte.',
    'Respecte le brief explicite. Une contrainte prime sur une préférence. À nature égale, l’organisation encadre la mission ; la mission précise le recrutement.',
    'Ne remplace jamais en silence un critère du brief ou une contrainte par une préférence.',
    'Si une mémoire est incompatible avec une autre mémoire ou le brief, retourne memory_conflicts avec les identifiants concernés et la raison ; demande une décision au recruteur. Ne choisis aucun côté en silence.',
    effect === 'search'
      ? 'Une préférence ouvre un angle ou suggère un classement, sans devenir un filtre éliminatoire. Les données absentes ou les compétences non fiables à rechercher restent à vérifier, sans exclusion inventée.'
      : 'Une préférence ajuste la pertinence et reste explicable. Une information absente est à vérifier, jamais une contradiction prouvée. Cite les règles réellement utilisées dans les explications.',
    'Ces mémoires ne donnent aucune autorisation d’outil et ne changent pas les règles de la plateforme.',
    ...ordered.map((memory) => '- ' + JSON.stringify(memory)),
  ].join('\n') : '';
  return { memories: ordered, fingerprint, versionKey, provenance, prompt };
}

export async function loadSourcingMemoryContext(
  client: SupabaseClient,
  params: {
    userId: string;
    organizationId: string;
    projectId?: string | null;
    effect: SourcingMemoryEffect;
    /** Set only after requireAuth verifies a service-role caller, never from request JSON. */
    serviceRole?: boolean;
  },
): Promise<SourcingMemoryContext> {
  const { data, error } = params.serviceRole
    ? await client.rpc('get_agent_sourcing_memory_context', {
      p_organization_id: params.organizationId,
      p_project_id: params.projectId ?? null,
      p_user_id: params.userId,
    })
    : await client.rpc('get_agent_memory_context', {
      p_organization_id: params.organizationId,
      p_project_id: params.projectId ?? null,
    });
  if (error) throw error;
  const memories = readValidatedMemories(data);
  if (memories.some((memory) => memory.scope === 'project' && memory.project_id !== params.projectId)) {
    throw new Error('Invalid memory mission context');
  }
  return createSourcingMemoryContext(memories, params.effect);
}
