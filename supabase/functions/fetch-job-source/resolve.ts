// Décision de lecture de fetch-job-source : quel niveau essayer, dans quel ordre, et
// quand renoncer. Sans API Deno : le réseau est injecté (Deps), ce qui permet de
// tester le flux sous Node avec des réponses simulées (tests/ux/lecture-offres-serveur).
//
//   1. interface publique du logiciel de recrutement (Greenhouse, Lever, Ashby, Recruitee) ;
//   2. lecture directe de la page : données JobPosting, liens d'offres, sinon texte ;
//   3. Firecrawl (rendu JavaScript), si la clé est posée et le plafond non atteint.

import {
  atsApiUrls, capDescription, classifyUrl, companyFromHost, decodeEntities, extractHtmlLinks,
  extractJsonLdJobs, firstMarkdownHeading, genericJobLinks, htmlToText, jobMarkdownText, jobPageText, looksThin, markdownToText,
  parseAshbyList, parseGreenhouseJob, parseGreenhouseList, parseLeverList, parseLeverPosting,
  parseRecruiteeList, smartCapitalize, withoutDescriptions, wttjJobsFromLinks, wttjLinksFromRawHtml, MAX_LIST_JOBS,
  type Classified, type PageLink, type SourceJob,
} from "./readers.ts";

export type Reader = "ats_api" | "json_ld" | "direct_text" | "firecrawl";
export type Resolved =
  | { kind: "job"; job: SourceJob; reader: Reader }
  | { kind: "company"; company: { name: string; url: string }; jobs: SourceJob[]; reader: Reader; truncated: boolean }
  | { kind: "unreadable"; message: string };

export interface RenderedPage {
  markdown: string;
  links: PageLink[];
}

/** Le réseau, injecté : index.ts fournit les vraies implémentations, les tests des réponses simulées. */
export interface Deps {
  /** Texte HTML d'une page publique (garde SSRF comprise). Lève une exception en cas d'échec. */
  fetchPage(url: string): Promise<string>;
  /** JSON d'une interface publique de logiciel de recrutement. Lève une exception en cas d'échec. */
  fetchJson(url: string): Promise<unknown>;
  /** Vrai si Firecrawl est configuré et le plafond quotidien de l'utilisateur non atteint. */
  allowFirecrawl(): Promise<boolean>;
  scrape(url: string, mainContentOnly: boolean): Promise<RenderedPage>;
}

/** Ce que chaque niveau a vu : écrit dans le journal, jamais renvoyé à l'écran. */
export interface Trace {
  direct?: { chars: number; ldJobs: number; links: number; jobsMentions: number; nextDataChars: number; title?: string } | "failed";
  firecrawl?: "not_configured" | "failed" | { markdownChars: number; links: number };
}

/** Une fiche plus courte est un résumé, pas une fiche : on passe au niveau suivant. */
const MIN_DESCRIPTION_CHARS = 300;
const MIN_PAGE_TEXT_CHARS = 800;

export const MSG_LINKEDIN = "LinkedIn ne permet pas de lire une offre depuis son adresse. Collez le texte de la fiche.";
export const MSG_UNREADABLE = "Cette page n'a pas pu être lue (accès refusé ou contenu absent). Collez le texte de la fiche.";
export const MSG_WTTJ_ADDRESS =
  "Cette adresse Welcome to the Jungle n'a pas pu être lue. Utilisez l'adresse d'une offre, ou celle de la page emplois d'une société (…/companies/<société>/jobs).";

const JOB_TEXT_RE = /(missions?|profil|exp[ée]rience|responsabilit|vos t[âa]ches|requirements|qualifications|responsibilities|about the role)/i;

// ─── Niveau 1 : interface publique des logiciels de recrutement ───────────

function findJob(jobs: SourceJob[], ref: string): SourceJob | undefined {
  return jobs.find((j) => j.id === ref || j.url.includes(`/${ref}`));
}

async function readFromAts(c: Classified, deps: Deps, wantJob: boolean): Promise<Resolved | null> {
  const urls = atsApiUrls(c);
  if (!urls || !c.org) return null;
  const org = c.org;

  if (wantJob && c.jobRef) {
    let job: SourceJob | null | undefined;
    if (c.source === "greenhouse" && urls.single) job = parseGreenhouseJob(await deps.fetchJson(urls.single), org);
    else if (c.source === "lever" && urls.single) job = parseLeverPosting(await deps.fetchJson(urls.single), org);
    else if (c.source === "ashby") job = findJob(parseAshbyList(await deps.fetchJson(urls.list), org), c.jobRef);
    else if (c.source === "recruitee") job = findJob(parseRecruiteeList(await deps.fetchJson(urls.list), org), c.jobRef);
    if (job && (job.description?.length ?? 0) >= MIN_DESCRIPTION_CHARS) return { kind: "job", job, reader: "ats_api" };
    return null;
  }

  let jobs: SourceJob[] = [];
  const data = await deps.fetchJson(urls.list);
  if (c.source === "greenhouse") jobs = parseGreenhouseList(data, org);
  else if (c.source === "lever") jobs = parseLeverList(data, org);
  else if (c.source === "ashby") jobs = withoutDescriptions(parseAshbyList(data, org));
  else if (c.source === "recruitee") jobs = withoutDescriptions(parseRecruiteeList(data, org));
  if (!jobs.length) return null;
  return {
    kind: "company",
    company: { name: jobs[0].company ?? smartCapitalize(org), url: urls.list },
    jobs: jobs.slice(0, MAX_LIST_JOBS),
    reader: "ats_api",
    truncated: jobs.length > MAX_LIST_JOBS,
  };
}

// ─── Niveaux 2 et 3 : la page elle-même ───────────────────────────────────

function pageTitle(html: string): string | undefined {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const fromH1 = h1 ? htmlToText(h1[1]).split("\n")[0] : "";
  if (fromH1) return fromH1.slice(0, 140);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const fromTitle = title ? decodeEntities(title[1]).split(/\s[|\-–—]\s/)[0].trim() : "";
  return fromTitle ? fromTitle.slice(0, 140) : undefined;
}

function companyOf(c: Classified, url: URL, fallback?: string): string {
  if (c.org && c.source === "wttj") return smartCapitalize(c.org);
  return fallback ?? companyFromHost(url.hostname);
}

function listFromLinks(c: Classified, url: URL, links: PageLink[]): SourceJob[] {
  return c.source === "wttj" && c.org ? wttjJobsFromLinks(links, c.org) : genericJobLinks(links, url.toString());
}

function companyResult(c: Classified, url: URL, jobs: SourceJob[], reader: Reader): Resolved {
  return {
    kind: "company",
    company: { name: companyOf(c, url, jobs[0]?.company), url: url.toString() },
    jobs: jobs.slice(0, MAX_LIST_JOBS),
    reader,
    truncated: jobs.length > MAX_LIST_JOBS,
  };
}

function jobFromText(c: Classified, url: URL, title: string | undefined, text: string, reader: Reader): Resolved {
  return {
    kind: "job",
    reader,
    job: {
      id: url.toString(),
      title: title || smartCapitalize((c.jobRef ?? "").split("_")[0]) || "Offre",
      company: companyOf(c, url),
      url: url.toString(),
      description: capDescription(text),
    },
  };
}

/** Une page plus fournie d'un quart au moins que le JobPosting : la fiche entière, pas son seul descriptif. */
const FULLER_RATIO = 1.25;

/**
 * Le JobPosting de Welcome to the Jungle ne porte que le descriptif du poste : résumé,
 * compétences, profil recherché et déroulement des entretiens n'y sont pas. On garde ses
 * champs (titre, société, lieu, contrat, salaire) et on remplace la description par le texte
 * de la page, lu directement, sinon rendu par Firecrawl. Sans mieux, le JobPosting reste.
 */
async function completeFromPage(url: URL, job: SourceJob, html: string, deps: Deps, jobRef?: string): Promise<Resolved> {
  const known = job.description?.length ?? 0;
  const text = jobPageText(html, jobRef);
  if (text.length >= MIN_PAGE_TEXT_CHARS && !looksThin(text) && text.length > known * FULLER_RATIO) {
    return { kind: "job", job: { ...job, description: capDescription(text) }, reader: "direct_text" };
  }
  if (await deps.allowFirecrawl()) {
    try {
      // Page entière : le contenu principal seul peut perdre le bloc de tags au-dessus du descriptif.
      const rendered = jobMarkdownText((await deps.scrape(url.toString(), false)).markdown, jobRef);
      if (!looksThin(rendered, 400) && rendered.length > known * FULLER_RATIO) {
        return { kind: "job", job: { ...job, description: capDescription(rendered) }, reader: "firecrawl" };
      }
    } catch (e) {
      console.warn("[fetch-job-source] Firecrawl impossible:", e instanceof Error ? e.message : e);
    }
  }
  return { kind: "job", job, reader: "json_ld" };
}

async function readPage(url: URL, c: Classified, deps: Deps, trace: Trace): Promise<Resolved | null> {
  // Niveau 2 : lecture directe.
  let html = "";
  try {
    html = await deps.fetchPage(url.toString());
  } catch (e) {
    trace.direct = "failed";
    console.warn("[fetch-job-source] lecture directe impossible:", e instanceof Error ? e.message : e);
  }

  if (html) {
    const ld = extractJsonLdJobs(html, url.toString());
    trace.direct = {
      chars: html.length,
      ldJobs: ld.length,
      links: extractHtmlLinks(html, url.toString()).length,
      jobsMentions: (html.match(/\/jobs\b/g) ?? []).length,
      nextDataChars: /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1].length ?? 0,
      title: pageTitle(html)?.slice(0, 80),
    };
    const withText = ld.filter((j) => (j.description?.length ?? 0) >= MIN_DESCRIPTION_CHARS);
    if (c.kind !== "company" && withText.length === 1) {
      return c.source === "wttj" ? completeFromPage(url, withText[0], html, deps, c.jobRef) : { kind: "job", job: withText[0], reader: "json_ld" };
    }
    if (c.kind !== "job" && ld.length >= 2) return companyResult(c, url, withoutDescriptions(ld), "json_ld");
    if (c.kind !== "job") {
      const list = listFromLinks(c, url, extractHtmlLinks(html, url.toString()));
      if (list.length) return companyResult(c, url, list, "direct_text");
      // Welcome to the Jungle : les offres sont parfois dans les données intégrées à la page, sans lien <a>.
      const embedded = c.source === "wttj" && c.org ? wttjJobsFromLinks(wttjLinksFromRawHtml(html), c.org) : [];
      if (embedded.length) return companyResult(c, url, embedded, "direct_text");
    }
    if (c.kind !== "company") {
      const text = c.source === "wttj" ? jobPageText(html, c.jobRef) : htmlToText(html);
      if (text.length >= MIN_PAGE_TEXT_CHARS && !looksThin(text) && (c.kind === "job" || JOB_TEXT_RE.test(text))) {
        return jobFromText(c, url, pageTitle(html), text, "direct_text");
      }
    }
  }

  // Niveau 3 : rendu JavaScript par Firecrawl.
  if (!(await deps.allowFirecrawl())) {
    trace.firecrawl = "not_configured";
    return null;
  }
  try {
    const page = await deps.scrape(url.toString(), c.kind === "job");
    trace.firecrawl = { markdownChars: page.markdown.length, links: page.links.length };
    if (c.kind !== "job") {
      const list = listFromLinks(c, url, page.links);
      if (list.length) return companyResult(c, url, list, "firecrawl");
    }
    if (c.kind !== "company") {
      const text = c.source === "wttj" ? jobMarkdownText(page.markdown, c.jobRef) : markdownToText(page.markdown);
      if (!looksThin(text, 400)) return jobFromText(c, url, firstMarkdownHeading(page.markdown), text, "firecrawl");
    }
  } catch (e) {
    trace.firecrawl = "failed";
    console.warn("[fetch-job-source] Firecrawl impossible:", e instanceof Error ? e.message : e);
  }
  return null;
}

// ─── Orchestration ────────────────────────────────────────────────────────

export async function resolveUrl(url: URL, deps: Deps, expectJob: boolean): Promise<Resolved> {
  const classified = classifyUrl(url);
  if (classified.source === "linkedin") return { kind: "unreadable", message: MSG_LINKEDIN };
  // read_job : l'adresse vient d'une liste, c'est une offre, même si son chemin ne le dit pas.
  const c: Classified = expectJob ? { ...classified, kind: "job" } : classified;

  let result: Resolved | null = null;
  if (atsApiUrls(c)) {
    try {
      result = await readFromAts(c, deps, c.kind === "job");
    } catch (e) {
      console.warn("[fetch-job-source] interface du logiciel de recrutement impossible:", e instanceof Error ? e.message : e);
    }
  }
  const trace: Trace = {};
  if (!result) result = await readPage(url, c, deps, trace);

  console.log("[fetch-job-source]", expectJob ? "read_job" : "resolve", {
    host: url.hostname,
    source: c.source,
    kind: result?.kind ?? "unreadable",
    reader: result && result.kind !== "unreadable" ? result.reader : "none",
    jobs: result?.kind === "company" ? result.jobs.length : undefined,
    chars: result?.kind === "job" ? result.job.description?.length : undefined,
    ...(result ? {} : { trace }),
  });

  if (!result) {
    // Recherche ou page d'accueil du site : l'adresse attendue est celle d'une offre ou d'une société.
    const unknownWttj = c.source === "generic" && /(^|\.)welcometothejungle\.com$/.test(url.hostname);
    return { kind: "unreadable", message: unknownWttj ? MSG_WTTJ_ADDRESS : MSG_UNREADABLE };
  }
  if (expectJob && result.kind === "company") return { kind: "unreadable", message: MSG_UNREADABLE };
  return result;
}
