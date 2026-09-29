// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/timing-safe-equal.ts";
import { cancelScheduledInMails, MEETING_INMAIL_CANCEL_REASON } from "../_shared/candidate-reply-closure.ts";
import { candidateRef, recordMeeting, resolveMeetingMission, type CandidateRef } from "../_shared/candidate-stage-events.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
const supabase = createClient(supabaseUrl, serviceRoleKey);

/** Slug public d'une URL de profil LinkedIn (/in/{slug}), en minuscules, sans paramètres ni fragment. */
function linkedinSlugFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  const slug = match?.[1]?.trim().toLowerCase() ?? '';
  return slug.length >= 3 ? slug : null;
}

/**
 * Motifs ilike d'une URL de profil exacte : linkedin.com/in/{slug} avec et
 * sans « / » final, jamais de joker après le slug (« /in/marie-martin » ne
 * doit pas désigner « /in/marie-martin-4b2a1 »). Les jokers SQL du slug sont
 * échappés.
 */
function exactProfileUrlPatterns(slug: string): string[] {
  const escaped = slug.replace(/([%_\\])/g, '\\$1');
  return [`%linkedin.com/in/${escaped}`, `%linkedin.com/in/${escaped}/`];
}

/** Au-delà, l'arrêt est refusé : un rendez-vous concerne un candidat, pas une liste. */
const MAX_ENROLLMENTS_STOPPED_PER_BOOKING = 5;
const PENDING_EXECUTION_STATUSES = ['scheduled', 'waiting_event', 'quota_blocked'];

async function verifyCalendlySignature(req: Request, body: string): Promise<boolean> {
  const signingKey = Deno.env.get('CALENDLY_WEBHOOK_SIGNING_KEY');
  if (!signingKey) {
    console.error('[calendly-webhook] ❌ CALENDLY_WEBHOOK_SIGNING_KEY not set — rejecting request. Configure this secret before using the webhook.');
    return false;
  }

  const signatureHeader = req.headers.get('Calendly-Webhook-Signature');
  if (!signatureHeader) {
    console.warn('[calendly-webhook] Missing Calendly-Webhook-Signature header');
    return false;
  }

  // Parse header: t=<timestamp>,v1=<signature>
  const parts: Record<string, string> = {};
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key && value) parts[key.trim()] = value.trim();
  }

  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) {
    console.warn('[calendly-webhook] Invalid signature header format');
    return false;
  }

  // Check timestamp tolerance (5 minutes)
  const timestampMs = parseInt(timestamp, 10) * 1000;
  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    console.warn('[calendly-webhook] Signature timestamp too old');
    return false;
  }

  // Compute expected signature: HMAC-SHA256(signing_key, timestamp + '.' + body)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const payload = `${timestamp}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expectedSignature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (!timingSafeEqual(expectedSignature, signature)) {
    console.warn('[calendly-webhook] Signature mismatch');
    return false;
  }

  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify Calendly webhook signature
    const rawBody = await req.text();
    const isValid = await verifyCalendlySignature(req, rawBody);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = JSON.parse(rawBody);
    console.log('[calendly-webhook] Received event:', body.event);

    // Handle webhook subscription verification
    if (body.event === 'ping') {
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // We only care about invitee.created
    if (body.event !== 'invitee.created') {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = body.payload;
    const invitee = payload;
    const event = payload.event || payload.scheduled_event;

    // Only process our recruitment event type
    const ALLOWED_EVENT_NAME = '📅 20 min pour présentation poste - Equipe Konekt';
    const eventName = event?.name || null;
    if (eventName !== ALLOWED_EVENT_NAME) {
      console.log(`[calendly-webhook] Skipping event "${eventName}" (not matching "${ALLOWED_EVENT_NAME}")`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'event_type_mismatch' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extract data
    const calendlyEventId = event?.uri?.split('/').pop() || null;
    const calendlyInviteeId = invitee?.uri?.split('/').pop() || null;
    const inviteeEmail = invitee?.email || null;
    const inviteeName = invitee?.name || null;
    const eventStartAt = event?.start_time || null;
    const eventEndAt = event?.end_time || null;

    // Extract location
    let eventLocation: string | null = null;
    if (event?.location) {
      eventLocation = event.location.join_url || event.location.location || event.location.type || null;
    }

    // Extract LinkedIn URL from custom questions (round robin-safe)
    let candidateLinkedinUrl: string | null = null;
    const questionsAndAnswers = invitee?.questions_and_answers || payload?.questions_and_answers || [];
    for (const qa of questionsAndAnswers) {
      const answer = qa.answer?.trim();
      const question = (qa.question || '').toLowerCase();
      if (!answer) continue;

      const looksLinkedin = /linkedin\.com/i.test(answer);
      if (looksLinkedin || question.includes('linkedin')) {
        if (looksLinkedin) {
          candidateLinkedinUrl = answer;
          break;
        }
      }
    }

    // Also check tracking params (from our URL pre-fill ?a1=...)
    const tracking = invitee?.tracking || payload?.tracking || {};
    if (!candidateLinkedinUrl && typeof tracking.utm_content === 'string' && /linkedin\.com/i.test(tracking.utm_content)) {
      candidateLinkedinUrl = tracking.utm_content.trim();
    }

    console.log('[calendly-webhook] Extracted:', {
      calendlyEventId,
      inviteeEmail,
      inviteeName,
      candidateLinkedinUrl,
      eventName,
      eventStartAt,
    });

    // Try to match candidate via LinkedIn URL in job_candidate_status.
    // URL exacte (slug sans paramètres), jamais une sous-chaîne : '%/in/marie%'
    // désignait aussi '/in/marie-martin-4b2a1' (SEQ-008).
    type CandidateMatch = {
      candidate_id?: string;
      candidate_name?: string;
      candidate_headline?: string;
      job_id?: string;
      job_title?: string;
      project_id?: string;
      linkedin_profile_url?: string;
      scoring_details?: any;
      organization_id?: string | null;
      created_by?: string | null;
      updated_at?: string;
    };
    let candidateMatch: CandidateMatch | null = null;
    // Mission du rendez-vous (lot 0b-2a, décision 12) : la même sert à la
    // séance et à l'étape. null : aucune ou plusieurs sans lien.
    let meetingProjectId: string | null = null;
    let meetingCandidate: CandidateRef | null = null;
    // Étape non écrite : ambiguous_mission (aucune mission ou plusieurs sans
    // lien) ou error (refus métier, fonction absente).
    let stageSkippedReason: string | null = null;

    // Validate LinkedIn URL (must be a real profile URL, not just "LinkedIn")
    const isValidLinkedinUrl = candidateLinkedinUrl && /^https?:\/\/(www\.)?linkedin\.com\/in\/.+/i.test(candidateLinkedinUrl);
    const candidateSlug = isValidLinkedinUrl ? linkedinSlugFromUrl(candidateLinkedinUrl) : null;

    if (candidateSlug) {
      // Toutes les lignes qui suivent ce profil, toutes organisations : le
      // secret Calendly est global et le webhook ne sait pas quelle
      // organisation a reçu le rendez-vous. Choisir « la ligne la plus
      // récente » écrivait chez une autre organisation qui suit le même
      // profil (session avec l'e-mail de l'invité, séquences closes,
      // notification). Décision D4 : on n'agit que si UNE SEULE organisation
      // reliée à Calendly suit ce profil ; sinon rien, et on le journalise.
      const matches: CandidateMatch[] = [];
      for (const pattern of exactProfileUrlPatterns(candidateSlug)) {
        const { data, error } = await supabase
          .from('job_candidate_status')
          .select('candidate_id, candidate_name, candidate_headline, job_id, linkedin_profile_url, scoring_details, project_id, organization_id, created_by, updated_at')
          .ilike('linkedin_profile_url', pattern)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        matches.push(...((data ?? []) as CandidateMatch[]));
      }

      if (matches.length > 0) {
        const trackingOrgIds = [...new Set(matches.map((m) => m.organization_id).filter((id): id is string => !!id))];
        let calendlyOrgIds: string[] = [];
        if (trackingOrgIds.length > 0) {
          const { data: integrations, error: integrationsError } = await supabase
            .from('organization_integrations')
            .select('organization_id')
            .in('organization_id', trackingOrgIds)
            .eq('calendly_connected', true);
          if (integrationsError) throw integrationsError;
          calendlyOrgIds = [...new Set(((integrations ?? []) as Array<{ organization_id: string }>).map((i) => i.organization_id))];
        }
        if (calendlyOrgIds.length !== 1) {
          console.warn(`[calendly-webhook] Organization not identifiable (${trackingOrgIds.length} org(s) track this profile, ${calendlyOrgIds.length} with Calendly connected) — no session, no sequence stopped, no notification`);
          return new Response(JSON.stringify({
            success: true,
            skipped: true,
            reason: 'ambiguous_org',
            calendly_org_count: calendlyOrgIds.length,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const bookingOrgId = calendlyOrgIds[0];
        const orgMatches = matches.filter((m) => m.organization_id === bookingOrgId);
        orgMatches.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
        candidateMatch = orgMatches[0] ?? null;

        // Mission du rendez-vous, résolue avant la séance (conversation, profil,
        // inscription, lignes contactées, sinon seule mission qui suit le
        // candidat). Trouvée : la ligne retenue devient la plus récente de
        // cette mission. Échec (même transitoire) : séance comme avant sur la
        // ligne la plus récente, aucune étape ; jamais bloquant, la séance,
        // l'arrêt des séquences et l'annulation des InMails passent.
        meetingCandidate = candidateRef({
          ids: orgMatches.map((m) => m.candidate_id),
          slug: candidateSlug,
          profileUrl: candidateLinkedinUrl,
        });
        const resolved = await resolveMeetingMission(supabase, { organizationId: bookingOrgId, candidate: meetingCandidate });
        if (!resolved.ok) {
          console.error('[calendly-webhook] resolve_meeting_mission:', resolved.kind, resolved.error);
          stageSkippedReason = 'error';
        } else if (resolved.data) {
          meetingProjectId = resolved.data.project_id;
          const inMission = orgMatches.filter((m) => m.project_id === meetingProjectId);
          if (inMission.length > 0) candidateMatch = inMission[0];
          console.log(`[calendly-webhook] Meeting mission ${meetingProjectId} (${resolved.data.via})`);
        }
        if (!meetingProjectId && !stageSkippedReason) {
          stageSkippedReason = 'ambiguous_mission';
          console.warn('[calendly-webhook] ambiguous_mission: no single mission for this candidate — session as before, no stage written');
        }
      }
    }

    // Get job title if we have a match
    let jobTitle: string | null = null;
    let clientName: string | null = null;
    let projectId: string | null = null;

    // Séance dans la mission du rendez-vous ; sans mission, celle de la ligne
    // la plus récente de l'organisation (comme avant).
    const sessionProjectId: string | null = meetingProjectId ?? candidateMatch?.project_id ?? null;
    // Poste de la ligne retenue, seulement s'il est dans la mission de la séance.
    const sessionJobId: string | null = meetingProjectId && candidateMatch?.project_id !== meetingProjectId
      ? null
      : (candidateMatch?.job_id || null);

    if (sessionProjectId) {
      projectId = sessionProjectId;
      const { data: project } = await supabase
        .from('sourcing_projects')
        .select('job_title, client_name')
        .eq('id', sessionProjectId)
        .single();
      if (project) {
        jobTitle = project.job_title;
        clientName = project.client_name;
      }
    }

    // Session attribuée au recruteur qui suit le candidat, dans son
    // organisation. Plus de repli sur « le premier profil venu » de toute la
    // base : sans candidat reconnu, aucune session et aucun arrêt (SEQ-008).
    const createdBy: string | null = candidateMatch?.created_by || null;
    const candidateOrgId: string | null = candidateMatch?.organization_id || null;

    if (!createdBy) {
      console.warn('[calendly-webhook] No matching candidate with an owner — no session created, no sequence stopped');
      return new Response(JSON.stringify({ success: false, error: 'candidate_not_found' }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Étape du candidat (lot 0b-2a, S5) : entretien en origine system dans la
    // mission du rendez-vous, sur sa première étape d'entretien, sinon « ITW
    // en cours » ; un écarté reste écarté. Sans mission : aucune étape. Non
    // bloquant, comme l'ancienne écriture : un échec (même transitoire) est
    // journalisé (stage_skipped: 'error') et n'empêche ni la séance, ni
    // l'arrêt des séquences, ni l'annulation des InMails. Pas de rejeu :
    // calendly_event_id n'est pas unique en production, un rejeu doublerait
    // la séance.
    if (meetingProjectId && candidateOrgId && meetingCandidate) {
      const meeting = await recordMeeting(supabase, {
        organizationId: candidateOrgId,
        projectId: meetingProjectId,
        candidate: meetingCandidate,
      });
      if (!meeting.ok) {
        console.error('[calendly-webhook] record_candidate_meeting:', meeting.kind, meeting.error);
        stageSkippedReason = 'error';
      } else if (meeting.data.project_id) {
        console.log(`[calendly-webhook] Meeting stage: ${meeting.data.rows.length} row(s) in mission ${meeting.data.project_id}`);
      }
    }

    // Build scoring summary from existing scoring_details
    let scoringSummary: any = {};
    if (candidateMatch?.scoring_details) {
      const sd = candidateMatch.scoring_details as any;
      scoringSummary = {
        overall_score: sd.overall_score || sd.score || null,
        strengths: sd.strengths || [],
        weaknesses: sd.weaknesses || sd.gaps || [],
        recommendation: sd.recommendation || sd.verdict || null,
        key_criteria: sd.criteria_scores || sd.key_criteria || [],
      };
    }

    // Create qualification session
    const { data: session, error: sessionError } = await supabase
      .from('qualification_sessions')
      .insert({
        calendly_event_id: calendlyEventId,
        calendly_invitee_id: calendlyInviteeId,
        event_name: eventName,
        event_start_at: eventStartAt,
        event_end_at: eventEndAt,
        event_location: eventLocation,
        invitee_email: inviteeEmail,
        candidate_linkedin_url: candidateLinkedinUrl,
        candidate_name: candidateMatch?.candidate_name || inviteeName,
        candidate_headline: candidateMatch?.candidate_headline || null,
        candidate_profile_id: candidateMatch?.candidate_id || null,
        job_id: sessionJobId,
        job_title: jobTitle,
        client_name: clientName,
        project_id: projectId,
        scoring_summary: scoringSummary,
        status: 'scheduled',
        created_by: createdBy,
        organization_id: candidateOrgId,
      })
      .select()
      .single();

    if (sessionError) {
      console.error('[calendly-webhook] Error creating session:', sessionError);
      throw sessionError;
    }

    console.log('[calendly-webhook] Created qualification session:', session.id);

    // Arrêt des séquences du candidat (rendez-vous = objectif atteint).
    // SEQ-008 / SEQ-112 : jamais sans filtre de profil, toujours dans
    // l'organisation du candidat reconnu, inscriptions actives ET en pause
    // (une pause reprise plus tard relançait après le rendez-vous), statut
    // 'completed' admis par la contrainte (l'ancien 'booked' était refusé en
    // base neuve), exécutions annulées seulement pour les inscriptions
    // réellement closes.
    let sequencesStopped = 0;
    let inmailsCancelled = 0;
    let stopSkippedReason: string | null = null;
    if (candidateMatch?.candidate_id && candidateOrgId) {
      try {
        type EnrollmentToStop = {
          id: string;
          sequence_id: string;
          created_by: string | null;
          organization_id: string | null;
          profile_name: string | null;
          tracking_data: Record<string, unknown> | null;
          profile_id: string | null;
          provider_id: string | null;
          resolved_profile_id: string | null;
        };
        const enrollmentColumns = 'id, sequence_id, created_by, organization_id, profile_name, tracking_data, profile_id, provider_id, resolved_profile_id';
        const found = new Map<string, EnrollmentToStop>();

        const { data: byProfile, error: byProfileError } = await supabase
          .from('sequence_enrollments')
          .select(enrollmentColumns)
          .eq('organization_id', candidateOrgId)
          .in('status', ['active', 'paused'])
          .eq('profile_id', candidateMatch.candidate_id);
        if (byProfileError) throw byProfileError;
        for (const e of (byProfile ?? []) as EnrollmentToStop[]) found.set(e.id, e);

        if (candidateSlug) {
          for (const pattern of exactProfileUrlPatterns(candidateSlug)) {
            const { data: byUrl, error: byUrlError } = await supabase
              .from('sequence_enrollments')
              .select(enrollmentColumns)
              .eq('organization_id', candidateOrgId)
              .in('status', ['active', 'paused'])
              .ilike('profile_url', pattern);
            if (byUrlError) throw byUrlError;
            for (const e of (byUrl ?? []) as EnrollmentToStop[]) found.set(e.id, e);
          }
        }

        const candidates = [...found.values()];
        if (candidates.length > MAX_ENROLLMENTS_STOPPED_PER_BOOKING) {
          stopSkippedReason = 'too_many_matches';
          console.error(`[calendly-webhook] ${candidates.length} enrollments match one booking — stop refused (max ${MAX_ENROLLMENTS_STOPPED_PER_BOOKING})`);
        } else if (candidates.length > 0) {
          const now = new Date().toISOString();
          const stopped: EnrollmentToStop[] = [];
          for (const enrollment of candidates) {
            const { data: changed, error: updateError } = await supabase
              .from('sequence_enrollments')
              .update({
                status: 'completed',
                completed_at: now,
                pause_reason: null,
                updated_at: now,
                tracking_data: {
                  ...(enrollment.tracking_data ?? {}),
                  completion_reason: 'meeting_booked',
                  meeting_booked_at: now,
                  ...(session?.id ? { qualification_session_id: session.id } : {}),
                },
              })
              .eq('id', enrollment.id)
              .in('status', ['active', 'paused'])
              .select('id');
            if (updateError) {
              console.error(`[calendly-webhook] enrollment ${enrollment.id} not closed:`, updateError);
              continue;
            }
            if (!changed || changed.length === 0) continue;
            stopped.push(enrollment);

            const { error: cancelError } = await supabase
              .from('sequence_step_executions')
              .update({ status: 'cancelled', skip_reason: 'Rendez-vous pris : séquence arrêtée', updated_at: now })
              .eq('enrollment_id', enrollment.id)
              .in('status', PENDING_EXECUTION_STATUSES);
            if (cancelError) console.error(`[calendly-webhook] executions of ${enrollment.id} not cancelled:`, cancelError);
          }
          sequencesStopped = stopped.length;

          // Log analytics for each affected sequence — incrément atomique.
          // (no calendly_booked column exists, so we track via
          // replies_received as a proxy — booking > reply)
          const sequenceIds = [...new Set(stopped.map(e => e.sequence_id))];
          for (const seqId of sequenceIds) {
            await supabase.rpc('increment_sequence_analytics', {
              p_sequence_id: seqId,
              p_field: 'replies_received',
            });
          }

          // Le recruteur de chaque inscription close est prévenu (SEQ-115).
          const byOwner = new Map<string, EnrollmentToStop[]>();
          for (const e of stopped) {
            if (!e.created_by || !e.organization_id) continue;
            const key = `${e.created_by}:${e.organization_id}`;
            byOwner.set(key, [...(byOwner.get(key) ?? []), e]);
          }
          const candidateLabel = candidateMatch.candidate_name || inviteeName || 'Un candidat';
          const notifications = [...byOwner.values()].map((rows) => ({
            user_id: rows[0].created_by,
            organization_id: rows[0].organization_id,
            type: 'action',
            title: 'RDV pris, séquence arrêtée',
            body: `${rows[0].profile_name || candidateLabel} a réservé un rendez-vous : sa séquence est arrêtée, aucune relance ne partira.`,
            link: session?.id ? `/qualification/${session.id}` : '/missions',
            metadata: {
              source: 'calendly',
              enrollment_ids: rows.map(r => r.id),
              sequence_id: rows[0].sequence_id,
              profile_name: rows[0].profile_name ?? candidateLabel,
              ...(session?.id ? { qualification_session_id: session.id } : {}),
            },
          }));
          if (notifications.length > 0) {
            const { error: notifError } = await supabase.from('notifications').insert(notifications);
            if (notifError) console.warn('[calendly-webhook] notifications not created:', notifError);
          }

          console.log(`[calendly-webhook] ✅ Stopped ${sequencesStopped} sequence enrollment(s) → status: completed (meeting_booked)`);
        } else {
          console.log('[calendly-webhook] No active or paused sequence enrollments found for this candidate');
        }

        // Décision 27 : le rendez-vous annule aussi les InMails pas encore
        // partis vers le candidat dans l'organisation du rendez-vous, avec ou
        // sans inscription (InMail groupé hors séquence) ; jamais quand
        // l'arrêt est refusé (trop de correspondances). Non bloquant.
        if (stopSkippedReason !== 'too_many_matches') {
          try {
            inmailsCancelled = await cancelScheduledInMails(
              supabase,
              { organizationId: candidateOrgId },
              [candidateMatch.candidate_id, ...candidates.flatMap((e) => [e.profile_id, e.provider_id, e.resolved_profile_id])],
              { kind: 'all' },
              MEETING_INMAIL_CANCEL_REASON,
            );
          } catch (inmailErr) {
            console.error('[calendly-webhook] scheduled InMails not cancelled:', inmailErr);
          }
        }
      } catch (seqErr) {
        console.warn('[calendly-webhook] Sequence stop failed (non-blocking):', seqErr);
        stopSkippedReason = 'error';
      }
    }

    return new Response(JSON.stringify({
      success: true,
      session_id: session.id,
      candidate_matched: !!candidateMatch,
      sequences_stopped: sequencesStopped,
      inmails_cancelled: inmailsCancelled,
      ...(stopSkippedReason ? { sequences_stop_skipped: stopSkippedReason } : {}),
      ...(stageSkippedReason ? { stage_skipped: stageSkippedReason } : {}),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[calendly-webhook] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
