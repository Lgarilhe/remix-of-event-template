/**
 * templatePlaceholders.ts — Système de variables dynamiques style Lemlist.
 *
 * Features :
 *  - 25+ placeholders contextuels (contact, mission, sender, date, conv)
 *  - Filtres pipe-style : {{prenom | upper}}, {{var | fallback:"valeur"}}
 *  - Conditionnels (résolution avec fallback intégré)
 *  - Salutations contextuelles auto (Bonjour/Bonsoir selon heure)
 *  - Variables custom user (depuis hook useUserTemplateVariables)
 *
 * Syntaxe :
 *   {{nom_var}}                          → simple substitution
 *   {{nom_var | upper}}                   → applique le filtre upper
 *   {{nom_var | fallback:"par défaut"}}  → si vide, utilise la valeur de fallback
 *   {{nom_var | truncate:30}}             → tronque à 30 chars + "…"
 *   {{nom_var | upper | truncate:30}}    → chaînage de filtres
 *
 * Filtres disponibles :
 *   - upper, lower, capitalize, title
 *   - fallback:"valeur"   → si placeholder vide, utilise valeur
 *   - truncate:N           → coupe à N caractères + "…"
 *   - first_word           → ne garde que le premier mot
 *   - default:"valeur"     → alias de fallback
 *   - trim
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface PlaceholderContext {
  // ─── Contact LinkedIn (depuis chat.attendees[0]) ──
  prenom?: string;
  nom?: string;
  nom_complet?: string;
  headline?: string;
  poste_actuel?: string;
  entreprise_actuelle?: string;
  ville?: string;
  pays?: string;
  profil_linkedin?: string;

  // ─── Données enrichies (si dispo) ──
  /** Nombre d'années d'expérience totales (calculé depuis work_experience) */
  annees_experience?: string;
  /** Top 3 skills concaténés (ex: "React, TypeScript, Node.js") */
  skills_top3?: string;
  /** École de formation principale */
  ecole?: string;
  /** Diplôme principal */
  diplome?: string;
  /** Industrie de l'entreprise actuelle */
  industrie?: string;
  /** Date de début du poste actuel (YYYY-MM ou texte type "depuis 3 ans") */
  date_debut_poste?: string;
  /** Durée au poste actuel (ex: "3 ans", "6 mois") */
  duree_poste?: string;
  /** Connexion LinkedIn niveau (1st, 2nd, 3rd) */
  niveau_connexion?: string;

  // ─── Mission ──
  poste_recherche?: string;
  client?: string;
  /** Localisation du poste recherché */
  lieu_poste?: string;
  /** Type de contrat (CDI, freelance...) */
  type_contrat?: string;
  /** Top skills requis (top 3 du job) */
  skills_requis?: string;

  // ─── Sender (recruteur — l'user connecté) ──
  mon_prenom?: string;
  mon_nom?: string;
  ma_signature?: string;
  /** Mon entreprise (nom de l'org) */
  ma_societe?: string;
  /** Mon poste */
  mon_poste?: string;
  lien_calendly?: string;

  // ─── Date / time ──
  aujourd_hui?: string;
  jour_semaine?: string;
  date_courte?: string;
  /** Salutation contextuelle (Bonjour / Bonsoir / Bonne soirée) */
  salutation?: string;
  /** Période du jour (matin / après-midi / soir) */
  periode_jour?: string;

  // ─── Conversation ──
  /** Sujet du dernier email/InMail (si dispo) */
  objet_conversation?: string;
  /** Nombre de messages échangés */
  nb_messages_echanges?: string;

  // ─── Variables custom user (étendues par useUserTemplateVariables) ──
  [customKey: string]: string | undefined;
}

// ─── Catalog des placeholders disponibles (pour UI) ──────────────────

export interface PlaceholderInfo {
  key: keyof PlaceholderContext;
  label: string;
  description: string;
  example: string;
  category: 'contact' | 'enriched' | 'mission' | 'sender' | 'date' | 'conv';
}

export const PLACEHOLDERS_CATALOG: PlaceholderInfo[] = [
  // Contact
  { key: 'prenom', label: '{{prenom}}', description: 'Prénom du contact', example: 'Jérôme', category: 'contact' },
  { key: 'nom', label: '{{nom}}', description: 'Nom de famille du contact', example: 'Laporte', category: 'contact' },
  { key: 'nom_complet', label: '{{nom_complet}}', description: 'Prénom + nom complet', example: 'Jérôme Laporte', category: 'contact' },
  { key: 'headline', label: '{{headline}}', description: 'Headline LinkedIn complet', example: 'CTO at Konekt | Tech Recruitment', category: 'contact' },
  { key: 'poste_actuel', label: '{{poste_actuel}}', description: 'Job title actuel', example: 'CTO', category: 'contact' },
  { key: 'entreprise_actuelle', label: '{{entreprise_actuelle}}', description: 'Entreprise actuelle', example: 'Konekt', category: 'contact' },
  { key: 'ville', label: '{{ville}}', description: 'Ville / localisation', example: 'Paris', category: 'contact' },
  { key: 'pays', label: '{{pays}}', description: 'Pays', example: 'France', category: 'contact' },
  { key: 'profil_linkedin', label: '{{profil_linkedin}}', description: 'URL profil LinkedIn', example: 'linkedin.com/in/jerome', category: 'contact' },

  // Enriched (si données dispo via Unipile/PDL/Apollo)
  { key: 'annees_experience', label: '{{annees_experience}}', description: 'Années XP totales (calculées)', example: '8 ans', category: 'enriched' },
  { key: 'skills_top3', label: '{{skills_top3}}', description: 'Top 3 compétences', example: 'React, TypeScript, Node', category: 'enriched' },
  { key: 'ecole', label: '{{ecole}}', description: 'École de formation', example: 'EPITA', category: 'enriched' },
  { key: 'diplome', label: '{{diplome}}', description: 'Diplôme principal', example: 'Master Eng. Logiciel', category: 'enriched' },
  { key: 'industrie', label: '{{industrie}}', description: 'Industrie de l\'entreprise', example: 'SaaS / Tech RH', category: 'enriched' },
  { key: 'duree_poste', label: '{{duree_poste}}', description: 'Durée au poste actuel', example: '3 ans', category: 'enriched' },
  { key: 'niveau_connexion', label: '{{niveau_connexion}}', description: 'Niveau LinkedIn (1st/2nd/3rd)', example: '2nd', category: 'enriched' },

  // Mission
  { key: 'poste_recherche', label: '{{poste_recherche}}', description: 'Titre du poste recherché', example: 'Senior Backend Dev', category: 'mission' },
  { key: 'client', label: '{{client}}', description: 'Nom du client', example: 'Spotify', category: 'mission' },
  { key: 'lieu_poste', label: '{{lieu_poste}}', description: 'Localisation du poste', example: 'Paris (remote OK)', category: 'mission' },
  { key: 'type_contrat', label: '{{type_contrat}}', description: 'Type de contrat', example: 'CDI', category: 'mission' },
  { key: 'skills_requis', label: '{{skills_requis}}', description: 'Top 3 skills requis', example: 'Go, Kubernetes, AWS', category: 'mission' },

  // Sender
  { key: 'mon_prenom', label: '{{mon_prenom}}', description: 'Votre prénom', example: 'Laurent', category: 'sender' },
  { key: 'mon_nom', label: '{{mon_nom}}', description: 'Votre nom de famille', example: 'Garilhe', category: 'sender' },
  { key: 'ma_signature', label: '{{ma_signature}}', description: 'Votre signature complète', example: 'Laurent Garilhe', category: 'sender' },
  { key: 'ma_societe', label: '{{ma_societe}}', description: 'Votre entreprise', example: 'Konekt', category: 'sender' },
  { key: 'mon_poste', label: '{{mon_poste}}', description: 'Votre poste', example: 'CEO', category: 'sender' },
  { key: 'lien_calendly', label: '{{lien_calendly}}', description: 'Votre lien Calendly du projet', example: 'calendly.com/laurent/15min', category: 'sender' },

  // Date
  { key: 'salutation', label: '{{salutation}}', description: 'Salutation contextuelle (Bonjour/Bonsoir)', example: 'Bonjour', category: 'date' },
  { key: 'periode_jour', label: '{{periode_jour}}', description: 'Période du jour (matin/après-midi/soir)', example: 'matinée', category: 'date' },
  { key: 'aujourd_hui', label: '{{aujourd_hui}}', description: 'Date du jour en français', example: 'lundi 28 avril 2026', category: 'date' },
  { key: 'jour_semaine', label: '{{jour_semaine}}', description: 'Jour de la semaine', example: 'lundi', category: 'date' },
  { key: 'date_courte', label: '{{date_courte}}', description: 'Date courte JJ/MM/AAAA', example: '28/04/2026', category: 'date' },

  // Conversation
  { key: 'objet_conversation', label: '{{objet_conversation}}', description: 'Sujet du dernier message (InMail)', example: 'Opportunité Spotify', category: 'conv' },
  { key: 'nb_messages_echanges', label: '{{nb_messages_echanges}}', description: 'Nombre de messages échangés', example: '3', category: 'conv' },
];

// ─── Builder du context ──────────────────────────────────────────────

interface BuildContextInput {
  chat?: {
    subject?: string;
    attendees?: Array<{
      display_name?: string;
      name?: string;
      first_name?: string;
      last_name?: string;
      headline?: string;
      profile_url?: string;
      // Données enrichies optionnelles
      location?: string;
      country?: string;
      network_distance?: string;
      work_experience?: Array<{
        title?: string;
        company?: string;
        start_date?: string;
        end_date?: string | null;
      }>;
      education?: Array<{
        school?: string;
        degree?: string;
      }>;
      skills?: string[];
      industry?: string;
    }>;
    last_message?: { text?: string };
  };
  messages?: Array<unknown>; // Pour compter les messages échangés
  currentJob?: {
    title?: string;
    location?: string;
    contractType?: string;
    skills?: string[];
    client?: { name?: string };
  };
  user?: {
    email?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
    job_title?: string;
  };
  organizationName?: string;
  calendlyLink?: string | null;
  /** Variables custom user (depuis useUserTemplateVariables) */
  customVariables?: Record<string, string>;
}

/** Calcule la durée entre 2 dates en années/mois (string FR) */
function durationFr(start: string, end?: string | null): string {
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : new Date();
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return '';
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (months < 1) return 'moins d\'un mois';
    if (months < 12) return `${months} mois`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    if (years === 1 && remainingMonths === 0) return '1 an';
    if (years === 1) return `1 an et ${remainingMonths} mois`;
    if (remainingMonths === 0) return `${years} ans`;
    return `${years} ans et ${remainingMonths} mois`;
  } catch {
    return '';
  }
}

export function buildPlaceholderContext(input: BuildContextInput): PlaceholderContext {
  const ctx: PlaceholderContext = {};

  // ─── Contact ──
  const attendee = input.chat?.attendees?.[0];
  if (attendee) {
    const fullName = attendee.display_name || attendee.name || `${attendee.first_name || ''} ${attendee.last_name || ''}`.trim();
    if (fullName) {
      ctx.nom_complet = fullName;
      const parts = fullName.split(/\s+/);
      ctx.prenom = attendee.first_name || parts[0];
      ctx.nom = attendee.last_name || parts.slice(1).join(' ') || undefined;
    }
    if (attendee.headline) {
      ctx.headline = attendee.headline;
      const match = attendee.headline.match(/^(.+?)\s+(?:at|chez|@)\s+(.+?)(?:\s*[|·,]|$)/i);
      if (match) {
        ctx.poste_actuel = match[1].trim();
        ctx.entreprise_actuelle = match[2].trim();
      } else {
        ctx.poste_actuel = attendee.headline.split(/[|·,]/)[0].trim();
      }
    }
    if (attendee.profile_url) {
      ctx.profil_linkedin = attendee.profile_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
    if (attendee.location) ctx.ville = attendee.location;
    if (attendee.country) ctx.pays = attendee.country;
    if (attendee.network_distance) ctx.niveau_connexion = attendee.network_distance;
    if (attendee.industry) ctx.industrie = attendee.industry;

    // Enriched : work_experience
    if (attendee.work_experience && attendee.work_experience.length > 0) {
      // Années XP totales = somme des durées de tous les jobs
      let totalMonths = 0;
      for (const exp of attendee.work_experience) {
        if (!exp.start_date) continue;
        try {
          const s = new Date(exp.start_date);
          const e = exp.end_date ? new Date(exp.end_date) : new Date();
          if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
            totalMonths += Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
          }
        } catch { /* skip */ }
      }
      if (totalMonths > 0) {
        const years = Math.floor(totalMonths / 12);
        ctx.annees_experience = years === 0 ? 'moins d\'un an' : years === 1 ? '1 an' : `${years} ans`;
      }
      // Durée au poste actuel = première expérience sans end_date
      const currentExp = attendee.work_experience.find(e => !e.end_date) || attendee.work_experience[0];
      if (currentExp?.start_date) {
        ctx.duree_poste = durationFr(currentExp.start_date, currentExp.end_date) || undefined;
        ctx.date_debut_poste = currentExp.start_date.slice(0, 7); // "YYYY-MM"
      }
    }
    // Enriched : skills (top 3)
    if (attendee.skills && attendee.skills.length > 0) {
      ctx.skills_top3 = attendee.skills.slice(0, 3).join(', ');
    }
    // Enriched : education
    if (attendee.education && attendee.education.length > 0) {
      const main = attendee.education[0];
      if (main.school) ctx.ecole = main.school;
      if (main.degree) ctx.diplome = main.degree;
    }
  }

  // ─── Mission ──
  if (input.currentJob) {
    if (input.currentJob.title) ctx.poste_recherche = input.currentJob.title;
    if (input.currentJob.client?.name) ctx.client = input.currentJob.client.name;
    if (input.currentJob.location) ctx.lieu_poste = input.currentJob.location;
    if (input.currentJob.contractType) ctx.type_contrat = input.currentJob.contractType;
    if (input.currentJob.skills && input.currentJob.skills.length > 0) {
      ctx.skills_requis = input.currentJob.skills.slice(0, 3).join(', ');
    }
  }

  // ─── Sender ──
  if (input.user) {
    const fullName = input.user.full_name || `${input.user.first_name || ''} ${input.user.last_name || ''}`.trim();
    if (fullName) {
      const parts = fullName.split(/\s+/);
      ctx.mon_prenom = input.user.first_name || parts[0];
      ctx.mon_nom = input.user.last_name || parts.slice(1).join(' ') || undefined;
      ctx.ma_signature = fullName;
    } else if (input.user.email) {
      const local = input.user.email.split('@')[0];
      ctx.mon_prenom = local.charAt(0).toUpperCase() + local.slice(1);
      ctx.ma_signature = ctx.mon_prenom;
    }
    if (input.user.job_title) ctx.mon_poste = input.user.job_title;
  }
  if (input.organizationName) ctx.ma_societe = input.organizationName;
  if (input.calendlyLink) ctx.lien_calendly = input.calendlyLink;

  // ─── Date / time ──
  const now = new Date();
  const hour = now.getHours();
  ctx.aujourd_hui = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  ctx.jour_semaine = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  ctx.date_courte = now.toLocaleDateString('fr-FR');

  // Salutation contextuelle
  if (hour < 12) {
    ctx.salutation = 'Bonjour';
    ctx.periode_jour = 'matinée';
  } else if (hour < 18) {
    ctx.salutation = 'Bonjour';
    ctx.periode_jour = 'après-midi';
  } else if (hour < 22) {
    ctx.salutation = 'Bonsoir';
    ctx.periode_jour = 'soirée';
  } else {
    ctx.salutation = 'Bonsoir';
    ctx.periode_jour = 'soirée';
  }

  // ─── Conversation ──
  if (input.chat?.subject) ctx.objet_conversation = input.chat.subject;
  if (input.messages) ctx.nb_messages_echanges = String(input.messages.length);

  // ─── Variables custom user ──
  if (input.customVariables) {
    for (const [key, value] of Object.entries(input.customVariables)) {
      if (value && !(key in ctx)) ctx[key] = value;
    }
  }

  return ctx;
}

// ─── Filtres pipe-style ──────────────────────────────────────────────

type FilterFn = (value: string, arg?: string) => string;

const FILTERS: Record<string, FilterFn> = {
  upper: (v) => v.toUpperCase(),
  lower: (v) => v.toLowerCase(),
  capitalize: (v) => v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v,
  title: (v) => v.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
  trim: (v) => v.trim(),
  first_word: (v) => v.split(/\s+/)[0] || '',
  truncate: (v, arg) => {
    const n = parseInt(arg || '50', 10);
    return v.length > n ? v.slice(0, n).trimEnd() + '…' : v;
  },
  fallback: (v, arg) => v && v.trim() ? v : (arg ?? ''),
  default: (v, arg) => v && v.trim() ? v : (arg ?? ''),
};

/** Parse les filtres d'une expression : "var | upper | truncate:30" */
function parseFilters(expr: string): { key: string; filters: Array<{ name: string; arg?: string }> } {
  const parts = expr.split('|').map(s => s.trim());
  const key = parts[0];
  const filters = parts.slice(1).map(filterStr => {
    // Format : "name" ou "name:arg" ou "name:\"arg\""
    const match = filterStr.match(/^(\w+)(?::\s*(?:"([^"]*)"|'([^']*)'|(.+)))?$/);
    if (!match) return { name: filterStr };
    return {
      name: match[1],
      arg: match[2] ?? match[3] ?? match[4]?.trim(),
    };
  });
  return { key, filters };
}

/** Applique une chaîne de filtres sur une valeur */
function applyFilters(value: string, filters: Array<{ name: string; arg?: string }>): string {
  let result = value;
  for (const f of filters) {
    const fn = FILTERS[f.name];
    if (fn) {
      result = fn(result, f.arg);
    }
  }
  return result;
}

// ─── Interpolation principale ────────────────────────────────────────

/**
 * Remplace tous les `{{xxx | filter | filter}}` dans un texte par les valeurs
 * du context, en appliquant les filtres dans l'ordre.
 *
 * Si la variable est manquante ET qu'il n'y a pas de filtre `fallback`/`default`,
 * le placeholder reste visible pour que l'user voit qu'il manque une valeur.
 *
 * Exemples :
 *   "{{prenom | upper}}"                  → "JÉRÔME"
 *   "{{client | fallback:\"votre boîte\"}}" → "votre boîte" si client manquant
 *   "{{poste | first_word | capitalize}}" → "Cto" (prend "CTO at Konekt", garde 1er mot, capitalize)
 */
export function interpolatePlaceholders(text: string, ctx: PlaceholderContext): string {
  if (!text) return text;

  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, expr) => {
    const { key, filters } = parseFilters(expr);
    const normalizedKey = key.toLowerCase().trim();
    const rawValue = ctx[normalizedKey];

    // Détecte si on a un filtre fallback ou default
    const hasFallback = filters.some(f => f.name === 'fallback' || f.name === 'default');

    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
      // Valeur manquante
      if (hasFallback) {
        // Applique les filtres avec valeur vide → fallback prend le relais
        return applyFilters('', filters);
      }
      return match; // Garde le placeholder visible
    }

    return applyFilters(String(rawValue), filters);
  });
}

/** Liste les placeholders utilisés dans un template (pour preview / validation) */
export function extractPlaceholders(text: string): string[] {
  if (!text) return [];
  const matches = text.matchAll(/\{\{\s*([^{}|]+?)(?:\s*\|[^}]*)?\s*\}\}/g);
  const set = new Set<string>();
  for (const m of matches) {
    set.add(m[1].toLowerCase().trim());
  }
  return Array.from(set);
}
