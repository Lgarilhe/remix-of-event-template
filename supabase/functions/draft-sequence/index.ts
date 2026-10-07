// draft-sequence : brouillon d'une séquence (refonte mission, lot 5).
//
// Trois actions :
// - preview_values (lot 5d-1, gratuite), ci-dessous ;
// - prepare (lot 5e, gratuite) et draft (lot 5e, payante : la seule action qui
//   débite des crédits) : rédaction de la séquence par l'IA à partir du poste,
//   dans compose.ts. Ce fichier ne débite rien et n'appelle aucun service.
//
// preview_values : valeurs des variables d'un message pour 20 candidats au plus,
// calculées comme le moteur les calcule à l'envoi (buildSequenceContext), pour
// que l'aperçu du navigateur (renderTemplatePreview) soit le texte qui partira.
//   Entrée  { action: 'preview_values', organization_id, mission_id?, sequence_id?,
//             keys: string[], enrollment_ids?: uuid[], profiles?: PreviewProfileInput[],
//             account_id? }
//   - keys : variables utilisées par les textes de la séquence (50 au plus) ;
//     seules celles-ci sont rendues ;
//   - enrollment_ids : inscriptions lues avec le jeton de l'appelant (sa RLS) ;
//     une inscription invisible pour lui est absente de la réponse ;
//   - profiles : candidats pas encore inscrits, avec les colonnes que le
//     navigateur écrira à l'inscription ; expéditeur = l'appelant, depuis son
//     compte LinkedIn (account_id refusé s'il est relié à un autre membre,
//     comme à l'inscription), sauf rotation multi-expéditeurs de sequence_id.
//   Sortie  { candidates: [{ source, id, values, at_send, missing }],
//             excluded: [{ source, id, reason, message }], send_time }
//   Les variables personnelles d'un autre membre, et celles d'un expéditeur
//   choisi à l'envoi, sont annoncées dans at_send, jamais données.
//   Erreurs : { error, error_code } (convention de invokeEdgeFunction).
// Gratuite : n'écrit rien, ne débite rien, aucun appel sortant.
// Contrat : docs/refonte-mission/lot5-plan.md, section 5d-1, et
// supabase/functions/_shared/sequence-preview-values.ts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { handleDraft, handlePrepare } from "./compose.ts";
import {
  buildPreviewValues,
  loadDrawnSenderSequences,
  parsePreviewRequest,
  profileEnrollment,
  type PreviewItem,
} from "../_shared/sequence-preview-values.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;

const FAILED_MESSAGE = "L'aperçu n'a pas pu être préparé. Réessayez dans un instant.";

Deno.serve(async (req) => {
  // Début de la requête : la rédaction (action draft) doit tenir dans les 60 s de la fonction.
  const startedAt = Date.now();
  const corsHeaders = buildCorsHeaders(req);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non prise en charge.", error_code: "METHOD_NOT_ALLOWED" }, 405);

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    // La RLS de l'appelant borne les inscriptions lues : une clé de service n'a pas d'appelant.
    if (!auth.userId) return json({ error: "Session utilisateur requise.", error_code: "USER_REQUIRED" }, 403);
    const userId = auth.userId;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Requête illisible.", error_code: "PREVIEW_INVALID_INPUT" }, 400);
    }
    const action = body && typeof body === "object" ? (body as { action?: unknown }).action : undefined;
    if (action === "prepare") return await handlePrepare(body, { userId, corsHeaders, startedAt });
    if (action === "draft") return await handleDraft(body, { userId, corsHeaders, startedAt });
    const parsed = parsePreviewRequest(body);
    if (!parsed.ok) return json({ error: parsed.error, error_code: parsed.code }, parsed.status);
    const {
      organization_id: organizationId,
      mission_id: missionId,
      sequence_id: sequenceId,
      enrollment_ids: enrollmentIds,
      profiles,
      keys,
    } = parsed.request;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!await verifyOrgMembership(admin, userId, organizationId)) {
      return json({ error: "Vous n'êtes pas membre de cette organisation.", error_code: "PREVIEW_FORBIDDEN" }, 403);
    }

    if (missionId) {
      const { data: mission, error } = await admin
        .from("sourcing_projects")
        .select("id")
        .eq("id", missionId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) {
        console.error("[draft-sequence] lecture de la mission:", error.message);
        return json({ error: FAILED_MESSAGE, error_code: "PREVIEW_FAILED" }, 500);
      }
      if (!mission) return json({ error: "Mission introuvable dans cette organisation.", error_code: "MISSION_NOT_FOUND" }, 404);
    }

    const items: PreviewItem[] = [];

    // Inscriptions : lues avec le jeton de l'appelant, donc sous sa RLS.
    if (enrollmentIds.length > 0) {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: rows, error } = await userClient
        .from("sequence_enrollments")
        .select("*")
        .in("id", enrollmentIds)
        .eq("organization_id", organizationId);
      if (error) {
        console.error("[draft-sequence] lecture des inscriptions:", error.message);
        return json({ error: FAILED_MESSAGE, error_code: "PREVIEW_FAILED" }, 500);
      }
      const byId = new Map(((rows ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row]));
      for (const id of enrollmentIds) {
        const enrollment = byId.get(id);
        if (enrollment) items.push({ source: "enrollment", id, enrollment });
      }
    }

    // Candidats pas encore inscrits : expéditeur = l'appelant. Un compte relié
    // à un autre membre est refusé, comme à l'inscription
    // (sequence_enrollments_check_sender_owner).
    if (profiles.length > 0) {
      const accountId = parsed.request.account_id?.trim() || null;
      if (accountId) {
        const { data: links, error } = await admin
          .from("member_linkedin_accounts")
          .select("user_id")
          .eq("organization_id", organizationId)
          .eq("linkedin_account_id", accountId);
        if (error) {
          console.error("[draft-sequence] lecture du compte d'envoi:", error.message);
          return json({ error: FAILED_MESSAGE, error_code: "PREVIEW_FAILED" }, 500);
        }
        if (((links ?? []) as Array<{ user_id: string | null }>).some((l) => l.user_id !== userId)) {
          return json({
            error: "Ce compte LinkedIn est relié à un autre membre de l'équipe. Choisissez votre propre compte.",
            error_code: "PREVIEW_ACCOUNT_OF_OTHER_MEMBER",
          }, 403);
        }
      }
      for (const profile of profiles) {
        items.push({
          source: "profile",
          id: profile.id,
          enrollment: profileEnrollment(profile, { organizationId, userId, accountId, missionId, sequenceId }),
        });
      }
    }

    // Rotation multi-expéditeurs : séquence de l'aperçu et séquences des inscriptions lues.
    const sequences = await loadDrawnSenderSequences(admin, organizationId, [sequenceId, ...items.map((i) => i.enrollment.sequence_id)]);
    if (!sequences.ok) return json({ error: FAILED_MESSAGE, error_code: "PREVIEW_FAILED" }, 500);
    if (sequenceId && !sequences.found.has(sequenceId)) {
      return json({ error: "Séquence introuvable dans cette organisation.", error_code: "SEQUENCE_NOT_FOUND" }, 404);
    }

    return json(await buildPreviewValues(admin, {
      organizationId,
      callerUserId: userId,
      keys,
      drawnSenderSequences: sequences.drawn,
    }, items));
  } catch (err) {
    console.error("[draft-sequence]", err);
    return json({ error: FAILED_MESSAGE, error_code: "PREVIEW_FAILED" }, 500);
  }
});
