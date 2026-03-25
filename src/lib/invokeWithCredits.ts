/**
 * Wrapper that checks and deducts AI credits before calling an edge function.
 * Use this for all AI-powered edge function calls.
 */

import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

export async function invokeWithCredits<T = Record<string, unknown>>(
  functionName: string,
  aiAction: string,
  body: Record<string, unknown> = {},
  options?: { description?: string; skipCreditCheck?: boolean }
): Promise<{ data: T & { success?: boolean; error?: string }; error: Error | null }> {
  // Skip credit check if explicitly told to (e.g. for free features)
  if (!options?.skipCreditCheck) {
    // Atomically check and reserve credits in a single call to prevent
    // concurrent requests from over-spending.
    const { data: reserveResult } = await invokeEdgeFunction<{ has_credits: boolean; remaining: number; cost: number; reservation_id?: string }>(
      'ai-credits',
      { action: 'check_and_deduct', ai_action: aiAction, description: options?.description || functionName }
    );

    if (!reserveResult?.has_credits) {
      const msg = `Crédits IA insuffisants (${reserveResult?.remaining ?? 0} restants, ${reserveResult?.cost ?? 1} requis)`;
      toast.error(msg, {
        action: {
          label: 'Voir les plans',
          onClick: () => window.location.href = '/pricing',
        },
      });
      return {
        data: { success: false, error: 'insufficient_credits' } as any,
        error: new Error(msg),
      };
    }
  }

  // Call the actual function (credits already deducted)
  const result = await invokeEdgeFunction<T>(functionName, body);

  return result;
}
