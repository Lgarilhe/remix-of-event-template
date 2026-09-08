/**
 * Token-based AI credit wrapper.
 *
 * Pattern in 3 steps:
 * 1. PRE-AUTH  → Check estimated credits are available
 * 2. API CALL  → Execute the edge function (which calls the AI provider)
 * 3. SETTLEMENT → Deduct real credits based on actual tokens consumed
 *
 * The edge function is responsible for step 3 (settlement) internally.
 * This wrapper handles step 1 (pre-auth) and passes the model to the edge function.
 */

import { invokeEdgeFunction, isInsufficientCreditsError, type EdgeFunctionError } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { ACTION_COSTS, estimateCredits, resolveModel } from '@/types/aiCredits';

const MODEL_PREF_KEY = 'konekt_ai_model_default';

/** Read org default model from localStorage (set in Settings > Crédits IA) */
function getOrgModelDefault(): string | null {
  try {
    return localStorage.getItem(MODEL_PREF_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Identifiant unique du toast de crédits insuffisants. Une même action peut
 * lancer plusieurs appels en parallèle (dix profils par lot de scoring) : sans
 * cet identifiant, chaque lot refusé empilerait son propre toast.
 */
export const CREDITS_TOAST_ID = 'ai-credits-insufficient';

/**
 * Modèle réellement utilisé pour une action, dans l'ordre appliqué à l'appel :
 * choix ponctuel, défaut de l'organisation, défaut de l'action, défaut du tier.
 */
export function resolveActionModel(aiAction: string, modelOverride?: string | null): string {
  const routingTier = ACTION_COSTS[aiAction]?.routingTier ?? 'default';
  return resolveModel(routingTier, modelOverride, getOrgModelDefault(), aiAction);
}

/**
 * Estimation en crédits d'une action, sur le modèle qui servira à l'appel.
 *
 * A utiliser pour tout coût annoncé avant l'appel : une valeur écrite en dur
 * dans un écran cesse de suivre le catalogue et annonce un coût que le serveur
 * n'exigera pas.
 */
export function estimateActionCredits(aiAction: string, modelOverride?: string | null): number {
  return estimateCredits(aiAction, resolveActionModel(aiAction, modelOverride));
}

interface InvokeWithCreditsOptions {
  /** Human-readable description for the transaction log */
  description?: string;
  /** Skip credit check entirely (for free features) */
  skipCreditCheck?: boolean;
  /** User-selected model override (e.g. from ModelPicker) */
  modelOverride?: string;
  /** Organization's default model preference */
  orgModelDefault?: string;
}

interface InvokeResult<T> {
  data: T & { success?: boolean; error?: string; error_code?: string };
  // EdgeFunctionError et non Error : les appelants ont besoin du code HTTP et
  // de l'error_code du serveur pour distinguer un refus de crédits d'une panne.
  error: EdgeFunctionError | null;
}

export async function invokeWithCredits<T = Record<string, unknown>>(
  functionName: string,
  aiAction: string,
  body: Record<string, unknown> = {},
  options?: InvokeWithCreditsOptions
): Promise<InvokeResult<T>> {
  const action = ACTION_COSTS[aiAction];
  const routingTier = action?.routingTier ?? 'default';

  // Resolve which model to use (user override > org default from localStorage > action.autoDefault > tier default)
  const orgDefault = options?.orgModelDefault || getOrgModelDefault();
  const model = resolveModel(routingTier, options?.modelOverride, orgDefault, aiAction);

  // Step 1: PRE-AUTH — verify credits before calling the AI
  // Graceful: if pre-auth fails (no balance table, network error), proceed anyway
  if (!options?.skipCreditCheck) {
    try {
      const { data: preauthResult, error: preauthError } = await invokeEdgeFunction<{
        has_credits: boolean;
        estimated_credits: number;
        remaining: number;
        model: string;
      }>('ai-credits', {
        action: 'preauth',
        ai_action: aiAction,
        model,
      });

      // Only block when pre-auth explicitly says "no credits"
      if (!preauthError && preauthResult && preauthResult.has_credits === false) {
        const remaining = preauthResult.remaining ?? 0;
        const estimated = preauthResult.estimated_credits ?? 1;
        const msg = `Crédits IA insuffisants (${remaining} restants, ~${estimated} requis)`;
        toast.error(msg, {
          id: CREDITS_TOAST_ID,
          action: {
            label: 'Acheter des crédits',
            onClick: () => window.location.href = '/settings?tab=credits',
          },
        });
        // Même forme d'erreur que le refus serveur (402 + error_code), pour que
        // les appelants n'aient qu'un seul test à écrire, sur le code.
        return {
          data: { success: false, error: 'insufficient_credits', error_code: 'INSUFFICIENT_CREDITS' } as T & {
            success: boolean; error: string; error_code: string;
          },
          error: Object.assign(new Error(msg), { status: 402, code: 'INSUFFICIENT_CREDITS' }),
        };
      }
    } catch (e) {
      console.warn('[invokeWithCredits] Pre-auth failed, proceeding anyway:', e);
    }
  }

  // Step 2: API CALL — the edge function handles the AI call + settlement (step 3)
  // We pass the model and ai_action so the edge function can:
  // - Use the correct model for the API call
  // - Capture actual tokens and deduct credits (settlement)
  const result = await invokeEdgeFunction<T>(functionName, {
    ...body,
    _ai_model: model,
    _ai_action: aiAction,
    _ai_description: options?.description || functionName,
  });

  // Refus de crédits renvoyé par la fonction : 402 du garde serveur, posé avant
  // l'appel au modèle. Le test porte sur le code, pas sur le texte du message,
  // qui est une phrase française sans code HTTP ni jeton technique.
  if (isInsufficientCreditsError(result.error)) {
    toast.error('Crédits IA insuffisants.', {
      id: CREDITS_TOAST_ID,
      action: {
        label: 'Acheter des crédits',
        onClick: () => window.location.href = '/settings?tab=credits',
      },
    });
  }

  return result as InvokeResult<T>;
}
