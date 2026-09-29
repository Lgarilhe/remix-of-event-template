/**
 * Fiche société renvoyée par `enrich-company`, réduite à ce que l'onboarding
 * montre. Le fournisseur des données ne s'affiche jamais (règle de marque) :
 * la source d'un poste ouvert n'est donc pas gardée.
 */
export interface CompanyBrief {
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  funding: string | null;
  description: string | null;
  openRoles: Array<{ title: string; location: string | null }>;
}

export interface CompanyCandidate {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  logoUrl: string | null;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\-\u2013\u2014()/,]+/g, ' ').trim();
}

/** Postes dédoublonnés par titre (la fiche en renvoie plusieurs fois le même, un par lieu ou par source). */
export function dedupeRoles(roles: Array<{ title: string; location: string | null }>): Array<{ title: string; location: string | null }> {
  const seen = new Set<string>();
  return roles.filter((role) => {
    const key = normalizeTitle(role.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseCompany(raw: unknown, fallbackName: string): CompanyBrief {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const domain = str(c.domain);
  const roles = Array.isArray(c.openRoles)
    ? (c.openRoles as Raw[])
        .map((r) => ({ title: str(r?.title) ?? '', location: str(r?.location) }))
        .filter((r) => r.title)
    : [];
  return {
    name: str(c.name) ?? fallbackName,
    domain,
    websiteUrl: str(c.websiteUrl) ?? (domain ? `https://${domain}` : null),
    logoUrl: str(c.logoUrl),
    industry: str(c.industry),
    size: str(c.size),
    location: str(c.location),
    funding: str(c.funding),
    description: str(c.description),
    openRoles: dedupeRoles(roles),
  };
}

export function parseCandidates(raw: unknown): CompanyCandidate[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Raw[])
    .map((c) => ({
      id: str(c?.id) ?? '',
      name: str(c?.name) ?? '',
      domain: str(c?.domain),
      industry: str(c?.industry),
      location: str(c?.location),
      size: str(c?.size),
      logoUrl: str(c?.logoUrl),
    }))
    .filter((c) => c.id && c.name);
}

/** Petit texte de contexte pour l'analyse du poste : ce qu'on sait de la société, sans jargon ni chiffres inventés. */
export function companyContext(company: CompanyBrief | null): string {
  if (!company) return '';
  const facts = [company.industry, company.size ? `${company.size} salariés` : null, company.location].filter(Boolean).join(', ');
  const about = company.description ? company.description.slice(0, 320) : '';
  return [facts && `${company.name} : ${facts}.`, about].filter(Boolean).join(' ');
}
