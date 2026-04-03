// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;
import { requireAuth } from "../_shared/require-auth.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface WorkExperienceItem {
  role: string;
  company: string;
  duration?: string;
  durationMonths?: number;
  description?: string;
  skills?: string[];
}

interface ProfileData {
  id: string; // IMPORTANT: UUID stable depuis ta table candidates
  name: string;
  headline?: string;
  currentRole?: string;
  currentCompany?: string;
  location?: string;
  skills?: string[];
  summary?: string;
  workExperience?: WorkExperienceItem[];
  pastPositions?: string[];
  education?: string[];
  yearsOfExperience?: number;
  averageTenureMonths?: number | null;
  openToWork?: boolean;
  openProfile?: boolean;
  networkDistance?: number | null;
  profileUrl?: string;
  providerId?: string;
  noAiScoring?: boolean;
}

interface JobData {
  id: string;
  title: string;
  client?: { name: string; sector: string } | null;
  skills: string[];
  requirements?: string;
  description?: string;
  seniority?: string;
  location?: string;
  remote?: string;
  xpMin?: number;
  xpMax?: number;
  salaryMin?: number;
  salaryMax?: number;
  tjmMin?: number;
  tjmMax?: number;
  contractType?: string;
  mustHave?: string;
  shouldHave?: string;
  niceToHave?: string;
  transversalCriteria?: {
    must?: string;
    should?: string;
    niceToHave?: string;
    context?: string;
    bodyContent?: string;
  };
  bodyContent?: string;
}

interface DimensionScore {
  score: number;
  weight: number;
  details?: string;
}

interface ScoringResult {
  profile_id?: string;
  name: string;
  score: number;
  recommendation: string;
  summary: string;
  strengths: string[];
  concerns: string[];
  missingSkills: string[];
  seniorityMatch?: string;
  locationMatch?: string;
  experienceMatch?: string;
  tenureAnalysis?: string;
  receptivityScore?: number | null;
  internationalExperienceValidation?: string;
  locationCompatibility?: string;
  candidatePreferencesConflict?: string | null;
  contractMismatch?: string | null;
  skipReason?: string | null;
  matchedSkills?: string[];
  matchedSkillCount?: number;
  totalRequiredSkills?: number;
  hardFilterPassed: boolean;
  hardFilterKO?: string;
  weightedCriteriaScore: number;
  semanticScore: number | null;
  llmScore: number | null;
  pedigreeScore?: number | null;
  notableCompanies?: string[] | null;
  criteriaEvaluations?: Array<{ label: string; verdict: string; reason: string }>;
  finalScore: number;
  confidenceScore: number;
  dimensions: Record<string, DimensionScore>;
  dataCompleteness: "full" | "partial" | "minimal";
  missingDataPoints: string[];
  skippedLLM: boolean;
  processingTimeMs: number;
  tokensUsed: { input: number; output: number } | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Default model — can be overridden per-request via _ai_model
const CLAUDE_MODEL_DEFAULT = "claude-sonnet-4-6";
const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 200;
const CACHE_TTL_MS = 48 * 60 * 60 * 1000; // 48h
const MAX_LLM_RETRIES = 2;

// ─── Skill Synonyms ─────────────────────────────────────────────────────────
// Synchronized with src/hooks/linkedin/skillSynonyms.ts — keep both in sync.
// Used for hard-filter pre-computation and implicit skill extraction.
// NOTE: The definitive skill matching is done by the LLM (Claude), which
// understands synonyms and context natively. This dictionary is a fast heuristic.

const SKILL_SYNONYMS: Record<string, string[]> = {
  // Languages & Frameworks
  javascript: ["js", "ecmascript", "es6", "es2015", "es2020"],
  typescript: ["ts"],
  python: ["py", "python3", "pyspark"],
  java: ["jvm", "spring", "spring boot", "j2ee", "jee", "hibernate"],
  "c#": ["csharp", ".net", "dotnet", "asp.net"],
  "c++": ["cpp", "c plus plus"],
  go: ["golang"],
  rust: ["rustlang"],
  ruby: ["rails", "ruby on rails", "ror"],
  php: ["laravel", "symfony", "wordpress"],
  swift: ["ios development", "swiftui"],
  kotlin: ["android development", "jetpack compose"],
  scala: ["akka", "play framework"],
  vba: ["visual basic", "excel macro"],
  abap: ["sap abap"],
  // Frontend
  react: ["reactjs", "react.js", "react native"],
  vue: ["vuejs", "vue.js", "nuxt", "nuxtjs"],
  angular: ["angularjs", "angular.js"],
  "next.js": ["nextjs", "next"],
  svelte: ["sveltekit"],
  tailwind: ["tailwindcss"],
  sass: ["scss", "less"],
  figma: ["ui design", "sketch", "adobe xd"],
  // Backend & API
  node: ["nodejs", "node.js", "express", "fastify", "nestjs"],
  api: ["rest api", "restful", "api rest"],
  graphql: ["graph ql", "apollo graphql"],
  grpc: ["protocol buffers", "protobuf"],
  microservices: ["micro-services", "architecture microservices", "soa"],
  // Databases
  postgres: ["postgresql", "psql", "pg"],
  mysql: ["mariadb"],
  sql: ["sql server", "mssql", "tsql", "plsql", "pl/sql"],
  mongodb: ["mongo", "mongoose"],
  redis: ["redis cache", "redis cluster"],
  elasticsearch: ["elastic", "elastic search", "opensearch"],
  cassandra: ["apache cassandra", "scylladb"],
  dynamodb: ["dynamo db", "aws dynamodb"],
  oracle: ["oracle db", "oracle database"],
  // Cloud
  aws: ["amazon web services", "amazon aws"],
  azure: ["microsoft azure", "azure cloud"],
  gcp: ["google cloud", "google cloud platform"],
  ec2: ["elastic compute", "amazon ec2"],
  s3: ["amazon s3", "simple storage service"],
  lambda: ["aws lambda", "serverless aws"],
  eks: ["elastic kubernetes service", "aws eks"],
  aks: ["azure kubernetes service"],
  gke: ["google kubernetes engine"],
  // Virtualisation
  vmware: ["vsphere", "esxi", "vcenter", "vsan", "nsx", "vmware vsphere"],
  "hyper-v": ["hyperv", "hyper v", "microsoft hyper-v"],
  kvm: ["qemu", "libvirt"],
  openstack: ["open stack"],
  nutanix: ["nutanix ahv", "acropolis"],
  virtualisation: ["virtualization", "hyperviseur", "hypervisor"],
  // Containers & Orchestration
  docker: ["containers", "containerization", "containerd", "containerisation"],
  kubernetes: ["k8s", "kube", "container orchestration"],
  helm: ["helm charts"],
  istio: ["service mesh", "envoy proxy"],
  openshift: ["red hat openshift", "ocp"],
  // IaC & Config Management
  terraform: ["iac", "infrastructure as code", "terragrunt", "opentofu"],
  ansible: ["configuration management", "ansible playbook"],
  puppet: ["puppet enterprise"],
  chef: ["chef infra", "chef automate"],
  packer: ["hashicorp packer"],
  // CI/CD & DevOps
  "ci/cd": ["cicd", "continuous integration", "continuous deployment", "continuous delivery"],
  devops: ["dev ops", "sre", "site reliability", "platform engineering"],
  jenkins: ["ci server", "jenkins pipeline"],
  gitlab: ["gitlab ci", "gitlab ci/cd"],
  "github actions": ["gh actions", "github workflows"],
  argocd: ["argo cd", "gitops"],
  // Networking
  cisco: ["ios", "nexus", "catalyst", "cisco systems"],
  juniper: ["junos", "juniper networks"],
  arista: ["arista networks", "arista eos"],
  networking: ["network", "réseau", "réseaux", "network engineer"],
  bgp: ["border gateway protocol"],
  "sd-wan": ["sdwan", "software defined wan"],
  vpn: ["virtual private network", "ipsec", "openvpn", "wireguard"],
  dns: ["bind", "domain name system", "powerdns"],
  // Security
  cybersecurity: ["cybersécurité", "infosec", "information security", "sécurité informatique"],
  "palo alto": ["palo alto networks", "pan-os", "panorama"],
  fortinet: ["fortigate", "fortios", "fortimanager"],
  checkpoint: ["check point", "check point firewall"],
  zscaler: ["zscaler zpa", "zscaler zia", "zero trust network"],
  waf: ["web application firewall", "modsecurity"],
  siem: ["security information", "splunk siem", "qradar", "sentinel"],
  soc: ["security operations center", "centre opérationnel de sécurité"],
  pentest: ["penetration testing", "test intrusion", "ethical hacking"],
  rgpd: ["gdpr", "data protection", "protection des données"],
  // Load Balancing
  f5: ["big-ip", "f5 networks", "f5 big-ip", "ltm"],
  haproxy: ["ha proxy"],
  nginx: ["nginx plus", "reverse proxy"],
  traefik: ["traefik proxy"],
  "load balancing": ["load balancer", "répartition de charge"],
  // Monitoring
  nagios: ["nagios xi", "centreon"],
  zabbix: ["zabbix monitoring"],
  datadog: ["dd", "datadog agent"],
  splunk: ["splunk enterprise"],
  grafana: ["grafana dashboards"],
  prometheus: ["prom", "promql"],
  elk: ["elk stack", "logstash", "kibana", "elastic stack"],
  dynatrace: ["dynatrace oneagent"],
  // Storage & Backup
  netapp: ["ontap", "netapp ontap"],
  "dell emc": ["emc", "dell storage", "powerstore"],
  ceph: ["ceph storage", "rados"],
  san: ["storage area network", "fibre channel", "iscsi"],
  nas: ["network attached storage", "nfs", "smb", "cifs"],
  veeam: ["veeam backup"],
  commvault: ["commvault backup"],
  // OS
  linux: ["unix", "rhel", "ubuntu", "debian", "centos", "rocky linux"],
  "windows server": ["active directory", "ad", "gpo", "wsus", "sccm"],
  shell: ["bash", "zsh", "scripting", "powershell", "script shell"],
  // ITSM
  servicenow: ["snow", "service-now"],
  itil: ["itil v3", "itil v4", "gestion des services"],
  jira: ["atlassian jira", "jira service management"],
  // Data & BI
  "data engineering": ["data pipeline", "etl", "elt", "data platform"],
  spark: ["apache spark", "pyspark", "spark streaming"],
  airflow: ["apache airflow", "dag", "orchestration données"],
  dbt: ["data build tool"],
  kafka: ["event streaming", "message queue", "apache kafka", "confluent"],
  rabbitmq: ["message broker", "amqp"],
  snowflake: ["snowflake db", "snowflake data cloud"],
  databricks: ["lakehouse", "delta lake"],
  tableau: ["data visualization", "dataviz"],
  "power bi": ["powerbi"],
  looker: ["looker studio", "google data studio"],
  // ML & AI
  "machine learning": ["ml", "deep learning", "ai", "artificial intelligence"],
  tensorflow: ["tf", "keras"],
  pytorch: ["torch"],
  nlp: ["natural language processing", "traitement du langage naturel"],
  "data science": ["science des données", "data scientist"],
  // Agile & PM
  agile: ["scrum", "kanban", "safe", "lean agile"],
  pmp: ["project management professional", "gestion de projet"],
  "product management": ["product owner", "po", "gestion produit"],
  // ERP & Business
  sap: ["sap erp", "sap hana", "sap s/4hana", "sap fi/co", "sap mm"],
  salesforce: ["sfdc", "salesforce crm", "salesforce lightning"],
  hubspot: ["hubspot crm", "hubspot marketing"],
  workday: ["workday hcm"],
  // Marketing
  seo: ["search engine optimization", "référencement naturel"],
  sea: ["search engine advertising", "google ads", "adwords"],
  "marketing automation": ["marketo", "pardot", "mailchimp", "brevo"],
  crm: ["customer relationship management", "gestion relation client"],
  // Finance
  comptabilité: ["accounting", "comptable", "accountant"],
  ifrs: ["normes ifrs", "international financial reporting"],
  "contrôle de gestion": ["management control", "controlling"],
  kyc: ["know your customer", "aml", "anti money laundering", "lcb-ft"],
  // HR
  sirh: ["hris", "human resource information system"],
  paie: ["payroll", "gestion paie"],
  recrutement: ["recruitment", "sourcing", "talent acquisition"],
  // Supply Chain
  "supply chain": ["chaîne d'approvisionnement", "supply chain management", "scm"],
  wms: ["warehouse management system", "gestion d'entrepôt"],
  lean: ["lean management", "lean manufacturing", "kaizen", "six sigma"],
  // Engineering & BTP
  autocad: ["auto cad", "autodesk autocad"],
  bim: ["building information modeling", "maquette numérique"],
  solidworks: ["solid works", "dassault solidworks"],
  // Legal
  compliance: ["conformité", "regulatory compliance"],
  "propriété intellectuelle": ["intellectual property", "ip", "brevets", "patents"],
  dpo: ["data protection officer", "délégué protection données"],
  // Healthcare
  hl7: ["health level 7", "hl7 fhir"],
  fhir: ["fast healthcare interoperability"],
  // Certifications
  ccna: ["cisco certified network associate"],
  ccnp: ["cisco certified network professional"],
  "aws saa": ["aws solutions architect", "solutions architect associate"],
  "az-104": ["azure administrator"],
  vcp: ["vmware certified professional"],
  cka: ["certified kubernetes administrator"],
  cissp: ["certified information systems security"],
};

// Build a flat lookup: variant → canonical
const VARIANT_TO_CANONICAL = new Map<string, string>();
for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
  VARIANT_TO_CANONICAL.set(canonical, canonical);
  for (const syn of synonyms) {
    VARIANT_TO_CANONICAL.set(syn, canonical);
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Normalize a skill string to its canonical form */
function normalizeSkill(skill: string): string {
  const lower = skill.trim().toLowerCase();
  return VARIANT_TO_CANONICAL.get(lower) ?? lower;
}

/** Word-boundary-safe skill matching */
function skillsMatch(profileSkill: string, jobSkill: string): boolean {
  const pNorm = normalizeSkill(profileSkill);
  const jNorm = normalizeSkill(jobSkill);

  // Exact canonical match
  if (pNorm === jNorm) return true;

  // For skills >= 3 chars, allow word-boundary substring match
  // This avoids false positives on short skills like "go", "r", "c"
  if (pNorm.length >= 3 && jNorm.length >= 3) {
    const pRegex = new RegExp(`\\b${escapeRegex(pNorm)}\\b`, "i");
    const jRegex = new RegExp(`\\b${escapeRegex(jNorm)}\\b`, "i");
    if (pRegex.test(jNorm) || jRegex.test(pNorm)) return true;
  }

  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeSkillMatch(
  profileSkills: string[],
  jobSkills: string[],
): { matched: string[]; missing: string[]; ratio: number } {
  const matched = jobSkills.filter((js) => profileSkills.some((ps) => skillsMatch(ps, js)));
  const missing = jobSkills.filter((js) => !profileSkills.some((ps) => skillsMatch(ps, js)));
  return {
    matched,
    missing,
    ratio: jobSkills.length > 0 ? matched.length / jobSkills.length : 0,
  };
}

/** Extract implicit skills from headline and work experience descriptions */
function extractImplicitSkills(profile: ProfileData): string[] {
  const implicit: Set<string> = new Set();
  const allText: string[] = [];

  if (profile.headline) allText.push(profile.headline);
  if (profile.summary) allText.push(profile.summary);
  for (const exp of profile.workExperience ?? []) {
    if (exp.description) allText.push(exp.description);
    if (exp.role) allText.push(exp.role);
    for (const s of exp.skills ?? []) { if (typeof s === "string") implicit.add(s.toLowerCase()); }
  }

  const combined = allText.join(" ").toLowerCase();

  // Check all known skills/synonyms against the text
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    const allVariants = [canonical, ...synonyms];
    for (const variant of allVariants) {
      if (variant.length >= 3) {
        const regex = new RegExp(`\\b${escapeRegex(variant)}\\b`, "i");
        if (regex.test(combined)) {
          implicit.add(canonical);
          break;
        }
      }
    }
  }

  return [...implicit];
}

function sanitizeText(text: string | undefined | null): string {
  if (!text) return "";
  // Remove isolated surrogate pairs and control characters
  return text.replace(/[\uD800-\uDFFF]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/** Fetch with AbortController timeout to prevent hanging workers */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonRobust(raw: string): any {
  let content = raw
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const startIdx = content.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON found in response");

  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  let jsonStr: string;
  if (endIdx !== -1) {
    jsonStr = content.substring(startIdx, endIdx + 1);
  } else {
    // Attempt to repair truncated JSON
    jsonStr = content.substring(startIdx);
    jsonStr = jsonStr.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, "");
    const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) jsonStr += "]";
    const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces; i++) jsonStr += "}";
  }

  jsonStr = jsonStr
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "");

  return JSON.parse(jsonStr);
}

function getRecommendation(score: number): string {
  if (score >= 80) return "STRONG_MATCH";
  if (score >= 65) return "GOOD_MATCH";
  if (score >= 50) return "POSSIBLE_MATCH";
  if (score >= 35) return "WEAK_MATCH";
  return "NO_MATCH";
}

// ─── Layer 1: Hard Filters (cheapest first, AI last) ─────────────────────────

async function applyHardFilters(profile: ProfileData, job: JobData): Promise<{ passed: boolean; reason?: string }> {
  // 0. RGPD: candidate opted out of AI scoring
  if (profile.noAiScoring) {
    return { passed: false, reason: "Candidat a exercé son droit d'opposition au scoring IA (RGPD)" };
  }

  // 1. Minimum experience check (FREE — no API call)
  if (job.xpMin && profile.yearsOfExperience !== undefined) {
    if (profile.yearsOfExperience < job.xpMin * 0.75) {
      return {
        passed: false,
        reason: `XP insuffisante: ${profile.yearsOfExperience}ans vs ${job.xpMin}ans min requis`,
      };
    }
  }

  // 2. Freelance vs CDI hard filter (FREE)
  // Si le candidat affiche explicitement "Freelance" / "Indépendant" dans son titre
  // ou son À propos, et que le poste est en CDI → exclusion
  if (job.contractType && ["cdi", "permanent"].includes(job.contractType.toLowerCase())) {
    const freelanceKeywords = ["freelance", "indépendant", "auto-entrepreneur", "consultant indépendant", "micro-entrepreneur"];
    const headlineLower = (profile.headline || "").toLowerCase();
    const summaryLower = (profile.summary || "").toLowerCase();
    const freelanceInTitle = freelanceKeywords.some((f) => headlineLower.includes(f));
    const freelanceInSummary = freelanceKeywords.some((f) => summaryLower.includes(f));
    if (freelanceInTitle || freelanceInSummary) {
      return {
        passed: false,
        reason: `Profil freelance/indépendant explicite (${freelanceInTitle ? 'titre' : 'à propos'}) — poste CDI`,
      };
    }
  }

  // 3. Gross seniority mismatch (FREE)
  if (job.seniority && profile.headline) {
    const headline = profile.headline.toLowerCase();
    const jobSeniority = job.seniority.toLowerCase();
    const seniorRoles = ["director", "vp", "vice president", "head of", "c-level", "cto", "coo", "ceo"];
    const juniorRoles = ["junior", "intern", "stagiaire", "alternant", "apprenti", "student"];

    const isJobSenior = seniorRoles.some((r) => jobSeniority.includes(r));
    const isProfileJunior = juniorRoles.some((r) => headline.includes(r));
    const isJobJunior = juniorRoles.some((r) => jobSeniority.includes(r));
    const isProfileSenior = seniorRoles.some((r) => headline.includes(r));

    if (isJobSenior && isProfileJunior) {
      return { passed: false, reason: `Mismatch séniorité: profil junior vs poste ${job.seniority}` };
    }
    if (isJobJunior && isProfileSenior) {
      return { passed: false, reason: `Mismatch séniorité: profil senior vs poste junior` };
    }
  }

  // 3. Location hard filter for on-site roles (FREE)
  if (job.location && job.remote && !["full", "full remote", "remote"].includes(job.remote.toLowerCase())) {
    if (profile.location) {
      const jobLoc = job.location.toLowerCase();
      const profLoc = profile.location.toLowerCase();
      const frenchCities = [
        "france",
        "paris",
        "lyon",
        "marseille",
        "toulouse",
        "nantes",
        "bordeaux",
        "lille",
        "strasbourg",
        "courbevoie",
        "la défense",
      ];
      const foreignSignals = [
        "united states",
        "usa",
        "uk",
        "united kingdom",
        "germany",
        "spain",
        "india",
        "canada",
        "australia",
        "brazil",
      ];
      const jobInFrance = frenchCities.some((s) => jobLoc.includes(s));
      const profileAbroad = foreignSignals.some((s) => profLoc.includes(s));
      if (jobInFrance && profileAbroad) {
        return { passed: false, reason: `Localisation incompatible: ${profile.location} vs ${job.location} (on-site)` };
      }
    }
  }

  // 4. Must-have basic keyword check (safety net when LLM is skipped/fails)
  // The main LLM call evaluates must-have in detail, but if LLM is unavailable,
  // this basic check catches obvious mismatches using keyword presence.
  if (job.mustHave && job.mustHave.trim().length > 0) {
    const mustHaveTerms = job.mustHave.toLowerCase()
      .split(/[,;+&]/)
      .map(t => t.trim())
      .filter(t => t.length >= 3);

    if (mustHaveTerms.length > 0) {
      const profileText = [
        profile.headline || '',
        profile.summary || '',
        ...(profile.skills || []).map((s: any) => typeof s === 'string' ? s : s.name || ''),
        ...(profile.workExperience || []).map((w: any) => `${w.title || ''} ${w.description || ''}`),
      ].join(' ').toLowerCase();

      // Check if at least ONE must-have term is found anywhere in the profile
      const anyMatch = mustHaveTerms.some(term => profileText.includes(term));
      if (!anyMatch) {
        return {
          passed: false,
          reason: `Must-have non détecté dans le profil: "${job.mustHave.slice(0, 100)}" (vérification par mots-clés)`,
        };
      }
    }
  }

  return { passed: true };
}

// Legacy must-have AI function kept as fallback (unused in normal flow)
async function evaluateMustHaveWithAI(
  profile: ProfileData,
  job: JobData,
  modelOverride?: string,
): Promise<{ passed: boolean; reason?: string }> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    console.warn("[must-have-ai] No ANTHROPIC_API_KEY, skipping must-have check");
    return { passed: true };
  }

  const educationEntries = (profile.education || [])
    .map((e: any) => {
      if (typeof e === "string") return e;
      return [e.school, e.school_details?.name, e.degree, e.field, e.field_of_study].filter(Boolean).join(" - ");
    })
    .filter(Boolean);

  const profileSummary = [
    `Nom: ${profile.name}`,
    profile.headline ? `Headline: ${profile.headline}` : "",
    profile.currentRole ? `Poste actuel: ${profile.currentRole}` : "",
    profile.currentCompany ? `Entreprise: ${profile.currentCompany}` : "",
    (profile.skills || []).length > 0 ? `Skills: ${profile.skills!.join(", ")}` : "",
    educationEntries.length > 0
      ? `Formations:\n${educationEntries.map((e, i) => `  ${i + 1}. ${e}`).join("\n")}`
      : "Formation: non renseignée",
    profile.yearsOfExperience !== undefined ? `XP: ${profile.yearsOfExperience} ans` : "",
    (profile.workExperience || []).length > 0
      ? `Expériences:\n${profile
          .workExperience!
          .map((w) => {
            let line = `- ${w.role} @ ${w.company}`;
            if (w.duration) line += ` (${w.duration})`;
            if (w.description) line += ` — ${w.description.substring(0, 200)}`;
            return line;
          })
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = sanitizeText(
    `Tu es un recruteur expert. Vérifie si ce candidat satisfait les critères OBLIGATOIRES (must-have) du poste.

CRITÈRES OBLIGATOIRES: ${job.mustHave}

PROFIL CANDIDAT:
${profileSummary}

RÈGLES:
- Si les critères listent plusieurs écoles/formations avec "parmi", "ou", "dont", le candidat doit en avoir AU MOINS UNE.
- Vérifie TOUTES les formations listées dans le profil.
- Sois intelligent sur les noms d'écoles : "École Polytechnique" = "Polytechnique" = "X". "CentraleSupélec" = "Centrale" = "Supélec".
- Pour les skills techniques, accepte les synonymes évidents (React = ReactJS, K8s = Kubernetes, etc.)
- Sois strict mais juste.

Réponds UNIQUEMENT avec un JSON: {"passed": true/false, "reason": "explication courte si refusé, null si accepté"}`,
  );

  try {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelOverride || CLAUDE_MODEL_DEFAULT,
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }],
      }),
    }, 30000);

    if (!res.ok) {
      console.error(`[must-have-ai] Anthropic error ${res.status}`);
      return { passed: true }; // Don't block on API errors
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    console.log(`[must-have-ai] ${profile.name}: ${text.substring(0, 200)}`);

    const parsed = extractJsonRobust(text);
    return {
      passed: !!parsed.passed,
      reason: parsed.passed ? undefined : parsed.reason || "Must-have non satisfait (IA)",
    };
  } catch (err) {
    console.error("[must-have-ai] Error:", err);
    return { passed: true };
  }
}

// ─── Layer 2: Weighted Criteria Scoring (quantifiable dimensions only) ────────
// Tech/skill matching is delegated to the LLM for universal accuracy.
// This layer focuses on dimensions that can be computed deterministically.

interface WeightedResult {
  score: number;
  dimensions: Record<string, DimensionScore>;
  confidenceScore: number;
  dataCompleteness: "full" | "partial" | "minimal";
  missingDataPoints: string[];
  // Kept for context/heuristics — NOT the definitive matching
  matchedSkills: string[];
  missingSkills: string[];
  allJobSkills: string[];
}

function computeWeightedScore(profile: ProfileData, job: JobData): WeightedResult {
  const dimensions: Record<string, DimensionScore> = {};
  const missingDataPoints: string[] = [];

  // --- Enrich profile skills with implicit skills from text ---
  const explicitSkills = (profile.skills || []).filter((s) => typeof s === "string").map((s) => s.toLowerCase());
  const implicitSkills = extractImplicitSkills(profile);
  const profileSkills = [...new Set([...explicitSkills, ...implicitSkills])];

  // --- Combine job skills (for heuristic context, not definitive matching) ---
  const baseJobSkills = (job.skills || []).filter((s) => typeof s === "string").map((s) => s.toLowerCase());
  const shouldHaveSkills = job.shouldHave
    ? job.shouldHave
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const allJobSkills = [...new Set([...baseJobSkills, ...shouldHaveSkills])];
  const { matched, missing } = computeSkillMatch(profileSkills, allJobSkills);

  // --- Seniority / XP (weight: 35%) ---
  if (profile.yearsOfExperience !== undefined && (job.xpMin || job.xpMax)) {
    const xpMin = job.xpMin || 0;
    const xpMax = job.xpMax || xpMin + 5;
    const xp = profile.yearsOfExperience;
    let seniorityScore: number;

    if (xp >= xpMin && xp <= xpMax) {
      seniorityScore = 100;
    } else if (xp < xpMin) {
      seniorityScore = Math.max(0, 100 - (xpMin - xp) * 15);
    } else {
      seniorityScore = Math.max(50, 100 - (xp - xpMax) * 5);
    }
    dimensions.seniority = {
      score: Math.round(seniorityScore),
      weight: 35,
      details: `${xp}ans XP vs ${xpMin}-${xpMax}ans requis`,
    };
  } else {
    dimensions.seniority = { score: 50, weight: 35, details: "Données XP incomplètes" };
    if (profile.yearsOfExperience === undefined) missingDataPoints.push("candidate_xp");
    if (!job.xpMin && !job.xpMax) missingDataPoints.push("job_xp_range");
  }

  // --- Location (weight: 25%) ---
  let locationScore = 50;
  let locationDetails = "Non vérifiable";
  if (job.remote && ["full", "full remote", "remote", "full_remote"].includes(job.remote.toLowerCase())) {
    locationScore = 100;
    locationDetails = "Full remote — compatible";
  } else if (job.location && profile.location) {
    const jobLoc = job.location.toLowerCase();
    const profLoc = profile.location.toLowerCase();
    const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const jn = normalize(jobLoc);
    const pn = normalize(profLoc);

    if (pn.includes(jn) || jn.includes(pn)) {
      locationScore = 100;
      locationDetails = `Match direct: ${profile.location}`;
    } else {
      // Same country / region check
      const frenchCities = ["france", "paris", "lyon", "marseille", "toulouse", "nantes", "bordeaux", "lille", "strasbourg"];
      const isFranceJob = frenchCities.some((c) => jn.includes(c));
      const isFranceProfile = frenchCities.some((c) => pn.includes(c));
      const foreignSignals = ["united states", "usa", "uk", "germany", "spain", "india", "canada", "australia", "brazil"];
      const isAbroad = foreignSignals.some((s) => pn.includes(s));

      if (isFranceJob && isFranceProfile) {
        locationScore = 70;
        locationDetails = `Même pays: ${profile.location} / ${job.location}`;
      } else if (isFranceJob && isAbroad) {
        locationScore = 10;
        locationDetails = `Étranger: ${profile.location} vs ${job.location}`;
      } else {
        locationScore = 40;
        locationDetails = `${profile.location} vs ${job.location}`;
      }
    }
  } else {
    if (!profile.location) missingDataPoints.push("candidate_location");
    if (!job.location) missingDataPoints.push("job_location");
  }
  dimensions.location = {
    score: Math.round(locationScore),
    weight: 25,
    details: locationDetails,
  };

  // --- Receptivity (weight: 20%) ---
  let receptivityScore = 50;
  const signals: string[] = [];

  if (profile.openToWork) {
    receptivityScore += 25;
    signals.push("Open to Work");
  }
  if (profile.openProfile) {
    receptivityScore += 10;
    signals.push("Open Profile");
  }
  if (profile.networkDistance === 1) {
    receptivityScore += 15;
    signals.push("1st degree");
  } else if (profile.networkDistance === 2) {
    receptivityScore += 5;
    signals.push("2nd degree");
  }
  dimensions.receptivity = {
    score: Math.max(0, Math.min(100, Math.round(receptivityScore))),
    weight: 20,
    details: signals.join(", ") || "Neutre",
  };

  // --- Tenure / Stability (weight: 15%) ---
  let tenureScore = 50;
  let tenureDetails = "Données insuffisantes";
  if (profile.averageTenureMonths !== null && profile.averageTenureMonths !== undefined) {
    if (profile.averageTenureMonths >= 30) {
      tenureScore = 90;
      tenureDetails = `Tenure stable: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else if (profile.averageTenureMonths >= 24) {
      tenureScore = 80;
      tenureDetails = `Bonne tenure: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else if (profile.averageTenureMonths >= 18) {
      tenureScore = 60;
      tenureDetails = `Tenure moyenne: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else if (profile.averageTenureMonths >= 12) {
      tenureScore = 40;
      tenureDetails = `Tenure courte: ~${Math.round(profile.averageTenureMonths)} mois`;
    } else {
      tenureScore = 15;
      tenureDetails = `Tenure très courte: ~${Math.round(profile.averageTenureMonths)} mois`;
    }
  }
  dimensions.tenure = {
    score: Math.round(tenureScore),
    weight: 15,
    details: tenureDetails,
  };

  // --- Contract Fit (weight: 5%) ---
  // Check headline + summary + currentRole for freelance indicators
  let contractFitScore = 70; // default: neutral-positive
  let contractDetails = "Neutre";
  if (job.contractType) {
    const freelanceKeywords = ["freelance", "indépendant", "auto-entrepreneur", "consultant indépendant", "micro-entrepreneur", "portage salarial"];
    const textToCheck = [
      profile.headline || "",
      profile.summary || "",
      profile.currentRole || "",
      profile.currentCompany || "",
    ].join(" ").toLowerCase();
    const isFreelance = freelanceKeywords.some((f) => textToCheck.includes(f));
    const isCDI = ["cdi", "permanent"].includes(job.contractType.toLowerCase());
    const isFreelanceJob = ["freelance", "mission", "portage"].includes(job.contractType.toLowerCase());
    if (isFreelance && isCDI) {
      // Freelance explicite sur un poste CDI → exclu par hard filter en amont
      // Si on arrive ici, c'est un cas edge (mot dans currentCompany par ex.)
      contractFitScore = 10;
      contractDetails = "Freelance vs CDI — exclu";
    } else if (isFreelance && isFreelanceJob) {
      contractFitScore = 100;
      contractDetails = "Freelance match";
    } else if (!isFreelance && isCDI) {
      contractFitScore = 80;
      contractDetails = "Profil salarié / CDI";
    }
  }
  dimensions.contract_fit = {
    score: Math.round(contractFitScore),
    weight: 5,
    details: contractDetails,
  };

  // Calculate weighted total
  let totalWeightedScore = 0;
  let totalWeight = 0;
  for (const dim of Object.values(dimensions)) {
    totalWeightedScore += dim.score * dim.weight;
    totalWeight += dim.weight;
  }
  const score = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  // Confidence
  const maxDataPoints = 5;
  const availableDataPoints = maxDataPoints - missingDataPoints.length;
  const confidenceScore = Math.round((availableDataPoints / maxDataPoints) * 100);
  const dataCompleteness: "full" | "partial" | "minimal" =
    missingDataPoints.length === 0 ? "full" : missingDataPoints.length <= 2 ? "partial" : "minimal";

  return {
    score,
    dimensions,
    confidenceScore,
    dataCompleteness,
    missingDataPoints,
    matchedSkills: matched,
    missingSkills: missing,
    allJobSkills,
  };
}

// ─── Layer 3: Semantic Similarity (pgvector) ─────────────────────────────────

async function getSemanticScore(supabase: ReturnType<typeof createClient>, candidateId: string, jobId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.rpc("cosine_similarity_match", {
      p_candidate_id: candidateId,
      p_job_id: jobId,
    });
    if (error || data === null || data === undefined) return null;
    return Math.round(data * 100);
  } catch {
    return null;
  }
}

// ─── Layer 4: LLM (Claude) — COMPLETE assessment (tech + soft + must-have) ───
// The LLM is the primary judge of technical fit, soft skills, and must-have
// criteria. Unlike a static dictionary, Claude understands synonyms, related
// skills, and context natively across ALL professions and industries.

interface LLMResult {
  overallScore: number;
  techFitScore: number;
  softSkillsScore: number;
  pedigreeScore: number | null;
  matchedSkills: string[];
  missingCriticalSkills: string[];
  summary: string;
  strengths: string[];
  concerns: string[];
  notableCompanies: string[] | null;
  mustHavePassed: boolean;
  mustHaveUncertain: boolean;
  mustHaveDetails: string | null;
  criteriaEvaluations: Array<{ label: string; verdict: string; reason: string }>;
  tokensUsed: { input: number; output: number };
}

async function callLLM(
  profile: ProfileData,
  job: JobData,
  preComputedData: {
    weightedScore: number;
    dimensions: Record<string, DimensionScore>;
    matchedSkills: string[];
    missingSkills: string[];
    semanticScore: number | null;
  },
  customScoringInstructions?: string,
  modelOverride?: string,
): Promise<LLMResult> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  // Build comprehensive work experience text — include descriptions for accurate assessment
  const workExpText =
    (profile.workExperience || [])
      .map((w) => {
        let line = `- ${w.role} @ ${w.company}`;
        if (w.duration) line += ` (${w.duration})`;
        if (w.description) line += ` — ${w.description.substring(0, 500)}`;
        if (w.skills && w.skills.length > 0) line += ` [Skills: ${w.skills.join(", ")}]`;
        return line;
      })
      .join("\n") ||
    (profile.pastPositions || [])
      .map((p) => `- ${p}`)
      .join("\n") ||
    "Aucune expérience renseignée";

  // Build education text
  const educationText = (profile.education || []).map((e, i) => `  ${i + 1}. ${e}`).join("\n") || "Non renseignée";

  const hasDescriptions = (profile.workExperience || []).some(w => w.description && w.description.length > 30);
  const dataWarning = !hasDescriptions
    ? `\n⚠️ DONNÉES INCOMPLÈTES: Les descriptions d'expérience sont absentes. Évalue sur les titres, entreprises, et skills déclarés. NE PÉNALISE PAS le candidat pour manque de détails — ajuste ton score de confiance plutôt que le score technique.\n`
    : "";

  const prompt = sanitizeText(
    `Tu es un recruteur expert senior. Évalue la correspondance COMPLÈTE de ce candidat avec le poste.

=== CONTEXTE ALGO (indicatif, tu peux corriger) ===
Score quantitatif: ${preComputedData.weightedScore}/100
Skills heuristiques matchés: ${preComputedData.matchedSkills.join(", ") || "Aucun (heuristique limitée)"}
Skills heuristiques manquants: ${preComputedData.missingSkills.join(", ") || "Aucun"}
Similarité sémantique: ${preComputedData.semanticScore !== null ? preComputedData.semanticScore + "/100" : "N/A"}
XP: ${preComputedData.dimensions.seniority?.details || "?"} | Location: ${preComputedData.dimensions.location?.details || "?"} | Réceptivité: ${preComputedData.dimensions.receptivity?.details || "?"}

=== POSTE ===
${job.title}${job.client?.name ? " @ " + job.client.name : ""}${job.client?.sector ? " (" + job.client.sector + ")" : ""}
Skills requis: ${(job.skills || []).join(", ") || "Non spécifiés"}
${job.description ? "Description: " + job.description.substring(0, 500) : ""}
${job.requirements ? "Exigences: " + job.requirements.substring(0, 400) : ""}
${job.mustHave ? "\n⚠️ CRITÈRES OBLIGATOIRES (must-have): " + job.mustHave : ""}
${job.shouldHave ? "Should-have: " + job.shouldHave : ""}
${job.niceToHave ? "Nice-to-have: " + job.niceToHave : ""}
${job.seniority ? "Séniorité: " + job.seniority : ""}
${job.contractType ? "Contrat: " + job.contractType : ""}
${job.transversalCriteria?.context ? "Contexte client: " + job.transversalCriteria.context.substring(0, 300) : ""}
${job.transversalCriteria?.must ? "Critères transversaux obligatoires: " + job.transversalCriteria.must : ""}
${job.bodyContent ? "Détails: " + job.bodyContent.substring(0, 400) : ""}

=== CANDIDAT ===
${profile.name} — ${profile.headline || profile.currentRole || "?"}
${profile.location ? "📍 " + profile.location : ""}
${dataWarning}${profile.yearsOfExperience !== undefined ? "XP: " + profile.yearsOfExperience + " ans" : ""}
Skills déclarés: ${(profile.skills || []).join(", ") || "Non renseignés"}
${profile.summary ? "À propos: " + (profile.summary || "").substring(0, 400) : ""}

Formation:
${educationText}

Expériences:
${workExpText}

=== TA MISSION (COMPLÈTE) ===
Évalue TOUTES ces dimensions :

1. **Adéquation technique** (0-100) : Le candidat maîtrise-t-il les compétences requises ?
   → Synonymes : VMware=vSphere, K8s=Kubernetes, "admin Linux" implique bash/shell.
   → Skills implicites : considère les skills TRÈS PROBABLES (>80% confiance) selon le contexte employeur+rôle.
     Exemple OUI : "SRE chez OVH" → infra cloud, Linux, monitoring très probables.
     Exemple NON : "Chef de projet infra chez BNP Paribas" → ne PAS supposer datacenter/cloud.
   → En cas de doute sur un skill implicite, ne le compte PAS comme matché. Mentionne-le dans concerns.
   → Liste les skills effectivement matchés ET les skills critiques manquants.

2. **Must-have** : Si des critères sont marqués must-have/obligatoires, le candidat les satisfait-il ?
   → Si les critères listent plusieurs options avec "parmi", "ou", "dont", au moins UNE suffit.
   → Sois intelligent sur les noms d'écoles, certifications, et synonymes techniques.
   → IMPORTANT : 3 verdicts possibles :
     - "passed" : le profil satisfait clairement le critère (preuve dans le profil)
     - "failed" : le profil contredit clairement le critère (aucun indice, domaine totalement différent)
     - "uncertain" : pas assez d'infos pour juger (profil LinkedIn minimal, pas de description de poste, etc.)
     → En cas de doute, choisis "uncertain" plutôt que "failed". Mieux vaut vérifier qu'écarter à tort.

3. **Soft skills** (0-100) : Communication, leadership, curiosité, adaptabilité.

4. **Qualité des expériences & pedigree** : Évalue la QUALITÉ des entreprises ET la pertinence de l'expérience (durée + titre).
   → **Bonus fort** : scale-ups reconnues (Doctolib, Alan, Datadog, Contentsquare, Mirakl, etc.), GAFAM/FAANG, licornes, éditeurs software reconnus, cabinets tier-1 (McKinsey, BCG, etc.).
   → **Bonus modéré** : startups funded, entreprises tech reconnues dans leur niche, PME innovantes.
   → **Neutre** : grands groupes CAC40, administrations, PME traditionnelles.
   → **Signal négatif** : ESN/SSII body shopping (Alten, Altran, Sopra, CGI = neutre-négatif), intérim généraliste, expériences exclusivement offshore.

   ⚠️ IMPORTANT — La durée et le titre comptent autant que le nom de la boîte :
   → Stage ou alternance dans une bonne boîte = bonus FAIBLE (formation mais pas de vraie responsabilité)
   → < 6 mois dans une boîte top = bonus FAIBLE (période d'essai ou passage éclair, pas de vrai impact)
   → 1-2 ans sur un poste pertinent dans une boîte exigeante = bonus FORT
   → 3+ ans sur un poste senior/lead dans une boîte reconnue = bonus TRÈS FORT
   → Titre non pertinent (support, admin, RH) dans une boîte tech ≠ bonus tech
   → Seules les expériences sur des POSTES PERTINENTS pour le job évalué comptent pour le pedigree

5. **Cohérence du parcours** : Progression logique, spécialisation pertinente, pertinence sectorielle.

6. **Signaux d'alerte** : Job-hopping, surqualification, expertise complètement hors-sujet.

7. **Score global** (0-100) : Ta note finale de correspondance candidat/poste. Intègre la qualité du pedigree dans le score global — un candidat avec les bonnes compétences ET un parcours dans des boîtes exigeantes mérite un score supérieur à un profil équivalent dans des ESN.

8. **Évaluation des critères du manager** : Si des critères d'évaluation sont fournis dans "Détails" (section CRITÈRES D'ÉVALUATION DU MANAGER), évalue CHAQUE critère individuellement. Pour chaque critère, donne un verdict ("pass", "partial", "fail", "unknown") et une justification courte (max 20 mots). Respecte les deal-breakers et les poids.
${customScoringInstructions ? "\nConsignes supplémentaires de l'utilisateur: " + customScoringInstructions.slice(0, 400) : ""}

Réponds UNIQUEMENT en JSON compact :
{"techFitScore":N,"softSkillsScore":N,"pedigreeScore":N,"overallScore":N,"matchedSkills":["skill1"],"missingCriticalSkills":["skill2"],"summary":"max 25 mots","strengths":["max 4"],"concerns":["max 4"],"mustHavePassed":"passed","mustHaveDetails":null,"notableCompanies":["max 3"],"criteriaEvaluations":[{"label":"nom du critère","verdict":"pass","reason":"justification courte"}]}
pedigreeScore: 0-100, qualité des entreprises. mustHavePassed: "passed" / "failed" / "uncertain". criteriaEvaluations: évaluation de chaque critère du manager si fournis, sinon [].`,
  );

  let lastError: Error | null = null;
  let data: any = null;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, backoffMs));
      console.log(`[llm] Retry ${attempt} for ${profile.name} after ${backoffMs}ms`);
    }

    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: modelOverride || CLAUDE_MODEL_DEFAULT,
        system: [{ type: "text", text: "Tu es un expert recruteur senior avec 15 ans d'expérience dans le matching candidat/poste. Tu évalues TOUTES les dimensions : technique, soft skills, cohérence de parcours. Tu comprends nativement les synonymes techniques (VMware=vSphere, K8s=Kubernetes, etc.) et les skills implicites dans les descriptions d'expérience. Réponds en JSON compact, sans markdown.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
        max_tokens: 800,
        temperature: 0.1,
      }),
    }, 45000); // Slightly longer timeout for richer analysis

    if (res.ok) {
      data = await res.json();
      break;
    }

    const status = res.status;
    console.error(`[llm] Anthropic error (attempt ${attempt}): ${status}`);

    if (status === 429 && attempt < MAX_LLM_RETRIES) {
      lastError = new Error("RATE_LIMITED");
      continue;
    }
    if (status === 402 || status === 400) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`Anthropic API error: ${status}`);
  }

  if (!data) throw lastError || new Error("LLM call failed after retries");

  const rawContent = data.content?.[0]?.text || "";
  console.log(`[llm] ${profile.name}: ${rawContent.substring(0, 300)}`);
  const parsed = extractJsonRobust(rawContent);

  return {
    overallScore: parsed.overallScore ?? parsed.softSkillsScore ?? 50,
    techFitScore: parsed.techFitScore ?? 50,
    softSkillsScore: parsed.softSkillsScore ?? 50,
    pedigreeScore: parsed.pedigreeScore ?? null,
    matchedSkills: parsed.matchedSkills || [],
    missingCriticalSkills: parsed.missingCriticalSkills || [],
    summary: parsed.summary || "",
    strengths: parsed.strengths || [],
    concerns: parsed.concerns || [],
    notableCompanies: parsed.notableCompanies || null,
    mustHavePassed: parsed.mustHavePassed === "failed" ? false : true,
    mustHaveUncertain: parsed.mustHavePassed === "uncertain",
    mustHaveDetails: parsed.mustHaveDetails || null,
    criteriaEvaluations: Array.isArray(parsed.criteriaEvaluations) ? parsed.criteriaEvaluations : [],
    tokensUsed: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

// ─── Batch LLM Scoring ─────────────────────────────────────────────────────
// Score multiple profiles in a single API call to reduce latency and token cost.
// The job context + system prompt are sent ONCE, profiles are listed together.

interface BatchLLMInput {
  profile: ProfileData;
  preComputedData: {
    weightedScore: number;
    dimensions: Record<string, DimensionScore>;
    matchedSkills: string[];
    missingSkills: string[];
    semanticScore: number | null;
  };
}

async function callLLMBatch(
  inputs: BatchLLMInput[],
  job: JobData,
  customScoringInstructions?: string,
  modelOverride?: string,
): Promise<Map<string, LLMResult>> {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

  if (inputs.length === 0) return new Map();

  // Build job context (shared across all profiles)
  const jobContext = sanitizeText(
    `=== POSTE ===
${job.title}${job.client?.name ? " @ " + job.client.name : ""}${job.client?.sector ? " (" + job.client.sector + ")" : ""}
Skills requis: ${(job.skills || []).join(", ") || "Non spécifiés"}
${job.description ? "Description: " + job.description.substring(0, 500) : ""}
${job.requirements ? "Exigences: " + job.requirements.substring(0, 400) : ""}
${job.mustHave ? "\n⚠️ CRITÈRES OBLIGATOIRES (must-have): " + job.mustHave : ""}
${job.shouldHave ? "Should-have: " + job.shouldHave : ""}
${job.niceToHave ? "Nice-to-have: " + job.niceToHave : ""}
${job.seniority ? "Séniorité: " + job.seniority : ""}
${job.contractType ? "Contrat: " + job.contractType : ""}
${job.transversalCriteria?.context ? "Contexte client: " + job.transversalCriteria.context.substring(0, 300) : ""}
${job.transversalCriteria?.must ? "Critères transversaux obligatoires: " + job.transversalCriteria.must : ""}
${job.bodyContent ? "Détails: " + job.bodyContent.substring(0, 400) : ""}
${customScoringInstructions ? "\nConsignes supplémentaires: " + customScoringInstructions.slice(0, 400) : ""}`
  );

  // Build per-profile sections
  const profileSections = inputs.map(({ profile, preComputedData }, idx) => {
    const workExpText = (profile.workExperience || []).length > 0
      ? (profile.workExperience || []).slice(0, 6).map((w, i) =>
        `  ${i + 1}. ${w.role} @ ${w.company}${w.duration ? " (" + w.duration + ")" : ""}${w.description ? "\n     " + w.description.substring(0, 200) : ""}${w.skills?.length ? "\n     Skills: " + w.skills.join(", ") : ""}`
      ).join("\n") : "  Aucune expérience listée";

    const educationText = (profile.education || []).map((e, i) => `  ${i + 1}. ${e}`).join("\n") || "Non renseignée";

    const hasDescriptions = (profile.workExperience || []).some(w => w.description && w.description.length > 30);
    const dataWarning = !hasDescriptions ? " [DONNÉES INCOMPLÈTES: évalue sur titres/entreprises/skills]" : "";

    return sanitizeText(
      `--- CANDIDAT ${idx + 1} (id: ${profile.id}) ---
${profile.name} — ${profile.headline || profile.currentRole || "?"}${dataWarning}
${profile.location ? "📍 " + profile.location : ""}
${profile.yearsOfExperience !== undefined ? "XP: " + profile.yearsOfExperience + " ans" : ""}
Algo: ${preComputedData.weightedScore}/100 | Sémantique: ${preComputedData.semanticScore !== null ? preComputedData.semanticScore + "/100" : "N/A"}
Skills matchés: ${preComputedData.matchedSkills.join(", ") || "Aucun"} | Manquants: ${preComputedData.missingSkills.join(", ") || "Aucun"}
Skills déclarés: ${(profile.skills || []).join(", ") || "Non renseignés"}
${profile.summary ? "À propos: " + (profile.summary || "").substring(0, 300) : ""}
Formation: ${educationText}
Expériences:
${workExpText}`
    );
  }).join("\n\n");

  const prompt = `${jobContext}

=== ${inputs.length} CANDIDATS À ÉVALUER ===

${profileSections}

=== TA MISSION ===
Pour CHAQUE candidat, évalue : adéquation technique (0-100), soft skills (0-100), pedigree (0-100), score global (0-100), must-have ("passed"/"failed"/"uncertain").

Réponds UNIQUEMENT avec un JSON ARRAY, un objet par candidat dans l'ORDRE, format :
[{"id":"<id du candidat>","techFitScore":N,"softSkillsScore":N,"pedigreeScore":N,"overallScore":N,"matchedSkills":["skill1"],"missingCriticalSkills":["skill2"],"summary":"max 25 mots","strengths":["max 3"],"concerns":["max 3"],"mustHavePassed":"passed","mustHaveDetails":null,"notableCompanies":["max 2"],"criteriaEvaluations":[{"label":"critère","verdict":"pass","reason":"justif courte"}]}]
verdict: "pass"/"partial"/"fail"/"unknown". criteriaEvaluations: évalue chaque critère du manager si fournis dans le contexte du poste, sinon [].
JSON uniquement, sans markdown.`;

  console.log(`[llm-batch] Scoring ${inputs.length} profiles in single call`);

  let lastError: Error | null = null;
  let data: any = null;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise((r) => setTimeout(r, backoffMs));
      console.log(`[llm-batch] Retry ${attempt} after ${backoffMs}ms`);
    }

    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model: modelOverride || CLAUDE_MODEL_DEFAULT,
        system: [{ type: "text", text: "Tu es un expert recruteur senior avec 15 ans d'expérience dans le matching candidat/poste. Tu évalues TOUTES les dimensions : technique, soft skills, cohérence de parcours. Tu comprends nativement les synonymes techniques (VMware=vSphere, K8s=Kubernetes, etc.) et les skills implicites dans les descriptions d'expérience. Tu scores PLUSIEURS candidats en une seule passe. Réponds en JSON compact, sans markdown.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
        max_tokens: inputs.length * 250 + 200, // ~250 tokens per profile + overhead
        temperature: 0.1,
      }),
    }, 90000); // Longer timeout for batch

    if (res.ok) {
      data = await res.json();
      break;
    }

    const status = res.status;
    console.error(`[llm-batch] Anthropic error (attempt ${attempt}): ${status}`);
    if (status === 429 && attempt < MAX_LLM_RETRIES) {
      lastError = new Error("RATE_LIMITED");
      continue;
    }
    if (status === 402 || status === 400) throw new Error("CREDITS_EXHAUSTED");
    throw new Error(`Anthropic API error: ${status}`);
  }

  if (!data) throw lastError || new Error("LLM batch call failed after retries");

  const rawContent = data.content?.[0]?.text || "";
  console.log(`[llm-batch] Response (${rawContent.length} chars): ${rawContent.substring(0, 200)}...`);

  // Parse the JSON array — robust extraction for LLM output
  let parsedArray: any[];
  try {
    let content = rawContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Find the array start
    const arrStart = content.indexOf('[');
    if (arrStart === -1) {
      // No array found — try parsing as single object
      const single = extractJsonRobust(content);
      parsedArray = [single];
    } else {
      // Find matching closing bracket
      let depth = 0;
      let arrEnd = -1;
      for (let i = arrStart; i < content.length; i++) {
        if (content[i] === '[') depth++;
        else if (content[i] === ']') {
          depth--;
          if (depth === 0) { arrEnd = i; break; }
        }
      }

      let jsonStr: string;
      if (arrEnd !== -1) {
        jsonStr = content.substring(arrStart, arrEnd + 1);
      } else {
        // Truncated — attempt repair
        jsonStr = content.substring(arrStart);
        // Remove trailing incomplete object
        jsonStr = jsonStr.replace(/,\s*\{[^}]*$/, '');
        // Close unclosed brackets
        const openBrackets = (jsonStr.match(/\[/g) || []).length - (jsonStr.match(/\]/g) || []).length;
        for (let i = 0; i < openBrackets; i++) jsonStr += ']';
        const openBraces = (jsonStr.match(/\{/g) || []).length - (jsonStr.match(/\}/g) || []).length;
        for (let i = 0; i < openBraces; i++) jsonStr += '}';
      }

      parsedArray = JSON.parse(jsonStr);
      if (!Array.isArray(parsedArray)) parsedArray = [parsedArray];
    }

    console.log(`[llm-batch] Parsed ${parsedArray.length} results from response`);
  } catch (e) {
    console.error(`[llm-batch] Failed to parse batch response:`, (e as Error).message, `raw: ${rawContent.substring(0, 300)}`);
    throw new Error("BATCH_PARSE_FAILED");
  }

  const tokensPerProfile = {
    input: Math.round((data.usage?.input_tokens || 0) / inputs.length),
    output: Math.round((data.usage?.output_tokens || 0) / inputs.length),
  };

  const resultMap = new Map<string, LLMResult>();

  for (let i = 0; i < inputs.length; i++) {
    const parsed = parsedArray[i] || parsedArray.find((p: any) => p.id === inputs[i].profile.id);
    if (!parsed) {
      console.warn(`[llm-batch] Missing result for profile ${inputs[i].profile.name} (index ${i})`);
      continue;
    }

    resultMap.set(inputs[i].profile.id, {
      overallScore: parsed.overallScore ?? 50,
      techFitScore: parsed.techFitScore ?? 50,
      softSkillsScore: parsed.softSkillsScore ?? 50,
      pedigreeScore: parsed.pedigreeScore ?? null,
      matchedSkills: parsed.matchedSkills || [],
      missingCriticalSkills: parsed.missingCriticalSkills || [],
      summary: parsed.summary || "",
      strengths: parsed.strengths || [],
      concerns: parsed.concerns || [],
      notableCompanies: parsed.notableCompanies || null,
      mustHavePassed: parsed.mustHavePassed === "failed" ? false : true,
      mustHaveUncertain: parsed.mustHavePassed === "uncertain",
      mustHaveDetails: parsed.mustHaveDetails || null,
      criteriaEvaluations: Array.isArray(parsed.criteriaEvaluations) ? parsed.criteriaEvaluations : [],
      tokensUsed: tokensPerProfile,
    });
  }

  console.log(`[llm-batch] Parsed ${resultMap.size}/${inputs.length} results`);
  return resultMap;
}

// ─── Score Combiner ──────────────────────────────────────────────────────────
// LLM-First: The LLM now evaluates tech fit + soft skills + must-have,
// so it gets 40% weight. The algo handles quantifiable dimensions (40%).
// Semantic similarity provides a bonus signal (20%).

function computeFinalScore(weightedScore: number, semanticScore: number | null, llmScore: number | null): number {
  // New weights: algo 40%, LLM 40%, semantic 20%
  if (llmScore !== null) {
    let total = weightedScore * 0.4 + llmScore * 0.4;
    let totalWeight = 0.8;
    if (semanticScore !== null) {
      total += semanticScore * 0.2;
      totalWeight += 0.2;
    }
    return Math.round(total / totalWeight);
  }
  
  // Fallback without LLM: algo 80%, semantic 20%
  if (semanticScore !== null) {
    return Math.round(weightedScore * 0.8 + semanticScore * 0.2);
  }
  
  return weightedScore;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

async function getCachedScore(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
): Promise<ScoringResult | null> {
  try {
    const { data, error } = await supabase
      .from("match_scores")
      .select("scoring_result, created_at")
      .eq("candidate_id", candidateId)
      .eq("job_id", jobId)
      .maybeSingle();

    if (error || !data) return null;

    // TTL check: invalidate cache older than 48h
    const createdAt = new Date(data.created_at).getTime();
    if (Date.now() - createdAt > CACHE_TTL_MS) {
      return null; // Cache expired, will re-score
    }

    return data.scoring_result as ScoringResult;
  } catch {
    return null;
  }
}

async function setCachedScore(
  supabase: SupabaseClient,
  candidateId: string,
  jobId: string,
  result: ScoringResult,
): Promise<void> {
  try {
    // 1. Cache in match_scores (for fast lookup)
    await supabase.from("match_scores").upsert(
      {
        candidate_id: candidateId,
        job_id: jobId,
        score: result.finalScore,
        confidence: result.confidenceScore,
        scoring_result: result,
        created_at: new Date().toISOString(),
      },
      { onConflict: "candidate_id,job_id" },
    );

    // 2. Also update job_candidate_status with scoring data (for pipeline view)
    const status = result.finalScore >= 60 ? 'scored' : 'dismissed';
    await supabase.from("job_candidate_status").update({
      score: result.finalScore,
      recommendation: result.recommendation,
      scoring_details: {
        summary: result.summary,
        strengths: result.strengths,
        concerns: result.concerns,
        missingSkills: result.missingSkills,
        matchedSkills: result.matchedSkills,
        dimensions: result.dimensions,
        confidenceScore: result.confidenceScore,
        llmScore: result.llmScore,
        weightedCriteriaScore: result.weightedCriteriaScore,
        semanticScore: result.semanticScore,
        hardFilterPassed: result.hardFilterPassed,
      },
      status,
      updated_at: new Date().toISOString(),
    }).eq('candidate_id', candidateId).eq('job_id', jobId);
  } catch (err) {
    console.error("[cache] Write error:", err);
  }
}

// ─── Profile Enrichment Context ──────────────────────────────────────────────

interface EnrichmentContext {
  accountId: string;
  apiKey: string;
  baseUrl: string;
  dailyCount: number;
  dailyLimit: number;
}

const ENRICHMENT_MIN_DELAY_MS = 2000;
const ENRICHMENT_MAX_DELAY_MS = 4000;

/**
 * Enrich a profile via Unipile get_profile if it lacks descriptions.
 * Returns true if enrichment was performed (counts toward daily quota).
 */
async function maybeEnrichProfile(
  profile: ProfileData,
  ctx: EnrichmentContext,
): Promise<boolean> {
  if (ctx.dailyCount >= ctx.dailyLimit) return false;

  // Check if enrichment is needed: missing summary OR missing descriptions in top 3 experiences
  const top3 = (profile.workExperience || []).slice(0, 3);
  const hasDescriptions = top3.some((exp) => exp.description && exp.description.length > 30);
  const hasSummary = !!profile.summary && profile.summary.length > 20;
  if (hasDescriptions && hasSummary) return false;

  const reasons: string[] = [];
  if (!hasDescriptions) reasons.push('no descriptions');
  if (!hasSummary) reasons.push('no summary/about');
  console.info(`[enrichment] Triggering for ${profile.name}: ${reasons.join(', ')}`);

  // Need a profile identifier
  const profileId = profile.providerId || profile.profileUrl;
  if (!profileId) {
    console.log(`[enrichment] No profile identifier for ${profile.name}, skipping`);
    return false;
  }

  // Random delay 2-4s
  const delay = Math.floor(
    Math.random() * (ENRICHMENT_MAX_DELAY_MS - ENRICHMENT_MIN_DELAY_MS) + ENRICHMENT_MIN_DELAY_MS,
  );
  await sleep(delay);

  try {
    let resolvedId = profileId;
    if (resolvedId.includes("linkedin.com")) {
      resolvedId = resolvedId.replace(/\/+$/, "").split("/").pop() || resolvedId;
    }

    const sectionsParams = ["experience", "about", "skills"]
      .map(s => `linkedin_sections=${encodeURIComponent(s)}`)
      .join("&");
    const response = await fetch(
      `${ctx.baseUrl}/users/${encodeURIComponent(resolvedId)}?account_id=${ctx.accountId}&${sectionsParams}&notify=false`,
      {
        headers: { "X-API-KEY": ctx.apiKey, Accept: "application/json" },
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.warn(`[enrichment] HTTP ${response.status} for ${profile.name}: ${errBody.slice(0, 200)}`);
      return false;
    }

    const data = await response.json();
    const dataKeys = Object.keys(data).join(', ');
    const enrichedExp = (data.work_experience || data.positions || data.experiences || []).slice(0, 5);
    const hasSummaryData = !!(data.about || data.summary);
    console.info(`[enrichment] API response for ${profile.name}: keys=[${dataKeys}], work_exp=${enrichedExp.length}, about=${hasSummaryData}`);
    if (data.summary) console.info(`[enrichment] summary found (${data.summary.length} chars): ${data.summary.slice(0, 120)}...`);
    if (data.about) console.info(`[enrichment] about found (${data.about.length} chars): ${data.about.slice(0, 120)}...`);
    if (data.throttled_sections) console.warn(`[enrichment] THROTTLED sections for ${profile.name}: ${JSON.stringify(data.throttled_sections)}`);
    // Log first exp description for debug
    if (enrichedExp.length > 0) {
      const firstDesc = enrichedExp[0]?.description;
      console.info(`[enrichment] First exp desc: ${firstDesc ? `${firstDesc.length} chars - "${firstDesc.slice(0, 100)}"` : 'NONE'}`);
    }

    if (enrichedExp.length > 0) {
      const formatDuration = (m: number) => {
        const y = Math.floor(m / 12);
        const mo = m % 12;
        if (y === 0) return `${mo} mois`;
        if (mo === 0) return `${y} an${y > 1 ? "s" : ""}`;
        return `${y} an${y > 1 ? "s" : ""} ${mo} mois`;
      };

      const enrichedMapped = enrichedExp.map((exp: any) => {
        const role = exp.role || exp.position || exp.title || "";
        const company = exp.company || exp.company_name || "";
        const description = exp.description || "";
        const skills = (exp.skills || []).map((s: any) => (typeof s === "string" ? s : s.name));
        let durationMonths = 0;
        const startYear = exp.start?.year || (typeof exp.start === "string" ? parseInt(exp.start.split("-")[0]) : null);
        const endYear = exp.end?.year || (typeof exp.end === "string" ? parseInt(exp.end.split("-")[0]) : null) || new Date().getFullYear();
        if (startYear) {
          const startMonth = exp.start?.month || 1;
          const endMonth = exp.end?.month || new Date().getMonth() + 1;
          durationMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
        }
        return {
          role,
          company,
          duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
          durationMonths,
          description: description.slice(0, 500) || undefined,
          skills: skills.slice(0, 8),
        };
      });

      // Merge: enrich existing experiences with descriptions/skills from API, then append new ones
      const existingExps = profile.workExperience || [];
      for (const enriched of enrichedMapped) {
        const match = existingExps.find((e: any) => 
          e.company && enriched.company && 
          e.company.toLowerCase().includes(enriched.company.toLowerCase().slice(0, 15)) &&
          e.role && enriched.role &&
          e.role.toLowerCase().includes(enriched.role.toLowerCase().slice(0, 15))
        );
        if (match) {
          // Enrich existing entry with missing data
          if (!match.description && enriched.description) match.description = enriched.description;
          if ((!match.skills || match.skills.length === 0) && enriched.skills?.length > 0) match.skills = enriched.skills;
          if (!match.duration && enriched.duration) match.duration = enriched.duration;
        } else {
          // New experience not in original data — append
          existingExps.push(enriched);
        }
      }
      profile.workExperience = existingExps;
      const withDesc = existingExps.filter((e: any) => e.description && e.description.length > 30).length;
      console.info(
        `[enrichment] SUCCESS ${profile.name}: merged ${enrichedMapped.length} enriched into ${existingExps.length} total exp (${withDesc} with desc)`,
      );
    }

    if (!profile.summary && (data.about || data.summary)) {
      profile.summary = (data.about || data.summary).slice(0, 300);
      console.info(`[enrichment] Added summary for ${profile.name}: ${profile.summary!.slice(0, 80)}...`);
    }
    if ((!profile.skills || profile.skills.length === 0) && data.skills) {
      profile.skills = (data.skills as any[]).map((s: any) => (typeof s === "string" ? s : s.name)).slice(0, 15);
    }

    console.info(`[enrichment] DONE ${profile.name}: exp=${enrichedExp.length}, summary=${!!profile.summary}, skills=${profile.skills?.length || 0}`);
    return true;
  } catch (err) {
    console.error(`[enrichment] ERROR for ${profile.name}:`, err);
    return false;
  }
}

// ─── Main Scoring Pipeline ───────────────────────────────────────────────────

async function scoreProfile(
  supabase: SupabaseClient,
  profile: ProfileData,
  job: JobData,
  customScoringInstructions?: string,
  enrichmentCtx?: EnrichmentContext | null,
  claudeModel?: string,
): Promise<ScoringResult> {
  const startTime = Date.now();
  const candidateId = profile.id; // Stable ID from your candidates table

  // Check cache
  const cached = await getCachedScore(supabase, candidateId, job.id);
  if (cached) return cached;

  // Layer 1: Hard Filters (cheapest first, AI must-have last)
  const hardFilter = await applyHardFilters(profile, job);
  if (!hardFilter.passed) {
    const result: ScoringResult = {
      name: profile.name,
      score: 0,
      recommendation: "NO_MATCH",
      summary: hardFilter.reason || "Éliminé par filtre",
      strengths: [],
      concerns: [hardFilter.reason || "Hard filter KO"],
      missingSkills: [],
      hardFilterPassed: false,
      hardFilterKO: hardFilter.reason,
      weightedCriteriaScore: 0,
      semanticScore: null,
      llmScore: null,
      finalScore: 0,
      confidenceScore: 100,
      dimensions: {},
      dataCompleteness: "full",
      missingDataPoints: [],
      skippedLLM: true,
      processingTimeMs: Date.now() - startTime,
      tokensUsed: null,
      skipReason: hardFilter.reason,
    };
    await setCachedScore(supabase, candidateId, job.id, result);
    return result;
  }

  // ─── Enrichment: after hard filter pass, before weighted scoring ──────────
  // Only enrich profiles that passed hard filters and lack experience descriptions
  if (enrichmentCtx) {
    const enriched = await maybeEnrichProfile(profile, enrichmentCtx);
    if (enriched) {
      enrichmentCtx.dailyCount++;
    }
  }

  // Layer 2: Weighted Criteria (now returns matched/missing skills too)
  const weighted = computeWeightedScore(profile, job);

  // Layer 3: Semantic Similarity
  const semanticScore = await getSemanticScore(supabase, candidateId, job.id);

  // Layer 4: LLM — COMPLETE assessment for ALL profiles passing hard filter
  // No more skipping: the LLM is the primary judge of technical fit.
  let llmResult: LLMResult | null = null;
  let skippedLLM = false;

  try {
    llmResult = await callLLM(
      profile,
      job,
      {
        weightedScore: weighted.score,
        dimensions: weighted.dimensions,
        matchedSkills: weighted.matchedSkills,
        missingSkills: weighted.missingSkills,
        semanticScore,
      },
      customScoringInstructions,
      claudeModel,
    );

    // If LLM says must-have clearly failed, treat as hard filter KO
    // If "uncertain" (not enough info), keep but penalize score
    if (job.mustHave && job.mustHave.trim().length > 0 && !llmResult.mustHavePassed) {
      const koResult: ScoringResult = {
        name: profile.name,
        score: 0,
        recommendation: "NO_MATCH",
        summary: llmResult.mustHaveDetails || "Must-have non satisfait (évaluation IA)",
        strengths: llmResult.strengths || [],
        concerns: [llmResult.mustHaveDetails || "Must-have KO", ...(llmResult.concerns || [])],
        missingSkills: llmResult.missingCriticalSkills || [],
        hardFilterPassed: false,
        hardFilterKO: llmResult.mustHaveDetails || "Must-have non satisfait",
        weightedCriteriaScore: weighted.score,
        semanticScore,
        llmScore: llmResult.overallScore,
        finalScore: 0,
        confidenceScore: 100,
        dimensions: weighted.dimensions,
        dataCompleteness: weighted.dataCompleteness,
        missingDataPoints: weighted.missingDataPoints,
        skippedLLM: false,
        processingTimeMs: Date.now() - startTime,
        tokensUsed: llmResult.tokensUsed,
        skipReason: llmResult.mustHaveDetails,
      };
      await setCachedScore(supabase, candidateId, job.id, koResult);
      return koResult;
    }

    // If must-have is uncertain, penalize score and flag for review
    if ((llmResult as any).mustHaveUncertain) {
      llmResult.overallScore = Math.max(0, (llmResult.overallScore || 0) - 15);
      llmResult.concerns = [
        ...(llmResult.concerns || []),
        "⚠️ Critère obligatoire à vérifier manuellement — pas assez d'infos sur le profil",
      ];
      if (llmResult.mustHaveDetails) {
        llmResult.concerns.push(llmResult.mustHaveDetails);
      }
    }

    // Inject LLM dimensions into weighted result for visibility
    weighted.dimensions.tech_fit_llm = {
      score: llmResult.techFitScore,
      weight: 0, // Not counted in algo score — already in LLM score
      details: "Évaluation technique IA",
    };
    weighted.dimensions.soft_skills_llm = {
      score: llmResult.softSkillsScore,
      weight: 0,
      details: "Évaluation soft skills IA",
    };
  } catch (err) {
    console.error(`[llm] Error for ${profile.name}:`, err);
    skippedLLM = true;
    // When LLM is unavailable, we still score with algo + semantic only
  }

  const finalScore = computeFinalScore(weighted.score, semanticScore, llmResult?.overallScore ?? null);

  const recommendation = getRecommendation(finalScore);

  // Build summary, strengths, concerns — prefer LLM output when available
  const summary =
    llmResult?.summary ||
    (finalScore >= 60
      ? `Bon match algo (${weighted.score}/100)`
      : finalScore >= 40
        ? `Match partiel (${weighted.score}/100)`
        : `Faible match (${weighted.score}/100)`);

  const strengths = llmResult?.strengths || [];
  const concerns = llmResult?.concerns || [];

  // Use LLM's skill analysis when available, fallback to heuristic
  const matchedSkills = llmResult?.matchedSkills?.length ? llmResult.matchedSkills : weighted.matchedSkills;
  const missingSkills = llmResult?.missingCriticalSkills?.length ? llmResult.missingCriticalSkills : weighted.missingSkills;

  if (skippedLLM) {
    concerns.push("⚠️ Évaluation IA indisponible — score basé uniquement sur l'algorithme");
  }

  const result: ScoringResult = {
    name: profile.name,
    score: finalScore,
    recommendation,
    summary,
    strengths: strengths.slice(0, 5),
    concerns: concerns.slice(0, 5),
    missingSkills,
    seniorityMatch: weighted.dimensions.seniority?.details,
    locationMatch: weighted.dimensions.location?.details,
    experienceMatch: weighted.dimensions.seniority?.details,
    tenureAnalysis: weighted.dimensions.tenure?.details,
    receptivityScore: weighted.dimensions.receptivity?.score ?? null,
    internationalExperienceValidation: "none",
    locationCompatibility:
      weighted.dimensions.location?.score && weighted.dimensions.location.score > 60 ? "compatible" : "partial",
    candidatePreferencesConflict: null,
    contractMismatch: weighted.dimensions.contract_fit?.details !== "Neutre" ? weighted.dimensions.contract_fit?.details || null : null,
    skipReason: finalScore < 40 ? summary : null,
    matchedSkills,
    matchedSkillCount: matchedSkills.length,
    totalRequiredSkills: weighted.allJobSkills.length,
    hardFilterPassed: true,
    weightedCriteriaScore: weighted.score,
    semanticScore,
    llmScore: llmResult?.overallScore ?? null,
    pedigreeScore: (llmResult as any)?.pedigreeScore ?? null,
    notableCompanies: (llmResult as any)?.notableCompanies ?? null,
    finalScore,
    confidenceScore: weighted.confidenceScore,
    dimensions: weighted.dimensions,
    dataCompleteness: weighted.dataCompleteness,
    missingDataPoints: weighted.missingDataPoints,
    skippedLLM,
    processingTimeMs: Date.now() - startTime,
    tokensUsed: llmResult?.tokensUsed ?? null,
  };

  await setCachedScore(supabase, candidateId, job.id, result);
  return result;
}

// ─── HTTP Handler ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    const userId = auth.userId;

    // Rate limit: 30 req/min for scoring
    const svcRL = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: allowed } = await svcRL.rpc('check_rate_limit', { p_user_id: userId, p_action: 'score_profile', p_max_requests: 30, p_window_seconds: 60 });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: corsHeaders });
    }
    const body = await req.json();
    const { profile, job, profiles, customScoringInstructions, accountId } = body as {
      profile?: ProfileData;
      job?: JobData;
      profiles?: ProfileData[];
      customScoringInstructions?: string;
      accountId?: string;
    };

    // Resolve AI model from frontend override (request-scoped)
    let aiParams: { aiAction: string; modelId: string; description: string | null } = {
      aiAction: "scoring", modelId: "claude-sonnet-4-6", description: null,
    };
    try {
      const { extractAIParams } = await import("../_shared/settle-credits.ts");
      aiParams = extractAIParams(body, "scoring");
    } catch (e) {
      console.warn("[score-profile-job] Failed to load settle-credits:", e);
    }
    let anthropicModelId = aiParams.modelId;
    try {
      const { getAnthropicModelId, MODEL_CATALOG } = await import("../_shared/ai-config.ts");
      // If the resolved model is not Claude (e.g. Gemini), map to closest Claude by tier
      const resolvedModel = MODEL_CATALOG[aiParams.modelId];
      if (resolvedModel && resolvedModel.provider !== "anthropic") {
        const tierToClaudeMap: Record<string, string> = {
          budget: "claude-haiku-4-5",
          balanced: "claude-sonnet-4-6",
          premium: "claude-opus-4-6",
        };
        anthropicModelId = getAnthropicModelId(tierToClaudeMap[resolvedModel.tier] || CLAUDE_MODEL_DEFAULT);
        console.log(`[score-profile-job] Non-Claude model "${aiParams.modelId}" (${resolvedModel.tier}) → mapped to "${anthropicModelId}"`);
      } else {
        anthropicModelId = getAnthropicModelId(aiParams.modelId);
      }
    } catch (e) {
      console.warn("[score-profile-job] Failed to load ai-config:", e);
    }
    const CLAUDE_MODEL = (anthropicModelId && anthropicModelId.startsWith("claude-"))
      ? anthropicModelId
      : CLAUDE_MODEL_DEFAULT;

    // Input validation
    if (!job || !job.id || !job.title) {
      return new Response(JSON.stringify({ error: "Missing or invalid job data (id and title required)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const profilesToScore = profiles || (profile ? [profile] : []);
    if (profilesToScore.length === 0) {
      return new Response(JSON.stringify({ error: "No profile(s) provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate all profiles have an id
    const missingIds = profilesToScore.filter((p) => !p.id);
    if (missingIds.length > 0) {
      return new Response(
        JSON.stringify({
          error: `${missingIds.length} profile(s) missing 'id' field. Each profile must have a stable unique id.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // ─── Enrichment Context Setup ──────────────────────────────────────────────
    // Enrichment happens INSIDE scoreProfile, AFTER hard filter pass.
    // This avoids wasting get_profile calls on profiles that would be eliminated.
    const ENRICHMENT_DAILY_LIMIT = 500;
    // Resolve Unipile credentials from org_integrations with env fallback
    let resolvedUnipile: { apiKey: string; dsn: string } | null = null;
    try {
      const { resolveUnipileCredentials, resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
      const orgId = userId ? await resolveOrgIdFromUser(userId, supabase as any) : null;
      resolvedUnipile = await resolveUnipileCredentials(orgId, supabase as any);
    } catch (e) {
      console.warn('[score-profile-job] Failed to resolve org credentials, falling back to env:', e);
      const envKey = Deno.env.get("UNIPILE_API_KEY");
      const envDsn = Deno.env.get("UNIPILE_DSN");
      if (envKey && envDsn) {
        resolvedUnipile = { apiKey: envKey, dsn: `https://${envDsn.replace(/^https?:\/\//, '')}` };
      }
    }
    let enrichmentCtx: EnrichmentContext | null = null;

    if (accountId && resolvedUnipile) {
      const today = new Date().toISOString().split("T")[0];
      const countKey = `enrichment_count_${today}`;
      const { data: countRow } = await supabase
        .from("internal_config")
        .select("value")
        .eq("key", countKey)
        .maybeSingle();
      const dailyCount = countRow ? parseInt(countRow.value, 10) : 0;

      enrichmentCtx = {
        accountId,
        apiKey: resolvedUnipile.apiKey,
        baseUrl: `${resolvedUnipile.dsn}/api/v1`,
        dailyCount,
        dailyLimit: ENRICHMENT_DAILY_LIMIT,
      };
      console.log(`[enrichment] Context initialized: ${dailyCount}/${ENRICHMENT_DAILY_LIMIT} used today`);
    }

    // ─── Scoring (batch LLM approach) ──────────────────────────────────────
    // Phase 1: Run fast layers (cache, hard filter, enrichment, weighted, semantic) per profile
    // Phase 2: Batch LLM call for all profiles that need it
    // Phase 3: Combine scores and return

    const results: ScoringResult[] = [];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let hardFilteredCount = 0;
    let llmSkippedCount = 0;
    let llmCalledCount = 0;

    // Phase 1: Pre-compute per profile (fast layers)
    interface PreScoredProfile {
      profile: ProfileData;
      startTime: number;
      cached?: ScoringResult;
      hardFilterResult?: { passed: boolean; ko?: string; result?: ScoringResult };
      weighted?: ReturnType<typeof computeWeightedScore>;
      semanticScore?: number | null;
      needsLLM: boolean;
    }

    const preScored: PreScoredProfile[] = [];

    for (const p of profilesToScore) {
      const startTime = Date.now();
      const candidateId = p.id;

      // Layer 0: Cache check
      const cached = await getCachedScore(supabase, candidateId, job.id);
      if (cached) {
        console.log(`[cache] HIT for ${p.name} → score=${cached.finalScore}`);
        preScored.push({ profile: p, startTime, cached, needsLLM: false });
        continue;
      }

      // Layer 1: Hard filters
      const hardFilterResult = await applyHardFilters(p, job);
      if (!hardFilterResult.passed) {
        const koResult: ScoringResult = {
          name: p.name,
          score: 0,
          recommendation: "NO_MATCH",
          summary: hardFilterResult.reason || "Hard filter KO",
          strengths: [],
          concerns: [hardFilterResult.reason || "Filtre automatique"],
          missingSkills: [],
          hardFilterPassed: false,
          hardFilterKO: hardFilterResult.reason,
          weightedCriteriaScore: 0,
          semanticScore: null,
          llmScore: null,
          finalScore: 0,
          confidenceScore: 100,
          dimensions: {},
          dataCompleteness: "minimal" as const,
          missingDataPoints: [],
          skippedLLM: true,
          processingTimeMs: Date.now() - startTime,
          tokensUsed: null,
        };
        await setCachedScore(supabase, candidateId, job.id, koResult);
        preScored.push({ profile: p, startTime, hardFilterResult: { passed: false, result: koResult }, needsLLM: false });
        continue;
      }

      // Enrichment
      if (enrichmentCtx) {
        await maybeEnrichProfile(p, enrichmentCtx);
      }

      // Layer 2: Weighted criteria
      const weighted = computeWeightedScore(p, job);

      // Layer 3: Semantic similarity
      const semanticScore = await getSemanticScore(supabase, candidateId, job.id);

      preScored.push({ profile: p, startTime, weighted, semanticScore, needsLLM: true });
    }

    // Phase 2: Batch LLM call for profiles that need scoring
    const llmNeeded = preScored.filter(ps => ps.needsLLM && ps.weighted);
    const batchInputs: BatchLLMInput[] = llmNeeded.map(ps => ({
      profile: ps.profile,
      preComputedData: {
        weightedScore: ps.weighted!.score,
        dimensions: ps.weighted!.dimensions,
        matchedSkills: ps.weighted!.matchedSkills,
        missingSkills: ps.weighted!.missingSkills,
        semanticScore: ps.semanticScore ?? null,
      },
    }));

    let llmResultMap = new Map<string, LLMResult>();


    if (batchInputs.length > 0) {
      // Process in sub-batches of BATCH_SIZE for the LLM
      const LLM_BATCH_SIZE = 10;
      for (let i = 0; i < batchInputs.length; i += LLM_BATCH_SIZE) {
        const subBatch = batchInputs.slice(i, i + LLM_BATCH_SIZE);
        try {
          const subMap = await callLLMBatch(subBatch, job, customScoringInstructions, CLAUDE_MODEL);
          for (const [k, v] of subMap) llmResultMap.set(k, v);
        } catch (err: any) {
          if (err.message === "BATCH_PARSE_FAILED") {
            console.warn(`[scoring] Batch LLM parse failed, falling back to individual scoring`);

            break;
          }
          throw err;
        }

        if (i + LLM_BATCH_SIZE < batchInputs.length) {
          await sleep(DELAY_BETWEEN_BATCHES_MS);
        }
      }

      // Fallback: score individually for profiles that didn't get a result
      for (const input of batchInputs) {
        if (!llmResultMap.has(input.profile.id)) {
          try {
            console.log(`[scoring] Fallback individual LLM for ${input.profile.name}`);
            const result = await callLLM(input.profile, job, input.preComputedData, customScoringInstructions, CLAUDE_MODEL);
            llmResultMap.set(input.profile.id, result);
          } catch (err) {
            console.error(`[scoring] Individual LLM fallback failed for ${input.profile.name}:`, err);
          }
        }
      }
    }

    // Phase 3: Combine and build final results (always include profile_id for safe matching)
    for (const ps of preScored) {
      // Cached results
      if (ps.cached) {
        results.push({ ...ps.cached, profile_id: ps.profile.id });
        if (ps.cached.tokensUsed) {
          totalTokensInput += ps.cached.tokensUsed.input;
          totalTokensOutput += ps.cached.tokensUsed.output;
        }
        continue;
      }

      // Hard-filtered results
      if (ps.hardFilterResult?.result) {
        results.push({ ...ps.hardFilterResult.result, profile_id: ps.profile.id });
        hardFilteredCount++;
        llmSkippedCount++;
        continue;
      }

      // LLM-scored results
      const llmResult = llmResultMap.get(ps.profile.id) ?? null;
      const weighted = ps.weighted!;
      const semanticScore = ps.semanticScore ?? null;

      if (llmResult) {
        llmCalledCount++;
        if (llmResult.tokensUsed) {
          totalTokensInput += llmResult.tokensUsed.input;
          totalTokensOutput += llmResult.tokensUsed.output;
        }

        // Must-have KO check
        if (job.mustHave && job.mustHave.trim().length > 0 && !llmResult.mustHavePassed) {
          const koResult: ScoringResult = {
            profile_id: ps.profile.id,
            name: ps.profile.name,
            score: 0,
            recommendation: "NO_MATCH",
            summary: llmResult.mustHaveDetails || "Must-have non satisfait (évaluation IA)",
            strengths: llmResult.strengths || [],
            concerns: [llmResult.mustHaveDetails || "Must-have KO", ...(llmResult.concerns || [])],
            missingSkills: llmResult.missingCriticalSkills || [],
            hardFilterPassed: false,
            hardFilterKO: llmResult.mustHaveDetails || "Must-have non satisfait",
            weightedCriteriaScore: weighted.score,
            semanticScore,
            llmScore: llmResult.overallScore,
            finalScore: 0,
            confidenceScore: 100,
            dimensions: weighted.dimensions,
            dataCompleteness: weighted.dataCompleteness,
            missingDataPoints: weighted.missingDataPoints,
            skippedLLM: false,
            processingTimeMs: Date.now() - ps.startTime,
            tokensUsed: llmResult.tokensUsed,
            skipReason: llmResult.mustHaveDetails,
          };
          await setCachedScore(supabase, ps.profile.id, job.id, koResult);
          results.push(koResult);
          hardFilteredCount++;
          continue;
        }

        // Must-have uncertain penalty
        if ((llmResult as any).mustHaveUncertain) {
          llmResult.overallScore = Math.max(0, (llmResult.overallScore || 0) - 15);
          llmResult.concerns = [
            ...(llmResult.concerns || []),
            "⚠️ Critère obligatoire à vérifier manuellement",
          ];
        }

        // Inject LLM dimensions
        weighted.dimensions.tech_fit_llm = { score: llmResult.techFitScore, weight: 0, details: "Évaluation technique IA" };
        weighted.dimensions.soft_skills_llm = { score: llmResult.softSkillsScore, weight: 0, details: "Évaluation soft skills IA" };
      } else {
        llmSkippedCount++;
      }

      let finalScore = computeFinalScore(weighted.score, semanticScore, llmResult?.overallScore ?? null);
      const confidenceScore = weighted.confidenceScore;

      // Penalize incomplete profiles: reduce score proportionally to missing data
      // A profile with 3/5 missing data points gets a 20% penalty (60% confidence → -20%)
      if (weighted.dataCompleteness === 'minimal') {
        finalScore = Math.round(finalScore * 0.8); // -20% for minimal data
      } else if (weighted.dataCompleteness === 'partial') {
        finalScore = Math.round(finalScore * 0.9); // -10% for partial data
      }

      const recommendation = getRecommendation(finalScore);

      const result: ScoringResult = {
        profile_id: ps.profile.id,
        name: ps.profile.name,
        score: finalScore,
        recommendation,
        summary: llmResult?.summary || `Score: ${finalScore}/100`,
        strengths: llmResult?.strengths || [],
        concerns: llmResult?.concerns || [],
        missingSkills: llmResult?.missingCriticalSkills || weighted.missingSkills,
        matchedSkills: llmResult?.matchedSkills || weighted.matchedSkills,
        matchedSkillCount: (llmResult?.matchedSkills || weighted.matchedSkills).length,
        totalRequiredSkills: (job.skills || []).length,
        seniorityMatch: weighted.dimensions.seniority?.details,
        locationMatch: weighted.dimensions.location?.details,
        experienceMatch: weighted.dimensions.experience?.details,
        tenureAnalysis: weighted.dimensions.tenure?.details,
        receptivityScore: weighted.dimensions.receptivity?.score ?? null,
        hardFilterPassed: true,
        weightedCriteriaScore: weighted.score,
        semanticScore,
        llmScore: llmResult?.overallScore ?? null,
        finalScore,
        confidenceScore,
        dimensions: weighted.dimensions,
        dataCompleteness: weighted.dataCompleteness,
        missingDataPoints: weighted.missingDataPoints,
        criteriaEvaluations: llmResult?.criteriaEvaluations || [],
        skippedLLM: llmResult === null,
        processingTimeMs: Date.now() - ps.startTime,
        tokensUsed: llmResult?.tokensUsed ?? null,
      };

      await setCachedScore(supabase, ps.profile.id, job.id, result);
      results.push(result);
    }

    // Persist enrichment daily count
    if (enrichmentCtx) {
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("internal_config").upsert(
        { key: `enrichment_count_${today}`, value: String(enrichmentCtx.dailyCount) },
        { onConflict: "key" },
      );
      console.log(`[enrichment] Final daily count: ${enrichmentCtx.dailyCount}/${enrichmentCtx.dailyLimit}`);
    }

    const avgScore =
      results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.finalScore, 0) / results.length) : 0;

    const stats = {
      total: results.length,
      hardFiltered: hardFilteredCount,
      llmSkipped: llmSkippedCount,
      llmCalled: llmCalledCount,
      avgScore,
      totalTokens: totalTokensInput + totalTokensOutput,
    };

    const responseData = profiles ? { results, stats } : { result: results[0] };

    // Settle credits based on actual tokens consumed (fire-and-forget)
    if (totalTokensInput + totalTokensOutput > 0) {
      try {
        const { resolveOrgIdFromUser } = await import("../_shared/resolve-org-credentials.ts");
        const orgId = userId ? await resolveOrgIdFromUser(userId, supabase as any) : null;
        if (orgId && userId) {
          const { settleCredits } = await import("../_shared/settle-credits.ts");
          const settleResult = await settleCredits(supabase as any, {
            organizationId: orgId,
            userId,
            aiAction: aiParams.aiAction,
            modelId: aiParams.modelId,
            tokensInput: totalTokensInput,
            tokensOutput: totalTokensOutput,
            description: aiParams.description,
          });
          if (!settleResult?.success) {
            console.error(`[score-profile-job] ⚠️ CREDIT SETTLEMENT FAILED: ${totalTokensInput}in+${totalTokensOutput}out tokens NOT deducted for org ${orgId}`);
          }
        }
      } catch (e) { console.warn("[score-profile-job] settle skipped:", e); }
    }

    return new Response(JSON.stringify({ success: true, ...responseData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[handler] Score profile error:", error);

    // Don't leak internal error details to client
    const message = error instanceof Error ? error.message : "Unknown error";
    const isRateLimited = message.includes("RATE_LIMITED");
    const isCreditsExhausted = message.includes("CREDITS_EXHAUSTED");
    const status = isRateLimited ? 429 : isCreditsExhausted ? 402 : 500;

    return new Response(
      JSON.stringify({
        error: isRateLimited
          ? "Rate limited, please retry later"
          : isCreditsExhausted
            ? "API credits exhausted"
            : "Internal scoring error",
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
