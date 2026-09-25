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

/**
 * Expéditeur d'une inscription : titulaire du compte d'envoi, sinon le repli
 * fourni, sinon l'auteur de l'inscription.
 */
export async function resolveSequenceSenderUserId(
  client: SupabaseLikeClient,
  enrollment: SenderEnrollment,
  step?: { sender_id?: unknown } | null,
  fallbackUserId?: string | null,
): Promise<string | null> {
  const owner = await resolveSendingAccountOwner(client, enrollment, step);
  if (owner) return owner;
  if (fallbackUserId) return fallbackUserId;
  return typeof enrollment.created_by === 'string' && enrollment.created_by ? enrollment.created_by : null;
}
