/**
 * useAiContext — Lecture/écriture du contexte IA structuré.
 *
 * 2 niveaux séparés :
 *  - user-level (profiles.ai_context) → géré par useUserAiContext (chaque user édite le sien)
 *  - org-level (organizations.ai_context) → géré par useOrgAiContext (admin/owner only en UI,
 *    contrainte côté RLS via owners_update)
 *
 * Le payload est validé/normalisé avant écriture : tone whitelist, longueurs max,
 * arrays cappés à 10 entrées. Pas d'erreur si on overshoot — on tronque silencieusement.
 *
 * Phase 2 ajoutera l'injection backend via _shared/ai-context.ts.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthReady } from "./useAuthReady";
import { useOrganization } from "./useOrganization";
import { toast } from "sonner";

export type AiContextTone = "tu" | "vous" | "casual" | "formal";

export interface AiContext {
  tone: AiContextTone | null;
  specialty: string;
  do: string[];
  dont: string[];
  free_text: string;
}

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
  return {
    tone,
    specialty,
    do: cleanList(r.do),
    dont: cleanList(r.dont),
    free_text: typeof r.free_text === "string" ? r.free_text.slice(0, MAX_FREE_TEXT) : "",
  };
}

/** Profile-level (per-user) AI context */
export function useUserAiContext() {
  const { user } = useAuthReady();
  const queryClient = useQueryClient();
  const queryKey = ["ai-context", "user", user?.id];

  const { data: aiContext = EMPTY_AI_CONTEXT, isLoading } = useQuery({
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
      if (!user?.id) throw new Error("Non authentifié");
      const normalized = normalizeAiContext(input);
      const { data, error } = await supabase
        .from("profiles")
        .update({ ai_context: normalized, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select("ai_context")
        .single();
      if (error) throw error;
      return normalizeAiContext(data?.ai_context);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      toast.success("Contexte IA enregistré");
    },
    onError: (err: Error) => {
      toast.error("Erreur enregistrement", { description: err.message });
    },
  });

  return { aiContext, isLoading, save: save.mutate, isSaving: save.isPending };
}

/** Organization-level AI context — RLS limits UPDATE to owners */
export function useOrgAiContext() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ["ai-context", "org", organizationId];

  const { data: aiContext = EMPTY_AI_CONTEXT, isLoading } = useQuery({
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
      if (!organizationId) throw new Error("Pas d'organisation active");
      const normalized = normalizeAiContext(input);
      const { data, error } = await supabase
        .from("organizations")
        .update({ ai_context: normalized })
        .eq("id", organizationId)
        .select("ai_context")
        .single();
      if (error) throw error;
      return normalizeAiContext(data?.ai_context);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      toast.success("Contexte IA agence enregistré");
    },
    onError: (err: Error) => {
      toast.error("Erreur enregistrement", { description: err.message });
    },
  });

  return { aiContext, isLoading, save: save.mutate, isSaving: save.isPending };
}
