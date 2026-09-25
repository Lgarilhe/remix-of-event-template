// Titulaire du compte d'envoi d'une inscription de séquence.
//
// Audit séquences 2026-09-25, lot E3 (SEQ-013, SEQ-100). L'expéditeur au sens
// « qui signe, quelles variables {{mon_prenom}}, quel contexte IA » est le
// titulaire du compte LinkedIn qui envoie réellement (rotation comprise), pas
// l'auteur de l'inscription. assigned_sender_id porte un identifiant de compte,
// jamais un user_id : le lire comme un user_id vidait le contexte expéditeur.
//
// Utilisé par process-sequences (signature IA), template-interpolation
// (variables expéditeur) et ai-context (contexte IA de l'expéditeur).
//
//   deno test --no-check supabase/functions/_shared/sequence-sender.test.ts

import { pickMailbox, resolveEmailSender } from './sequence-email-policy.mjs';

// Les appelants mélangent les clients `npm:` et `esm.sh` (types internes
// incompatibles) : même convention permissive que ai-context.ts.
// deno-lint-ignore no-explicit-any
type SupabaseLikeClient = any;

export interface SenderEnrollment {
  assigned_sender_id?: unknown;
  account_id?: unknown;
  organization_id?: unknown;
  created_by?: unknown;
  sequence?: { organization_id?: unknown } | null;
  [key: string]: unknown;
}

/** Compte LinkedIn qui envoie : étape, puis rotation, puis compte de l'inscription (même ordre que l'envoi). */
export function sendingAccountId(
  enrollment: SenderEnrollment,
  step?: { sender_id?: unknown } | null,
): string | null {
  const id = step?.sender_id || enrollment.assigned_sender_id || enrollment.account_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function enrollmentOrgId(enrollment: SenderEnrollment): string | null {
  const org = enrollment.organization_id || enrollment.sequence?.organization_id;
  return typeof org === 'string' && org ? org : null;
}

const OWNER_CACHE = new Map<string, { userId: string | null; expiresAt: number }>();
const OWNER_TTL_MS = 5 * 60 * 1000;

/** Vide le cache (tests). */
export function clearSenderCache(): void {
  OWNER_CACHE.clear();
}

/**
 * user_id du titulaire du compte d'envoi dans l'organisation de l'inscription
 * (member_linkedin_accounts), ou null si la liaison est introuvable ou
 * illisible. Une erreur de lecture est journalisée et n'est pas mise en cache.
 */
export async function resolveSendingAccountOwner(
  client: SupabaseLikeClient,
  enrollment: SenderEnrollment,
  step?: { sender_id?: unknown } | null,
): Promise<string | null> {
  const accountId = sendingAccountId(enrollment, step);
  const orgId = enrollmentOrgId(enrollment);
  if (!accountId || !orgId) return null;
  const key = `${orgId}::${accountId}`;
  const cached = OWNER_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;
  try {
    const { data, error } = await client
      .from('member_linkedin_accounts')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('linkedin_account_id', accountId)
      .maybeSingle();
    if (error) {
      console.warn('[sequence-sender] titulaire du compte d\'envoi illisible:', error.message);
      return null;
    }
    const userId = (data as { user_id?: string | null } | null)?.user_id ?? null;
    OWNER_CACHE.set(key, { userId, expiresAt: Date.now() + OWNER_TTL_MS });
    return userId;
  } catch (e) {
    console.warn('[sequence-sender] titulaire du compte d\'envoi illisible:', e);
    return null;
  }
}

// ─── Étape e-mail : boîte d'envoi et titulaire (SEQ-067, SEQ-100) ───────────

/** Étape envoyée par e-mail (canal ou type d'action), comme le moteur la route. */
export function isEmailStep(step?: { action_type?: unknown; step_channel?: unknown } | null): boolean {
  return !!step && (step.action_type === 'email' || step.step_channel === 'email');
}

/** États d'une boîte e-mail qui ne peut plus envoyer tant qu'elle n'est pas reconnectée. */
export const MAILBOX_DISCONNECTED_STATUSES: readonly string[] = ['CREDENTIALS', 'ERROR', 'PERMISSIONS', 'DELETED'];

export function isMailboxDisconnected(status: unknown): boolean {
  return typeof status === 'string' && MAILBOX_DISCONNECTED_STATUSES.includes(status.toUpperCase());
}

export type EmailStepSender =
  | { kind: 'ok'; mailboxId: string; mailboxStatus: string | null; ownerUserId: string | null }
  | { kind: 'not_in_org' }
  | { kind: 'no_mailbox'; ownerUserId: string | null }
  | { kind: 'lookup_failed' };

/**
 * Boîte d'envoi et titulaire d'une étape e-mail, avec EXACTEMENT la règle de
 * sequence-send-email (resolveEmailSender puis pickMailbox de
 * sequence-email-policy.mjs, lignes filtrées par l'organisation de
 * l'inscription) : le moteur contrôle l'état de la boîte que l'envoi
 * utilisera, et signe au nom de son titulaire.
 */
export async function resolveEmailStepSender(
  client: SupabaseLikeClient,
  enrollment: SenderEnrollment,
  step?: { sender_id?: unknown } | null,
): Promise<EmailStepSender> {
  const orgId = enrollmentOrgId(enrollment);
  if (!orgId) return { kind: 'not_in_org' };
  const ids = [...new Set(
    [step?.sender_id, enrollment.assigned_sender_id, enrollment.account_id]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim()),
  )];
  const fallbackUserId = typeof enrollment.created_by === 'string' && enrollment.created_by ? enrollment.created_by : null;
  try {
    let emailAccounts: Array<{ email_account_id: string; user_id: string | null; account_status?: string | null }> = [];
    let linkedinAccounts: Array<{ linkedin_account_id: string; user_id: string | null }> = [];
    if (ids.length > 0) {
      const [emailRes, linkedinRes] = await Promise.all([
        client.from('member_email_accounts').select('email_account_id, user_id, account_status')
          .eq('organization_id', orgId).in('email_account_id', ids),
        client.from('member_linkedin_accounts').select('linkedin_account_id, user_id')
          .eq('organization_id', orgId).in('linkedin_account_id', ids),
      ]);
      if (emailRes.error || linkedinRes.error) {
        console.warn('[sequence-sender] boîte e-mail illisible:', (emailRes.error || linkedinRes.error).message);
        return { kind: 'lookup_failed' };
      }
      emailAccounts = emailRes.data || [];
      linkedinAccounts = linkedinRes.data || [];
    }
    const decision = resolveEmailSender({ candidates: ids, emailAccounts, linkedinAccounts, fallbackUserId });
    if (decision.kind === 'not_in_org') return { kind: 'not_in_org' };
    if (decision.kind === 'mailbox') {
      const row = emailAccounts.find((r) => r.email_account_id === decision.mailboxId);
      return { kind: 'ok', mailboxId: decision.mailboxId, mailboxStatus: row?.account_status ?? null, ownerUserId: decision.ownerUserId };
    }
    if (!decision.ownerUserId) return { kind: 'no_mailbox', ownerUserId: null };
    const { data: rows, error } = await client
      .from('member_email_accounts')
      .select('email_account_id, account_status')
      .eq('organization_id', orgId)
      .eq('user_id', decision.ownerUserId);
    if (error) {
      console.warn('[sequence-sender] boîtes du titulaire illisibles:', error.message);
      return { kind: 'lookup_failed' };
    }
    const ownerRows = (rows || []) as Array<{ email_account_id: string; account_status: string | null }>;
    const mailboxId = pickMailbox(ownerRows);
    if (!mailboxId) return { kind: 'no_mailbox', ownerUserId: decision.ownerUserId };
    const picked = ownerRows.find((r) => r.email_account_id === mailboxId);
    return { kind: 'ok', mailboxId, mailboxStatus: picked?.account_status ?? null, ownerUserId: decision.ownerUserId };
  } catch (e) {
    console.warn('[sequence-sender] boîte e-mail illisible:', e);
    return { kind: 'lookup_failed' };
  }
}

/**
 * Expéditeur d'une inscription : titulaire du compte d'envoi (pour une étape
 * e-mail, titulaire de la boîte que sequence-send-email utilisera), sinon le
 * repli fourni, sinon l'auteur de l'inscription.
 */
export async function resolveSequenceSenderUserId(
  client: SupabaseLikeClient,
  enrollment: SenderEnrollment,
  step?: { sender_id?: unknown; action_type?: unknown; step_channel?: unknown } | null,
  fallbackUserId?: string | null,
): Promise<string | null> {
  if (isEmailStep(step)) {
    const mailbox = await resolveEmailStepSender(client, enrollment, step);
    const mailboxOwner = mailbox.kind === 'ok' || mailbox.kind === 'no_mailbox' ? mailbox.ownerUserId : null;
    if (mailboxOwner) return mailboxOwner;
  }
  const owner = await resolveSendingAccountOwner(client, enrollment, step);
  if (owner) return owner;
  if (fallbackUserId) return fallbackUserId;
  return typeof enrollment.created_by === 'string' && enrollment.created_by ? enrollment.created_by : null;
}
