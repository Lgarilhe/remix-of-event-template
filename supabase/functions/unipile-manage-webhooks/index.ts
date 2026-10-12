// Deno.serve used directly
import { requireOrgAccess } from "../_shared/require-auth.ts";
import { describeForLog, errorKindOf, isUnipileError, userSafeMessage } from "../_shared/unipile/index.ts";
import { corsHeaders, respond, runAction } from "./handlers.ts";

/**
 * Authentification, appartenance à l'organisation et rôle owner/admin ici ; les
 * actions et la porte des administrateurs de la plateforme (KONEKT_PLATFORM_ADMIN_USER_IDS :
 * mutations tolérantes sans le secret, journal et rejeu fermés sans lui) dans
 * handlers.ts (`runAction`), où les tests les jouent.
 */
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
      return respond({ success: false, error: "Action réservée aux administrateurs de l'organisation." }, 403);
    }

    return await runAction(action, body as Record<string, unknown>, userId);
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
