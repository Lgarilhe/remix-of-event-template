/**
 * template-interpolation.ts — Système d'interpolation unifié pour séquences.
 *
 * Port Deno-compatible de `src/lib/templatePlaceholders.ts`. Utilisé par
 * `process-sequences` (safety-net juste avant envoi LinkedIn/InMail/WhatsApp)
 * et `sequence-send-email` (envoi email).
 *
 * Supporte :
 *  - 30+ placeholders FR (prenom, headline, poste_recherche, mon_prenom...)
 *  - Aliases EN backward-compat (first_name, company, job_title, sender_name...)
 *  - Variables custom user (depuis user_template_variables)
 *  - Filtres pipe-style : upper, lower, capitalize, title, trim, first_word,
 *    truncate:N, fallback:"valeur", default:"valeur"
 *
 * Pour les variables QUI N'EXISTENT QUE CÔTÉ INBOX (annees_experience,
 * skills_top3, ville, pays, ecole, diplome, industrie, duree_poste) : non
 * peuplées ici car `sequence_enrollments` ne stocke pas ces données. Elles
 * resteront vides → le filtre `| fallback:"..."` permet de les gérer.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";

export type PlaceholderContext = Record<string, string | undefined>;

// ─── Filtres pipe-style ──────────────────────────────────────────────

type FilterFn = (value: string, arg?: string) => string;

const FILTERS: Record<string, FilterFn> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  capitalize: (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v),
  title: (v) =>
    v
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" "),
  trim: (v) => v.trim(),
  first_word: (v) => v.split(/\s+/)[0] || "",
  truncate: (v, arg) => {
    const n = parseInt(arg || "50", 10);
    return v.length > n ? v.slice(0, n).trimEnd() + "…" : v;
  },
  fallback: (v, arg) => (v && v.trim() ? v : arg ?? ""),
  default: (v, arg) => (v && v.trim() ? v : arg ?? ""),
};

function parseFilters(expr: string): { key: string; filters: Array<{ name: string; arg?: string }> } {
  const parts = expr.split("|").map((s) => s.trim());
  const key = parts[0];
  const filters = parts.slice(1).map((filterStr) => {
    const match = filterStr.match(/^(\w+)(?::\s*(?:"([^"]*)"|'([^']*)'|(.+)))?$/);
    if (!match) return { name: filterStr };
    return {
      name: match[1],
      arg: match[2] ?? match[3] ?? match[4]?.trim(),
    };
  });
  return { key, filters };
}

function applyFilters(value: string, filters: Array<{ name: string; arg?: string }>): string {
  let result = value;
  for (const f of filters) {
    const fn = FILTERS[f.name];
    if (fn) result = fn(result, f.arg);
  }
  return result;
}

// ─── Interpolation principale ────────────────────────────────────────

/**
 * Remplace tous les `{{xxx | filter | filter}}` dans un texte par les valeurs
 * du context, en appliquant les filtres dans l'ordre.
 *
 * Si la variable est manquante ET qu'il n'y a pas de filtre `fallback`/`default`,
 * le placeholder reste visible. Le caller doit stripper ensuite si besoin.
 */
export function interpolatePlaceholders(text: string, ctx: PlaceholderContext): string {
  if (!text) return text;

  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, expr) => {
    const { key, filters } = parseFilters(expr);
    const normalizedKey = key.toLowerCase().trim();
    const rawValue = ctx[normalizedKey];

    const hasFallback = filters.some((f) => f.name === "fallback" || f.name === "default");

    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
      if (hasFallback) return applyFilters("", filters);
      return match;
    }
    return applyFilters(String(rawValue), filters);
  });
}

// ─── Builder du context pour séquences ───────────────────────────────

export interface BuildSequenceContextInput {
  enrollment: Record<string, unknown>;
  /** Sender user_id : priorité step.sender_id > enrollment.assigned_sender_id > enrollment.created_by */
  senderUserId?: string | null;
  /** Si déjà chargé en amont (économise une query) */
  senderProfile?: { first_name?: string | null; last_name?: string | null; display_name?: string | null; job_title?: string | null } | null;
  /** Si déjà chargé en amont */
  organizationName?: string | null;
  /** Override calendly link (sinon résolu via project.job_details.calendly_link) */
  calendlyLink?: string | null;
}

/**
 * Construit un PlaceholderContext complet pour un enrollment de séquence en
 * interrogeant la DB : sourcing_projects, profiles, organizations,
 * user_template_variables.
 *
 * Toutes les queries sont fail-soft : si une table manque ou la query échoue,
 * la variable reste undefined et le placeholder garde sa valeur de fallback.
 */
export async function buildSequenceContext(
  supabase: SupabaseClient,
  input: BuildSequenceContextInput
): Promise<PlaceholderContext> {
  const { enrollment, senderUserId } = input;
  const ctx: PlaceholderContext = {};

  // ─── Contact (depuis enrollment) ──
  const profileName = String(enrollment.profile_name || "").trim();
  if (profileName) {
    const parts = profileName.split(/\s+/).filter(Boolean);
    ctx.prenom = parts[0] || "";
    ctx.nom = parts.slice(1).join(" ");
    ctx.nom_complet = profileName;
  }

  const headline = String(enrollment.profile_headline || "").trim();
  if (headline) {
    ctx.headline = headline;
    const match = headline.match(/^(.+?)\s+(?:at|chez|@)\s+(.+?)(?:\s*[|·,]|$)/i);
    if (match) {
      ctx.poste_actuel = match[1].trim();
      ctx.entreprise_actuelle = match[2].trim();
    } else {
      ctx.poste_actuel = headline.split(/[|·,]/)[0].trim();
    }
  }

  // job_title / company_name de l'enrollment écrasent le parsing si présents
  // (ils sont stockés explicitement → plus fiables que parsing headline)
  const enrollJobTitle = String(enrollment.job_title || "").trim();
  if (enrollJobTitle) ctx.poste_actuel = enrollJobTitle;
  const enrollCompany = String(enrollment.company_name || "").trim();
  if (enrollCompany) ctx.entreprise_actuelle = enrollCompany;

  const profileUrl = String(enrollment.profile_url || "").trim();
  if (profileUrl) {
    ctx.profil_linkedin = profileUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  const networkDistance = String(enrollment.network_distance || "").trim();
  if (networkDistance) ctx.niveau_connexion = networkDistance;

  // ─── Mission (depuis sourcing_projects via enrollment.job_id) ──
  let calendlyLink = input.calendlyLink ?? null;
  const jobId = enrollment.job_id;
  if (jobId && typeof jobId === "string") {
    try {
      const { data: project } = await supabase
        .from("sourcing_projects")
        .select("name, job_details")
        .eq("id", jobId)
        .maybeSingle();
      if (project) {
        const jd = (project.job_details || {}) as Record<string, unknown>;
        ctx.poste_recherche = String(jd.title || project.name || "");
        if (jd.client_name) ctx.client = String(jd.client_name);
        if (jd.location) ctx.lieu_poste = String(jd.location);
        if (jd.contract_type) ctx.type_contrat = String(jd.contract_type);
        const skills = jd.skills_must_have;
        if (Array.isArray(skills) && skills.length > 0) {
          ctx.skills_requis = skills.slice(0, 3).join(", ");
        }
        if (!calendlyLink && jd.calendly_link) {
          calendlyLink = String(jd.calendly_link);
        }
      }
    } catch (e) {
      console.warn("[template-interpolation] sourcing_projects fetch failed:", e);
    }
  }
  if (calendlyLink) ctx.lien_calendly = calendlyLink;

  // ─── Sender (recruteur — depuis profiles) ──
  let senderProfile = input.senderProfile;
  if (!senderProfile && senderUserId) {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, display_name, job_title")
        .eq("user_id", senderUserId)
        .maybeSingle();
      senderProfile = data;
    } catch (e) {
      console.warn("[template-interpolation] sender profile fetch failed:", e);
    }
  }
  if (senderProfile) {
    const fullName =
      senderProfile.display_name ||
      [senderProfile.first_name, senderProfile.last_name].filter(Boolean).join(" ");
    if (fullName) {
      const parts = fullName.split(/\s+/);
      ctx.mon_prenom = senderProfile.first_name || parts[0];
      ctx.mon_nom = senderProfile.last_name || parts.slice(1).join(" ") || undefined;
      ctx.ma_signature = fullName;
    }
    if (senderProfile.job_title) ctx.mon_poste = senderProfile.job_title;
  }

  // ─── Organization name ──
  let organizationName = input.organizationName;
  if (!organizationName && enrollment.organization_id) {
    try {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", enrollment.organization_id)
        .maybeSingle();
      organizationName = org?.name ?? null;
    } catch (e) {
      console.warn("[template-interpolation] organization fetch failed:", e);
    }
  }
  if (organizationName) ctx.ma_societe = organizationName;

  // ─── Variables custom user ──
  if (senderUserId) {
    try {
      const { data: customs } = await supabase
        .from("user_template_variables")
        .select("key, value")
        .eq("user_id", senderUserId);
      if (Array.isArray(customs)) {
        for (const v of customs) {
          if (v.key && v.value && !(v.key in ctx)) {
            ctx[v.key] = v.value;
          }
        }
      }
    } catch (e) {
      console.warn("[template-interpolation] user_template_variables fetch failed:", e);
    }
  }

  // ─── Date / time ──
  const now = new Date();
  const hour = now.getHours();
  ctx.aujourd_hui = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  ctx.jour_semaine = now.toLocaleDateString("fr-FR", { weekday: "long" });
  ctx.date_courte = now.toLocaleDateString("fr-FR");
  if (hour < 12) {
    ctx.salutation = "Bonjour";
    ctx.periode_jour = "matinée";
  } else if (hour < 18) {
    ctx.salutation = "Bonjour";
    ctx.periode_jour = "après-midi";
  } else {
    ctx.salutation = "Bonsoir";
    ctx.periode_jour = "soirée";
  }

  // ─── Aliases EN (backward-compat avec anciens templates) ──
  // Les séquences créées avant cette unification utilisent {{first_name}}, {{company}}, etc.
  // On expose les mêmes clés que l'ancien `buildSequenceTemplateVars`.
  if (ctx.prenom) ctx.first_name = ctx.prenom;
  if (ctx.nom) ctx.last_name = ctx.nom;
  if (ctx.nom_complet) ctx.name = ctx.nom_complet;
  if (ctx.entreprise_actuelle) ctx.company = ctx.entreprise_actuelle;
  if (ctx.poste_actuel) ctx.job_title = ctx.poste_actuel;
  if (ctx.mon_prenom) ctx.sender_name = ctx.mon_prenom;
  if (ctx.lien_calendly) ctx.calendly_link = ctx.lien_calendly;
  if (ctx.ville) ctx.city = ctx.ville;

  return ctx;
}

/**
 * Helper standalone — applique l'interpolation puis strip les placeholders
 * non résolus restants pour ne jamais envoyer `{{...}}` brut au candidat.
 * Retourne { result, leftover: string[] } pour logging.
 */
export function interpolateAndStrip(
  text: string,
  ctx: PlaceholderContext
): { result: string; leftover: string[] } {
  const interpolated = interpolatePlaceholders(text, ctx);
  const leftover = interpolated.match(/\{\{[^}]+\}\}/g) || [];
  const stripped = leftover.length > 0 ? interpolated.replace(/\{\{[^}]+\}\}/g, "") : interpolated;
  return { result: stripped, leftover };
}
