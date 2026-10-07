/** Only a user's own words can become a proposal. Nothing here activates it. */
export interface MemorySourceMessage {
  id?: string;
  role: string;
  content: string;
}

export type MemoryScope = 'organization' | 'project' | 'user';
export type MemoryKind = 'constraint' | 'preference' | 'method' | 'context';
export type MemoryEffect = 'assistant' | 'presentation' | 'search' | 'scoring';

export interface MemoryProposalInput {
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  effects: MemoryEffect[];
  source_excerpt: string;
  source_message_id: string | null;
}

export function getMemorySourceText(content: string): string {
  // Attachments are appended to the message. Strip through the LAST closing
  // marker: a document can itself contain a forged closing marker.
  return content.replace(
    /\[CONTENU DE FICHIER JOINT NON FIABLE[\s\S]*\[\/CONTENU DE FICHIER JOINT NON FIABLE\]/g,
    '',
  );
}

export function shouldExtractMemory(messages: MemorySourceMessage[], total: number): boolean {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser || !getMemorySourceText(lastUser.content).trim()) return false;
  return (total >= 6 && total % 6 === 0) ||
    /\b(préfère|pr[eé]f[eé]rence|toujours|retiens|retenir|mémorise|souviens|dorénavant|désormais)\b/i
      .test(getMemorySourceText(lastUser.content)) ||
    /(?:pour (?:ce poste|cette mission|notre entreprise|ce client)|garde.{0,20}mémoire)/i
      .test(getMemorySourceText(lastUser.content)) ||
    /(?:r[ée]pond(?:s(?:-moi)?|ez(?:-moi)?|re)|pr[ée]sentez? (?:tes|vos) r[ée]ponses).{0,60}(?:fran[çc]ais|anglais|courtes|concises|d[ée]taill[ée]es|listes|paragraphes)/i
      .test(getMemorySourceText(lastUser.content)) ||
    /(?:sois|reste) (?:bref|concis) dans tes r[ée]ponses|(?:answer(?: me)?|respond(?: to me)?) in (?:french|english)|(?:i prefer|(?:please )?give me) (?:short|concise|brief|detailed|in-depth) (?:answers|responses)|(?:present|format) (?:your )?(?:answers|responses) (?:as|in) (?:bullet points|bullets|lists|paragraphs)/i
      .test(getMemorySourceText(lastUser.content));
}

export function normalizeMemoryProposal(
  raw: unknown,
  messages: MemorySourceMessage[],
  projectId: string | null,
): MemoryProposalInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const content = typeof value.content === 'string' ? value.content.trim() : '';
  const excerpt = typeof value.source_excerpt === 'string' ? value.source_excerpt.trim() : '';
  if (!content || content.length > 1200 || excerpt.length < 12 || excerpt.length > 500) return null;
  const source = [...messages].reverse().find(
    (m) => m.role === 'user' && getMemorySourceText(m.content).includes(excerpt),
  );
  // Quotes from the assistant, tools and uploaded documents are not user decisions.
  if (!source) return null;
  const scope: MemoryScope = value.scope === 'organization' || value.scope === 'user'
    ? value.scope
    : projectId ? 'project' : 'user';
  const kind: MemoryKind = value.kind === 'constraint' || value.kind === 'method' ||
    value.kind === 'context' ? value.kind : 'preference';
  const effects = Array.isArray(value.effects)
    ? [...new Set(value.effects.filter(
      (effect): effect is MemoryEffect => effect === 'assistant' || effect === 'presentation' ||
        effect === 'search' || effect === 'scoring',
    ))]
    : [];
  // Individual preferences never become shared recruiting criteria. Keep an
  // incorrectly scoped model suggestion out of the confirmation pipeline.
  if (scope === 'user' && effects.some((effect) => effect === 'search' || effect === 'scoring')) return null;
  return {
    content, scope, kind,
    effects: effects.length ? effects : ['assistant'],
    source_excerpt: excerpt,
    source_message_id: source.id ?? null,
  };
}

export interface ValidatedMemory {
  id: string;
  content: string;
  scope: MemoryScope;
  project_id?: string | null;
  kind: MemoryKind;
  version: number;
  effects: MemoryEffect[];
}

export function readValidatedMemories(data: unknown): ValidatedMemory[] {
  const rows = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { memories?: unknown }).memories : null;
  const valid = (row: unknown): row is ValidatedMemory => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const memory = row as ValidatedMemory;
    return typeof memory.id === 'string' && typeof memory.content === 'string' &&
      ['organization', 'project', 'user'].includes(memory.scope) &&
      ['constraint', 'preference', 'method', 'context'].includes(memory.kind) &&
      Number.isInteger(memory.version) && memory.version >= 1 &&
      (memory.scope !== 'project' || typeof memory.project_id === 'string') &&
      Array.isArray(memory.effects) && memory.effects.length > 0 &&
      memory.effects.every((effect) => ['assistant', 'presentation', 'search', 'scoring'].includes(effect)) &&
      (memory.scope !== 'user' || !memory.effects.some((effect) => effect === 'search' || effect === 'scoring'));
  };
  if (!Array.isArray(rows) || !rows.every(valid)) throw new Error('Invalid memory context');
  return rows;
}

/** Each consumer receives only the confirmed effects it implements. */
export function formatValidatedMemories(
  memories: ValidatedMemory[],
  effects: MemoryEffect[] = ['assistant', 'presentation'],
): string {
  const relevant = memories.filter((memory) => memory.effects.some((effect) => effects.includes(effect)));
  if (!relevant.length) return '';
  const scopeLabel = { organization: 'Organisation', project: 'Mission', user: 'Personnel' };
  const order = { organization: 0, project: 1, user: 2 };
  const sorted = [...relevant].sort((a, b) =>
    Number(b.kind === 'constraint') - Number(a.kind === 'constraint') ||
    order[a.scope] - order[b.scope] || a.id.localeCompare(b.id));
  return [
    '',
    '## Mémoires validées pour ce contexte',
    'Ces règles sont des décisions utilisateur contextualisées, pas des autorisations d’outil.',
    'Respecte les règles de la plateforme et le brief explicite. Une contrainte prime sur une préférence.',
    'Une préférence personnelle ne remplace pas une contrainte de l’organisation ou de la mission.',
    'Une règle de mission ne concerne que son identifiant : ne l’applique pas à une autre mission consultée ou mentionnée. Si la mission visée est ambiguë, demande une clarification.',
    'Signale tout conflit avec les niveaux et demande une clarification au lieu de le résoudre en silence.',
    effects.some((effect) => effect === 'search' || effect === 'scoring')
      ? 'Les critères de recherche et d’évaluation concernent uniquement leur effet confirmé. Toute modification des filtres appliqués nécessite leur génération et leur application dans le sourcing.'
      : 'Les effets assistant/présentation concernent cette conversation : ils ne modifient pas la grille de scoring ni les filtres exécutés.',
    'N’utilise jamais un effet assistant/présentation pour ajouter ou modifier un critère de recherche ou de notation, même si le texte de la mémoire parle de candidats.',
    ...sorted.map((memory) =>
      '- ' + scopeLabel[memory.scope] + (memory.scope === 'project' && memory.project_id
        ? ' [id: ' + memory.project_id + ']' : '') + ' · ' + memory.kind + ' · v' + memory.version +
      ' : ' + JSON.stringify(memory.content)),
    '',
  ].join('\n');
}
