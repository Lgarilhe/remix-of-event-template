/**
 * Edge Function: sequence-email-track
 *
 * Tracking endpoint for email opens (pixel) and link clicks (redirect).
 * No authentication required — must work from email clients.
 */
import { createClient } from "npm:@supabase/supabase-js@2.75.1";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const tid = url.searchParams.get('tid');
  const evt = url.searchParams.get('evt');
  const redirectUrl = url.searchParams.get('url');

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
          headers: { 'Location': decodeURIComponent(redirectUrl) },
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
          headers: { 'Location': decodeURIComponent(redirectUrl) },
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
          headers: { 'Location': decodeURIComponent(redirectUrl) },
        });
      }
      return new Response(TRANSPARENT_GIF, {
        headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' },
      });
    }

    // 4. Update tracking_data and status
    const now = new Date().toISOString();
    const currentPriority = STATUS_PRIORITY[execution.status] ?? 0;

    if (evt === 'open') {
      const newOpenedAt = [...openedAt, now];
      const updates: Record<string, unknown> = {
        tracking_data: { ...trackingData, opened_at: newOpenedAt },
      };

      // Only upgrade status, never downgrade
      const openPriority = STATUS_PRIORITY['opened'] ?? 3;
      if (openPriority > currentPriority) {
        updates.status = 'opened';
      }

      await supabase
        .from('sequence_step_executions')
        .update(updates)
        .eq('id', execution.id);

    } else if (evt === 'click') {
      const newClickedAt = [...clickedAt, now];
      const updates: Record<string, unknown> = {
        tracking_data: { ...trackingData, clicked_at: newClickedAt },
      };

      const clickPriority = STATUS_PRIORITY['clicked'] ?? 4;
      if (clickPriority > currentPriority) {
        updates.status = 'clicked';
      }

      await supabase
        .from('sequence_step_executions')
        .update(updates)
        .eq('id', execution.id);
    }
  } catch (err) {
    // Log but don't fail — tracking should be invisible to the user
    console.error('[sequence-email-track] Error:', err);
  }

  // 5. Serve response
  if (evt === 'click' && redirectUrl) {
    return new Response(null, {
      status: 302,
      headers: { 'Location': decodeURIComponent(redirectUrl) },
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
