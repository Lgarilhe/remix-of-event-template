import type { LinkedInProfile } from '@/components/outreach/types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const named = (value: unknown): string | undefined => text(value) || text(record(value).name);
const date = (value: unknown): string | { year?: number; month?: number } | null => {
  if (typeof value === 'string') return value;
  const row = record(value);
  return typeof row.year === 'number' ? { year: row.year, ...(typeof row.month === 'number' ? { month: row.month } : {}) } : null;
};

export function candidateLinkedInSlug(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || (url.hostname !== 'linkedin.com' && !url.hostname.endsWith('.linkedin.com'))) return null;
    return url.pathname.match(/^\/in\/([^/]+)\/?$/i)?.[1].toLowerCase() ?? null;
  } catch { return null; }
}

/** Les instantanés de recherche et les profils détaillés utilisent plusieurs formats. Aucun parcours n'est tronqué. */
export function normalizeCandidateProfile(value: unknown, id: string, name?: string): LinkedInProfile {
  const raw = record(value);
  const rows = (...values: unknown[]) => values.map(list).find(items => items.length) ?? [];
  return {
    id, name: text(raw.name) || [text(raw.first_name), text(raw.last_name)].filter(Boolean).join(' ') || name,
    headline: text(raw.headline), summary: text(raw.summary) || text(raw.about),
    location: text(raw.location) || text(record(raw.location).name), industry: named(raw.industry),
    profile_url: text(raw.public_profile_url) || text(raw.profile_url), provider_id: text(raw.provider_id),
    work_experience: rows(raw.work_experience, raw.positions, raw.experiences).map(value => {
      const row = record(value);
      return { company: named(row.company) || text(row.company_name), role: text(row.role) || text(row.position) || text(row.title), description: text(row.description), location: text(row.location), current: row.current === true || row.is_current === true, start: date(row.start ?? row.start_date ?? row.starts_at), end: date(row.end ?? row.end_date ?? row.ends_at) };
    }),
    education: rows(raw.education, raw.educations).map(value => {
      const row = record(value);
      return { school: named(row.school) || text(row.school_name), degree: text(row.degree) || text(row.degree_name), field_of_study: text(row.field_of_study), description: text(row.description), activities: text(row.activities), start: date(row.start ?? row.start_date ?? row.starts_at), end: date(row.end ?? row.end_date ?? row.ends_at) };
    }),
    skills: list(raw.skills).map(value => ({ name: named(value) ?? '' })).filter(row => row.name),
    languages: list(raw.languages).map(value => ({ name: named(value) ?? '', proficiency: text(record(value).proficiency) })).filter(row => row.name),
    certifications: list(raw.certifications).map(value => { const row = record(value); return { name: named(value), organization: named(row.organization) || named(row.authority) }; }),
    projects: list(raw.projects).map(value => { const row = record(value); return { name: text(row.name) || text(row.title), description: text(row.description) }; }),
    volunteering_experience: rows(raw.volunteering_experience, raw.volunteering).map(value => { const row = record(value); return { company: named(row.company) || named(row.organization), role: text(row.role), description: text(row.description), cause: text(row.cause) }; }),
    interests: list(raw.interests).map(named).filter((value): value is string => !!value),
    contact_info: { emails: list(record(raw.contact_info).emails).map(text).filter((value): value is string => !!value), phones: list(record(raw.contact_info).phones).map(text).filter((value): value is string => !!value) },
    recommendations: { received: list(record(raw.recommendations).received).map(value => { const row = record(value); return { text: text(row.text), caption: text(row.caption) }; }) },
  };
}

export function profileDate(value: NonNullable<LinkedInProfile['education']>[number]['start']): string {
  if (!value) return '';
  if (typeof value === 'string') {
    // Une année seule doit rester une année, sans mois de janvier inventé.
    if (/^\d{4}$/.test(value)) return value;
    if (/^\d{4}-\d{2}(?:-\d{2})?(?:T.*)?$/.test(value)) {
      const parsed = new Date(value.length === 7 ? `${value}-01` : value);
      if (Number.isFinite(parsed.getTime())) return parsed.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    return value;
  }
  if (!value.year) return '';
  return value.month && value.month >= 1 && value.month <= 12 ? new Date(Date.UTC(value.year, value.month - 1)).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : String(value.year);
}

export function profilePeriod(start: Parameters<typeof profileDate>[0], end: Parameters<typeof profileDate>[0], current = false): string {
  return [profileDate(start), current ? "Aujourd'hui" : profileDate(end)].filter(Boolean).join(' – ');
}
