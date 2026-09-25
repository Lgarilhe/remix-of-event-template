/**
 * enrollmentDuplicates : anti-doublon d'inscription en séquence
 * (lot P0-D, docs/p0-plan-2026-09-06.md, section 2).
 *
 * Un candidat déjà contacté par un membre de l'organisation est signalé
 * « Déjà contacté par {prénom} le {date} » et exclu par défaut de
 * l'inscription (séquence ou InMail groupé). Sont pris en compte, toute
 * séquence et tout compte :
 *  - les inscriptions encore vivantes (active, paused), quelle que soit leur
 *    date : une séquence longue ou mise en pause peut encore écrire ;
 *  - les inscriptions closes par une réponse ou terminées (replied,
 *    completed) des 90 derniers jours ;
 *  - les InMails groupés programmés, en cours d'envoi ou envoyés
 *    (inmail_queue : scheduled, sending, sent) des 90 derniers jours.
 * La dérogation « Inscrire quand même » est réservée aux propriétaires et
 * administrateurs (useOrganization().isAdmin).
 *
 * Clés de rapprochement : profile_id, provider_id et resolved_profile_id
 * normalisés (identifiant LinkedIn ou URL canonique en minuscules sans barre
 * finale), plus le slug public de profile_url (/in/{slug}). Un même candidat
 * inscrit depuis un compte Recruiter (identifiant AE...) puis depuis un compte
 * classique (ACo...) est ainsi reconnu dès que l'un de ces identifiants ou son
 * URL publique concorde. Le même rapprochement est appliqué côté serveur par
 * l'outil agent enroll_in_sequence (_shared/agent-tools-mutations.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { LinkedInProfile } from '@/components/outreach/types';
import { extractLinkedInSlug } from '@/lib/linkedinUtils';

export const RECENT_CONTACT_WINDOW_DAYS = 90;
export const RECENT_CONTACT_STATUSES = ['active', 'paused', 'replied', 'completed'] as const;
/** Inscriptions qui peuvent encore envoyer : signalées sans limite de date. */
export const LIVE_CONTACT_STATUSES = ['active', 'paused'] as const;
/** Inscriptions closes : signalées sur les 90 derniers jours seulement. */
export const CLOSED_CONTACT_STATUSES = ['replied', 'completed'] as const;
/** InMails groupés comptés comme un contact (programmés, en cours, envoyés). */
export const INMAIL_CONTACT_STATUSES = ['scheduled', 'sending', 'sent'] as const;

/** Taille des lots de clés passées au filtre `in.()` (longueur d'URL bornée). */
const QUERY_CHUNK_SIZE = 40;
/** Taille des lots de slugs comparés par `profile_url.ilike` (un motif par slug). */
const SLUG_CHUNK_SIZE = 20;

export interface RecentEnrollment {
  /** user_id du membre qui a inscrit le candidat (created_by), null si inconnu. */
  createdBy: string | null;
  /** Prénom résolu depuis profiles.display_name, null si non lisible. */
  createdByFirstName: string | null;
  createdAt: string;
  /** Séquence de l'inscription, null pour un InMail groupé. */
  sequenceId: string | null;
  status: string;
  /** Origine du contact : inscription en séquence ou InMail groupé. */
  source: 'sequence' | 'inmail';
}

export type EnrollmentProfileRef = Pick<
  LinkedInProfile,
  'id' | 'provider_id' | 'public_identifier' | 'profile_url' | 'public_profile_url'
>;

/** Identifiant LinkedIn ou URL canonique : minuscules, sans barre finale. */
export function normalizeEnrollmentKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(/\/+$/, '').toLowerCase();
  return normalized || null;
}

/** Toutes les clés normalisées sous lesquelles un profil peut avoir été inscrit. */
function profileKeys(profile: EnrollmentProfileRef): string[] {
  const keys = new Set<string>();
  const raw = [
    profile.id,
    profile.provider_id,
    profile.public_identifier,
    profile.profile_url,
    profile.public_profile_url,
  ];
  for (const value of raw) {
    const key = normalizeEnrollmentKey(value);
    if (key) keys.add(key);
    if (value) {
      const slug = extractLinkedInSlug(value);
      if (slug) keys.add(slug);
    }
  }
  return Array.from(keys);
}

/** Valeur sûre pour une liste `in.(...)` d'un filtre PostgREST `or`. */
function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function firstNameOf(displayName: string | null | undefined): string | null {
  const first = (displayName || '').trim().split(/\s+/)[0];
  return first || null;
}

/**
 * Cherche, pour chaque profil, le dernier contact de l'organisation : inscription
 * vivante (sans limite de date), inscription close ou InMail groupé des 90
 * derniers jours. Renvoie une Map indexée par `profile.id` (les profils absents
 * n'ont pas de contact récent).
 *
 * Lève une erreur si la lecture échoue : l'appelant décide s'il bloque ou
 * s'il prévient l'utilisateur.
 */
export async function findRecentEnrollments(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  profiles: EnrollmentProfileRef[],
): Promise<Map<string, RecentEnrollment>> {
  const result = new Map<string, RecentEnrollment>();
  if (!organizationId || profiles.length === 0) return result;

  // Index clé normalisée → identifiants de profils (plusieurs profils peuvent
  // partager une clé si la sélection contient un doublon).
  const keyIndex = new Map<string, string[]>();
  for (const profile of profiles) {
    for (const key of profileKeys(profile)) {
      const list = keyIndex.get(key) ?? [];
      if (!list.includes(profile.id)) list.push(profile.id);
      keyIndex.set(key, list);
    }
  }
  const allKeys = Array.from(keyIndex.keys());
  if (allKeys.length === 0) return result;

  // Les valeurs stockées ne sont pas forcément normalisées : on interroge
  // aussi avec les valeurs brutes, puis on compare après normalisation.
  const queryValues = new Set<string>(allKeys);
  for (const profile of profiles) {
    for (const value of [profile.id, profile.provider_id, profile.public_identifier, profile.profile_url, profile.public_profile_url]) {
      const trimmed = value?.trim();
      if (trimmed) queryValues.add(trimmed);
    }
  }
  const values = Array.from(queryValues);
  // Slugs publics connus (/in/{slug}) : l'URL enregistrée à l'inscription peut
  // différer (https, www, barre finale, paramètres), on la compare par motif.
  const slugs = Array.from(new Set(
    profiles.flatMap(p => [p.id, p.provider_id, p.public_identifier, p.profile_url, p.public_profile_url])
      .map(v => (v ? extractLinkedInSlug(v) : null))
      .filter((slug): slug is string => !!slug),
  ));
  const since = new Date(Date.now() - RECENT_CONTACT_WINDOW_DAYS * 86_400_000).toISOString();

  type EnrollmentRow = Pick<
    Database['public']['Tables']['sequence_enrollments']['Row'],
    'profile_id' | 'provider_id' | 'resolved_profile_id' | 'profile_url' | 'created_by' | 'created_at' | 'status' | 'sequence_id'
  >;
  type InMailRow = Pick<
    Database['public']['Tables']['inmail_queue']['Row'],
    'recipient_profile_id' | 'created_by' | 'created_at' | 'status'
  >;
  /** Contact trouvé, inscription ou InMail, avec les valeurs à rapprocher. */
  interface ContactRow {
    matchValues: Array<string | null | undefined>;
    createdBy: string | null;
    createdAt: string;
    status: string;
    sequenceId: string | null;
    source: 'sequence' | 'inmail';
  }
  const rows: ContactRow[] = [];
  const pushEnrollments = (data: EnrollmentRow[] | null) => {
    for (const row of data ?? []) {
      rows.push({
        matchValues: [row.profile_id, row.provider_id, row.resolved_profile_id, row.profile_url],
        createdBy: row.created_by,
        createdAt: row.created_at,
        status: row.status,
        sequenceId: row.sequence_id,
        source: 'sequence',
      });
    }
  };
  // Deux lectures par filtre : les inscriptions vivantes sans limite de date
  // (une inscription créée il y a 100 jours et encore en pause peut écrire à
  // la reprise), les inscriptions closes sur les 90 derniers jours.
  const fetchRows = async (orFilter: string) => {
    const select = 'profile_id, provider_id, resolved_profile_id, profile_url, created_by, created_at, status, sequence_id';
    const live = await supabase
      .from('sequence_enrollments')
      .select(select)
      .eq('organization_id', organizationId)
      .in('status', [...LIVE_CONTACT_STATUSES])
      .or(orFilter)
      .order('created_at', { ascending: false });
    if (live.error) throw live.error;
    pushEnrollments(live.data as EnrollmentRow[] | null);
    const closed = await supabase
      .from('sequence_enrollments')
      .select(select)
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .in('status', [...CLOSED_CONTACT_STATUSES])
      .or(orFilter)
      .order('created_at', { ascending: false });
    if (closed.error) throw closed.error;
    pushEnrollments(closed.data as EnrollmentRow[] | null);
  };
  for (let i = 0; i < values.length; i += QUERY_CHUNK_SIZE) {
    const list = values.slice(i, i + QUERY_CHUNK_SIZE).map(quoteFilterValue).join(',');
    await fetchRows(`profile_id.in.(${list}),provider_id.in.(${list}),resolved_profile_id.in.(${list})`);
  }
  for (let i = 0; i < slugs.length; i += SLUG_CHUNK_SIZE) {
    const patterns = slugs.slice(i, i + SLUG_CHUNK_SIZE)
      .map(slug => `profile_url.ilike.${quoteFilterValue(`*/in/${slug}*`)}`)
      .join(',');
    await fetchRows(patterns);
  }
  // InMails groupés de l'organisation (programmés, en cours ou envoyés) :
  // deux InMails groupés successifs, ou un InMail puis une séquence, se voient.
  for (let i = 0; i < values.length; i += QUERY_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from('inmail_queue')
      .select('recipient_profile_id, created_by, created_at, status')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .in('status', [...INMAIL_CONTACT_STATUSES])
      .in('recipient_profile_id', values.slice(i, i + QUERY_CHUNK_SIZE))
      .order('created_at', { ascending: false });
    if (error) throw error;
    for (const row of (data ?? []) as InMailRow[]) {
      rows.push({
        matchValues: [row.recipient_profile_id],
        createdBy: row.created_by,
        createdAt: row.created_at,
        status: row.status,
        sequenceId: null,
        source: 'inmail',
      });
    }
  }

  // Lignes triées par lot : on garde la plus récente par profil. Le motif
  // ilike est large (/in/jean* couvre /in/jean-dupont) : le rapprochement
  // ci-dessous ne retient que les clés exactes.
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  for (const row of rows) {
    const rowKeys = new Set<string>();
    for (const value of row.matchValues) {
      const key = normalizeEnrollmentKey(value);
      if (key) rowKeys.add(key);
      if (value) {
        const slug = extractLinkedInSlug(value);
        if (slug) rowKeys.add(slug);
      }
    }
    for (const key of rowKeys) {
      for (const profileId of keyIndex.get(key) ?? []) {
        if (result.has(profileId)) continue;
        result.set(profileId, {
          createdBy: row.createdBy,
          createdByFirstName: null,
          createdAt: row.createdAt,
          sequenceId: row.sequenceId,
          status: row.status,
          source: row.source,
        });
      }
    }
  }
  if (result.size === 0) return result;

  // Prénom du membre à l'origine du contact (profiles.display_name).
  const userIds = Array.from(
    new Set(Array.from(result.values()).map(e => e.createdBy).filter((id): id is string => !!id)),
  );
  if (userIds.length > 0) {
    const { data: members, error } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', userIds);
    if (error) {
      console.warn('[enrollmentDuplicates] profiles lookup failed:', error);
    } else {
      const names = new Map((members ?? []).map(m => [m.user_id, firstNameOf(m.display_name)]));
      for (const entry of result.values()) {
        if (entry.createdBy) entry.createdByFirstName = names.get(entry.createdBy) ?? null;
      }
    }
  }

  return result;
}

/** « Déjà contacté par {prénom} le {date} » (« par InMail » pour un InMail groupé). */
export function formatRecentContactLabel(entry: RecentEnrollment): string {
  const who = entry.createdByFirstName || "un membre de l'équipe";
  const date = new Date(entry.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `Déjà contacté par ${who} le ${date}${entry.source === 'inmail' ? ' par InMail' : ''}`;
}
