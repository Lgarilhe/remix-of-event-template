/**
 * Réponse d'un candidat : arrêt, dans son organisation, de tout ce qui peut
 * encore lui écrire (SEQ-212 : aucune relance après une réponse, quel que
 * soit le compte qui l'a reçue). Partagé par les deux chemins de réponse de
 * unipile-webhook (message LinkedIn, e-mail).
 *
 * - Autres inscriptions vivantes (actives ou en pause) du candidat : statut
 *   'stopped' (pas 'replied' : la réponse est comptée sur l'inscription qui
 *   l'a reçue), étapes en attente annulées, jamais 'sending'.
 * - InMails pas encore partis vers le candidat : 'cancelled', motif lisible,
 *   jamais 'sending' ni 'sent'.
 *
 * Identité du candidat : identifiants LinkedIn (classique « ACo… », Recruiter
 * « AE… », URN) dans profile_id, resolved_profile_id ou provider_id, et slug
 * public de profile_url comparé exactement (même identité que l'anti-doublon,
 * src/lib/enrollmentDuplicates.ts). Jamais d'écriture hors de l'organisation
 * donnée (SEQ-006).
 *
 * Les écritures lèvent en cas d'erreur : l'appelant répond 500 et le
 * prestataire rejoue l'événement (SEQ-040). Tout est idempotent (seules les
 * lignes encore ouvertes ou en attente sont touchées).
 *
 *   deno test --no-check supabase/functions/_shared/candidate-reply-closure.test.ts
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";
import { SIBLING_REPLY_SKIP_REASON, type SiblingStopScope } from "./sequence-engine-rules.ts";

const OPEN_ENROLLMENT_STATUSES = ['active', 'paused'];
const PENDING_EXECUTION_STATUSES = ['scheduled', 'waiting_event', 'quota_blocked'];
const PENDING_INMAIL_STATUSES = ['pending', 'scheduled'];

/** Motif des InMails annulés parce que le candidat a répondu. */
export const REPLY_INMAIL_CANCEL_REASON = 'Le candidat a répondu';

/** Identifiants LinkedIn assainis pour un filtre PostgREST (ni virgule, ni parenthèse, ni guillemet), sans doublon. */
export function candidateIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.replace(/[^a-zA-Z0-9_\-:]/g, ''))
    .filter((v) => v.length > 0))];
}

/** Slug public d'une URL de profil LinkedIn (/in/{slug}), en minuscules. */
export function linkedInSlugOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/** Slugs du candidat, depuis des URLs de profil ou des identifiants publics bruts, en minuscules, sans doublon. */
export function candidateSlugs(values: Array<string | null | undefined>): string[] {
  const slugs = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const raw = value.trim();
    const slug = /linkedin\.com\/in\//i.test(raw) ? linkedInSlugOf(raw) : (/^[^/?#\s]+$/.test(raw) ? raw.toLowerCase() : null);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

/** Ce à quoi le message du candidat se rattache sur le compte qui le reçoit. */
export interface ReplyAnchor {
  /** Contact encore ouvert à l'arrivée du message (inscription active ou en pause, InMail envoyé). */
  live: boolean;
  /** Fin du contact déjà clos (date de réponse ou de fin). */
  endedAt?: string | null;
}

/**
 * Portée de l'arrêt dans une organisation (contrat §8, comme « Marquer comme
 * répondu ») : un contact ouvert à l'arrivée du message → tout ; seulement
 * des contacts déjà clos (inscription terminée ou déjà « répondu », InMail
 * déjà « répondu », rejeu d'un premier passage en échec) → ce qui a été créé
 * avant la dernière de ces clôtures, jamais une prise de contact démarrée
 * ensuite par un collègue ; aucune date lisible → rien.
 */
export function replySiblingScope(anchors: ReplyAnchor[]): SiblingStopScope {
  if (anchors.some((a) => a.live)) return { kind: 'all' };
  let latest = NaN;
  for (const anchor of anchors) {
    const endedAt = anchor.endedAt ? Date.parse(anchor.endedAt) : NaN;
    if (Number.isFinite(endedAt) && (!Number.isFinite(latest) || endedAt > latest)) latest = endedAt;
  }
  if (!Number.isFinite(latest)) return { kind: 'none' };
  return { kind: 'created_before', before: new Date(latest).toISOString() };
}

/**
 * Arrête les autres inscriptions actives ou en pause du candidat dans
 * l'organisation, hors `alreadyClosed`, et annule leurs étapes en attente.
 * Renvoie le nombre d'inscriptions arrêtées.
 */
export async function closeSiblingEnrollments(
  supabase: SupabaseClient,
  organizationId: string | null | undefined,
  identity: { ids: Array<string | null | undefined>; slugs?: Array<string | null | undefined> },
  alreadyClosed: ReadonlySet<string>,
  scope: SiblingStopScope = { kind: 'all' },
): Promise<number> {
  if (!organizationId || scope.kind === 'none') return 0;
  const ids = candidateIds(identity.ids);
  const slugs = candidateSlugs(identity.slugs ?? []);
  if (ids.length === 0 && slugs.length === 0) return 0;

  const openSiblings = () => {
    let query = supabase
      .from('sequence_enrollments')
      .select('id, profile_url')
      .eq('organization_id', organizationId)
      .in('status', OPEN_ENROLLMENT_STATUSES);
    if (scope.kind === 'created_before') query = query.lt('created_at', scope.before);
    return query;
  };
  const targets = new Set<string>();
  if (ids.length > 0) {
    const list = ids.join(',');
    const { data, error } = await openSiblings()
      .or(`profile_id.in.(${list}),resolved_profile_id.in.(${list}),provider_id.in.(${list})`);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string }>) targets.add(row.id);
  }
  for (const slug of slugs) {
    const { data, error } = await openSiblings().ilike('profile_url', `%/in/${slug.replace(/([%_\\])/g, '\\$1')}%`);
    if (error) throw error;
    // Slug exact (le motif accepte « marie-martin-4b2a1 » pour « marie-martin »).
    for (const row of (data ?? []) as Array<{ id: string; profile_url: string | null }>) {
      if (linkedInSlugOf(row.profile_url) === slug) targets.add(row.id);
    }
  }
  for (const id of alreadyClosed) targets.delete(id);
  if (targets.size === 0) return 0;

  const nowIso = new Date().toISOString();
  const { data: stopped, error: stopError } = await supabase
    .from('sequence_enrollments')
    .update({ status: 'stopped', pause_reason: null, completed_at: nowIso, updated_at: nowIso })
    .in('id', [...targets])
    .in('status', OPEN_ENROLLMENT_STATUSES)
    .select('id');
  if (stopError) throw stopError;
  const stoppedIds = ((stopped ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (stoppedIds.length > 0) {
    const { error: cancelError } = await supabase
      .from('sequence_step_executions')
      .update({ status: 'cancelled', skip_reason: SIBLING_REPLY_SKIP_REASON, updated_at: nowIso })
      .in('enrollment_id', stoppedIds)
      .in('status', PENDING_EXECUTION_STATUSES);
    if (cancelError) throw cancelError;
    console.log(`[candidate-reply-closure] ${stoppedIds.length} sibling enrollment(s) stopped in org ${organizationId}`);
  }
  return stoppedIds.length;
}

/**
 * Annule les InMails programmés ou en attente vers le candidat : ceux de
 * l'organisation, depuis n'importe lequel de ses comptes (bornés par
 * `scope`), ou ceux du compte qui vient de recevoir son message. Renvoie le
 * nombre d'InMails annulés.
 */
export async function cancelScheduledInMails(
  supabase: SupabaseClient,
  target: { organizationId: string } | { accountId: string },
  identifiers: Array<string | null | undefined>,
  scope: SiblingStopScope = { kind: 'all' },
): Promise<number> {
  if (scope.kind === 'none') return 0;
  const ids = candidateIds(identifiers);
  if (ids.length === 0) return 0;
  let query = supabase
    .from('inmail_queue')
    .update({ status: 'cancelled', error_message: REPLY_INMAIL_CANCEL_REASON, updated_at: new Date().toISOString() })
    .in('status', PENDING_INMAIL_STATUSES)
    .in('recipient_profile_id', ids);
  query = 'organizationId' in target
    ? query.eq('organization_id', target.organizationId)
    : query.eq('account_id', target.accountId);
  if (scope.kind === 'created_before') query = query.lt('created_at', scope.before);
  const { data, error } = await query.select('id');
  if (error) throw error;
  const cancelled = (data ?? []).length;
  if (cancelled > 0) console.log(`[candidate-reply-closure] ${cancelled} scheduled InMail(s) cancelled after a reply`);
  return cancelled;
}
