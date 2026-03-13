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
    // Check credits first
    const { data: checkResult } = await invokeEdgeFunction<{ has_credits: boolean; remaining: number; cost: number }>(
      'ai-credits',
      { action: 'check_credits', ai_action: aiAction }
    );

    if (!checkResult?.has_credits) {
      const msg = `Crédits IA insuffisants (${checkResult?.remaining ?? 0} restants, ${checkResult?.cost ?? 1} requis)`;
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

  // Call the actual function
  const result = await invokeEdgeFunction<T>(functionName, body);

  // Deduct credits only on success
  if (result.data && !result.error && (result.data as any).success !== false) {
    await invokeEdgeFunction('ai-credits', {
      action: 'deduct',
      ai_action: aiAction,
      description: options?.description || functionName,
    });
  }

  return result;
}
