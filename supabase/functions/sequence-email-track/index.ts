/**
 * Edge Function: sequence-email-track
 *
 * Tracking endpoint for email opens (pixel) and link clicks (redirect).
 * No authentication required — must work from email clients.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;

// 1x1 transparent GIF (43 bytes)
const TRANSPARENT_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
  0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

// Status priority: higher index = higher priority (never downgrade)
const STATUS_PRIORITY: Record<string, number> = {
  'scheduled': 0,
  'sending': 1,
  'sent': 2,
  'opened': 3,
  'clicked': 4,
  'replied': 5,
  'bounced': 2, // same as sent (bounce can happen after send)
};

const MAX_EVENTS_PER_TRACKING = 100;

// ── Anti open-redirect (audit 2026-07, Delivery M4) ──────────────────────────
// Ce endpoint est public (les clients mail doivent pouvoir le joindre) et
// redirigeait vers N'IMPORTE QUELLE url passée en paramètre → un phisher
// pouvait faire pointer un lien « de confiance » (domaine supabase.co présent
// dans tous les emails Konekt) vers son site. Les liens sont désormais signés
// à l'envoi (sequence-send-email) : sig = HMAC-SHA256(tid + '|' + url) avec la
// service key. Sans signature valide, on redirige vers l'app (atterrissage
// neutre) au lieu de l'url fournie — les liens des emails déjà partis (non
// signés) restent cliquables mais ne peuvent plus servir de tremplin.
const APP_URL = (Deno.env.get('APP_URL') || 'https://konekt-app-navy.vercel.app').replace(/\/+$/, '');

async function verifyLinkSig(tid: string, targetUrl: string, sig: string | null): Promise<boolean> {
  if (!sig) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(SUPABASE_SERVICE_ROLE_KEY),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${tid}|${targetUrl}`));
    const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    // Comparaison à temps constant
    const a = new TextEncoder().encode(expected);
    const b = new TextEncoder().encode(sig);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const tid = url.searchParams.get('tid');
  const evt = url.searchParams.get('evt');
  const rawRedirect = url.searchParams.get('url');
  const sig = url.searchParams.get('sig');

  // Résolution UNIQUE de la cible de redirection, appliquée partout plus bas :
  // signature valide + scheme http(s) → url demandée ; sinon → app Konekt.
  let redirectUrl: string | null = null;
  if (evt === 'click' && rawRedirect) {
    const decoded = decodeURIComponent(rawRedirect);
    const sigOk = tid ? await verifyLinkSig(tid, decoded, sig) : false;
    redirectUrl = (sigOk && isHttpUrl(decoded)) ? decoded : APP_URL;
  }

  if (!tid || !evt) {
    // Return pixel anyway to avoid broken images
    return new Response(TRANSPARENT_GIF, {
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Lookup tracking record
    const { data: tracking, error: trackingError } = await supabase
      .from('sequence_email_tracking')
      .select('id, execution_id')
      .eq('tracking_id', tid)
      .single();

    if (trackingError || !tracking) {
      // Unknown tracking ID — return pixel/redirect without processing
      if (evt === 'click' && redirectUrl) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': redirectUrl },
        });
      }
      return new Response(TRANSPARENT_GIF, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      });
    }

    // 2. Get current execution state
    const { data: execution } = await supabase
      .from('sequence_step_executions')
      .select('id, status, tracking_data')
      .eq('id', tracking.execution_id)
      .single();

    if (!execution) {
      if (evt === 'click' && redirectUrl) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': redirectUrl },
        });
      }
      return new Response(TRANSPARENT_GIF, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      });
    }

    // 3. Rate limit check
    const trackingData = (execution.tracking_data || {}) as Record<string, unknown>;
    const openedAt = (trackingData.opened_at || []) as string[];
    const clickedAt = (trackingData.clicked_at || []) as string[];
    const totalEvents = openedAt.length + clickedAt.length;

    if (totalEvents >= MAX_EVENTS_PER_TRACKING) {
      // Silently stop tracking but still serve response
      if (evt === 'click' && redirectUrl) {
        return new Response(null, {
          status: 302,
          headers: { 'Location': redirectUrl },
        });
      }
      return new Response(TRANSPARENT_GIF, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      });
    }

    // 4. Update tracking_data and status ATOMICALLY using raw SQL to avoid lost-update race condition
    // Two concurrent opens would both read the same tracking_data, modify it, and one would overwrite the other.
    // Instead, we use jsonb concatenation in SQL which is atomic.
    const now = new Date().toISOString();
    const currentPriority = STATUS_PRIORITY[execution.status] ?? 0;

    if (evt === 'open') {
      const openPriority = STATUS_PRIORITY['opened'] ?? 3;
      const newStatus = openPriority > currentPriority ? 'opened' : execution.status;

      // Try atomic RPC first, fallback to read-modify-write if RPC not available
      const { error: rpcError } = await supabase.rpc('atomic_tracking_append', {
        p_execution_id: execution.id,
        p_field: 'opened_at',
        p_value: now,
        p_new_status: newStatus,
      });
      if (rpcError) {
        console.warn('[sequence-email-track] RPC fallback:', rpcError.message);
        const newOpenedAt = [...openedAt, now];
        await supabase.from('sequence_step_executions').update({
          tracking_data: { ...trackingData, opened_at: newOpenedAt },
          ...(openPriority > currentPriority ? { status: 'opened' } : {}),
        }).eq('id', execution.id);
      }

    } else if (evt === 'click') {
      const clickPriority = STATUS_PRIORITY['clicked'] ?? 4;
      const newStatus = clickPriority > currentPriority ? 'clicked' : execution.status;

      const { error: rpcError } = await supabase.rpc('atomic_tracking_append', {
        p_execution_id: execution.id,
        p_field: 'clicked_at',
        p_value: now,
        p_new_status: newStatus,
      });
      if (rpcError) {
        console.warn('[sequence-email-track] RPC fallback:', rpcError.message);
        const newClickedAt = [...clickedAt, now];
        await supabase.from('sequence_step_executions').update({
          tracking_data: { ...trackingData, clicked_at: newClickedAt },
          ...(clickPriority > currentPriority ? { status: 'clicked' } : {}),
        }).eq('id', execution.id);
      }
    }
  } catch (err) {
    // Log but don't fail — tracking should be invisible to the user
    console.error('[sequence-email-track] Error:', err);
  }

  // 5. Serve response
  if (evt === 'click' && redirectUrl) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': redirectUrl },
    });
  }

  return new Response(TRANSPARENT_GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
});
