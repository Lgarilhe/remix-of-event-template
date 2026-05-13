/**
 * ai-context.ts — Charge et formate le contexte IA user + org pour injection
 * dans le system prompt des appels Anthropic.
 *
 * Source : organizations.ai_context + profiles.ai_context (jsonb).
 * Édition : UI Settings → onglet "Contexte IA" (cf Phase 1).
 *
 * Le bloc résultat est injecté APRÈS les règles anti-IA Konekt mais AVANT le
 * system prompt spécifique de chaque fonction, pour rester prioritaire sur le
 * contenu fonctionnel sans contredire les règles globales.
 *
 * Cache : in-memory LRU 5min, clé `${orgId}|${userId}`. Survit aux invocations
 * tant que l'instance edge function reste chaude (cron processant N enrollments
 * du même user → 1 seule query au lieu de N).
 *
 * Fail-soft : toute erreur de query → string vide → l'appel IA tourne sans
 * contexte, jamais bloqué.
 */

// SupabaseClient typing intentionally permissive — callers mix `npm:` and
// `esm.sh:` imports which produce incompatible internal types. The actual
// runtime shape is the same; this lets us accept both without `as any` at
// every call site.
// deno-lint-ignore no-explicit-any
type SupabaseLikeClient = any;

export interface AiContext {
  tone: "tu" | "vous" | "casual" | "formal" | null;
  specialty: string;
  do: string[];
  dont: string[];
  free_text: string;
}

const EMPTY_CTX: AiContext = { tone: null, specialty: "", do: [], dont: [], free_text: "" };

const CACHE = new Map<string, { block: string; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

// ─── Normalisation défensive ─────────────────────────────────────────

function normalizeCtx(raw: unknown): AiContext {
  if (!raw || typeof raw !== "object") return EMPTY_CTX;
  const r = raw as Record<string, unknown>;
  const t = r.tone;
  const tone = t === "tu" || t === "vous" || t === "casual" || t === "formal" ? t : null;
  const cleanList = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 200))
      .slice(0, 10);
  };
  return {
    tone,
    specialty: typeof r.specialty === "string" ? r.specialty.slice(0, 200) : "",
    do: cleanList(r.do),
    dont: cleanList(r.dont),
    free_text: typeof r.free_text === "string" ? r.free_text.slice(0, 1000) : "",
  };
}

function isEmpty(ctx: AiContext): boolean {
  return (
    !ctx.tone &&
    !ctx.specialty.trim() &&
    ctx.do.length === 0 &&
    ctx.dont.length === 0 &&
    !ctx.free_text.trim()
  );
}

// ─── Format scope ────────────────────────────────────────────────────

const TONE_LABEL: Record<NonNullable<AiContext["tone"]>, string> = {
  tu: "tutoiement",
  vous: "vouvoiement",
  casual: "décontracté / familier",
  formal: "formel / soutenu",
};

function formatScope(scope: "agence" | "expéditeur", ctx: AiContext): string {
  if (isEmpty(ctx)) return "";
  const lines: string[] = [];
  lines.push(scope === "agence" ? "Voix de marque de l'agence :" : "Style perso de l'expéditeur :");
  if (ctx.tone) lines.push(`- Ton imposé : ${TONE_LABEL[ctx.tone]}`);
  if (ctx.specialty.trim()) lines.push(`- Spécialité : ${ctx.specialty.trim()}`);
  if (ctx.do.length > 0) {
    lines.push("- À faire :");
    for (const item of ctx.do) lines.push(`  • ${item}`);
  }
  if (ctx.dont.length > 0) {
    lines.push("- À éviter :");
    for (const item of ctx.dont) lines.push(`  • ${item}`);
  }
  if (ctx.free_text.trim()) lines.push(`- Nuances : ${ctx.free_text.trim()}`);
  return lines.join("\n");
}

// ─── Loader principal ────────────────────────────────────────────────

export interface LoadAiContextOpts {
  orgId?: string | null;
  userId?: string | null;
  /** Bypass cache (debug uniquement) */
  noCache?: boolean;
}

/**
 * Charge le contexte org + user, formate en bloc système prompt prêt à injecter.
 * Retourne '' (string vide) si les 2 contextes sont vides — le caller peut alors
 * skip l'injection sans condition supplémentaire.
 */
export async function loadAndBuildAiContext(
  supabase: SupabaseLikeClient,
  opts: LoadAiContextOpts
): Promise<string> {
  const { orgId, userId } = opts;
  const cacheKey = `${orgId || "-"}|${userId || "-"}`;

  if (!opts.noCache) {
    const cached = CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.block;
  }

  let orgCtx: AiContext = EMPTY_CTX;
  let userCtx: AiContext = EMPTY_CTX;

  if (orgId) {
    try {
      const { data } = await supabase
        .from("organizations")
        .select("ai_context")
        .eq("id", orgId)
        .maybeSingle();
      orgCtx = normalizeCtx(data?.ai_context);
    } catch (e) {
      console.warn("[ai-context] org fetch failed:", e);
    }
  }

  if (userId) {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("ai_context")
        .eq("user_id", userId)
        .maybeSingle();
      userCtx = normalizeCtx(data?.ai_context);
    } catch (e) {
      console.warn("[ai-context] user fetch failed:", e);
    }
  }

  const orgBlock = formatScope("agence", orgCtx);
  const userBlock = formatScope("expéditeur", userCtx);

  let result: string;
  if (!orgBlock && !userBlock) {
    result = "";
  } else {
    const sections: string[] = [];
    sections.push("=== CONTEXTE UTILISATEUR (RESPECTER STRICTEMENT) ===");
    if (orgBlock) sections.push(orgBlock);
    if (userBlock) sections.push(userBlock);
    sections.push(
      "INSTRUCTION : applique ces patterns dans toute génération user-facing. En cas de divergence entre voix agence et style perso, le style perso de l'expéditeur prime."
    );
    sections.push("=== FIN CONTEXTE UTILISATEUR ===");
    result = sections.join("\n\n");
  }

  CACHE.set(cacheKey, { block: result, expiresAt: Date.now() + TTL_MS });
  return result;
}

/**
 * Helper court : résout (orgId, userId) depuis un enrollment de séquence
 * (process-sequences, sequence-send-email) puis charge le contexte. Utilisé
 * pour les générations automatisées où le sender est step.sender_id ||
 * enrollment.created_by.
 */
export async function loadAiContextForEnrollment(
  supabase: SupabaseLikeClient,
  enrollment: Record<string, unknown>,
  step?: { sender_id?: string | null } | null
): Promise<string> {
  const userId =
    (step?.sender_id as string) ||
    (enrollment.assigned_sender_id as string) ||
    (enrollment.created_by as string) ||
    null;
  const orgId = (enrollment.organization_id as string) || null;
  return loadAndBuildAiContext(supabase, { orgId, userId });
}
