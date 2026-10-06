// Lecture des offres d'emploi : classification d'une adresse, interfaces publiques
// des logiciels de recrutement, données JobPosting des pages, conversion en texte,
// liens d'offres d'une page société. Fonctions pures, sans API Deno : testées sous
// Node (tests/ux/lecture-offres.test.mjs).
//
// Ces lecteurs sont tolérants : une réponse inattendue donne une liste vide ou null,
// jamais une exception, pour que index.ts passe au niveau de lecture suivant.
//
// Les formats des interfaces Greenhouse, Lever, Ashby et Recruitee sont écrits
// d'après leur documentation publique ; ils n'ont pas pu être vérifiés contre
// l'interface réelle au moment de l'écriture. index.ts journalise le lecteur utilisé.

export interface SourceJob {
  id: string;
  title: string;
  company?: string;
  location?: string;
  contract?: string;
  posted_at?: string;
  url: string;
  /** Texte brut de la fiche, absent des listes. */
  description?: string;
}

export type Source = "greenhouse" | "lever" | "ashby" | "recruitee" | "wttj" | "linkedin" | "generic";

export interface Classified {
  source: Source;
  kind: "job" | "company" | "unknown";
  /** Jeton de la société chez le logiciel de recrutement, ou identifiant WTTJ. */
  org?: string;
  jobRef?: string;
  /** Instance européenne (Lever). */
  eu?: boolean;
}

export const MAX_DESCRIPTION_CHARS = 20000;
export const MAX_LIST_JOBS = 100;

// ─── Utilitaires de lecture de JSON inconnu ───────────────────────────────

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
};

export function capDescription(text: string): string {
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS) : text;
}

export function smartCapitalize(s: string): string {
  return s
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .trim();
}

// ─── Texte ────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ccedil: "ç",
  icirc: "î", iuml: "ï", ocirc: "ô", ugrave: "ù", ucirc: "û", uuml: "ü", oelig: "œ",
  Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
  hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
  laquo: "«", raquo: "»", euro: "€", middot: "·", bull: "•",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!(code > 0 && code <= 0x10ffff)) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const STRIP_BLOCKS = /<(script|style|noscript|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi;
// Dans le contenu principal d'une page, l'en-tête de l'offre (titre, tags) est souvent un <header> : on le garde.
const STRIP_BLOCKS_KEEP_HEADER = /<(script|style|noscript|svg|nav|footer|form)\b[\s\S]*?<\/\1>/gi;

/** HTML en texte brut : paragraphes et listes conservés, le reste retiré. */
export function htmlToText(input: string, options: { keepHeader?: boolean } = {}): string {
  let html = input ?? "";
  // Greenhouse renvoie du HTML encodé en entités (&lt;p&gt;…) : on le décode d'abord.
  if (!/<[a-z!/]/i.test(html) && /&lt;\/?[a-z]/i.test(html)) html = decodeEntities(html);
  const text = html
    .replace(options.keepHeader ? STRIP_BLOCKS_KEEP_HEADER : STRIP_BLOCKS, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|h[1-6]|ul|ol|table|blockquote)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normalizeWhitespace(decodeEntities(text));
}

/** Markdown (rendu d'une page) en texte brut. */
export function markdownToText(md: string): string {
  return normalizeWhitespace(
    (md ?? "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/^[*+]\s+/gm, "- "),
  );
}

export function firstMarkdownHeading(md: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(md ?? "");
  return m ? m[1].replace(/[*_`]/g, "").trim() || undefined : undefined;
}

/** Contenu trop court pour être une fiche, ou mur de consentement aux cookies. */
export function looksThin(text: string, minChars = 600): boolean {
  const t = (text ?? "").trim();
  if (t.length < minChars) return true;
  return /cookie|consentement|accepter (tout|les)/i.test(t.slice(0, 500)) && t.length < 2500;
}

// Blocs qui suivent la fiche sur une page d'offre : leurs intitulés et compétences ne sont pas ceux du poste.
const TRAILING_SECTION_RE = /^(offres? (d'emploi )?(similaires|recommand[ée]es|qui pourraient)|(autres|jobs?|postes?) (offres|jobs?|postes?|similaires)|ces offres|d[ée]couvrez (aussi|d'autres)|pourraient (aussi )?vous (int[ée]resser|plaire)|similar (jobs|roles|positions)|recommended jobs|you (may|might) also like)\b.*$/im;

/** Coupe le texte avant « Offres similaires » et ses voisins, sans jamais amputer le début d'une fiche. */
export function trimTrailingSections(text: string): string {
  const m = TRAILING_SECTION_RE.exec(text);
  return m && m.index >= 600 ? text.slice(0, m.index).trim() : text;
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Distance au-delà de laquelle un titre précédant le premier lien d'une autre offre est celui d'une autre section : il reste. */
const BLOCK_TITLE_WINDOW = 1500;

/**
 * Début des offres suggérées d'une page d'offre Welcome to the Jungle : le premier lien vers
 * une autre offre (/companies/<société>/jobs/<offre>), reculé jusqu'au titre du bloc s'il est
 * proche. Le lien d'une offre vers elle-même (postuler, partager) n'en est pas un.
 */
function otherJobsStartInHtml(html: string, jobRef: string | undefined): number {
  if (!jobRef) return -1;
  const re = /<a\b[^>]*\bhref=["'][^"']*?\/companies(?:-v1)?\/[^/"'?#]+\/jobs\/([^/"'?#]+)/gi;
  for (const m of html.matchAll(re)) {
    if (safeDecode(m[1]) === jobRef) continue;
    const title = [...html.slice(0, m.index).matchAll(/<h[1-6]\b/gi)].at(-1);
    return title && m.index - title.index < BLOCK_TITLE_WINDOW ? title.index : m.index;
  }
  return -1;
}

function otherJobsStartInMarkdown(md: string, jobRef: string | undefined): number {
  if (!jobRef) return -1;
  const re = /\]\([^)\s]*?\/companies(?:-v1)?\/[^/)\s?#]+\/jobs\/([^/)\s?#]+)/g;
  for (const m of md.matchAll(re)) {
    if (safeDecode(m[1]) === jobRef) continue;
    const lineStart = md.lastIndexOf("\n", m.index) + 1;
    const title = [...md.slice(0, lineStart).matchAll(/^#{1,6}\s.*$/gm)].at(-1);
    return title && lineStart - title.index < BLOCK_TITLE_WINDOW ? title.index : lineStart;
  }
  return -1;
}

/** Texte rendu, coupé avant les offres suggérées ; sans coupe utile (fiche réduite à rien), le texte entier. */
function withoutOtherJobs(full: string, cutText: (() => string) | null): string {
  const kept = trimTrailingSections(full);
  const cut = cutText ? trimTrailingSections(cutText()) : "";
  return cut.length >= 600 ? cut : kept;
}

/**
 * Texte visible d'une page d'offre : le contenu de <main> (titre, tags, résumé, descriptif,
 * profil, entretiens), sinon la page entière, sans les offres suggérées (jobRef : l'offre lue).
 * Le JobPosting de certains sites n'en porte que le descriptif.
 */
export function jobPageText(html: string, jobRef?: string): string {
  const render = (h: string, keepHeader: boolean): string => {
    const start = otherJobsStartInHtml(h, jobRef);
    return withoutOtherJobs(htmlToText(h, { keepHeader }), start >= 0 ? () => htmlToText(h.slice(0, start), { keepHeader }) : null);
  };
  const open = /<main\b[^>]*>/i.exec(html ?? "");
  if (open) {
    const end = [...html.matchAll(/<\/main\s*>/gi)].at(-1)?.index;
    const main = render(html.slice(open.index + open[0].length, end !== undefined && end > open.index ? end : undefined), true);
    if (main.length >= 300) return main;
  }
  return render(html ?? "", false);
}

/** Même chose pour un rendu Markdown de la page entière : on repart du premier titre, après les menus. */
export function jobMarkdownText(md: string, jobRef?: string): string {
  const heading = /^#\s/m.exec(md ?? "");
  const body = heading ? md.slice(heading.index) : md ?? "";
  const start = otherJobsStartInMarkdown(body, jobRef);
  return withoutOtherJobs(markdownToText(body), start >= 0 ? () => markdownToText(body.slice(0, start)) : null);
}

export interface PageLink {
  text?: string;
  url: string;
}

export function extractMarkdownLinks(md: string): PageLink[] {
  const out: PageLink[] = [];
  const re = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md ?? ""))) out.push({ text: m[1], url: m[2] });
  return out;
}

export function extractHtmlLinks(html: string, baseUrl: string): PageLink[] {
  const out: PageLink[] = [];
  const re = /<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? ""))) {
    try {
      out.push({ url: new URL(decodeEntities(m[1]), baseUrl).toString(), text: htmlToText(m[2]).slice(0, 200) });
    } catch {
      // lien inexploitable : ignoré
    }
  }
  return out;
}

// ─── Données structurées JobPosting (schema.org) ──────────────────────────

const EMPLOYMENT_LABELS: Record<string, string> = {
  FULL_TIME: "Temps plein",
  PART_TIME: "Temps partiel",
  CONTRACTOR: "Freelance",
  TEMPORARY: "Temporaire",
  INTERN: "Stage",
};

function formatEmployment(v: unknown): string | undefined {
  const labels = (Array.isArray(v) ? v : [v])
    .map((x) => (typeof x === "string" ? EMPLOYMENT_LABELS[x.toUpperCase()] : undefined))
    .filter((x): x is string => !!x);
  return labels.length ? [...new Set(labels)].join(", ") : undefined;
}

function formatLocation(v: unknown): string | undefined {
  const places = (Array.isArray(v) ? v : [v])
    .map((p) => {
      const address = obj(obj(p)?.address) ?? obj(p);
      if (!address) return str(p);
      const country = obj(address.addressCountry)?.name ?? address.addressCountry;
      const parts = [str(address.addressLocality), str(address.addressRegion), str(country)].filter(Boolean);
      return parts.length ? [...new Set(parts)].join(", ") : undefined;
    })
    .filter((x): x is string => !!x);
  return places.length ? [...new Set(places)].slice(0, 3).join(" / ") : undefined;
}

const SALARY_UNITS: Record<string, string> = { YEAR: "par an", MONTH: "par mois", WEEK: "par semaine", DAY: "par jour", HOUR: "par heure" };

function formatSalary(v: unknown): string | undefined {
  const salary = obj(v);
  if (!salary) return undefined;
  const value = obj(salary.value);
  const min = typeof value?.minValue === "number" ? value.minValue : undefined;
  const max = typeof value?.maxValue === "number" ? value.maxValue : undefined;
  const exact = typeof value?.value === "number" ? value.value : undefined;
  const currency = str(salary.currency) ?? "";
  const unit = SALARY_UNITS[String(value?.unitText ?? "").toUpperCase()] ?? "";
  const amount = min !== undefined && max !== undefined && min !== max
    ? `${min} à ${max}`
    : String(min ?? max ?? exact ?? "");
  if (!amount) return undefined;
  return [amount, currency, unit].filter(Boolean).join(" ");
}

function jobFromJsonLd(node: Obj, pageUrl: string): SourceJob | null {
  const title = str(node.title) ?? str(node.name);
  if (!title) return null;
  const org = obj(node.hiringOrganization);
  const company = str(org?.name) ?? str(node.hiringOrganization);
  const remote = String(node.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE";
  const location = [formatLocation(node.jobLocation), remote ? "télétravail" : undefined].filter(Boolean).join(", ") || undefined;
  const salary = formatSalary(node.baseSalary);
  const body = htmlToText(str(node.description) ?? "");
  const description = capDescription([body, salary ? `Rémunération : ${salary}` : ""].filter(Boolean).join("\n\n"));
  let url = pageUrl;
  try {
    url = new URL(str(node.url) ?? pageUrl, pageUrl).toString();
  } catch {
    // adresse de la page
  }
  const identifier = obj(node.identifier);
  return {
    id: str(identifier?.value) ?? str(node.identifier) ?? url,
    title,
    company,
    location,
    contract: formatEmployment(node.employmentType),
    posted_at: str(node.datePosted),
    url,
    description: description || undefined,
  };
}

/** Offres décrites par les blocs ld+json d'une page (une page d'offre en porte une, une liste plusieurs). */
export function extractJsonLdJobs(html: string, pageUrl: string): SourceJob[] {
  const jobs: SourceJob[] = [];
  const collect = (node: unknown, depth: number): void => {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      node.forEach((n) => collect(n, depth + 1));
      return;
    }
    const o = obj(node);
    if (!o) return;
    const types = Array.isArray(o["@type"]) ? (o["@type"] as unknown[]) : [o["@type"]];
    if (types.includes("JobPosting")) {
      const job = jobFromJsonLd(o, pageUrl);
      if (job) jobs.push(job);
      return;
    }
    collect(o["@graph"], depth + 1);
    collect(o.itemListElement, depth + 1);
    collect(o.item, depth + 1);
  };
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html ?? ""))) {
    try {
      collect(JSON.parse(m[1].trim()), 0);
    } catch {
      // bloc illisible : ignoré
    }
  }
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.url + j.title) ? false : (seen.add(j.url + j.title), true)));
}

// ─── Classification d'une adresse ─────────────────────────────────────────

const TOKEN_RE = /^[A-Za-z0-9._-]{1,80}$/;
const WTTJ_LANG_RE = /^[a-z]{2}$/;

/** Les adresses de société de Welcome to the Jungle existent en « companies » et en « companies-v1 ». */
function wttjCompaniesIndex(segs: string[]): number {
  return segs.findIndex((s) => s === "companies" || s === "companies-v1");
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

export function classifyUrl(url: URL): Classified {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segs = pathSegments(url);

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return { source: "linkedin", kind: "unknown" };

  if (["boards.greenhouse.io", "job-boards.greenhouse.io", "job-boards.eu.greenhouse.io", "boards.eu.greenhouse.io"].includes(host)) {
    const embedded = url.searchParams.get("for");
    const org = segs[0] === "embed" ? embedded : segs[0];
    if (org && TOKEN_RE.test(org)) {
      if (segs[0] !== "embed" && segs[1] === "jobs" && segs[2] && TOKEN_RE.test(segs[2])) {
        return { source: "greenhouse", kind: "job", org, jobRef: segs[2] };
      }
      return { source: "greenhouse", kind: "company", org };
    }
  }

  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const eu = host === "jobs.eu.lever.co";
    if (segs[0] && TOKEN_RE.test(segs[0])) {
      if (segs[1] && /^[0-9a-f-]{20,}$/i.test(segs[1])) return { source: "lever", kind: "job", org: segs[0], jobRef: segs[1], eu };
      return { source: "lever", kind: "company", org: segs[0], eu };
    }
  }

  if (host === "jobs.ashbyhq.com" && segs[0] && TOKEN_RE.test(segs[0])) {
    if (segs[1] && /^[0-9a-f-]{20,}$/i.test(segs[1])) return { source: "ashby", kind: "job", org: segs[0], jobRef: segs[1] };
    return { source: "ashby", kind: "company", org: segs[0] };
  }

  if (host.endsWith(".recruitee.com") && !["api.recruitee.com", "app.recruitee.com"].includes(host)) {
    const org = host.slice(0, -".recruitee.com".length);
    if (TOKEN_RE.test(org)) {
      if (segs[0] === "o" && segs[1]) return { source: "recruitee", kind: "job", org, jobRef: segs[1] };
      return { source: "recruitee", kind: "company", org };
    }
  }

  if (host === "welcometothejungle.com") {
    const i = wttjCompaniesIndex(segs);
    if (i >= 0 && segs[i + 1] && TOKEN_RE.test(segs[i + 1]) && (i === 0 || (i === 1 && WTTJ_LANG_RE.test(segs[0])))) {
      if (segs[i + 2] === "jobs" && segs[i + 3]) return { source: "wttj", kind: "job", org: segs[i + 1], jobRef: segs[i + 3] };
      return { source: "wttj", kind: "company", org: segs[i + 1] };
    }
  }

  const path = url.pathname;
  if (/\/(jobs?|offres?|emplois?|careers?|carrieres|positions?|postings?|vacancies|opportunities)\/[^/]{3,}/i.test(path)) {
    return { source: "generic", kind: "job" };
  }
  if (/\/(jobs|offres|emplois|careers|carrieres|recrutement|nous-rejoindre|join-us)\/?$/i.test(path)) {
    return { source: "generic", kind: "company" };
  }
  return { source: "generic", kind: "unknown" };
}

/** Adresses des interfaces publiques de chaque logiciel de recrutement (hôtes fixes, aucune saisie utilisateur hors jeton validé). */
export function atsApiUrls(c: Classified): { list: string; single?: string } | null {
  if (!c.org || !TOKEN_RE.test(c.org)) return null;
  const org = encodeURIComponent(c.org);
  const ref = c.jobRef ? encodeURIComponent(c.jobRef) : undefined;
  switch (c.source) {
    case "greenhouse":
      return {
        list: `https://boards-api.greenhouse.io/v1/boards/${org}/jobs`,
        single: ref ? `https://boards-api.greenhouse.io/v1/boards/${org}/jobs/${ref}` : undefined,
      };
    case "lever": {
      const base = c.eu ? "https://api.eu.lever.co" : "https://api.lever.co";
      return {
        list: `${base}/v0/postings/${org}?mode=json`,
        single: ref ? `${base}/v0/postings/${org}/${ref}` : undefined,
      };
    }
    case "ashby":
      return { list: `https://api.ashbyhq.com/posting-api/job-board/${org}` };
    case "recruitee":
      return { list: `https://${org}.recruitee.com/api/offers/` };
    default:
      return null;
  }
}

// ─── Interfaces publiques des logiciels de recrutement ────────────────────

export function parseGreenhouseJob(data: unknown, org: string): SourceJob | null {
  const j = obj(data);
  const title = str(j?.title);
  const url = str(j?.absolute_url);
  if (!j || !title || !url) return null;
  const description = htmlToText(str(j.content) ?? "");
  return {
    id: str(j.id) ?? url,
    title,
    company: str(j.company_name) ?? smartCapitalize(org),
    location: str(obj(j.location)?.name),
    posted_at: str(j.updated_at) ?? str(j.first_published),
    url,
    description: description ? capDescription(description) : undefined,
  };
}

export function parseGreenhouseList(data: unknown, org: string): SourceJob[] {
  return arr(obj(data)?.jobs)
    .map((j) => parseGreenhouseJob(j, org))
    .filter((j): j is SourceJob => !!j)
    .map((j) => ({ ...j, description: undefined }));
}

export function parseLeverPosting(data: unknown, org: string): SourceJob | null {
  const p = obj(data);
  const title = str(p?.text);
  const url = str(p?.hostedUrl);
  if (!p || !title || !url) return null;
  const categories = obj(p.categories);
  const location = str(categories?.location) ?? arr(categories?.allLocations).map(str).filter(Boolean).join(" / ");
  const parts = [str(p.descriptionPlain) ?? htmlToText(str(p.description) ?? "")];
  for (const entry of arr(p.lists)) {
    const list = obj(entry);
    const heading = str(list?.text);
    const body = htmlToText(str(list?.content) ?? "");
    if (heading || body) parts.push([heading, body].filter(Boolean).join("\n"));
  }
  parts.push(str(p.additionalPlain) ?? htmlToText(str(p.additional) ?? ""));
  const description = capDescription(parts.filter(Boolean).join("\n\n"));
  const created = typeof p.createdAt === "number" ? new Date(p.createdAt).toISOString() : undefined;
  return {
    id: str(p.id) ?? url,
    title,
    company: smartCapitalize(org),
    location: location || undefined,
    contract: str(categories?.commitment),
    posted_at: created,
    url,
    description: description || undefined,
  };
}

export function parseLeverList(data: unknown, org: string): SourceJob[] {
  return arr(data)
    .map((p) => parseLeverPosting(p, org))
    .filter((j): j is SourceJob => !!j)
    .map((j) => ({ ...j, description: undefined }));
}

const ASHBY_CONTRACTS: Record<string, string> = {
  FullTime: "Temps plein", PartTime: "Temps partiel", Intern: "Stage", Contract: "Freelance", Temporary: "Temporaire",
};

export function parseAshbyList(data: unknown, org: string): SourceJob[] {
  return arr(obj(data)?.jobs)
    .map((entry): SourceJob | null => {
      const j = obj(entry);
      const title = str(j?.title);
      const url = str(j?.jobUrl);
      if (!j || !title || !url) return null;
      const description = str(j.descriptionPlain) ?? htmlToText(str(j.descriptionHtml) ?? "");
      return {
        id: str(j.id) ?? url,
        title,
        company: smartCapitalize(org),
        location: [str(j.location), j.isRemote === true ? "télétravail" : undefined].filter(Boolean).join(", ") || undefined,
        contract: ASHBY_CONTRACTS[str(j.employmentType) ?? ""],
        posted_at: str(j.publishedAt),
        url,
        description: description ? capDescription(description) : undefined,
      };
    })
    .filter((j): j is SourceJob => !!j);
}

export function parseRecruiteeList(data: unknown, org: string): SourceJob[] {
  return arr(obj(data)?.offers)
    .map((entry): SourceJob | null => {
      const o = obj(entry);
      const title = str(o?.title);
      const url = str(o?.careers_url);
      if (!o || !title || !url) return null;
      const description = [htmlToText(str(o.description) ?? ""), htmlToText(str(o.requirements) ?? "")].filter(Boolean).join("\n\n");
      return {
        id: str(o.id) ?? url,
        title,
        company: str(o.company_name) ?? smartCapitalize(org),
        location: str(o.location) ?? ([str(o.city), str(o.country)].filter(Boolean).join(", ") || undefined),
        contract: str(o.employment_type_code),
        posted_at: str(o.published_at),
        url,
        description: description ? capDescription(description) : undefined,
      };
    })
    .filter((j): j is SourceJob => !!j);
}

/** Retire les descriptions d'une liste : seule la fiche choisie est lue en entier. */
export function withoutDescriptions(jobs: SourceJob[]): SourceJob[] {
  return jobs.map((j) => ({ ...j, description: undefined }));
}

// ─── Liens d'offres d'une page société ────────────────────────────────────

const CONTRACT_LINE_RE = /^(CDI|CDD|Stage|Alternance|Freelance|Intérim|Interim|Apprentissage|Temps plein|Temps partiel)\b/i;
const GENERIC_LINK_TEXT_RE = /^(voir|postuler|en savoir|découvrir|lire|apply|view|see|read|learn)\b/i;

/** Titre, contrat et lieu d'une carte d'offre rendue en Markdown ([Titre\n\nCDI\n\nParis](adresse)). */
function cardParts(text: string | undefined): { title?: string; contract?: string; location?: string } {
  const lines = (text ?? "")
    .split(/\n+/)
    .map((l) => l.replace(/[*_`#]/g, "").trim())
    .filter(Boolean);
  if (!lines.length) return {};
  const title = lines[0].length >= 3 && lines[0].length <= 140 && !GENERIC_LINK_TEXT_RE.test(lines[0]) ? lines[0] : undefined;
  const rest = lines.slice(1);
  const contract = rest.find((l) => CONTRACT_LINE_RE.test(l));
  const location = rest.find((l) => l !== contract && l.length <= 80 && !/^\d|€|télétravail|remote/i.test(l));
  return { title, contract, location };
}

export function wttjJobsFromLinks(links: PageLink[], companySlug: string): SourceJob[] {
  // adresse canonique -> position dans jobs, pour compléter une offre vue d'abord sans sa carte.
  const seen = new Map<string, number>();
  const jobs: SourceJob[] = [];
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link.url);
    } catch {
      continue;
    }
    if (u.hostname.toLowerCase().replace(/^www\./, "") !== "welcometothejungle.com") continue;
    const segs = pathSegments(u);
    const i = wttjCompaniesIndex(segs);
    if (i < 0 || segs[i + 1] !== companySlug || segs[i + 2] !== "jobs" || !segs[i + 3]) continue;
    const canonical = `${u.origin}/${segs.slice(0, i + 4).join("/")}`;
    const slug = segs[i + 3];
    const [slugTitle, ...slugPlace] = slug.split("_");
    const card = cardParts(link.text);
    const job: SourceJob = {
      id: slug,
      title: card.title ?? smartCapitalize(slugTitle),
      company: smartCapitalize(companySlug),
      location: card.location ?? (slugPlace.length ? smartCapitalize(slugPlace[0].replace(/-\d+$/, "")) : undefined),
      contract: card.contract,
      url: canonical,
    };
    const known = seen.get(canonical);
    if (known !== undefined) {
      // Même offre, vue d'abord par un lien sans titre (« Voir l'offre ») : la carte complète la remplace.
      if (card.title && !jobs[known].contract && card.contract) jobs[known] = job;
      continue;
    }
    seen.set(canonical, jobs.length);
    jobs.push(job);
    if (jobs.length >= MAX_LIST_JOBS) break;
  }
  return jobs;
}

/**
 * Adresses d'offres d'une société Welcome to the Jungle écrites dans le texte brut de la page
 * (données JSON intégrées, `\u002F` compris), quand la liste n'est pas faite de liens <a>.
 * Aucun titre n'y est lu : wttjJobsFromLinks le déduit de l'adresse.
 */
export function wttjLinksFromRawHtml(html: string): PageLink[] {
  const text = (html ?? "").replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const re = /\/(?:[a-z]{2}\/)?companies(?:-v1)?\/[^/"'\\\s?#<>&]+\/jobs\/[^/"'\\\s?#<>&]+/gi;
  const out: PageLink[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(re)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push({ url: `https://www.welcometothejungle.com${m[0]}` });
  }
  return out;
}

const JOB_PATH_RE = /\/(jobs?|offres?|emplois?|careers?|carrieres|positions?|postings?|vacancies|opportunities|recrutement)\/[^/?#]{3,}/i;

/** Liens d'offres d'une page société quelconque : même site, chemin de type /jobs/xyz, sans doublon. */
export function genericJobLinks(links: PageLink[], pageUrl: string): SourceJob[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const pageHost = page.hostname.toLowerCase().replace(/^www\./, "");
  const seen = new Set<string>();
  const jobs: SourceJob[] = [];
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link.url);
    } catch {
      continue;
    }
    if (u.hostname.toLowerCase().replace(/^www\./, "") !== pageHost) continue;
    if (!JOB_PATH_RE.test(u.pathname)) continue;
    const canonical = `${u.origin}${u.pathname.replace(/\/$/, "")}`;
    if (canonical === `${page.origin}${page.pathname.replace(/\/$/, "")}` || seen.has(canonical)) continue;
    const card = cardParts(link.text);
    const slug = pathSegments(u).pop() ?? "";
    const title = card.title ?? smartCapitalize(slug.replace(/\.[a-z]+$/i, ""));
    if (title.length < 3) continue;
    seen.add(canonical);
    jobs.push({ id: canonical, title, location: card.location, contract: card.contract, url: canonical });
    if (jobs.length >= MAX_LIST_JOBS) break;
  }
  return jobs;
}

/** Nom de société déduit d'un nom de domaine : acme-corp.com devient « Acme Corp ». */
export function companyFromHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const name = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  return smartCapitalize(name);
}
