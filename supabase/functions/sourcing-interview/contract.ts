/** Pure contract shared by the edge function, UI and regression tests. */
export type Criterion = {
  id: string; label: string; description: string;
  category: 'technical' | 'soft_skill' | 'culture_fit' | 'motivation' | 'experience';
  weight: 1 | 2 | 3; deal_breaker?: boolean;
};
export type BriefPatch = {
  title?: string; location?: string; context?: string; mission_description?: string;
  seniority?: string; salary_currency?: string; reports_to?: string;
  client?: { name?: string; sector?: string; size?: 'startup' | 'scale-up' | 'mid-market' | 'enterprise'; culture_notes?: string };
  contract_type?: 'cdi' | 'cdd' | 'freelance' | 'alternance' | 'stage' | 'interim';
  remote_policy?: 'onsite' | 'hybrid' | 'full_remote'; salary_type?: 'annual' | 'daily' | 'hourly';
  experience_min?: number; experience_max?: number; salary_min?: number; salary_max?: number;
  remote_days?: number; team_size?: number; manages?: number;
  skills_must_have?: string[]; skills_should_have?: string[]; skills_nice_to_have?: string[];
  skills_to_avoid?: string[]; certifications?: string[];
  languages?: Array<{ language: string; level: string }>;
  target_companies?: Array<{ category: string; companies: Array<{ name: string }> }>;
  evaluation_criteria?: Criterion[];
  evaluation_weights?: { technical: number; soft_skill: number; culture_fit: number; motivation: number; experience: number };
};

const categories = ['technical', 'soft_skill', 'culture_fit', 'motivation', 'experience'] as const;
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Réponse de cadrage invalide. Réessayez.');
  return v as Record<string, unknown>;
};
const text = (v: unknown, limit = 4000): string => {
  if (typeof v !== 'string' || v.length > limit) throw new Error('Texte de cadrage invalide.');
  return v.trim();
};
const list = (v: unknown, limit = 20): unknown[] => {
  if (!Array.isArray(v) || v.length > limit) throw new Error('Liste de cadrage invalide.');
  return v;
};
const number = (v: unknown, max: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new Error('Valeur de cadrage invalide.');
  return v;
};
const enumValue = (v: unknown, values: readonly string[]) => {
  if (typeof v !== 'string' || !values.includes(v)) throw new Error('Choix de cadrage invalide.');
  return v;
};

/** Reject malformed fields; ignore unknown keys so AI cannot change access, client or process. */
export function readBriefPatch(value: unknown, requireWeightsTotal = true, allowEmptyCriteria = false): BriefPatch {
  const row = object(value);
  const out: Record<string, unknown> = {};
  if ('client' in row) {
    const client = object(row.client); const safe: Record<string, unknown> = {};
    for (const key of ['name', 'sector', 'culture_notes']) if (key in client) safe[key] = text(client[key]);
    if ('size' in client) safe.size = enumValue(client.size, ['startup', 'scale-up', 'mid-market', 'enterprise']);
    out.client = safe;
  }
  for (const key of ['title', 'location', 'context', 'mission_description', 'seniority', 'salary_currency', 'reports_to']) {
    if (key in row) out[key] = text(row[key]);
  }
  for (const [key, values] of Object.entries({
    contract_type: ['cdi', 'cdd', 'freelance', 'alternance', 'stage', 'interim'],
    remote_policy: ['onsite', 'hybrid', 'full_remote'], salary_type: ['annual', 'daily', 'hourly'],
  })) if (key in row) out[key] = enumValue(row[key], values);
  for (const [key, max] of Object.entries({ experience_min: 70, experience_max: 70, salary_min: 10000000,
    salary_max: 10000000, remote_days: 7, team_size: 100000, manages: 100000 })) {
    if (key in row) out[key] = number(row[key], max);
  }
  for (const key of ['skills_must_have', 'skills_should_have', 'skills_nice_to_have', 'skills_to_avoid', 'certifications']) {
    if (key in row) out[key] = [...new Set(list(row[key]).map(v => text(v, 200)).filter(Boolean))];
  }
  if ('languages' in row) out.languages = list(row.languages).map(v => {
    const l = object(v); return { language: text(l.language, 100), level: text(l.level, 100) };
  });
  if ('target_companies' in row) out.target_companies = list(row.target_companies, 10).map(v => {
    const c = object(v); return { category: text(c.category, 200), companies: list(c.companies).map(v => ({ name: text(object(v).name, 200) })) };
  });
  if ('evaluation_criteria' in row) {
    const ids = new Set<string>();
    out.evaluation_criteria = list(row.evaluation_criteria, 30).map(v => {
      const c = object(v); const id = text(c.id, 100); const label = text(c.label, 200);
      if (!id || (!label && !allowEmptyCriteria) || ids.has(id) || ![1, 2, 3].includes(Number(c.weight)) || typeof c.weight !== 'number') throw new Error('Critère invalide.');
      ids.add(id);
      if ('deal_breaker' in c && typeof c.deal_breaker !== 'boolean') throw new Error('Critère éliminatoire invalide.');
      return { id, label, description: text(c.description, 2000), category: enumValue(c.category, categories),
        weight: c.weight, ...('deal_breaker' in c ? { deal_breaker: c.deal_breaker } : {}) };
    });
  }
  if ('evaluation_weights' in row) {
    const w = object(row.evaluation_weights);
    const weights = Object.fromEntries(categories.map(key => [key, number(w[key], 100)]));
    if (requireWeightsTotal && Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 100) > 0.01) throw new Error('Les pondérations doivent totaliser 100 %.');
    out.evaluation_weights = weights;
  }
  return out as BriefPatch;
}

export function readInterviewTurn(value: unknown): { reply: string; patch: BriefPatch } {
  const turn = object(value);
  const reply = text(turn.reply, 2000);
  if (!reply) throw new Error('La réponse de cadrage est vide. Réessayez.');
  return { reply, patch: readBriefPatch(turn.patch) };
}

export function validateBriefRanges(brief: BriefPatch, requireWeightsTotal = true): void {
  if (brief.evaluation_weights) {
    const weights = categories.map(key => number(brief.evaluation_weights![key], 100));
    if (requireWeightsTotal && Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 0.01) throw new Error('Les pondérations doivent totaliser 100 %.');
  }
  for (const [min, max] of [[brief.experience_min, brief.experience_max], [brief.salary_min, brief.salary_max]]) {
    if (min != null && max != null && min > max) throw new Error('Le minimum doit être inférieur ou égal au maximum.');
  }
}

export function nextBriefQuestion(brief: BriefPatch): string {
  if (!brief.title?.trim()) return 'Quel poste cherchez-vous et dans quel contexte ?';
  if (!brief.location?.trim()) return 'Où se trouve le poste, et quelle souplesse avez-vous sur le télétravail ?';
  if (!brief.skills_must_have?.length && !brief.evaluation_criteria?.length) return 'Quels sont les trois critères indispensables, et lesquels sont négociables ?';
  if (brief.experience_min == null && brief.experience_max == null && !brief.seniority) return 'Quel niveau d’expérience attendez-vous ?';
  if (brief.salary_min == null && brief.salary_max == null) return 'Quelle rémunération ou quel budget pouvez-vous proposer ?';
  if (!brief.mission_description && !brief.context) return 'Quel sera l’objectif de la personne recrutée et son environnement de travail ?';
  if (!brief.target_companies?.length) return 'Y a-t-il des entreprises, secteurs ou parcours à privilégier ou à éviter ?';
  return 'Le cadrage permet de chercher. Souhaitez-vous ajuster un critère, son importance ou lancer la recherche ?';
}
