// Deno.serve used directly
import { requireOrgAccess } from "../_shared/require-auth.ts";
import { describeForLog, errorKindOf, isUnipileError, userSafeMessage } from "../_shared/unipile/index.ts";
import { corsHeaders, handleDelete, handleList, handleRegister, respond } from "./handlers.ts";

/**
 * Actions réservées pour un lot suivant (journal des livraisons et rejeu d'un
 * événement) : refusées proprement, jamais exécutées ici.
 */
const RESERVED_ACTIONS = new Set(['list_deliveries', 'replay_event']);

/**
 * Mutations sur la clé PLATEFORME du service de connexion (commune à toutes les
 * organisations) : réservées aux user ids listés dans le secret
 * KONEKT_PLATFORM_ADMIN_USER_IDS (séparés par des virgules) quand il est défini.
 * Sans ce secret, owner/admin de l'org suffit (comportement historique) ; le
 * poser est recommandé (SEC-031).
 */
function platformAdminDenied(userId: string): Response | null {
  const raw = Deno.env.get('KONEKT_PLATFORM_ADMIN_USER_IDS') ?? '';
  const allow = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (allow.length === 0 || allow.includes(userId)) return null;
  return respond({ success: false, error: 'Action réservée aux administrateurs de la plateforme' }, 403);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as { action?: string }).action;

    // AUTH + org membership: this endpoint MANAGES the notification endpoint of
    // the platform (it is NOT a webhook receiver).
    let organizationId: string;
    let userId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let adminClient: any;
    try {
      const access = await requireOrgAccess(req, body as Record<string, unknown>, corsHeaders);
      organizationId = access.organizationId;
      userId = access.userId;
      adminClient = access.adminClient;
    } catch (resp) {
      return resp as Response;
    }

    // Rôle owner/admin exigé pour toutes les actions (SEC-031) : la gestion des
    // webhooks agit sur la clé plateforme partagée. L'UI est déjà admin-only.
    const { data: membership } = await adminClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .maybeSingle();
    const callerRole = (membership as { role?: string } | null)?.role;
    if (callerRole !== 'owner' && callerRole !== 'admin') {
      return respond({ success: false, error: "Action réservée aux administrateurs de l'organisation" }, 403);
    }

    if (typeof action === 'string' && RESERVED_ACTIONS.has(action)) {
      return respond({ success: false, error: "Cette action n'est pas encore disponible.", error_code: 'not_implemented' }, 501);
    }
    if (action !== 'list' && action !== 'register' && action !== 'delete') {
      return respond({ success: false, error: 'Action inconnue.', error_code: 'unknown_action' }, 400);
    }

    // Les points de terminaison sont ceux de l'application, pas d'une organisation :
    // les mutations sont réservées aux administrateurs de la plateforme quand la liste existe.
    if (action === 'register' || action === 'delete') {
      const denied = platformAdminDenied(userId);
      if (denied) return denied;
    }

    switch (action) {
      case 'list':
        return await handleList();
      case 'register':
        return await handleRegister();
      case 'delete':
        return await handleDelete(body as Record<string, unknown>);
    }
  } catch (error) {
    // Texte du prestataire : journal du serveur seulement, jamais renvoyé.
    console.error('[unipile-manage-webhooks] Error:', describeForLog(error));
    const kind = errorKindOf(error);
    return respond({
      success: false,
      error: isUnipileError(error) ? userSafeMessage(kind) : "Les notifications en temps réel n'ont pas pu être mises à jour. Réessayez.",
      error_code: isUnipileError(error) ? kind : 'server',
    });
  }
});
