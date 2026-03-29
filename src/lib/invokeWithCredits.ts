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

import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { ACTION_COSTS, resolveModel } from '@/types/aiCredits';

const MODEL_PREF_KEY = 'konekt_ai_model_default';

/** Read org default model from localStorage (set in Settings > Crédits IA) */
function getOrgModelDefault(): string | null {
  try {
    return localStorage.getItem(MODEL_PREF_KEY) || null;
  } catch {
    return null;
  }
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
  data: T & { success?: boolean; error?: string };
  error: Error | null;
}

export async function invokeWithCredits<T = Record<string, unknown>>(
  functionName: string,
  aiAction: string,
  body: Record<string, unknown> = {},
  options?: InvokeWithCreditsOptions
): Promise<InvokeResult<T>> {
  const action = ACTION_COSTS[aiAction];
  const routingTier = action?.routingTier ?? 'default';

  // Resolve which model to use (user override > org default from localStorage > auto)
  const orgDefault = options?.orgModelDefault || getOrgModelDefault();
  const model = resolveModel(routingTier, options?.modelOverride, orgDefault);

  // Step 1: PRE-AUTH — verify credits before calling the AI
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

      // If preauth call itself failed (network, edge function down), proceed anyway
      // The edge function will handle credit check on its side
      if (!preauthError && preauthResult && preauthResult.has_credits === false) {
        const remaining = preauthResult.remaining ?? 0;
        const estimated = preauthResult.estimated_credits ?? 1;
        const msg = `Crédits IA insuffisants (${remaining} restants, ~${estimated} requis)`;
        toast.error(msg, {
          action: {
            label: 'Acheter des crédits',
            onClick: () => window.location.href = '/settings?tab=credits',
          },
        });
        return {
          data: { success: false, error: 'insufficient_credits' } as T & { success: boolean; error: string },
          error: new Error(msg),
        };
      }
    } catch (e) {
      // Pre-auth failed — proceed with the call anyway (graceful degradation)
      console.warn('[invokeWithCredits] Pre-auth check failed, proceeding:', e);
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

  // Handle 402 from the edge function (settlement failed)
  if (result.error?.message?.includes('402')) {
    toast.error('Crédits IA insuffisants après exécution.', {
      action: {
        label: 'Acheter des crédits',
        onClick: () => window.location.href = '/settings?tab=credits',
      },
    });
  }

  return result as InvokeResult<T>;
}
