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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
type SupabaseClient = ReturnType<typeof createClient>;

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
  try {
    const { data: cached } = await supabase
      .from('candidate_enrichments')
      .select('contact_email, contact_phone, email_provider_source, phone_provider_source, status, expires_at')
      .eq('organization_id', input.organizationId)
      .eq('linkedin_url', normalizedUrl)
      .eq('status', 'terminated')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached && (cached.contact_email || cached.contact_phone)) {
      return {
        email: normalizeEmail(cached.contact_email),
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

/** Insert demande d'effacement RGPD + DELETE en cascade */
export async function recordGdprErasure(
  supabase: SupabaseClient,
  input: {
    email?: string | null;
    linkedinUrl?: string | null;
    reason?: string;
    source?: string;
    notes?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  const emailNorm = normalizeEmail(input.email);
  const urlNorm = normalizeLinkedInUrl(input.linkedinUrl);

  if (!emailNorm && !urlNorm) {
    return { success: false, error: 'email ou linkedin_url requis' };
  }

  const emailHash = emailNorm ? await sha256Hex(emailNorm) : null;
  const urlHash = urlNorm ? await sha256Hex(urlNorm) : null;

  // Insert dans gdpr_erasures
  const { error: insertError } = await supabase
    .from('gdpr_erasures')
    .insert({
      email_hash: emailHash,
      linkedin_url_hash: urlHash,
      reason: input.reason || 'user_request',
      source: input.source || null,
      notes: input.notes || null,
    });

  if (insertError) {
    return { success: false, error: insertError.message };
  }

  // DELETE en cascade : candidate_enrichments matchant
  if (urlNorm) {
    await supabase.from('candidate_enrichments').delete().eq('linkedin_url', urlNorm);
  }
  if (emailNorm) {
    await supabase.from('candidate_enrichments').delete().eq('contact_email', emailNorm);
  }

  return { success: true };
}
