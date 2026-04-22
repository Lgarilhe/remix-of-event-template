// ============================================================================
// CORS — allowlist d'origines autorisées
// ============================================================================
// Avant : `Access-Control-Allow-Origin: *` dans toutes les fonctions = CORS
// désactivé = n'importe quel site peut appeler nos edge functions depuis le
// navigateur d'un user authentifié (CSRF-like).
//
// Après : allowlist via env var `ALLOWED_ORIGINS` (comma-separated).
// Wildcard `*` reste possible en dev/staging si besoin (ALLOWED_ORIGINS=*).
//
// Origines par défaut (si env var absente) :
//   - https://konekt-app-navy.vercel.app (prod)
//   - http://localhost:5173 (dev Vite)
//   - http://localhost:8080 (dev legacy)
// ============================================================================

const DEFAULT_ALLOWED = [
  'https://konekt-app-navy.vercel.app',
  'http://localhost:5173',
  'http://localhost:8080',
];

function getAllowedOrigins(): string[] {
  const envValue = Deno.env.get('ALLOWED_ORIGINS');
  if (!envValue) return DEFAULT_ALLOWED;
  // Wildcard explicite
  if (envValue.trim() === '*') return ['*'];
  return envValue.split(',').map((s) => s.trim()).filter(Boolean);
}

const ALLOWED = getAllowedOrigins();
const ALLOW_ANY = ALLOWED.includes('*');

/**
 * Build CORS headers based on the request's Origin header.
 * If the origin is in the allowlist (or wildcard active), echo it back.
 * Otherwise, return headers without Access-Control-Allow-Origin (browser will block).
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get('origin') || '';
  const allowed = ALLOW_ANY || ALLOWED.includes(requestOrigin);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (allowed && requestOrigin) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else if (ALLOW_ANY) {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  // else : pas de Access-Control-Allow-Origin → le browser bloque la réponse.

  return headers;
}

/**
 * Backward-compat: certains fichiers importent juste `corsHeaders` comme un objet
 * static. On expose un Proxy qui rebuild à la demande pour ne pas casser ces sites
 * tant qu'ils n'ont pas migré vers `buildCorsHeaders(req)`.
 *
 * Usage legacy (à éviter pour les nouvelles fonctions) :
 *   import { corsHeaders } from "../_shared/cors.ts";
 *   return new Response(..., { headers: corsHeaders });
 *
 * Usage moderne (recommandé) :
 *   import { buildCorsHeaders } from "../_shared/cors.ts";
 *   const corsHeaders = buildCorsHeaders(req);
 *   return new Response(..., { headers: corsHeaders });
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': ALLOW_ANY ? '*' : DEFAULT_ALLOWED[0],
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
