/**
 * Arrêt des envois d'un compte LinkedIn dans une organisation.
 *
 * Partagé par unipile-accounts (« Dissocier », changement de compte d'un
 * membre, retrait d'un membre de l'équipe) et unipile-webhook (nouvelle
 * connexion hosted_auth qui remplace le compte relié d'un membre). Sans cet
 * arrêt, le moteur continuait d'envoyer depuis un compte que plus personne
 * n'avait relié : process-sequences et process-inmail-queue ne contrôlent
 * l'état d'un compte que s'il est relié (audit séquences 2026-09-25, SEQ-041,
 * SEQ-042).
 *
 * Étapes, toutes idempotentes (relancer après un échec partiel termine le
 * travail) :
 *   a. inscriptions actives du compte (compte d'inscription ou compte de
 *      rotation) : pause manuelle ;
 *   b. inscriptions en pause automatique : passées en pause manuelle, sinon
 *      les reprises automatiques (reconnexion du compte, abonnement souscrit)
 *      les réactiveraient sans regarder la liaison ;
 *   c. InMails programmés depuis ce compte : annulés ;
 *   d. rotation multi-expéditeurs : le compte sort des pools des séquences de
 *      l'organisation.
 *
 * Les exécutions en attente des inscriptions mises en pause ne sont PAS
 * touchées (contrat des lots, sémantique de la pause) : le moteur ignore les
 * exécutions d'une inscription qui n'est pas active, et la reprise
 * (process-sequences, action resume_enrollments) les garde avec leur date,
 * après avoir vérifié que le compte d'envoi est de nouveau relié.
 *
 * Toute erreur lève LinkedInSendingStopError : l'appelant ne retire jamais
 * la liaison (ni ne la remplace) tant que l'arrêt n'a pas réussi.
 */

// Type seul (aucun import à l'exécution) : le client non typé des appelants
// (unipile-accounts, unipile-webhook) s'y assigne sans conversion.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";

export interface LinkedInSendingStopResult {
  /** Inscriptions actives passées en pause par cet appel. */
  pausedEnrollments: number;
  /** Inscriptions en pause automatique passées en pause manuelle. */
  relabeledEnrollments: number;
  /** InMails programmés annulés. */
  cancelledInmails: number;
}

export class LinkedInSendingStopError extends Error {
  step: string;
  constructor(step: string, cause: unknown) {
    super(`Arrêt des envois impossible (${step})`);
    this.step = step;
    this.cause = cause;
  }
}

/** Pauses posées par le moteur ou la facturation, reprises sans action de l'utilisateur. */
export const AUTO_RESUMED_PAUSE_REASONS = ['account_disconnected', 'subscription_required', 'quota_reached'];

// 22P02 (valeur invalide pour le type) : sequence_enrollments.assigned_sender_id
// est encore une colonne uuid tant que la migration de SEQ-013 n'est pas en
// base ; un identifiant de compte (texte) y lève cette erreur. Aucune ligne ne
// peut alors porter ce compte : il n'y a rien à arrêter par ce chemin.
const UUID_COLUMN_ERROR = '22P02';

function isUuidColumnError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UUID_COLUMN_ERROR;
}

type SenderColumn = 'account_id' | 'assigned_sender_id';
const SENDER_COLUMNS: SenderColumn[] = ['account_id', 'assigned_sender_id'];

export async function stopLinkedInAccountSending(
  admin: SupabaseClient,
  input: { organizationId: string; accountId: string },
): Promise<LinkedInSendingStopResult> {
  const { organizationId, accountId } = input;
  if (!organizationId || !accountId) throw new LinkedInSendingStopError('paramètres', null);
  const nowIso = new Date().toISOString();

  // a. Inscriptions actives : pause manuelle.
  const pausedIds = new Set<string>();
  for (const column of SENDER_COLUMNS) {
    const { data, error } = await admin
      .from('sequence_enrollments')
      .update({ status: 'paused', pause_reason: 'manual', updated_at: nowIso })
      .eq('organization_id', organizationId)
      .eq(column, accountId)
      .eq('status', 'active')
      .select('id');
    if (error) {
      if (column === 'assigned_sender_id' && isUuidColumnError(error)) continue;
      console.error(`[linkedin-sending-stop] pause by ${column} failed:`, error);
      throw new LinkedInSendingStopError('mise en pause', error);
    }
    for (const row of (data ?? []) as Array<{ id: string }>) pausedIds.add(row.id);
  }

  // b. Pauses automatiques : passées en pause manuelle.
  const relabeledIds = new Set<string>();
  for (const column of SENDER_COLUMNS) {
    const { data, error } = await admin
      .from('sequence_enrollments')
      .update({ pause_reason: 'manual', updated_at: nowIso })
      .eq('organization_id', organizationId)
      .eq(column, accountId)
      .eq('status', 'paused')
      .in('pause_reason', AUTO_RESUMED_PAUSE_REASONS)
      .select('id');
    if (error) {
      if (column === 'assigned_sender_id' && isUuidColumnError(error)) continue;
      console.error(`[linkedin-sending-stop] relabel by ${column} failed:`, error);
      throw new LinkedInSendingStopError('pause manuelle', error);
    }
    for (const row of (data ?? []) as Array<{ id: string }>) relabeledIds.add(row.id);
  }

  // c. InMails programmés depuis ce compte. Les lignes mises en file sans
  //    organisation (avant que process-inmail-queue n'écrive organization_id)
  //    sont prises aussi : un compte n'est relié qu'à une organisation (refus
  //    42501 au rattachement), et une ligne d'un ancien membre partirait
  //    sinon du compte arrêté.
  const inmailScope = `organization_id.eq.${organizationId},organization_id.is.null`;
  const { data: cancelledInmails, error: inmailError } = await admin
    .from('inmail_queue')
    .update({ status: 'cancelled', error_message: 'Compte LinkedIn dissocié', updated_at: nowIso })
    .or(inmailScope)
    .eq('account_id', accountId)
    .in('status', ['pending', 'scheduled'])
    .select('id');
  if (inmailError) {
    console.error('[linkedin-sending-stop] inmail cancel failed:', inmailError);
    throw new LinkedInSendingStopError('InMails programmés', inmailError);
  }

  // d. Rotation multi-expéditeurs : le compte sort des pools
  //    (outreach_sequences.sender_accounts) des séquences de l'organisation,
  //    sinon pickSenderForRotation continue de le choisir. contains() reçoit
  //    du JSON en texte : un tableau JS y produirait la syntaxe des tableaux
  //    Postgres, pas du jsonb.
  const { data: rotations, error: rotationReadError } = await admin
    .from('outreach_sequences')
    .select('id, sender_accounts')
    .eq('organization_id', organizationId)
    .contains('sender_accounts', JSON.stringify([{ account_id: accountId }]));
  if (rotationReadError) {
    console.error('[linkedin-sending-stop] rotation read failed:', rotationReadError);
    throw new LinkedInSendingStopError('rotation', rotationReadError);
  }
  for (const seq of (rotations ?? []) as Array<{ id: string; sender_accounts: unknown }>) {
    if (!Array.isArray(seq.sender_accounts)) continue;
    const remaining = (seq.sender_accounts as Array<{ account_id?: unknown } | null>)
      .filter((s) => s?.account_id !== accountId);
    if (remaining.length === seq.sender_accounts.length) continue;
    const patch: Record<string, unknown> = { sender_accounts: remaining, updated_at: nowIso };
    // Pool vide : la rotation est coupée, l'envoi retombe sur le compte de l'inscription.
    if (remaining.length === 0) patch.multi_sender_enabled = false;
    const { error: rotationError } = await admin
      .from('outreach_sequences')
      .update(patch)
      .eq('id', seq.id)
      .eq('organization_id', organizationId);
    if (rotationError) {
      console.error('[linkedin-sending-stop] rotation update failed:', rotationError);
      throw new LinkedInSendingStopError('rotation', rotationError);
    }
  }

  return {
    pausedEnrollments: pausedIds.size,
    relabeledEnrollments: relabeledIds.size,
    cancelledInmails: (cancelledInmails ?? []).length,
  };
}
