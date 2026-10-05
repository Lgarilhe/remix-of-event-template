// capture-candidate-photos : copie privée des photos LinkedIn des candidats
// (design simplifié, lot P, docs/design/06-simplicite.md).
//
// Appelée par pg_cron toutes les deux minutes (invoke_capture_candidate_photos,
// secret partagé process_sequences_secret), ou à la main avec la clé de service.
//
// 1. Copies de candidats sortis du pipeline de l'organisation (ligne supprimée à
//    la main ou par la purge RGPD) : fichier puis ligne supprimés.
// 2. Réclame jusqu'à 25 candidats dont la photo reste à copier
//    (claim_candidate_photos). Pour chacun :
//    - candidat effacé (RGPD) dans l'organisation : « erased », rien n'est
//      téléchargé ; registre illisible : « failed », rien n'est téléchargé ;
//    - adresse hors des origines autorisées (photos LinkedIn) : « skipped » ;
//    - téléchargement sans suivre de redirection, 200 ko au plus, type lu sur
//      les octets (JPEG, PNG, WebP), sinon « skipped » ;
//    - lien refusé par LinkedIn (403, 404, 410) : « expired » ; autre échec :
//      « failed », trois essais à une heure d'écart (claim_candidate_photos) ;
//    - copie dans candidate-photos/{organisation}/{empreinte}.{ext}, « stored ».
//    Un effacement arrivé pendant la copie gagne : la ligne n'est écrite que si
//    elle est encore « pending », sinon le fichier envoyé est supprimé.
//
// Sortie : { orphans, claimed, stored, expired, failed, skipped, erased }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";
import { timingSafeEqual } from "../_shared/timing-safe-equal.ts";
import { isCandidateErasedForOrg } from "../_shared/get-or-fetch-contact.ts";
import {
  PHOTO_BUCKET,
  PHOTO_MIME,
  allowedPhotoOrigins,
  isAllowedPhotoUrl,
  photoPathOf,
  photoTypeOf,
  readBodyCapped,
  statusOfFailedResponse,
} from "../_shared/candidate-photo.ts";

const CLAIM_LIMIT = 25;
const ORPHAN_LIMIT = 50;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 10_000;

type Outcome = "stored" | "expired" | "failed" | "skipped" | "erased";

interface ClaimedPhoto {
  organization_id: string;
  candidate_id: string;
  picture_url: string;
  linkedin_profile_url: string | null;
  attempts: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Même type que celui de _shared/get-or-fetch-contact.ts (isCandidateErasedForOrg).
type Admin = SupabaseClient;

/** Supprime les copies de candidats qui n'ont plus de fiche dans l'organisation. */
async function removeOrphans(admin: Admin): Promise<number> {
  const { data, error } = await admin.rpc("list_candidate_photo_orphans", { p_limit: ORPHAN_LIMIT });
  if (error) {
    console.error("[capture-candidate-photos] orphelins :", error.message);
    return 0;
  }
  const orphans = (data ?? []) as Array<{ organization_id: string; candidate_id: string; storage_path: string | null }>;
  if (orphans.length === 0) return 0;
  const paths = orphans.map((o) => o.storage_path).filter((p): p is string => !!p);
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from(PHOTO_BUCKET).remove(paths);
    // Fichiers gardés : les lignes aussi, pour réessayer au passage suivant.
    if (removeError) {
      console.error("[capture-candidate-photos] suppression des fichiers orphelins :", removeError.message);
      return 0;
    }
  }
  const byOrg = new Map<string, string[]>();
  for (const o of orphans) byOrg.set(o.organization_id, [...(byOrg.get(o.organization_id) ?? []), o.candidate_id]);
  let removed = 0;
  for (const [organizationId, candidateIds] of byOrg) {
    const { error: deleteError, count } = await admin
      .from("candidate_photos")
      .delete({ count: "exact" })
      .eq("organization_id", organizationId)
      .in("candidate_id", candidateIds)
      .not("status", "in", "(pending,erased)");
    if (deleteError) console.error("[capture-candidate-photos] suppression des lignes orphelines :", deleteError.message);
    else removed += count ?? 0;
  }
  return removed;
}

async function captureOne(admin: Admin, origins: string[], row: ClaimedPhoto): Promise<Outcome> {
  const finish = async (status: Outcome, extra: { storagePath?: string; lastError?: string } = {}): Promise<boolean> => {
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("candidate_photos")
      .update({
        status,
        storage_path: extra.storagePath ?? null,
        last_error: extra.lastError ?? null,
        captured_at: status === "stored" ? now : null,
        checked_at: now,
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq("organization_id", row.organization_id)
      .eq("candidate_id", row.candidate_id)
      .eq("status", "pending")
      .select("candidate_id");
    if (error) {
      console.error("[capture-candidate-photos] écriture de l'état :", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  };

  // Effacement RGPD : vérifié avant tout téléchargement ; registre illisible = refus.
  try {
    const erased = await isCandidateErasedForOrg(admin, {
      organizationId: row.organization_id,
      linkedinIds: [row.candidate_id],
      linkedinUrl: row.linkedin_profile_url,
    });
    if (erased) {
      await finish("erased");
      return "erased";
    }
  } catch (e) {
    await finish("failed", { lastError: `gdpr_check: ${String((e as Error)?.message ?? e).slice(0, 160)}` });
    return "failed";
  }

  if (!isAllowedPhotoUrl(row.picture_url, origins)) {
    await finish("skipped", { lastError: "origin" });
    return "skipped";
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(
      row.picture_url,
      { redirect: "manual", headers: { Accept: "image/jpeg,image/png,image/webp" } },
      FETCH_TIMEOUT_MS,
    );
  } catch (e) {
    await finish("failed", { lastError: `network: ${String((e as Error)?.message ?? e).slice(0, 160)}` });
    return "failed";
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    await finish("skipped", { lastError: `redirect ${response.status}` });
    return "skipped";
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const status = statusOfFailedResponse(response.status);
    await finish(status, { lastError: `http ${response.status}` });
    return status;
  }

  const bytes = await readBodyCapped(response);
  if (!bytes) {
    await finish("skipped", { lastError: "too_large" });
    return "skipped";
  }
  const ext = photoTypeOf(bytes);
  if (!ext) {
    await finish("skipped", { lastError: "format" });
    return "skipped";
  }

  const path = photoPathOf(row.organization_id, await sha256Hex(`${row.organization_id}:${row.candidate_id}`), ext);
  const { error: uploadError } = await admin.storage
    .from(PHOTO_BUCKET)
    .upload(path, bytes, { contentType: PHOTO_MIME[ext], upsert: true, cacheControl: "86400" });
  if (uploadError) {
    await finish("failed", { lastError: `upload: ${uploadError.message.slice(0, 160)}` });
    return "failed";
  }

  if (!(await finish("stored", { storagePath: path }))) {
    // La ligne n'est plus « pending » (effacement pendant la copie) : le fichier part.
    await admin.storage.from(PHOTO_BUCKET).remove([path]);
    return "erased";
  }
  return "stored";
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("PROCESS_SEQUENCES_SECRET") ?? "";

  // config.toml met verify_jwt = false : le jeton est comparé ici, à temps
  // constant, au secret de la tâche planifiée et à la clé de service.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const allowed = token.length > 0 &&
    ((cronSecret.length > 0 && timingSafeEqual(token, cronSecret)) ||
      (serviceKey.length > 0 && timingSafeEqual(token, serviceKey)));
  if (!allowed) return json({ error: "Forbidden" }, 403);
  if (!supabaseUrl || !serviceKey) return json({ error: "Configuration manquante" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const origins = allowedPhotoOrigins(Deno.env.get("CANDIDATE_PHOTO_ORIGINS"));

  const orphans = await removeOrphans(admin);

  const { data, error } = await admin.rpc("claim_candidate_photos", { p_limit: CLAIM_LIMIT });
  if (error) {
    console.error("[capture-candidate-photos] réclamation :", error.message);
    return json({ error: "Réclamation impossible", orphans }, 500);
  }
  const claimed = (data ?? []) as ClaimedPhoto[];
  const counts: Record<Outcome, number> = { stored: 0, expired: 0, failed: 0, skipped: 0, erased: 0 };
  for (let i = 0; i < claimed.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(claimed.slice(i, i + CONCURRENCY).map((row) => captureOne(admin, origins, row)));
    for (const outcome of outcomes) counts[outcome] += 1;
  }

  return json({ orphans, claimed: claimed.length, ...counts });
});
