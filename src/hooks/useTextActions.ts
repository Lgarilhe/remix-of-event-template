/**
 * useTextActions — Hook pour appeler les 3 actions IA contextuelles :
 *  - rewrite : reformule un texte → 3 variantes (court/standard/élaboré)
 *  - translate : traduit un texte FR ↔ EN auto
 *  - summarize : résume une conversation
 *
 * Toutes utilisent l'edge function `text-action` (1 seule fonction pour
 * réduire les cold starts).
 */

import { useState, useCallback } from 'react';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { toast } from 'sonner';

export interface RewriteVariant {
  label: string;
  text: string;
}

export interface RewriteResult {
  success: boolean;
  variants: RewriteVariant[];
}

export interface TranslateResult {
  success: boolean;
  translated: string;
}

export interface SummarizeResult {
  success: boolean;
  summary: string;
  key_points: string[];
  next_action: string;
}

export function useTextActions() {
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [translateLoading, setTranslateLoading] = useState(false);
  const [summarizeLoading, setSummarizeLoading] = useState(false);

  /** Reformule un texte en 3 variantes */
  const rewrite = useCallback(
    async (text: string, options?: { variants?: number; tone?: string }): Promise<RewriteVariant[] | null> => {
      if (!text.trim()) return null;
      setRewriteLoading(true);
      try {
        const res = await invokeWithCredits<RewriteResult>('text-action', 'rewrite_text', {
          action: 'rewrite',
          text,
          variants: options?.variants ?? 3,
          tone: options?.tone,
        });
        if (res.error) {
          toast.error('Reformulation échouée', { description: res.error.message });
          return null;
        }
        if (!res.data?.success || !Array.isArray(res.data.variants)) {
          toast.error('Réponse IA invalide');
          return null;
        }
        return res.data.variants;
      } finally {
        setRewriteLoading(false);
      }
    },
    []
  );

  /** Traduit un texte FR ↔ EN auto */
  const translate = useCallback(
    async (text: string, targetLanguage?: 'fr' | 'en'): Promise<string | null> => {
      if (!text.trim()) return null;
      setTranslateLoading(true);
      try {
        const res = await invokeWithCredits<TranslateResult>('text-action', 'translate_text', {
          action: 'translate',
          text,
          target_language: targetLanguage,
        });
        if (res.error) {
          toast.error('Traduction échouée', { description: res.error.message });
          return null;
        }
        if (!res.data?.success || !res.data.translated) {
          toast.error('Réponse IA invalide');
          return null;
        }
        return res.data.translated;
      } finally {
        setTranslateLoading(false);
      }
    },
    []
  );

  /** Résume une conversation (passer le history sous forme de texte) */
  const summarize = useCallback(
    async (conversationText: string): Promise<SummarizeResult | null> => {
      if (!conversationText.trim()) return null;
      setSummarizeLoading(true);
      try {
        const res = await invokeWithCredits<SummarizeResult>('text-action', 'summarize_conversation', {
          action: 'summarize',
          text: conversationText,
        });
        if (res.error) {
          toast.error('Résumé échoué', { description: res.error.message });
          return null;
        }
        if (!res.data?.success) {
          toast.error('Réponse IA invalide');
          return null;
        }
        return res.data;
      } finally {
        setSummarizeLoading(false);
      }
    },
    []
  );

  return {
    rewrite,
    translate,
    summarize,
    rewriteLoading,
    translateLoading,
    summarizeLoading,
  };
}
