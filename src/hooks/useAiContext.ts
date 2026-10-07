/**
 * useAiContext — Lecture/écriture du contexte IA structuré.
 *
 * 2 niveaux séparés :
 *  - user-level (profiles.ai_context) → géré par useUserAiContext (chaque user édite le sien)
 *  - org-level (organizations.ai_context) → géré par useOrgAiContext. UPDATE ouvert au
 *    propriétaire et aux administrateurs (policy admins_update, garde organizations_update_guard)
 *
 * Écriture verrouillée tant que la dernière lecture n'a pas réussi : un formulaire
 * vide monté après une lecture ratée écraserait le contexte enregistré.
 *
 * Le payload est validé/normalisé avant écriture : tone whitelist, longueurs max,
 * arrays cappés à 10 entrées. Pas d'erreur si on overshoot — on tronque silencieusement.
 *
 * Lot 5e-2 : le même jsonb porte le style de rédaction de la personne
 * (writing_style, carte « Votre style », useWritingPreferences). normalizeAiContext
 * le garde, et l'enregistrement des consignes relit la ligne juste avant
 * d'écrire puis ne remplace que ses propres clés : « Vos consignes » n'efface
 * jamais le style, ni « Votre style » les consignes.
 *
 * Phase 2 ajoutera l'injection backend via _shared/ai-context.ts.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "./useAuthReady";
import { useOrganization } from "./useOrganization";
import { updateOrganization } from "@/lib/organizationUpdate";
import { normalizeWritingStyle, type WritingStyle } from "@/lib/writingStyle";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type AiContextTone = "tu" | "vous" | "casual" | "formal";

// Type (et non interface) : assignable à Json, donc écrit sans cast.
export type AiContext = {
  tone: AiContextTone | null;
  specialty: string;
  do: string[];
  dont: string[];
  free_text: string;
  /** Style de rédaction par défaut (lot 5e-2), écrit par la carte « Votre style ». Absent tant qu'il n'a jamais été enregistré. */
  writing_style?: WritingStyle;
};

/** Clés écrites par le formulaire des consignes : les seules qu'il remplace dans le jsonb relu. */
const CONSIGNE_KEYS = ["tone", "specialty", "do", "dont", "free_text"] as const;

export const EMPTY_AI_CONTEXT: AiContext = {
  tone: null,
  specialty: "",
  do: [],
  dont: [],
  free_text: "",
};

const MAX_SPECIALTY = 200;
const MAX_LIST_ITEMS = 10;
const MAX_LIST_ITEM_CHARS = 200;
const MAX_FREE_TEXT = 1000;

/** Normalise un payload arbitraire en AiContext propre (caps + whitelist). */
export function normalizeAiContext(raw: unknown): AiContext {
  if (!raw || typeof raw !== "object") return { ...EMPTY_AI_CONTEXT };
  const r = raw as Record<string, unknown>;
  const tone = (() => {
    const t = r.tone;
    if (t === "tu" || t === "vous" || t === "casual" || t === "formal") return t;
    return null;
  })();
  const specialty = typeof r.specialty === "string" ? r.specialty.slice(0, MAX_SPECIALTY) : "";
  const cleanList = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim().slice(0, MAX_LIST_ITEM_CHARS))
      .slice(0, MAX_LIST_ITEMS);
  };
  const context: AiContext = {
    tone,
    specialty,
    do: cleanList(r.do),
    dont: cleanList(r.dont),
    free_text: typeof r.free_text === "string" ? r.free_text.slice(0, MAX_FREE_TEXT) : "",
  };
  // Style gardé (normalisé), jamais inventé : clé absente laissée absente.
  if (r.writing_style && typeof r.writing_style === "object" && !Array.isArray(r.writing_style)) {
    context.writing_style = normalizeWritingStyle(r.writing_style);
  }
  return context;
}

/** Profile-level (per-user) AI context */
export function useUserAiContext() {
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const queryKey = ["ai-context", "user", user?.id];

  const { data: aiContext = EMPTY_AI_CONTEXT, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<AiContext> => {
      if (!user?.id) return EMPTY_AI_CONTEXT;
      const { data, error } = await supabase
        .from("profiles")
        .select("ai_context")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return normalizeAiContext(data?.ai_context);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const save = useMutation({
    mutationFn: async (input: AiContext): Promise<AiContext> => {
      if (queryClient.getQueryState(queryKey)?.status !== "success") throw new Error("Votre contexte IA n'a pas pu être chargé : réessayez avant d'enregistrer.");
      if (!user?.id) throw new Error("Non authentifié");
      const normalized = normalizeAiContext(input);
      // Ligne relue juste avant l'écriture : seules les clés des consignes sont
      // remplacées, le style (writing_style) et toute autre clé restent.
      const { data: current, error: readError } = await supabase
        .from("profiles")
        .select("ai_context")
        .eq("user_id", user.id)
        .maybeSingle();
      if (readError) {
        console.error("[useUserAiContext] read before save", readError);
        throw new Error("L'enregistrement a échoué. Réessayez.");
      }
      const base = current?.ai_context && typeof current.ai_context === "object" && !Array.isArray(current.ai_context)
        ? (current.ai_context as Record<string, unknown>)
        : {};
      const merged = { ...base } as Record<string, unknown>;
      for (const key of CONSIGNE_KEYS) merged[key] = normalized[key];
      // Sans .single() : 0 ligne (profil absent) donnait une erreur brute en anglais.
      const { data, error } = await supabase
        .from("profiles")
        .update({ ai_context: merged as Json, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select("ai_context");
      if (error) {
        console.error("[useUserAiContext] save", error);
        throw new Error("L'enregistrement a échoué. Réessayez.");
      }
      if (!data?.length) throw new Error("Votre profil est introuvable : le contexte IA n'a pas été enregistré.");
      return normalizeAiContext(data[0].ai_context);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      void queryClient.invalidateQueries({ queryKey: ["writing-preferences"] });
      toast.success("Consignes de rédaction enregistrées");
    },
    onError: (err: Error) => {
      toast.error("Les consignes n’ont pas été enregistrées", { description: err.message });
    },
  });

  return { aiContext, isLoading, isError, refetch, save: save.mutate, isSaving: save.isPending };
}

/** Organization-level AI context — UPDATE ouvert au propriétaire et aux administrateurs (policy admins_update, garde organizations_update_guard) */
export function useOrgAiContext() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ["ai-context", "org", organizationId];

  const { data: aiContext = EMPTY_AI_CONTEXT, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<AiContext> => {
      if (!organizationId) return EMPTY_AI_CONTEXT;
      const { data, error } = await supabase
        .from("organizations")
        .select("ai_context")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return normalizeAiContext(data?.ai_context);
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const save = useMutation({
    mutationFn: async (input: AiContext): Promise<AiContext> => {
      if (queryClient.getQueryState(queryKey)?.status !== "success") throw new Error("Le contexte IA de l'organisation n'a pas pu être chargé : réessayez avant d'enregistrer.");
      if (!organizationId) throw new Error("Pas d'organisation active");
      const normalized = normalizeAiContext(input);
      // Refus (0 ligne ou garde serveur) : erreur en français levée par le helper.
      const row = await updateOrganization(organizationId, { ai_context: normalized });
      return normalizeAiContext(row.ai_context);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      toast.success("Consignes de l’organisation enregistrées");
    },
    onError: (err: Error) => {
      toast.error("Les consignes n’ont pas été enregistrées", { description: err.message });
    },
  });

  return { aiContext, isLoading, isError, refetch, save: save.mutate, isSaving: save.isPending };
}
