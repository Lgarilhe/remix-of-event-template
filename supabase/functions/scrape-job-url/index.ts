// scrape-job-url — Edge function qui scrape une URL d'offre d'emploi
// (Welcome to the Jungle, LinkedIn Jobs, Lever, Greenhouse, ATS génériques)
// et retourne TOUTES les infos structurées pour pré-remplir un brief de mission.
//
// Stratégie :
//   1. Fetch le HTML (pas de JS-rendering, mais la plupart des sites
//      exposent leurs données structurées dans le HTML statique).
//   2. Selon la source : extraction spécifique optimisée
//      - WTTJ : parsing du <script id="__NEXT_DATA__"> qui contient
//        tout l'objet job + organization (méga riche).
//      - LinkedIn / Lever / Greenhouse : JSON-LD JobPosting (schema.org)
//      - Générique : OpenGraph + meta description + JSON-LD si présent
//   3. Retourne un objet structuré exhaustif :
//      { title, description, profile, company, location, remote, salary,
//        contract_type, start_date, experience, skills, languages,
//        benefits, industry, team_size, raw_text, source }
//
// Pas d'IA ici — juste du parsing déterministe. L'IA est appelée
// ensuite (côté frontend) sur le contenu retourné.

import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FETCH_TIMEOUT_MS = 15000;

interface ScrapedJob {
  title?: string | null;
  /** Description longue : missions, contexte, ce que va faire le candidat */
  description?: string | null;
  /** Profil recherché : compétences, expérience, soft skills */
  profile?: string | null;
  /** Section "à propos de l'entreprise" / contexte */
  company_about?: string | null;
  /** Avantages, package, equity */
  benefits?: string | null;
  /** Process de recrutement */
  recruitment_process?: string | null;

  company?: string | null;
  industry?: string | null;
  team_size?: number | null;
  company_size?: string | null;

  location?: string | null;
  remote?: string | null;

  contract_type?: string | null;
  start_date?: string | null;
  experience_level?: string | null;
  experience_min_years?: number | null;

  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;

  languages?: string[];
  skills?: string[];
  education?: string | null;

  source?: string | null;
  url?: string | null;
  /** Texte brut concat de tout (pour fallback IA) */
  raw_text?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { userId: _ } = await requireAuth(req, corsHeaders);
    const body = await req.json();
    const url: string | undefined = body?.url;
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: 'URL required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lowerUrl = url.toLowerCase();
    let scraped: ScrapedJob | null = null;
    let html = '';

    // ── 1) Tentative Firecrawl /scrape avec waitFor + scroll
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    let firecrawlMd = '';
    let firecrawlMeta: Record<string, any> = {};
    if (firecrawlKey) {
      try {
        const fcBody: Record<string, unknown> = {
          url,
          formats: ['markdown'],
          onlyMainContent: false,
          waitFor: 6000,
          timeout: 35000,
        };
        if (url.toLowerCase().includes('welcometothejungle.com')) {
          fcBody.actions = [
            { type: 'wait', milliseconds: 3000 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 2000 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 2000 },
          ];
        }
        const fcRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${firecrawlKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcBody),
        });
        if (fcRes.ok) {
          const fcData = await fcRes.json();
          firecrawlMd = fcData?.data?.markdown || fcData?.markdown || '';
          firecrawlMeta = fcData?.data?.metadata || fcData?.metadata || {};
          console.log('[scrape-job-url] Firecrawl /scrape returned', firecrawlMd.length, 'chars');
        } else {
          const errText = await fcRes.text().catch(() => '');
          console.warn('[scrape-job-url] Firecrawl /scrape HTTP', fcRes.status, errText.slice(0, 200));
        }
      } catch (e) {
        console.warn('[scrape-job-url] Firecrawl /scrape error:', e);
      }

      // Si /scrape donne assez de contenu → on l'utilise
      if (firecrawlMd && firecrawlMd.length > 800) {
        scraped = buildFromFirecrawl(firecrawlMd, firecrawlMeta, url);
      } else {
        // Sinon → on tente Firecrawl /extract qui utilise un LLM pour
        // structurer les données depuis la page (plus lent mais plus fiable
        // sur les sites complexes type WTTJ avec anti-bot).
        console.log('[scrape-job-url] Trying Firecrawl /extract as fallback');
        try {
          const extractRes = await fetch('https://api.firecrawl.dev/v1/extract', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              urls: [url],
              prompt: `Extract ALL information about this job posting. Be exhaustive — include the full mission description, profile required, benefits, recruitment process, company info, salary, location, contract type, languages, technical skills, experience required. Don't summarize — return the COMPLETE text content as it appears on the page.`,
              schema: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Job title' },
                  company: { type: 'string', description: 'Company name' },
                  location: { type: 'string', description: 'Job location (city)' },
                  remote: { type: 'string', description: 'Remote policy if mentioned (full remote, hybrid, etc.)' },
                  contract_type: { type: 'string', description: 'Contract type (CDI, CDD, Freelance, Stage…)' },
                  start_date: { type: 'string', description: 'Start date if mentioned' },
                  experience_level: { type: 'string', description: 'Required experience level' },
                  salary_min: { type: 'number', description: 'Minimum salary in EUR if mentioned' },
                  salary_max: { type: 'number', description: 'Maximum salary in EUR if mentioned' },
                  description: { type: 'string', description: 'FULL job description / mission. Include all details about responsibilities, projects, day-to-day tasks. Several paragraphs.' },
                  profile: { type: 'string', description: 'FULL profile required / qualifications / requirements. Several paragraphs if available.' },
                  benefits: { type: 'string', description: 'Benefits, perks, package details' },
                  recruitment_process: { type: 'string', description: 'Steps of the recruitment process if mentioned' },
                  company_about: { type: 'string', description: 'About the company, mission, values, size if mentioned' },
                  industry: { type: 'string', description: 'Company industry / sector' },
                  skills: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Technical skills, technologies, frameworks mentioned',
                  },
                  languages: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Spoken languages required (French, English, etc.)',
                  },
                },
                required: ['title'],
              },
            }),
          });
          if (extractRes.ok) {
            const extractData = await extractRes.json();
            const extracted = extractData?.data || extractData?.extracted || extractData;
            console.log('[scrape-job-url] Firecrawl /extract returned keys:', Object.keys(extracted || {}));
            if (extracted && (extracted.title || extracted.description)) {
              scraped = {
                title: extracted.title || null,
                description: extracted.description || null,
                profile: extracted.profile || null,
                benefits: extracted.benefits || null,
                recruitment_process: extracted.recruitment_process || null,
                company_about: extracted.company_about || null,
                company: extracted.company || null,
                industry: extracted.industry || null,
                location: extracted.location || null,
                remote: extracted.remote || null,
                contract_type: extracted.contract_type || null,
                start_date: extracted.start_date || null,
                experience_level: extracted.experience_level || null,
                salary_min: typeof extracted.salary_min === 'number' ? extracted.salary_min : null,
                salary_max: typeof extracted.salary_max === 'number' ? extracted.salary_max : null,
                salary_currency: 'EUR',
                skills: Array.isArray(extracted.skills) ? extracted.skills : [],
                languages: Array.isArray(extracted.languages) ? extracted.languages : [],
              };
            }
          } else {
            const errText = await extractRes.text().catch(() => '');
            console.warn('[scrape-job-url] Firecrawl /extract HTTP', extractRes.status, errText.slice(0, 200));
          }
        } catch (e) {
          console.warn('[scrape-job-url] Firecrawl /extract error:', e);
        }

        // Si /extract foire aussi mais qu'on a quand même un peu de markdown du /scrape
        if (!scraped && firecrawlMd && firecrawlMd.length > 200) {
          scraped = buildFromFirecrawl(firecrawlMd, firecrawlMeta, url);
        }
      }
    } else {
      console.warn('[scrape-job-url] FIRECRAWL_API_KEY missing — skipping Firecrawl');
    }

    // ── 2) Fallback : fetch HTML statique + parsing si Firecrawl pas dispo
    // ou content insuffisant
    if (!scraped || !scraped.description || scraped.description.length < 100) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
          },
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));

        if (res.ok) {
          html = await res.text();
        }
      } catch (fetchErr) {
        console.warn('[scrape-job-url] static fetch failed:', fetchErr);
      }

      if (html) {
        let parsedFromHtml: ScrapedJob | null = null;
        if (lowerUrl.includes('welcometothejungle.com')) {
          parsedFromHtml = parseWTTJ(html);
          if (parsedFromHtml) parsedFromHtml.source = 'Welcome to the Jungle';
        } else if (lowerUrl.includes('linkedin.com')) {
          parsedFromHtml = parseJsonLd(html);
          if (parsedFromHtml) parsedFromHtml.source = 'LinkedIn Jobs';
        } else if (lowerUrl.includes('lever.co')) {
          parsedFromHtml = parseJsonLd(html) || parseLever(html);
          if (parsedFromHtml) parsedFromHtml.source = 'Lever';
        } else if (lowerUrl.includes('greenhouse.io')) {
          parsedFromHtml = parseJsonLd(html) || parseGreenhouse(html);
          if (parsedFromHtml) parsedFromHtml.source = 'Greenhouse';
        } else {
          parsedFromHtml = parseJsonLd(html);
        }
        if (!parsedFromHtml || (!parsedFromHtml.title && !parsedFromHtml.description)) {
          const fb = parseFallback(html, url);
          parsedFromHtml = parsedFromHtml ? mergeJobs(parsedFromHtml, fb) : fb;
        }
        // Merge avec le résultat Firecrawl éventuel
        scraped = scraped ? mergeJobs(scraped, parsedFromHtml) : parsedFromHtml;
      }
    }

    // Si rien de tout ça n'a marché → on retourne un message clair
    if (!scraped || (!scraped.title && !scraped.description)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Impossible d\'extraire le contenu de cette page',
          details: 'La page bloque les bots ou nécessite une authentification. Copie-colle le contenu manuellement.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Set source if missing based on URL
    if (!scraped.source) {
      if (lowerUrl.includes('welcometothejungle.com')) scraped.source = 'Welcome to the Jungle';
      else if (lowerUrl.includes('linkedin.com')) scraped.source = 'LinkedIn Jobs';
      else if (lowerUrl.includes('lever.co')) scraped.source = 'Lever';
      else if (lowerUrl.includes('greenhouse.io')) scraped.source = 'Greenhouse';
    }

    if (scraped) {
      scraped.url = url;
      // Construit raw_text de tout ce qu'on a (pour passer à l'IA)
      scraped.raw_text = buildRawText(scraped);
    }

    return new Response(
      JSON.stringify({
        success: !!scraped && (!!scraped.title || !!scraped.description),
        job: scraped,
        ...(scraped && (!scraped.title && !scraped.description) ? {
          warning: 'Extraction limitée — la page est peut-être protégée ou utilise du JS rendering. Copie-colle le contenu pour avoir un brief complet.',
        } : {}),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error('[scrape-job-url] error:', e);
    return new Response(
      JSON.stringify({ success: false, error: e?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ─── Firecrawl : markdown + métadonnées ─────────────────────────────
// Firecrawl exécute le JS et retourne le markdown propre + les meta tags
// extraits. Pour les sites en CSR (WTTJ, LinkedIn jobs), c'est le seul
// moyen fiable de récupérer le contenu complet.
function buildFromFirecrawl(markdown: string, meta: Record<string, any>, url: string): ScrapedJob {
  const title = pickStr(meta.title, meta.ogTitle, meta['og:title']);
  const titleParts = title?.split(' - ').map(s => s.trim()).filter(Boolean) || [];
  const cleanTitle = titleParts[0] || title;
  let companyFromTitle: string | null = null;
  let contractFromTitle: string | null = null;
  let locationFromTitle: string | null = null;
  if (titleParts.length >= 2) companyFromTitle = titleParts[1];
  if (titleParts.length >= 3) {
    const contractCandidate = titleParts[2];
    const contractMatch = contractCandidate.match(/^(CDI|CDD|Freelance|Stage|Alternance|Apprentissage|Intérim|Internship)/i);
    if (contractMatch) {
      contractFromTitle = contractMatch[0];
      const rest = contractCandidate.replace(contractMatch[0], '').replace(/^[\s-à]+/i, '').trim();
      if (rest) locationFromTitle = rest;
    } else {
      locationFromTitle = contractCandidate;
    }
  }

  const ogDescription = pickStr(meta.ogDescription, meta['og:description'], meta.description);

  // Parse markdown sections — bcp de fiches utilisent les sections H2/H3
  const sections = splitMarkdownSections(markdown);
  const hasStructuredSections = !!(sections.mission || sections.profil || sections.avantages);

  // Clean markdown : enlève les bouts répétitifs ou non utiles
  const cleanedMd = cleanMarkdown(markdown);

  // Stratégie pour la description :
  //   - Si on a des sections structurées → on utilise les bonnes sections
  //   - Sinon → markdown complet nettoyé (l'IA s'occupera de structurer)
  let description: string | null;
  if (hasStructuredSections) {
    description = sections.mission || sections.poste || sections.description || cleanedMd;
  } else {
    // Pas de sections H2/H3 reconnues — on prend le markdown nettoyé entier
    // qui contient TOUT le contenu de la page
    description = cleanedMd.length > 200 ? cleanedMd : ogDescription;
  }

  return {
    title: cleanTitle,
    description,
    profile: sections.profil || sections.profile || sections.qualifications || null,
    benefits: sections.avantages || sections.benefits || sections.perks || null,
    recruitment_process: sections.process || sections.recrutement || null,
    company_about: sections.entreprise || sections.about || sections['à propos'] || sections.company || null,
    company: companyFromTitle || pickStr(meta.ogSiteName, meta['og:site_name']),
    location: locationFromTitle,
    contract_type: contractFromTitle,
    raw_text: cleanedMd,
  };
}

// Nettoie le markdown : enlève les images, liens utm, sections de nav/footer
// résiduelles, sections cookies, ligne dupliquées.
function cleanMarkdown(md: string): string {
  return md
    // Enlève les images (ne servent à rien dans un brief)
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Garde le texte du lien mais enlève l'URL
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Enlève les patterns récurrents WTTJ/LinkedIn (postuler, partager, etc.)
    .replace(/^(Postuler|Apply now|Partager|Share|Sauvegarder|Save|Connexion|Sign in)\s*$/gim, '')
    // Enlève cookies banners / GDPR
    .replace(/(?:Accepter|Refuser|Gérer)[^\n]{0,40}cookies?[^\n]*$/gim, '')
    // Compresse les espaces / lignes vides multiples
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Split markdown by H2/H3 headings to identify sections
function splitMarkdownSections(md: string): Record<string, string> {
  const sections: Record<string, string> = {};
  // Match heading + content jusqu'au prochain heading même niveau ou supérieur
  const lines = md.split('\n');
  let currentTitle: string | null = null;
  let currentContent: string[] = [];

  const flush = () => {
    if (currentTitle) {
      sections[currentTitle.toLowerCase().trim()] = currentContent.join('\n').trim();
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentTitle = headingMatch[1]
        .replace(/[^\w\s'àâäéèêëïîôöùûüç-]/gi, '')
        .toLowerCase()
        .trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  flush();

  // Aliases : on stocke aussi sous des clés normalisées
  const aliasMap: Record<string, string[]> = {
    mission: ['le poste', 'votre mission', 'tes missions', 'descriptif du poste', 'job description', 'about the role', 'le poste en bref'],
    profil: ['profil recherché', 'ce que nous recherchons', 'votre profil', 'ton profil', 'qualifications', 'requirements'],
    avantages: ['avantages', 'benefits', 'perks', 'package', 'rémunération', 'ce que nous offrons'],
    process: ['process de recrutement', 'recruitment process', 'process recrutement', 'étapes du process'],
    entreprise: ['à propos de l\'entreprise', 'about the company', 'who we are', 'présentation de l\'entreprise'],
  };
  for (const [canonical, variants] of Object.entries(aliasMap)) {
    if (sections[canonical]) continue;
    for (const variant of variants) {
      if (sections[variant]) {
        sections[canonical] = sections[variant];
        break;
      }
    }
  }
  return sections;
}

// ─── WTTJ : __NEXT_DATA__ ────────────────────────────────────────────
// WTTJ = Next.js. Le HTML statique contient tout le state de la page
// dans <script id="__NEXT_DATA__"> sous forme de JSON. Très riche.
function parseWTTJ(html: string): ScrapedJob | null {
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const pageProps = data?.props?.pageProps || {};
    const job = pageProps.job || pageProps.jobOffer || pageProps.offer;
    const org = pageProps.organization || pageProps.company;
    if (!job) return null;

    const result: ScrapedJob = {
      title: pickStr(job.name, job.title, job.position_title),
      description: stripHtml(pickStr(
        job.description,
        job.description_translated,
        job.context,
      )),
      profile: stripHtml(pickStr(job.profile, job.profile_translated, job.requirements)),
      benefits: stripHtml(pickStr(job.benefits, job.perks)),
      recruitment_process: stripHtml(pickStr(job.recruitment_process)),

      company: pickStr(org?.name, job.organization_name),
      industry: pickStr(org?.industries?.[0]?.name, org?.industries?.[0]),
      team_size: typeof org?.size === 'number' ? org.size : null,
      company_size: pickStr(org?.size_range, org?.size_label),
      company_about: stripHtml(pickStr(org?.description, org?.description_translated)),

      location: pickStr(
        job.office?.city,
        job.office?.address,
        job.locations?.[0]?.city,
        job.locations?.[0]?.name,
        job.location,
      ),
      remote: pickStr(job.remote, job.remote_label, job.remote_policy),

      contract_type: pickStr(
        job.contract_type?.short_name,
        job.contract_type?.name,
        job.contract_type,
      ),
      start_date: pickStr(job.start_date, job.start_date_label),
      experience_level: pickStr(job.experience_level?.label, job.experience_level, job.experience),
      experience_min_years: typeof job.experience_min === 'number' ? job.experience_min : null,

      salary_min: typeof job.salary?.min === 'number' ? job.salary.min : null,
      salary_max: typeof job.salary?.max === 'number' ? job.salary.max : null,
      salary_currency: pickStr(job.salary?.currency, job.salary?.currency_code),
      salary_period: pickStr(job.salary?.period, job.salary?.frequency, 'yearly'),

      languages: Array.isArray(job.languages)
        ? job.languages.map((l: any) => pickStr(l.value, l.name, l.label, l.short_name)).filter(Boolean) as string[]
        : [],
      skills: Array.isArray(job.skills)
        ? job.skills.map((s: any) => pickStr(s.name, s.label, s)).filter(Boolean) as string[]
        : [],
      education: pickStr(job.education?.label, job.education),
    };

    return result;
  } catch (e) {
    console.warn('[parseWTTJ] failed:', e);
    return null;
  }
}

// ─── JSON-LD JobPosting (schema.org) ────────────────────────────────
// Format standard utilisé par LinkedIn, Lever, Greenhouse, et la
// plupart des sites carrière respectables.
function parseJsonLd(html: string): ScrapedJob | null {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g;
  const matches: string[] = [];
  let m;
  while ((m = re.exec(html)) !== null) matches.push(m[1]);

  for (const raw of matches) {
    try {
      const data = JSON.parse(raw.trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const node = unwrapGraph(item);
        if (node?.['@type'] === 'JobPosting' || (Array.isArray(node?.['@type']) && node['@type'].includes('JobPosting'))) {
          return jsonLdToScraped(node);
        }
      }
    } catch {}
  }
  return null;
}

function unwrapGraph(item: any): any {
  if (item?.['@graph'] && Array.isArray(item['@graph'])) {
    return item['@graph'].find((g: any) => g['@type'] === 'JobPosting' || (Array.isArray(g['@type']) && g['@type'].includes('JobPosting'))) || item;
  }
  return item;
}

function jsonLdToScraped(j: any): ScrapedJob {
  const baseSalary = j.baseSalary?.value || {};
  const salaryMin = typeof baseSalary.minValue === 'number' ? baseSalary.minValue
    : typeof j.baseSalary?.value === 'number' ? j.baseSalary.value : null;
  const salaryMax = typeof baseSalary.maxValue === 'number' ? baseSalary.maxValue : null;

  const loc = j.jobLocation?.address || j.jobLocation?.[0]?.address || {};
  const locationStr = pickStr(loc.addressLocality, loc.addressRegion, loc.addressCountry, j.jobLocation?.name);

  return {
    title: pickStr(j.title, j.name),
    description: stripHtml(pickStr(j.description, j.responsibilities)),
    profile: stripHtml(pickStr(j.qualifications, j.experienceRequirements)),
    benefits: stripHtml(pickStr(j.jobBenefits, j.incentiveCompensation)),
    company: pickStr(j.hiringOrganization?.name, j.hiringOrganization),
    industry: pickStr(j.industry, j.occupationalCategory),
    location: locationStr,
    remote: j.jobLocationType === 'TELECOMMUTE' ? 'Remote' : (j.applicantLocationRequirements ? 'Hybride' : null),
    contract_type: pickStr(j.employmentType),
    start_date: pickStr(j.datePosted),
    experience_level: pickStr(j.experienceRequirements?.monthsOfExperience ? `${Math.round(j.experienceRequirements.monthsOfExperience / 12)} ans` : null),
    salary_min: salaryMin,
    salary_max: salaryMax,
    salary_currency: pickStr(baseSalary.currency, j.baseSalary?.currency),
    salary_period: pickStr(baseSalary.unitText, 'YEAR'),
    skills: Array.isArray(j.skills) ? j.skills : (typeof j.skills === 'string' ? j.skills.split(',').map((s: string) => s.trim()) : []),
    languages: [],
  };
}

// ─── Lever (fallback HTML quand JSON-LD absent) ──────────────────────
function parseLever(html: string): ScrapedJob | null {
  const titleMatch = html.match(/<h2[^>]*class=["'][^"']*posting-headline[^"']*["'][^>]*>[\s\S]*?<h2[^>]*>([^<]+)<\/h2>/)
    || html.match(/<title>([^|<]+)/);
  return {
    title: titleMatch?.[1]?.trim(),
    description: stripHtml(extractBetween(html, 'class="section page-centered"', '</div>') || ''),
  };
}

// ─── Greenhouse (fallback) ───────────────────────────────────────────
function parseGreenhouse(html: string): ScrapedJob | null {
  const titleMatch = html.match(/<h1[^>]+class=["'][^"']*app-title[^"']*["'][^>]*>([^<]+)/)
    || html.match(/<title>([^|<]+)/);
  return {
    title: titleMatch?.[1]?.trim(),
    description: stripHtml(extractBetween(html, '<div id="content"', '</div>') || ''),
  };
}

// ─── Fallback générique : OpenGraph + meta ──────────────────────────
function parseFallback(html: string, url: string): ScrapedJob {
  const ogTitle = extractMeta(html, 'og:title') || extractTitle(html);
  const ogDesc = extractMeta(html, 'og:description') || extractMeta(html, 'description');
  const ogSiteName = extractMeta(html, 'og:site_name');

  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}

  return {
    title: ogTitle,
    description: ogDesc,
    company: ogSiteName,
    source: ogSiteName || host,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pickStr(...vals: any[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return null;
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à')
    .replace(/&ccedil;/g, 'ç').replace(/&ecirc;/g, 'ê').replace(/&ocirc;/g, 'ô')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

function extractMeta(html: string, name: string): string | null {
  const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(`<meta[^>]+property=["']${escName}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+name=["']${escName}["'][^>]+content=["']([^"']+)["']`, 'i');
  const re3 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escName}["']`, 'i');
  return html.match(re1)?.[1] || html.match(re2)?.[1] || html.match(re3)?.[1] || null;
}

function extractTitle(html: string): string | null {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || null;
}

function extractBetween(html: string, start: string, end: string): string | null {
  const i = html.indexOf(start);
  if (i < 0) return null;
  const j = html.indexOf(end, i);
  if (j < 0) return null;
  return html.slice(i, j);
}

function mergeJobs(a: ScrapedJob, b: ScrapedJob): ScrapedJob {
  const merged: ScrapedJob = { ...a };
  for (const k of Object.keys(b) as (keyof ScrapedJob)[]) {
    if (merged[k] == null && b[k] != null) (merged as any)[k] = b[k];
  }
  return merged;
}

function buildRawText(j: ScrapedJob): string {
  const parts: string[] = [];
  if (j.title) parts.push(`# ${j.title}`);
  if (j.company) parts.push(`Entreprise : ${j.company}`);
  if (j.industry) parts.push(`Secteur : ${j.industry}`);
  if (j.location) parts.push(`Lieu : ${j.location}${j.remote ? ` · ${j.remote}` : ''}`);
  if (j.contract_type) parts.push(`Contrat : ${j.contract_type}`);
  if (j.start_date) parts.push(`Démarrage : ${j.start_date}`);
  if (j.experience_level) parts.push(`Expérience : ${j.experience_level}`);
  if (j.salary_min || j.salary_max) {
    const period = j.salary_period === 'YEAR' || j.salary_period === 'yearly' ? '/an' : j.salary_period ? ` ${j.salary_period}` : '';
    const cur = j.salary_currency || 'EUR';
    const range = j.salary_min && j.salary_max ? `${j.salary_min}-${j.salary_max}` : j.salary_min ? `${j.salary_min}+` : `≤${j.salary_max}`;
    parts.push(`Salaire : ${range} ${cur}${period}`);
  }
  if (j.languages && j.languages.length) parts.push(`Langues : ${j.languages.join(', ')}`);
  if (j.skills && j.skills.length) parts.push(`Compétences : ${j.skills.join(', ')}`);
  if (j.education) parts.push(`Formation : ${j.education}`);
  parts.push('');
  if (j.description) parts.push('## Mission\n' + j.description);
  if (j.profile) parts.push('## Profil recherché\n' + j.profile);
  if (j.benefits) parts.push('## Avantages\n' + j.benefits);
  if (j.recruitment_process) parts.push('## Process de recrutement\n' + j.recruitment_process);
  if (j.company_about) parts.push('## À propos de l\'entreprise\n' + j.company_about);
  return parts.join('\n');
}
