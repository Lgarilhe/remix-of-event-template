/**
 * enrollmentDuplicates : anti-doublon d'inscription en séquence
 * (lot P0-D, docs/p0-plan-2026-09-06.md, section 2).
 *
 * Un candidat contacté par un membre de l'organisation dans les 90 derniers
 * jours (sequence_enrollments de l'organisation, statuts active, paused,
 * replied, completed, toute séquence, tout compte) est signalé
 * « Déjà contacté par {prénom} le {date} » et exclu par défaut de
 * l'inscription. La dérogation « Inscrire quand même » est réservée aux
 * propriétaires et administrateurs (useOrganization().isAdmin).
 *
 * Clé de rapprochement : profile_id normalisé (identifiant LinkedIn ou URL
 * canonique en minuscules sans barre finale), repli sur provider_id. Le même
 * rapprochement est appliqué côté serveur par l'outil agent
 * enroll_in_sequence (_shared/agent-tools-mutations.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { LinkedInProfile } from '@/components/outreach/types';
import { extractLinkedInSlug } from '@/lib/linkedinUtils';

export const RECENT_CONTACT_WINDOW_DAYS = 90;
export const RECENT_CONTACT_STATUSES = ['active', 'paused', 'replied', 'completed'] as const;

/** Taille des lots de clés passées au filtre `in.()` (longueur d'URL bornée). */
const QUERY_CHUNK_SIZE = 40;

export interface RecentEnrollment {
  /** user_id du membre qui a inscrit le candidat (created_by), null si inconnu. */
  createdBy: string | null;
  /** Prénom résolu depuis profiles.display_name, null si non lisible. */
  createdByFirstName: string | null;
  createdAt: string;
  sequenceId: string;
  status: string;
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
 * Cherche, pour chaque profil, la dernière inscription en séquence faite par
 * l'organisation dans les 90 derniers jours. Renvoie une Map indexée par
 * `profile.id` (les profils absents n'ont pas de contact récent).
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
  const since = new Date(Date.now() - RECENT_CONTACT_WINDOW_DAYS * 86_400_000).toISOString();

  type Row = Pick<
    Database['public']['Tables']['sequence_enrollments']['Row'],
    'profile_id' | 'provider_id' | 'created_by' | 'created_at' | 'status' | 'sequence_id'
  >;
  const rows: Row[] = [];
  for (let i = 0; i < values.length; i += QUERY_CHUNK_SIZE) {
    const list = values.slice(i, i + QUERY_CHUNK_SIZE).map(quoteFilterValue).join(',');
    const { data, error } = await supabase
      .from('sequence_enrollments')
      .select('profile_id, provider_id, created_by, created_at, status, sequence_id')
      .eq('organization_id', organizationId)
      .gte('created_at', since)
      .in('status', [...RECENT_CONTACT_STATUSES])
      .or(`profile_id.in.(${list}),provider_id.in.(${list})`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    rows.push(...((data ?? []) as Row[]));
  }

  // Lignes triées par lot : on garde la plus récente par profil.
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  for (const row of rows) {
    const rowKeys = new Set<string>();
    for (const value of [row.profile_id, row.provider_id]) {
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
          createdBy: row.created_by,
          createdByFirstName: null,
          createdAt: row.created_at,
          sequenceId: row.sequence_id,
          status: row.status,
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

/** « Déjà contacté par {prénom} le {date} ». */
export function formatRecentContactLabel(entry: RecentEnrollment): string {
  const who = entry.createdByFirstName || "un membre de l'équipe";
  const date = new Date(entry.createdAt).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return `Déjà contacté par ${who} le ${date}`;
}
