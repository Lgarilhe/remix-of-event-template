/**
 * verify-extension-token — résout le user/org depuis un token de la Chrome extension.
 *
 * L'extension envoie son token dans le header `X-Konekt-Extension-Token` (ou en body).
 * On hash le token reçu en SHA-256, cherche la row matching dans extension_tokens
 * (non révoquée), et retourne user_id + organization_id pour le scoping.
 *
 * Sécurité :
 *   - Token stocké uniquement en hash côté DB
 *   - Refuse si revoked_at IS NOT NULL
 *   - Touche last_used_at à chaque usage (audit trail)
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

export interface ExtensionAuth {
  userId: string;
  organizationId: string;
  tokenId: string;
}

/**
 * Hash SHA-256 → hex string. Utilisé pour comparer le token reçu au token_hash en DB.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Récupère le token depuis le header X-Konekt-Extension-Token.
 * Fallback : depuis le body (champ `extension_token`) ou Authorization Bearer.
 */
export function extractExtensionToken(req: Request, body?: Record<string, unknown> | null): string | null {
  const headerToken = req.headers.get('x-konekt-extension-token');
  if (headerToken && headerToken.trim()) return headerToken.trim();

  // Fallback : Authorization Bearer (format: "Bearer kekt_xxxxx")
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const candidate = auth.slice(7).trim();
    // Si le token Bearer commence par 'kekt_', c'est probablement notre token extension
    // (vs JWT Supabase qui ne commence pas par ça)
    if (candidate.startsWith('kekt_')) return candidate;
  }

  if (body && typeof body.extension_token === 'string' && body.extension_token.trim()) {
    return body.extension_token.trim();
  }

  return null;
}

/**
 * Vérifie un token extension et retourne user_id + organization_id.
 * Throw une erreur (avec status HTTP) si invalid/revoked.
 */
export async function verifyExtensionToken(
  token: string,
  adminClient?: SupabaseClient,
): Promise<ExtensionAuth> {
  const supabase = adminClient ?? createClient(
    Deno.env.get('SUPABASE_URL')!,
    (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
  );

  if (!token || token.length < 30) {
    throw new ExtensionAuthError(401, 'Token extension invalide');
  }

  const tokenHash = await sha256Hex(token);

  const { data, error } = await supabase
    .from('extension_tokens')
    .select('id, user_id, organization_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    console.error('[verify-extension-token] DB error:', error);
    throw new ExtensionAuthError(500, 'Erreur de vérification du token');
  }

  if (!data) {
    throw new ExtensionAuthError(401, 'Token extension introuvable ou expiré');
  }

  if (data.revoked_at) {
    throw new ExtensionAuthError(401, 'Token extension révoqué');
  }

  // Best-effort : update last_used_at (non-blocking)
  supabase
    .from('extension_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: updErr }) => {
      if (updErr) console.warn('[verify-extension-token] last_used_at update failed:', updErr);
    });

  return {
    userId: data.user_id,
    organizationId: data.organization_id,
    tokenId: data.id,
  };
}

export class ExtensionAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ExtensionAuthError';
    this.status = status;
  }
}

/**
 * Helper combiné : extrait + vérifie en un seul appel.
 * Renvoie ExtensionAuth ou null si pas de token (caller décide quoi faire).
 */
export async function tryExtensionAuth(
  req: Request,
  body?: Record<string, unknown> | null,
  adminClient?: SupabaseClient,
): Promise<ExtensionAuth | null> {
  const token = extractExtensionToken(req, body);
  if (!token) return null;
  return await verifyExtensionToken(token, adminClient);
}

export { sha256Hex };
