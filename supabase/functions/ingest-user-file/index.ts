// ============================================================================
// ingest-user-file — upload utilisateur → texte + knowledge lake (P1.2)
// ============================================================================
// Appelé par le chat (adapter) quand l'utilisateur joint un fichier au
// composer. Deux effets :
//   1. Retourne le texte extrait (le caller l'injecte dans le message pour
//      que l'agent le voie IMMÉDIATEMENT).
//   2. Chunk + embed + stocke dans knowledge_chunks (entity_type='document',
//      chunk_type='user_upload', TTL 90j) → retrouvable plus tard via
//      search_knowledge (recherche sémantique).
//
// Formats : PDF (extraction via IA, document block), TXT/MD/CSV (direct).
// DOCX/images : refusés proprement (v1).
//
// Body : { organization_id, filename, mime_type, content_base64, project_id? }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";
import { requireAuth, verifyOrgMembership } from "../_shared/require-auth.ts";
import { settleClaudeUsage } from "../_shared/settle-usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB binaire
const MAX_EXTRACTED_CHARS = 60_000;
const CHUNK_SIZE = 1_500;
const MAX_CHUNKS = 40;
const TEXT_MIMES = ["text/plain", "text/markdown", "text/csv", "application/csv"];

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Découpe paragraph-aware : coupe sur \n\n quand possible, sinon dur. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > 0 && chunks.length < MAX_CHUNKS) {
    if (rest.length <= CHUNK_SIZE) { chunks.push(rest); break; }
    let cut = rest.lastIndexOf("\n\n", CHUNK_SIZE);
    if (cut < CHUNK_SIZE * 0.4) cut = rest.lastIndexOf("\n", CHUNK_SIZE);
    if (cut < CHUNK_SIZE * 0.4) cut = rest.lastIndexOf(" ", CHUNK_SIZE);
    if (cut < CHUNK_SIZE * 0.4) cut = CHUNK_SIZE;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return chunks.filter((c) => c.length > 20);
}

/**
 * Extraction PDF (document block) ou image (vision) via l'API Anthropic —
 * pas de lib de parsing.
 */
async function extractViaAI(
  kind: "pdf" | "image",
  mediaType: string,
  contentBase64: string,
  filename: string,
): Promise<{ text: string; usage: { input_tokens: number; output_tokens: number } | null }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const contentBlock = kind === "pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: contentBase64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: contentBase64 } };
  const instruction = kind === "pdf"
    ? `Extrais le texte INTÉGRAL de ce document ("${filename}") de façon fidèle, en conservant la structure (titres, sections, listes). N'ajoute AUCUN commentaire, AUCUNE introduction — uniquement le contenu du document.`
    : `Cette image ("${filename}") a été jointe par un recruteur (typiquement : capture d'écran d'un profil, d'une offre d'emploi, d'un échange, ou photo d'un document). Transcris FIDÈLEMENT tout le texte visible en conservant la structure, puis ajoute si utile une ligne "[Description : …]" décrivant brièvement le visuel. Aucune introduction.`;

  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16_000,
      messages: [{
        role: "user",
        content: [contentBlock, { type: "text", text: instruction }],
      }],
    }),
  }, 90_000);

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`${kind} extraction failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n");
  return { text, usage: data.usage ?? null };
}

/** Embeddings OpenAI (même modèle que le reste du lake — 1536 dims). */
async function embedChunks(texts: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  }, 30_000);
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Embeddings failed (${res.status}): ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.data ?? []).map((d: { embedding: number[] }) => d.embedding);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    if (!auth.userId) {
      return json({ error: "User auth required" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!,
    );

    // Rate limit : l'extraction PDF coûte des tokens IA
    const { data: allowed } = await admin.rpc("check_rate_limit", {
      p_user_id: auth.userId,
      p_action: "ingest_user_file",
      p_max_requests: 20,
      p_window_seconds: 60,
    });
    if (allowed === false) return json({ error: "Rate limit exceeded" }, 429);

    const body = await req.json().catch(() => ({}));
    const { organization_id, filename, mime_type, content_base64, project_id } = body as Record<string, string | undefined>;

    if (!organization_id || !filename || !content_base64) {
      return json({ error: "organization_id, filename and content_base64 are required" }, 400);
    }
    const isMember = await verifyOrgMembership(admin, auth.userId, organization_id);
    if (!isMember) return json({ error: "Forbidden" }, 403);

    // Taille : base64 ≈ 4/3 du binaire
    if (content_base64.length > (MAX_FILE_BYTES * 4) / 3) {
      return json({ error: "Fichier trop volumineux (max 10 Mo)" }, 413);
    }

    const mime = (mime_type || "").toLowerCase();
    const lowerName = filename.toLowerCase();

    // ── Extraction du texte selon le format ──
    let extracted = "";
    let aiUsage: { input_tokens: number; output_tokens: number } | null = null;

    const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (mime === "application/pdf" || lowerName.endsWith(".pdf")) {
      const result = await extractViaAI("pdf", "application/pdf", content_base64, filename);
      extracted = result.text;
      aiUsage = result.usage;
    } else if (IMAGE_MIMES.includes(mime) || /\.(png|jpe?g|webp|gif)$/.test(lowerName)) {
      const mediaType = IMAGE_MIMES.includes(mime)
        ? mime
        : lowerName.endsWith(".png") ? "image/png"
        : lowerName.endsWith(".webp") ? "image/webp"
        : lowerName.endsWith(".gif") ? "image/gif"
        : "image/jpeg";
      const result = await extractViaAI("image", mediaType, content_base64, filename);
      extracted = result.text;
      aiUsage = result.usage;
    } else if (TEXT_MIMES.includes(mime) || /\.(txt|md|csv|markdown)$/.test(lowerName)) {
      try {
        const bin = Uint8Array.from(atob(content_base64), (c) => c.charCodeAt(0));
        extracted = new TextDecoder("utf-8", { fatal: false }).decode(bin);
      } catch {
        return json({ error: "Décodage du fichier texte impossible" }, 400);
      }
    } else if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
      return json({ error: "Format Word pas encore supporté — exporte le document en PDF et rejoins-le." }, 415);
    } else {
      return json({ error: `Format non supporté (${mime || filename}). Formats acceptés : PDF, images (PNG/JPG/WebP), TXT, MD, CSV.` }, 415);
    }

    extracted = extracted.slice(0, MAX_EXTRACTED_CHARS).trim();
    if (!extracted) {
      return json({ error: "Aucun texte extractible dans ce fichier (document vide ou scanné illisible)." }, 422);
    }

    // Crédits pour l'extraction PDF (fire-and-forget)
    if (aiUsage) {
      settleClaudeUsage({
        userId: auth.userId,
        organizationId: organization_id,
        aiAction: "file_ingest",
        usage: aiUsage,
        modelId: "claude-haiku-4-5",
      }).catch(() => {});
    }

    // ── Chunk + embed + insert dans le lake (fail-soft : si l'indexation
    // échoue, on retourne quand même le texte — l'injection immédiate dans
    // le message reste le premier bénéfice user) ──
    const documentId = crypto.randomUUID();
    let chunksIngested = 0;
    let lakeError: string | null = null;
    try {
      const chunks = chunkText(extracted);
      if (chunks.length > 0) {
        const embeddings = await embedChunks(chunks);
        const expiresAt = new Date(Date.now() + 90 * 864e5).toISOString();
        const rows = await Promise.all(chunks.map(async (content, i) => ({
          organization_id,
          entity_type: "document",
          entity_id: documentId,
          chunk_type: "user_upload",
          content,
          content_hash: await sha256Hex(content),
          embedding: embeddings[i] ?? null,
          metadata: {
            filename,
            mime_type: mime || null,
            project_id: project_id || null,
            uploaded_by: auth.userId,
            chunk_index: i,
            total_chunks: chunks.length,
          },
          expires_at: expiresAt,
        })));
        const { error: insertError, count } = await admin
          .from("knowledge_chunks")
          .upsert(rows, {
            onConflict: "organization_id,entity_type,entity_id,chunk_type,content_hash",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (insertError) throw insertError;
        chunksIngested = count ?? rows.length;
      }
    } catch (e) {
      lakeError = e instanceof Error ? e.message : String(e);
      console.error("[ingest-user-file] lake indexing failed (fail-soft):", lakeError);
    }

    return json({
      success: true,
      document_id: documentId,
      filename,
      extracted_text: extracted.slice(0, 12_000),
      extracted_chars: extracted.length,
      chunks_ingested: chunksIngested,
      lake_indexed: lakeError === null,
    });
  } catch (error) {
    console.error("[ingest-user-file] error:", error);
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
