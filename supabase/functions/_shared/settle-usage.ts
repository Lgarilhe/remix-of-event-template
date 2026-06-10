/**
 * settleClaudeUsage — décompte de crédits "one-liner" pour les fonctions qui
 * appellent Claude via callClaudeCompat (qui ne settle PAS lui-même : il
 * retourne seulement result.usage).
 *
 * Fix audit 2026-06-10 : 14 fonctions appelaient Claude sans aucun
 * settleCredits (coût Anthropic consommé sans décompte org). Ce helper
 * factorise le pattern de generate-scorecard (resolveOrgIdFromUser +
 * settleCredits) pour que chaque fonction n'ajoute qu'un appel :
 *
 *   import { settleClaudeUsage } from "../_shared/settle-usage.ts";
 *   const result = await callClaudeCompat({ ... });
 *   await settleClaudeUsage({
 *     userId,                      // ou user.id
 *     aiAction: "screen_candidate",
 *     usage: result.usage,
 *     modelId: result.model,
 *   });
 *
 * Fire-and-safe : toute erreur est avalée (log console), ne bloque jamais la
 * réponse. Si l'org est introuvable (user sans org), on skip silencieusement.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

export interface SettleClaudeUsageParams {
  /** User à débiter. Si null/undefined → skip (pas de settle anonyme). */
  userId: string | null | undefined;
  /** Org à débiter. Si absente, résolue depuis le user (organization_members). */
  organizationId?: string | null;
  /** Action id (clé ACTION_COSTS si elle existe, sinon floor=1). */
  aiAction: string;
  /** result.usage de callClaudeCompat. */
  usage: { input_tokens: number; output_tokens: number } | null | undefined;
  /** result.model de callClaudeCompat (model id réellement utilisé). */
  modelId: string;
  description?: string | null;
}

export async function settleClaudeUsage(params: SettleClaudeUsageParams): Promise<void> {
  const { userId, aiAction, usage, modelId, description } = params;
  try {
    if (!userId || !usage) return;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    let organizationId = params.organizationId ?? null;
    if (!organizationId) {
      const { resolveOrgIdFromUser } = await import("./resolve-org-credentials.ts");
      organizationId = await resolveOrgIdFromUser(userId, adminClient as never);
    }
    if (!organizationId) return;

    const { settleCredits } = await import("./settle-credits.ts");
    await settleCredits(adminClient as never, {
      organizationId,
      userId,
      aiAction,
      modelId,
      tokensInput: usage.input_tokens ?? 0,
      tokensOutput: usage.output_tokens ?? 0,
      description: description ?? null,
    });
  } catch (e) {
    console.warn(`[settle-usage] settle skipped for action=${aiAction}:`, e);
  }
}
