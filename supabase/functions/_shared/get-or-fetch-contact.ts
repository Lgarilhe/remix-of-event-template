/**
 * get-or-fetch-contact — Lookup en cascade pour récupérer email/phone
 * d'un candidat AVANT de lancer un enrichment payant Better Contact.
 *
 * Stratégie en 6 niveaux (du plus gratuit au plus cher) :
 *
 *   1. Check RGPD : si dans gdpr_erasures → STOP (refuse, pas le droit)
 *   2. LinkedInProfile.contact_info passé en input (Unipile direct, $0)
 *   3. candidate_enrichments cache (org-wide, TTL 30j, $0 si hit)
 *   4. job_candidate_status.linkedin_profile_data.contact_info ($0)
 *   5. airtable_candidates.email/phone si match linkedin_url ($0)
 *   6. → bc_pending : caller doit déclencher BC enrichment payant
 *
 * Notion lookup pas inclus (pas de table miroir SQL des Notion candidates,
 * il faudrait un fetch live API → coûteux en latence). À ajouter en V2 si
 * besoin.
 *
 * Usage côté edge function :
 *
 *   import { getOrFetchContact, normalizeLinkedInUrl } from '../_shared/get-or-fetch-contact.ts';
 *
 *   const result = await getOrFetchContact(serviceClient, {
 *     organizationId: orgId,
 *     linkedinUrl: profile.profile_url,
 *     contactInfoFromProfile: profile.contact_info,
 *   });
 *
 *   if (result.email || result.phone) {
 *     // Source gratuite — utiliser direct
 *     // result.source === 'cache' | 'unipile' | 'job_status' | 'airtable'
 *   } else if (result.gdprBlocked) {
 *     // Refuser : candidat a demandé son effacement
 *   } else {
 *     // bc_pending → trigger enrich-candidate-contact (payant)
 *   }
 */

// Type seul (aucun import à l'exécution) : le client non typé des appelants s'y assigne.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContactInput {
  organizationId: string;
  /** linkedin_url canonique (sera normalisé) */
  linkedinUrl: string | null | undefined;
  /** Si l'appelant a déjà un LinkedInProfile en mémoire, passe son contact_info */
  contactInfoFromProfile?: {
    emails?: string[] | null;
    phones?: string[] | null;
  };
  /** Si on connaît déjà un email/phone (input manuel par ex), on skip enrich */
  knownEmail?: string | null;
  knownPhone?: string | null;
}

export type ContactSource =
  | 'unipile'         // contact_info passé en input
  | 'cache'           // candidate_enrichments
  | 'job_status'      // job_candidate_status.linkedin_profile_data
  | 'airtable'        // airtable_candidates
  | 'manual'          // knownEmail/knownPhone passés en input
  | 'bc_pending'      // rien trouvé, BC nécessaire (caller décide)
  | 'gdpr_blocked';   // refusé pour cause RGPD

export interface ContactResult {
  email: string | null;
  phone: string | null;
  /** D'où vient la donnée (audit + UI) */
  source: ContactSource;
  /** True si candidat dans gdpr_erasures — caller doit refuser tout enrichment */
  gdprBlocked: boolean;
  /** Si source='cache', on retourne aussi le provider qui a fourni la donnée originale */
  providerSource?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Normalise linkedin_url pour matching (lowercase, sans trailing /, sans query/hash) */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return String(url)
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
    .trim() || null;
}

/** Normalise email pour matching (lowercased + trimmed) */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const cleaned = String(email).toLowerCase().trim();
  return /\S+@\S+\.\S+/.test(cleaned) ? cleaned : null;
}

/** Hash SHA-256 hex d'une chaîne (pour gdpr_erasures lookup) */
export async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Main lookup function ────────────────────────────────────────────────────

/**
 * Cascade lookup pour récupérer email/phone sans appel BC payant.
 * Si rien trouvé → caller décide de déclencher l'enrichment payant.
 */
export async function getOrFetchContact(
  supabase: SupabaseClient,
  input: ContactInput,
): Promise<ContactResult> {
  const normalizedUrl = normalizeLinkedInUrl(input.linkedinUrl);

  // ── 0. Manual override : si email/phone passés en input, on retourne direct
  if (input.knownEmail || input.knownPhone) {
    const email = normalizeEmail(input.knownEmail);
    const phone = input.knownPhone || null;
    // Vérifier RGPD avant tout
    if (email) {
      const blocked = await isGdprBlocked(supabase, { email, linkedinUrl: normalizedUrl });
      if (blocked) return { email: null, phone: null, source: 'gdpr_blocked', gdprBlocked: true };
    }
    return { email, phone, source: 'manual', gdprBlocked: false };
  }

  // ── 1. RGPD check (avant TOUT, même les sources gratuites) ──
  if (normalizedUrl) {
    const blocked = await isGdprBlocked(supabase, { linkedinUrl: normalizedUrl });
    if (blocked) {
      console.log(`[get-or-fetch-contact] GDPR blocked for ${normalizedUrl}`);
      return { email: null, phone: null, source: 'gdpr_blocked', gdprBlocked: true };
    }
  }

  // ── 2. LinkedInProfile.contact_info passé en input (Unipile direct) ──
  const unipileEmail = normalizeEmail(input.contactInfoFromProfile?.emails?.[0]);
  const unipilePhone = input.contactInfoFromProfile?.phones?.[0] || null;
  if (unipileEmail || unipilePhone) {
    return {
      email: unipileEmail,
      phone: unipilePhone,
      source: 'unipile',
      gdprBlocked: false,
    };
  }

  if (!normalizedUrl) {
    return { email: null, phone: null, source: 'bc_pending', gdprBlocked: false };
  }

  // ── 3. candidate_enrichments cache (org-wide, TTL 30j) ──
  // Plusieurs enrichissements terminés peuvent exister pour une même URL :
  // le plus récent gagne (maybeSingle échouait et sautait le cache). Une
  // adresse déclarée non délivrable n'est jamais renvoyée (le moteur l'écrirait
  // sur l'inscription et l'étape e-mail partirait vers une adresse morte).
  try {
    const { data: cachedRows } = await supabase
      .from('candidate_enrichments')
      .select('contact_email, contact_email_status, contact_phone, email_provider_source, phone_provider_source, status, expires_at')
      .eq('organization_id', input.organizationId)
      .eq('linkedin_url', normalizedUrl)
      .eq('status', 'terminated')
      .gt('expires_at', new Date().toISOString())
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(1);
    const cached = cachedRows?.[0];
    const cachedEmail = cached && cached.contact_email_status !== 'undeliverable'
      ? normalizeEmail(cached.contact_email)
      : null;

    if (cached && (cachedEmail || cached.contact_phone)) {
      return {
        email: cachedEmail,
        phone: cached.contact_phone || null,
        source: 'cache',
        providerSource: cached.email_provider_source || cached.phone_provider_source || null,
        gdprBlocked: false,
      };
    }
  } catch (e) {
    // Table peut ne pas exister (migration pas appliquée) — on continue
    console.warn('[get-or-fetch-contact] cache lookup error:', e);
  }

  // ── 4. job_candidate_status.linkedin_profile_data ──
  // Stocke un snapshot du LinkedInProfile complet incluant contact_info
  try {
    const { data: rows } = await supabase
      .from('job_candidate_status')
      .select('linkedin_profile_data')
      .eq('organization_id', input.organizationId)
      .eq('linkedin_profile_url', normalizedUrl)
      .limit(1);

    const profileData = rows?.[0]?.linkedin_profile_data as any;
    const jcsEmail = normalizeEmail(profileData?.contact_info?.emails?.[0]);
    const jcsPhone = profileData?.contact_info?.phones?.[0] || null;
    if (jcsEmail || jcsPhone) {
      return {
        email: jcsEmail,
        phone: jcsPhone,
        source: 'job_status',
        gdprBlocked: false,
      };
    }
  } catch (e) {
    console.warn('[get-or-fetch-contact] job_status lookup error:', e);
  }

  // ── 5. airtable_candidates (sync ATS Airtable) ──
  try {
    const { data: airtableRows } = await supabase
      .from('airtable_candidates')
      .select('email, phone')
      .eq('organization_id', input.organizationId)
      .eq('linkedin_url', input.linkedinUrl)  // unnormalized — Airtable stocke souvent avec variants
      .limit(1);

    const atRow = airtableRows?.[0];
    const atEmail = normalizeEmail(atRow?.email);
    const atPhone = atRow?.phone || null;
    if (atEmail || atPhone) {
      return {
        email: atEmail,
        phone: atPhone,
        source: 'airtable',
        gdprBlocked: false,
      };
    }
  } catch (e) {
    console.warn('[get-or-fetch-contact] airtable lookup error:', e);
  }

  // ── 6. → bc_pending : rien trouvé en sources gratuites
  return {
    email: null,
    phone: null,
    source: 'bc_pending',
    gdprBlocked: false,
  };
}

// ─── RGPD helpers ─────────────────────────────────────────────────────────────

/** Vérifie si un candidat est dans gdpr_erasures (par email ou linkedin_url) */
export async function isGdprBlocked(
  supabase: SupabaseClient,
  input: { email?: string | null; linkedinUrl?: string | null },
): Promise<boolean> {
  const hashes: string[] = [];
  const emailNorm = normalizeEmail(input.email);
  const urlNorm = normalizeLinkedInUrl(input.linkedinUrl);

  if (emailNorm) hashes.push(await sha256Hex(emailNorm));
  if (urlNorm) hashes.push(await sha256Hex(urlNorm));

  if (hashes.length === 0) return false;

  try {
    const { data } = await supabase
      .from('gdpr_erasures')
      .select('id')
      .or(
        hashes.map(h => `email_hash.eq.${h},linkedin_url_hash.eq.${h}`).join(',')
      )
      .limit(1);

    return Array.isArray(data) && data.length > 0;
  } catch (e) {
    console.warn('[isGdprBlocked] check failed (table may not exist):', e);
    return false; // Fail open : si la table n'existe pas, on laisse passer
  }
}

/** Slug public d'une URL de profil LinkedIn (/in/{slug}), en minuscules. */
export function linkedInProfileSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = String(url).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  const slug = match?.[1]?.trim().toLowerCase() ?? '';
  return slug.length >= 3 ? slug : null;
}

/** Échappe les jokers SQL d'un motif ilike (correspondance exacte, insensible à la casse). */
export function escapeLikePattern(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

const PENDING_EXECUTION_STATUSES = ['scheduled', 'waiting_event', 'quota_blocked'];
export const GDPR_ERASURE_SKIP_REASON = 'Effacement des données demandé : séquence arrêtée';

export interface GdprErasureResult {
  success: boolean;
  error?: string;
  /** Inscriptions actives ou en pause passées en 'stopped'. */
  stoppedEnrollments: number;
  /** Inscriptions (tous statuts) dont les données du candidat ont été effacées. */
  anonymizedEnrollments: number;
  cancelledInmails: number;
  /** Adresse ajoutée à la liste de suppression des envois e-mail. */
  emailSuppressed: boolean;
}

/**
 * Effacement RGPD d'un candidat (email et/ou URL LinkedIn).
 *
 * `organizationId` fixe le périmètre (SEQ-055) :
 *   - une organisation : effacement demandé par un propriétaire ou un
 *     administrateur de cette organisation, limité à ses données. Pas de ligne
 *     gdpr_erasures (blocage global) depuis ce chemin ;
 *   - null : effacement global, réservé aux administrateurs plateforme (ligne
 *     gdpr_erasures, toutes organisations).
 *
 * Dans ce périmètre (SEQ-054) : les inscriptions actives ou en pause du
 * candidat passent en 'stopped' et leurs exécutions en attente sont annulées,
 * ses InMails programmés sont annulés, l'adresse rejoint suppressed_emails
 * (reason 'unsubscribe'), puis nom, titre, adresse, téléphone et textes
 * envoyés sont effacés des lignes de séquence. Le succès n'est renvoyé
 * qu'une fois toutes ces écritures faites ; chaque étape est rejouable.
 */
export async function recordGdprErasure(
  supabase: SupabaseClient,
  input: {
    email?: string | null;
    linkedinUrl?: string | null;
    reason?: string;
    source?: string;
    notes?: string;
    organizationId: string | null;
  },
): Promise<GdprErasureResult> {
  const result: GdprErasureResult = {
    success: false,
    stoppedEnrollments: 0,
    anonymizedEnrollments: 0,
    cancelledInmails: 0,
    emailSuppressed: false,
  };
  const fail = (step: string, error: unknown): GdprErasureResult => {
    console.error(`[recordGdprErasure] ${step} failed:`, error);
    return { ...result, success: false, error: `${step}: ${(error as { message?: string } | null)?.message ?? String(error)}` };
  };

  const emailNorm = normalizeEmail(input.email);
  const urlNorm = normalizeLinkedInUrl(input.linkedinUrl);
  const orgId = input.organizationId;

  if (!emailNorm && !urlNorm) {
    return { ...result, error: 'email ou linkedin_url requis' };
  }

  // 1. Blocage global des enrichissements : administrateurs plateforme seulement.
  if (orgId === null) {
    const emailHash = emailNorm ? await sha256Hex(emailNorm) : null;
    const urlHash = urlNorm ? await sha256Hex(urlNorm) : null;
    const { error: insertError } = await supabase
      .from('gdpr_erasures')
      .insert({
        email_hash: emailHash,
        linkedin_url_hash: urlHash,
        reason: input.reason || 'user_request',
        source: input.source || null,
        notes: input.notes || null,
      });
    if (insertError) return fail('gdpr_erasures', insertError);
  }

  // 2. Inscriptions du candidat dans le périmètre : adresse exacte (jokers
  //    échappés) ou URL de profil exacte (slug, avec ou sans « / » final).
  type EnrollmentRow = {
    id: string;
    status: string;
    email_used: string | null;
    profile_id: string | null;
    provider_id: string | null;
    resolved_profile_id: string | null;
  };
  const enrollments = new Map<string, EnrollmentRow>();
  const byEmailIds = new Set<string>();
  const lookups: Array<{ column: string; pattern: string; byEmail: boolean }> = [];
  if (emailNorm) lookups.push({ column: 'email_used', pattern: escapeLikePattern(emailNorm), byEmail: true });
  const slug = linkedInProfileSlug(urlNorm);
  if (slug) {
    const escapedSlug = escapeLikePattern(slug);
    lookups.push({ column: 'profile_url', pattern: `%linkedin.com/in/${escapedSlug}`, byEmail: false });
    lookups.push({ column: 'profile_url', pattern: `%linkedin.com/in/${escapedSlug}/`, byEmail: false });
  } else if (urlNorm) {
    lookups.push({ column: 'profile_url', pattern: escapeLikePattern(urlNorm), byEmail: false });
  }
  for (const lookup of lookups) {
    let query = supabase
      .from('sequence_enrollments')
      .select('id, status, email_used, profile_id, provider_id, resolved_profile_id')
      .ilike(lookup.column, lookup.pattern)
      .limit(500);
    if (orgId) query = query.eq('organization_id', orgId);
    const { data, error } = await query;
    if (error) return fail('lecture des inscriptions', error);
    for (const row of (data ?? []) as EnrollmentRow[]) {
      enrollments.set(row.id, row);
      if (lookup.byEmail) byEmailIds.add(row.id);
    }
  }
  const allIds = [...enrollments.keys()];
  const liveIds = [...enrollments.values()].filter((e) => e.status === 'active' || e.status === 'paused').map((e) => e.id);
  const nowIso = new Date().toISOString();

  // 3. Arrêt définitif des inscriptions en cours.
  for (let i = 0; i < liveIds.length; i += 100) {
    const { data: stopped, error } = await supabase
      .from('sequence_enrollments')
      .update({ status: 'stopped', pause_reason: null, completed_at: nowIso, updated_at: nowIso })
      .in('id', liveIds.slice(i, i + 100))
      .in('status', ['active', 'paused'])
      .select('id');
    if (error) return fail('arrêt des inscriptions', error);
    result.stoppedEnrollments += (stopped ?? []).length;
  }

  // 4. Exécutions : celles en attente sont annulées, et les textes envoyés
  //    ou préparés sont effacés sur toutes.
  for (let i = 0; i < allIds.length; i += 100) {
    const batch = allIds.slice(i, i + 100);
    const { error: cancelError } = await supabase
      .from('sequence_step_executions')
      .update({ status: 'cancelled', skip_reason: GDPR_ERASURE_SKIP_REASON, updated_at: nowIso })
      .in('enrollment_id', batch)
      .in('status', PENDING_EXECUTION_STATUSES);
    if (cancelError) return fail('annulation des étapes', cancelError);
    const { error: scrubError } = await supabase
      .from('sequence_step_executions')
      .update({ final_message: null, final_subject: null, personalized_subject: null, ai_snippet: null, updated_at: nowIso })
      .in('enrollment_id', batch);
    if (scrubError) return fail('effacement des messages', scrubError);
  }

  // 5. InMails programmés au candidat (identifiants LinkedIn connus par ses inscriptions).
  const recipientIds = [...new Set(
    [...enrollments.values()]
      .flatMap((e) => [e.profile_id, e.provider_id, e.resolved_profile_id])
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  )];
  for (let i = 0; i < recipientIds.length; i += 100) {
    let inmailQuery = supabase
      .from('inmail_queue')
      .update({ status: 'cancelled', error_message: 'Effacement des données demandé', updated_at: nowIso })
      .in('recipient_profile_id', recipientIds.slice(i, i + 100))
      .in('status', ['pending', 'scheduled']);
    if (orgId) inmailQuery = inmailQuery.eq('organization_id', orgId);
    const { data: cancelled, error } = await inmailQuery.select('id');
    if (error) return fail('annulation des InMails', error);
    result.cancelledInmails += (cancelled ?? []).length;
  }

  // 6. Plus aucun e-mail vers cette adresse. suppressed_emails est commune à
  //    toutes les organisations : dans le périmètre d'une organisation, on ne
  //    l'écrit que si elle a réellement écrit à cette adresse (une de ses
  //    inscriptions la porte), pour qu'un administrateur ne puisse pas bloquer
  //    une adresse quelconque chez les autres. Une adresse déjà supprimée
  //    (rebond, désabonnement) garde sa raison d'origine.
  if (emailNorm && (orgId === null || byEmailIds.size > 0)) {
    const { error } = await supabase
      .from('suppressed_emails')
      .upsert({ email: emailNorm, reason: 'unsubscribe' }, { onConflict: 'email', ignoreDuplicates: true });
    if (error) return fail('liste de suppression', error);
    result.emailSuppressed = true;
  }

  // 7. Données du candidat retirées des lignes de séquence (l'URL de profil
  //    reste, sans elle un nouvel effacement ne retrouverait plus rien).
  for (let i = 0; i < allIds.length; i += 100) {
    const { data: scrubbed, error } = await supabase
      .from('sequence_enrollments')
      .update({ profile_name: null, profile_headline: null, email_used: null, phone_used: null, updated_at: nowIso })
      .in('id', allIds.slice(i, i + 100))
      .select('id');
    if (error) return fail('anonymisation des inscriptions', error);
    result.anonymizedEnrollments += (scrubbed ?? []).length;
  }

  // 8. Enrichissements (données de contact achetées), dans le périmètre.
  if (urlNorm) {
    let del = supabase.from('candidate_enrichments').delete().eq('linkedin_url', urlNorm);
    if (orgId) del = del.eq('organization_id', orgId);
    const { error } = await del;
    if (error) return fail('suppression des enrichissements (URL)', error);
  }
  if (emailNorm) {
    let del = supabase.from('candidate_enrichments').delete().eq('contact_email', emailNorm);
    if (orgId) del = del.eq('organization_id', orgId);
    const { error } = await del;
    if (error) return fail('suppression des enrichissements (e-mail)', error);
  }

  return { ...result, success: true };
}
