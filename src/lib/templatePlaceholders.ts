/**
 * templatePlaceholders.ts — Système de variables dynamiques pour les
 * templates de messages.
 *
 * Permet d'utiliser des placeholders type {{prénom}} dans les templates,
 * remplacés automatiquement par les vraies données du contact / mission /
 * user au moment de l'insertion.
 *
 * Convention : `{{nom_du_placeholder}}` (snake_case avec accents OK)
 *
 * Usage :
 *   const ctx = buildPlaceholderContext({ chat, currentJob, user });
 *   const finalText = interpolatePlaceholders(template.content, ctx);
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface PlaceholderContext {
  // Contact (depuis chat.attendees[0])
  prenom?: string;
  nom?: string;
  nom_complet?: string;
  headline?: string;          // Headline LinkedIn
  poste_actuel?: string;      // "CTO" extrait du headline
  entreprise_actuelle?: string; // "Konekt" extrait du headline ("CTO at Konekt")
  ville?: string;             // Localisation si dispo
  profil_linkedin?: string;   // URL profil LinkedIn

  // Mission / job
  poste_recherche?: string;   // Titre du job de la mission active
  client?: string;            // Nom du client (organization du job)

  // Sender (recruteur — l'user connecté)
  mon_prenom?: string;
  mon_nom?: string;
  ma_signature?: string;

  // Liens
  lien_calendly?: string;

  // Date / time
  aujourd_hui?: string;       // "lundi 28 avril 2026"
  jour_semaine?: string;      // "lundi"
  date_courte?: string;       // "28/04/2026"
}

// ─── Catalog des placeholders disponibles (pour UI) ──────────────────

export interface PlaceholderInfo {
  key: keyof PlaceholderContext;
  label: string;
  description: string;
  example: string;
  category: 'contact' | 'mission' | 'sender' | 'date';
}

export const PLACEHOLDERS_CATALOG: PlaceholderInfo[] = [
  // Contact
  { key: 'prenom', label: '{{prenom}}', description: 'Prénom du contact', example: 'Jérôme', category: 'contact' },
  { key: 'nom', label: '{{nom}}', description: 'Nom de famille du contact', example: 'Laporte', category: 'contact' },
  { key: 'nom_complet', label: '{{nom_complet}}', description: 'Prénom + nom complet', example: 'Jérôme Laporte', category: 'contact' },
  { key: 'headline', label: '{{headline}}', description: 'Headline LinkedIn complet', example: 'CTO at Konekt | Tech Recruitment', category: 'contact' },
  { key: 'poste_actuel', label: '{{poste_actuel}}', description: 'Job title actuel (extrait du headline)', example: 'CTO', category: 'contact' },
  { key: 'entreprise_actuelle', label: '{{entreprise_actuelle}}', description: 'Entreprise actuelle (extraite du headline)', example: 'Konekt', category: 'contact' },
  { key: 'ville', label: '{{ville}}', description: 'Ville / localisation', example: 'Paris', category: 'contact' },
  { key: 'profil_linkedin', label: '{{profil_linkedin}}', description: 'URL profil LinkedIn', example: 'linkedin.com/in/jerome', category: 'contact' },

  // Mission
  { key: 'poste_recherche', label: '{{poste_recherche}}', description: 'Titre du poste recherché', example: 'Senior Backend Dev', category: 'mission' },
  { key: 'client', label: '{{client}}', description: 'Nom du client', example: 'Spotify', category: 'mission' },

  // Sender
  { key: 'mon_prenom', label: '{{mon_prenom}}', description: 'Votre prénom', example: 'Laurent', category: 'sender' },
  { key: 'mon_nom', label: '{{mon_nom}}', description: 'Votre nom de famille', example: 'Garilhe', category: 'sender' },
  { key: 'ma_signature', label: '{{ma_signature}}', description: 'Votre signature complète', example: 'Laurent — Konekt', category: 'sender' },

  // Liens
  { key: 'lien_calendly', label: '{{lien_calendly}}', description: 'Votre lien Calendly du projet', example: 'calendly.com/laurent/15min', category: 'sender' },

  // Date
  { key: 'aujourd_hui', label: '{{aujourd_hui}}', description: 'Date d\'aujourd\'hui en français', example: 'lundi 28 avril 2026', category: 'date' },
  { key: 'jour_semaine', label: '{{jour_semaine}}', description: 'Jour de la semaine', example: 'lundi', category: 'date' },
  { key: 'date_courte', label: '{{date_courte}}', description: 'Date courte JJ/MM/AAAA', example: '28/04/2026', category: 'date' },
];

// ─── Builder du context depuis les vraies données ────────────────────

interface BuildContextInput {
  chat?: {
    attendees?: Array<{
      display_name?: string;
      name?: string;
      first_name?: string;
      last_name?: string;
      headline?: string;
      profile_url?: string;
    }>;
  };
  currentJob?: {
    title?: string;
    client?: { name?: string };
  };
  user?: {
    email?: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
  };
  calendlyLink?: string | null;
}

/**
 * Construit le PlaceholderContext depuis les vraies sources de données.
 * Chaque champ est optionnel — si pas de donnée, le placeholder reste tel quel
 * (l'user voit que la valeur n'est pas remplie et peut compléter).
 */
export function buildPlaceholderContext(input: BuildContextInput): PlaceholderContext {
  const ctx: PlaceholderContext = {};

  // Contact (depuis chat.attendees[0])
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
      // Parse "Job Title at Company" / "Job Title chez Company"
      const match = attendee.headline.match(/^(.+?)\s+(?:at|chez|@)\s+(.+?)(?:\s*[|·,]|$)/i);
      if (match) {
        ctx.poste_actuel = match[1].trim();
        ctx.entreprise_actuelle = match[2].trim();
      } else {
        // Fallback : tout le headline comme poste
        ctx.poste_actuel = attendee.headline.split(/[|·,]/)[0].trim();
      }
    }
    if (attendee.profile_url) {
      // Cleanup URL pour affichage : "linkedin.com/in/xxx" sans https
      ctx.profil_linkedin = attendee.profile_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
    }
  }

  // Mission
  if (input.currentJob) {
    if (input.currentJob.title) ctx.poste_recherche = input.currentJob.title;
    if (input.currentJob.client?.name) ctx.client = input.currentJob.client.name;
  }

  // Sender (user connecté)
  if (input.user) {
    const fullName = input.user.full_name || `${input.user.first_name || ''} ${input.user.last_name || ''}`.trim();
    if (fullName) {
      const parts = fullName.split(/\s+/);
      ctx.mon_prenom = input.user.first_name || parts[0];
      ctx.mon_nom = input.user.last_name || parts.slice(1).join(' ') || undefined;
      ctx.ma_signature = fullName;
    } else if (input.user.email) {
      // Fallback : 1ère partie de l'email
      const local = input.user.email.split('@')[0];
      ctx.mon_prenom = local.charAt(0).toUpperCase() + local.slice(1);
      ctx.ma_signature = ctx.mon_prenom;
    }
  }

  // Calendly
  if (input.calendlyLink) {
    ctx.lien_calendly = input.calendlyLink;
  }

  // Date
  const now = new Date();
  ctx.aujourd_hui = now.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  ctx.jour_semaine = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  ctx.date_courte = now.toLocaleDateString('fr-FR');

  return ctx;
}

// ─── Interpolation ────────────────────────────────────────────────────

/**
 * Remplace tous les `{{placeholder}}` dans un texte par les valeurs du context.
 * Si une valeur n'existe pas (undefined / vide), le placeholder reste tel quel
 * (visible) pour que l'user sache qu'il doit le remplir manuellement.
 *
 * Insensible à la casse, accents, et espaces autour du nom.
 *
 * Exemples :
 *   interpolatePlaceholders("Bonjour {{prenom}}", { prenom: "Jérôme" })
 *   → "Bonjour Jérôme"
 *
 *   interpolatePlaceholders("{{nom_complet}} chez {{client}}", { nom_complet: "Léo" })
 *   → "Léo chez {{client}}"  (client manquant → reste visible)
 */
export function interpolatePlaceholders(text: string, ctx: PlaceholderContext): string {
  if (!text) return text;

  return text.replace(/\{\{\s*([a-z0-9_éèêàâîôûç]+)\s*\}\}/gi, (match, key) => {
    const normalizedKey = key.toLowerCase().trim() as keyof PlaceholderContext;
    const value = ctx[normalizedKey];
    if (value && String(value).trim()) {
      return String(value);
    }
    return match; // Garde le placeholder visible si valeur manquante
  });
}

/**
 * Liste les placeholders utilisés dans un template (pour preview / validation)
 */
export function extractPlaceholders(text: string): string[] {
  if (!text) return [];
  const matches = text.matchAll(/\{\{\s*([a-z0-9_éèêàâîôûç]+)\s*\}\}/gi);
  const set = new Set<string>();
  for (const m of matches) {
    set.add(m[1].toLowerCase().trim());
  }
  return Array.from(set);
}
