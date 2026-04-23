/**
 * extension-token — gestion des tokens API pour la Chrome extension Konekt.
 *
 * Actions :
 *   - 'create' : génère un nouveau token (POST). Retourne le clair UNE seule fois.
 *   - 'list'   : liste les tokens actifs de l'user (sans exposer le clair).
 *   - 'revoke' : révoque un token (soft delete via revoked_at).
 *
 * Auth : requireAuth (JWT Konekt user).
 * CORS : standard (origines Konekt + chrome-extension://*).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { requireAuth } from '../_shared/require-auth.ts';
import { sha256Hex } from '../_shared/verify-extension-token.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-konekt-extension-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Génère un token aléatoire au format kekt_<48 chars base64url>.
 * 48 chars base64url = 36 bytes random = 288 bits entropy (largement suffisant).
 */
function generateToken(): { plain: string; prefix: string } {
  const bytes = new Uint8Array(36);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const plain = `kekt_${base64}`;
  // Prefix = 4 premiers chars du random pour identification visuelle dans l'UI
  const prefix = `kekt_${base64.slice(0, 4)}…`;
  return { plain, prefix };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAuth(req, corsHeaders);
    if (auth instanceof Response) return auth;
    if (!auth.userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '').trim();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!,
    );

    // Résoudre l'organisation active de l'user
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_organization_id')
      .eq('user_id', auth.userId)
      .maybeSingle();

    const organizationId = profile?.active_organization_id;
    if (!organizationId) {
      return new Response(JSON.stringify({ error: 'Aucune organisation active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    switch (action) {
      case 'create': {
        const { label } = body;
        const { plain, prefix } = generateToken();
        const tokenHash = await sha256Hex(plain);

        const userAgent = req.headers.get('user-agent') || null;

        const { data, error } = await supabase
          .from('extension_tokens')
          .insert({
            user_id: auth.userId,
            organization_id: organizationId,
            token_hash: tokenHash,
            token_prefix: prefix,
            label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 100) : 'Mon extension Chrome',
            user_agent: userAgent,
          })
          .select('id, label, token_prefix, created_at')
          .single();

        if (error) {
          console.error('[extension-token] insert failed:', error);
          return new Response(JSON.stringify({ error: 'Erreur lors de la création du token' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // ⚠️ Le token clair n'est retourné QU'ICI (jamais re-affiché ensuite)
        return new Response(
          JSON.stringify({
            success: true,
            token: plain, // À copier immédiatement
            id: data.id,
            label: data.label,
            prefix: data.token_prefix,
            created_at: data.created_at,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      case 'list': {
        const { data, error } = await supabase
          .from('extension_tokens')
          .select('id, label, token_prefix, created_at, last_used_at, revoked_at')
          .eq('user_id', auth.userId)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[extension-token] list failed:', error);
          return new Response(JSON.stringify({ error: 'Erreur lors du chargement' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, tokens: data ?? [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'revoke': {
        const { token_id } = body;
        if (!token_id || typeof token_id !== 'string') {
          return new Response(JSON.stringify({ error: 'token_id requis' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase
          .from('extension_tokens')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', token_id)
          .eq('user_id', auth.userId);

        if (error) {
          console.error('[extension-token] revoke failed:', error);
          return new Response(JSON.stringify({ error: 'Erreur lors de la révocation' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Action inconnue: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (e: any) {
    console.error('[extension-token] error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'Erreur serveur' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
