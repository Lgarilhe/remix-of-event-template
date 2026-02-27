/**
 * Unified wrapper for calling the unipile-search edge function.
 * 
 * Normalizes responses so callers always get `{ success, error?, ...rest }`
 * regardless of whether the edge function returned a 2xx or non-2xx status.
 * 
 * supabase.functions.invoke() behavior:
 * - 2xx → { data: body, error: null }
 * - non-2xx → { data: null, error: FunctionsHttpError }
 *   where error.context contains the original response (status, body, etc.)
 * 
 * This wrapper catches non-2xx and extracts the JSON body from the error context,
 * returning it as if it were a normal `data` response with `success: false`.
 */

import { supabase } from '@/integrations/supabase/client';

export interface UnipileResponse<T = Record<string, unknown>> {
  success: boolean;
  error?: string;
  errorType?: string;
  retryAfter?: number;
  [key: string]: unknown;
}

interface InvokeOptions {
  body: Record<string, unknown>;
}

/**
 * Call the unipile-search edge function with normalized error handling.
 * 
 * Always returns `{ data, error: null }` where `data` contains `success: boolean`.
 * Non-2xx HTTP responses are transparently converted to `{ success: false, error: "..." }`.
 * Only truly unrecoverable errors (network failures, JSON parse errors) throw.
 */
export async function invokeUnipile(
  options: InvokeOptions
): Promise<{ data: UnipileResponse; httpStatus?: number }> {
  const { data, error } = await supabase.functions.invoke('unipile-search', {
    body: options.body,
  });

  // Happy path: 2xx response
  if (!error) {
    return { data: data as UnipileResponse, httpStatus: 200 };
  }

  // Non-2xx: extract the response body from the error context
  // FunctionsHttpError has a `context` property with the raw Response
  try {
    const context = (error as any).context;
    if (context instanceof Response) {
      const httpStatus = context.status;
      const body = await context.json();
      
      // Return the body as-is — it already has { success: false, error: "..." }
      return {
        data: {
          success: false,
          ...body,
        } as UnipileResponse,
        httpStatus,
      };
    }
  } catch {
    // Failed to parse error context — fall through
  }

  // Fallback: wrap the raw error message
  return {
    data: {
      success: false,
      error: error.message || 'Erreur de communication avec le serveur',
    } as UnipileResponse,
    httpStatus: 500,
  };
}
