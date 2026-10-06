/**
 * Edge Function: sequence-email-track
 *
 * Tracking endpoint for email opens (pixel) and link clicks (redirect).
 * No authentication required — must work from email clients.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";
import { linkVerificationSecrets, trackedStatusToRaise, verifyTrackedUrl } from "../_shared/sequence-email-policy.mjs";

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
  // États TERMINAUX (audit 2026-07, Delivery L2) : priorité haute pour qu'un
  // open/click tardif (préfetch, scanner de liens) ne les « upgrade » PAS en
  // opened/clicked dans le fallback JS. Le timestamp est quand même
  // enregistré, seul le STATUS reste figé. (La RPC SQL gère déjà ce cas.)
  'cancelled': 6,
  'failed': 6,
};

const MAX_EVENTS_PER_TRACKING = 100;

// ── Anti open-redirect (audit 2026-07, Delivery M4) ──────────────────────────
// Ce endpoint est public (les clients mail doivent pouvoir le joindre) et
// redirigeait vers N'IMPORTE QUELLE url passée en paramètre → un phisher
// pouvait faire pointer un lien « de confiance » (domaine supabase.co présent
// dans tous les emails Konekt) vers son site. Les liens sont désormais signés
// à l'envoi (sequence-send-email) : sig = HMAC-SHA256(tid + '|' + url). Sans
// signature valide, on redirige vers l'app (atterrissage neutre) au lieu de
// l'url fournie — les liens des emails déjà partis (non signés) restent
// cliquables mais ne peuvent plus servir de tremplin.
// Clés acceptées : EMAIL_LINK_SIGNING_SECRET, EMAIL_LINK_SIGNING_SECRET_PREVIOUS
// (rotation), puis les clés de service qui signaient les liens avant la clé
// dédiée. Changer une clé ne casse donc pas les liens déjà envoyés.
const APP_URL = (Deno.env.get('APP_URL') || 'https://konekt-app-navy.vercel.app').replace(/\/+$/, '');
const LINK_VERIFICATION_SECRETS = linkVerificationSecrets((key) => Deno.env.get(key));

async function verifyLinkSig(tid: string, targetUrl: string, sig: string | null): Promise<boolean> {
  try {
    return await verifyTrackedUrl(LINK_VERIFICATION_SECRETS, tid, targetUrl, sig);
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
  // HEAD : les passerelles de sécurité et les aperçus de liens sondent le lien
  // sans lecture humaine. Même réponse qu'un GET, sans rien enregistrer.
  const isHead = req.method === 'HEAD';
  if (req.method !== 'GET' && !isHead) {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const tid = url.searchParams.get('tid');
  const evt = url.searchParams.get('evt');
  const rawRedirect = url.searchParams.get('url');
  const sig = url.searchParams.get('sig');

  // Résolution UNIQUE de la cible de redirection, appliquée partout plus bas :
  // signature valide + scheme http(s) → url demandée ; sinon → app Konekt.
  // searchParams.get() décode déjà le paramètre : un second décodage
  // modifiait toute URL contenant %XX (signature invalide, redirection vers
  // l'app) et levait une erreur sur un % isolé.
  let redirectUrl: string | null = null;
  if (evt === 'click' && rawRedirect) {
    const target = rawRedirect;
    const sigOk = tid ? await verifyLinkSig(tid, target, sig) : false;
    redirectUrl = (sigOk && isHttpUrl(target)) ? target : APP_URL;
  }

  if (isHead) {
    if (evt === 'click' && redirectUrl) {
      return new Response(null, { status: 302, headers: { 'Location': redirectUrl } });
    }
    return new Response(null, {
      headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
    });
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
      .select('id, status, tracking_data, executed_at')
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
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const currentPriority = STATUS_PRIORITY[execution.status] ?? 0;

    // Ouvertures et clics automatiques (passerelles de sécurité, préchargement
    // d'images, aperçus de liens) : l'horodatage est gardé, mais le statut ne
    // monte que pour un événement plausible (délai depuis l'envoi, client non
    // automatique, clic précédé d'une ouverture ou assez tardif). Ce statut
    // pilote les arrêts « a cliqué » et les branches ouvert / cliqué.
    const raiseTo = trackedStatusToRaise({
      evt,
      userAgent: req.headers.get('user-agent'),
      executedAt: execution.executed_at,
      nowMs,
      currentStatus: execution.status,
    });

    if (evt === 'open') {
      const openPriority = STATUS_PRIORITY['opened'] ?? 3;
      const raise = raiseTo === 'opened' && openPriority > currentPriority;

      // Try atomic RPC first, fallback to read-modify-write if RPC not available
      const { error: rpcError } = await supabase.rpc('atomic_tracking_append', {
        p_execution_id: execution.id,
        p_field: 'opened_at',
        p_value: now,
        p_new_status: raise ? 'opened' : null,
      });
      if (rpcError) {
        console.warn('[sequence-email-track] RPC fallback:', rpcError.message);
        const newOpenedAt = [...openedAt, now];
        await supabase.from('sequence_step_executions').update({
          tracking_data: { ...trackingData, opened_at: newOpenedAt },
          ...(raise ? { status: 'opened' } : {}),
        }).eq('id', execution.id);
      }

    } else if (evt === 'click') {
      const clickPriority = STATUS_PRIORITY['clicked'] ?? 4;
      const raise = raiseTo === 'clicked' && clickPriority > currentPriority;

      const { error: rpcError } = await supabase.rpc('atomic_tracking_append', {
        p_execution_id: execution.id,
        p_field: 'clicked_at',
        p_value: now,
        p_new_status: raise ? 'clicked' : null,
      });
      if (rpcError) {
        console.warn('[sequence-email-track] RPC fallback:', rpcError.message);
        const newClickedAt = [...clickedAt, now];
        await supabase.from('sequence_step_executions').update({
          tracking_data: { ...trackingData, clicked_at: newClickedAt },
          ...(raise ? { status: 'clicked' } : {}),
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
