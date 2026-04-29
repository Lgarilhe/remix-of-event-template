/**
 * useTextActions — Hook pour appeler les actions IA contextuelles :
 *  - rewrite : reformule un texte → 3 variantes (court/standard/élaboré)
 *  - translate : traduit un texte FR ↔ EN auto
 *  - summarize : résume une conversation
 *  - ctaReply : génère une réponse intégrant un CTA (RDV, CV, etc.)
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

export type CtaType =
  | 'auto'
  | 'rdv'
  | 'call'
  | 'cv'
  | 'job_details'
  | 'check_interest'
  | 'referral'
  | 'close';

export interface CtaChatMessage {
  text: string;
  is_sender: boolean;
  timestamp?: string;
}

export interface CtaReplyInput {
  cta_type?: CtaType;
  chat_history: CtaChatMessage[];
  candidate_name?: string;
  recruiter_name?: string;
  job_title?: string;
  /** Brief structuré du poste (titre, salaire, lieu, etc.) — utilisé
      surtout par le CTA "job_details" pour générer un message qui
      contient toutes les infos directement. Voir buildJobBriefForCta. */
  job_brief?: Record<string, unknown>;
  calendly_link?: string;
  tone?: string;
}

export interface CtaReplyResult {
  success: boolean;
  message: string;
  cta_used: CtaType;
  reason?: string;
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

  /**
   * Génère une réponse intégrant un CTA précis (ou auto-détecté) selon
   * le contexte de la conversation. Retourne le message + le CTA utilisé
   * + une raison courte (utile en mode auto).
   */
  const [ctaReplyLoading, setCtaReplyLoading] = useState(false);
  const ctaReply = useCallback(
    async (input: CtaReplyInput): Promise<CtaReplyResult | null> => {
      if (!input.chat_history || input.chat_history.length === 0) {
        toast.error('Aucun historique de conversation');
        return null;
      }
      setCtaReplyLoading(true);
      try {
        const res = await invokeWithCredits<CtaReplyResult>('text-action', 'cta_reply', {
          action: 'cta_reply',
          cta_type: input.cta_type || 'auto',
          chat_history: input.chat_history,
          candidate_name: input.candidate_name,
          recruiter_name: input.recruiter_name,
          job_title: input.job_title,
          job_brief: input.job_brief,
          calendly_link: input.calendly_link,
          tone: input.tone,
        });
        if (res.error) {
          toast.error('Suggestion IA échouée', { description: res.error.message });
          return null;
        }
        if (!res.data?.success || !res.data.message) {
          toast.error('Réponse IA invalide');
          return null;
        }
        return res.data;
      } finally {
        setCtaReplyLoading(false);
      }
    },
    []
  );

  return {
    rewrite,
    translate,
    summarize,
    ctaReply,
    rewriteLoading,
    translateLoading,
    summarizeLoading,
    ctaReplyLoading,
  };
}
