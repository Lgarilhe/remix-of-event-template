/**
 * Hook for managing enrollment preview state:
 * - Lazy AI message generation per candidate
 * - Variable resolution for non-AI steps
 * - Inline editing with local overrides
 * - Bulk generation with concurrency control
 */

import { useState, useCallback, useRef } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { invokeWithCredits } from '@/lib/invokeWithCredits';

export interface SequenceStepPreview {
  stepId: string;
  stepOrder: number;
  actionType: string;
  channel?: string;
  messageTemplate: string;
  subjectTemplate: string;
  useAiPersonalization: boolean;
  aiTone?: string;
  delayDays?: number;
  delayHours?: number;
  delayMinutes?: number;
  condition?: string;
  timeoutDays?: number;
  timeoutBranchStepId?: string | null;
  parentStepId?: string | null;
  branch?: string | null;
}

export interface GeneratedMessage {
  subject: string;
  message: string;
  personalizationPoints?: string[];
  isEdited: boolean;
  isGenerated: boolean;
  isGenerating: boolean;
  error?: string;
}

export type PreviewMap = Map<string, Map<string, GeneratedMessage>>; // candidateId -> stepId -> message

interface UseEnrollmentPreviewOptions {
  steps: SequenceStepPreview[];
  profiles: LinkedInProfile[];
  job?: { id: string; title: string; client?: any; skills?: string[]; description?: string; location?: string; accompagnement?: string[] } | null;
  accountId: string;
}

// Steps that have sendable messages
const MESSAGE_ACTION_TYPES = ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'];

function hasMessage(step: SequenceStepPreview): boolean {
  return MESSAGE_ACTION_TYPES.includes(step.actionType) && !!step.messageTemplate?.trim();
}

function resolveVariables(template: string, profile: LinkedInProfile): string {
  if (!template) return '';
  return template
    .replace(/\{\{first_name\}\}/gi, profile.first_name || profile.name?.split(' ')[0] || '')
    .replace(/\{\{last_name\}\}/gi, profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '')
    .replace(/\{\{full_name\}\}/gi, profile.name || '')
    .replace(/\{\{company\}\}/gi, profile.work_experience?.[0]?.company || '')
    .replace(/\{\{headline\}\}/gi, profile.headline || '')
    .replace(/\{\{location\}\}/gi, profile.location || '')
    .replace(/\{\{job_title\}\}/gi, profile.work_experience?.[0]?.role || profile.work_experience?.[0]?.position || '');
}

export function useEnrollmentPreview({ steps, profiles, job, accountId }: UseEnrollmentPreviewOptions) {
  const [previews, setPreviews] = useState<PreviewMap>(new Map());
  const [generatedCount, setGeneratedCount] = useState(0);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const abortRef = useRef(false);

  const messageSteps = steps.filter(hasMessage);
  const totalToGenerate = profiles.length;

  const getPreview = useCallback((candidateId: string, stepId: string): GeneratedMessage | undefined => {
    return previews.get(candidateId)?.get(stepId);
  }, [previews]);

  const setPreview = useCallback((candidateId: string, stepId: string, msg: Partial<GeneratedMessage>) => {
    setPreviews(prev => {
      const next = new Map(prev);
      const candidateMap = new Map(next.get(candidateId) || new Map());
      const existing = candidateMap.get(stepId) || {
        subject: '', message: '', isEdited: false, isGenerated: false, isGenerating: false,
      };
      candidateMap.set(stepId, { ...existing, ...msg });
      next.set(candidateId, candidateMap);
      return next;
    });
  }, []);

  const generateForCandidate = useCallback(async (profile: LinkedInProfile) => {
    // 🔧 Accumulator local pour résoudre un BUG de closure :
    // setPreview est async (passe par React state), donc dans la même
    // boucle, lire `previews.get(profile.id)?.get(s.stepId)` retourne
    // la valeur AVANT les writes faits dans les itérations précédentes.
    //
    // Conséquence : pour le step #5 (RELANCE), prevSentSteps n'avait
    // PAS le message #3 généré juste avant → l'IA recevait
    // prevSentSteps=[] → générait une "relance" sans contexte → message
    // bidon générique du type "Je relance brièvement, je sais que LinkedIn
    // déborde [...]" sans aucun lien avec le 1er message.
    //
    // Fix : on maintient une Map locale synchrone qui contient les
    // messages déjà générés dans cette boucle. C'est ELLE qu'on utilise
    // pour construire prevSentSteps, pas le React state.
    const localPreviews = new Map<string, GeneratedMessage>();

    // Pré-charge les previews déjà existants (cas où l'user a déjà
    // généré certains steps avant ; on ne les regenere pas mais on
    // veut les inclure dans prevSentSteps des steps suivants).
    const existingCandidateMap = previews.get(profile.id);
    if (existingCandidateMap) {
      existingCandidateMap.forEach((msg, stepId) => {
        if (msg.isGenerated || msg.isEdited) localPreviews.set(stepId, msg);
      });
    }

    for (const step of messageSteps) {
      if (abortRef.current) return;

      const existing = localPreviews.get(step.stepId);
      if (existing?.isGenerated && !existing.isEdited) continue; // Already generated

      setPreview(profile.id, step.stepId, { isGenerating: true, error: undefined });

      // Construit prevSentSteps simulés pour ce step : on liste tous
      // les steps "reach" précédents + leur message déjà généré dans
      // localPreviews (= synchrone, à jour). Ça permet à l'edge function
      // de typer correctement le message (PREMIER MESSAGE / RELANCE 1
      // / INMAIL DE RELANCE) ET de fournir le texte du message précédent
      // à l'IA pour qu'elle puisse vraiment référencer.
      const prevSentSteps = steps
        .filter(s =>
          s.stepOrder < step.stepOrder &&
          ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message']
            .includes(s.actionType)
        )
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map(s => {
          const prev = localPreviews.get(s.stepId);
          return {
            actionType: s.actionType,
            finalMessage: prev?.message
              ? prev.message.replace(/<br\s*\/?>(\s*)/gi, '\n')
              : '',
            stepOrder: s.stepOrder,
          };
        });

      if (step.useAiPersonalization) {
        try {
          // Build rich profile data — the more context, the better the AI personalization
          const profileData = {
            name: profile.name,
            headline: profile.headline,
            location: profile.location,
            summary: profile.summary || (profile as any).about,
            currentRole: profile.work_experience?.[0]?.role || profile.work_experience?.[0]?.position,
            currentCompany: profile.work_experience?.[0]?.company,
            skills: profile.skills?.map(s => typeof s === 'string' ? s : s.name).filter(Boolean) || [],
            pastPositions: profile.work_experience?.slice(0, 4).map(w =>
              `${w.role || w.position || ''} @ ${w.company || ''}`.trim()
            ).filter(Boolean) || [],
            education: (profile as any).education?.slice(0, 2).map((e: any) =>
              [e.school_name || e.school, e.degree_name || e.degree, e.field_of_study || e.field].filter(Boolean).join(' - ')
            ) || [],
            yearsOfExperience: (() => {
              const exps = profile.work_experience || [];
              if (exps.length === 0) return undefined;
              let earliest = 9999;
              for (const exp of exps) {
                const start = (exp as any).start_date || (exp as any).starts_at;
                if (start) {
                  const year = typeof start === 'object' && start?.year ? start.year
                    : typeof start === 'string' ? parseInt(start.split('-')[0]) : 9999;
                  if (year < earliest) earliest = year;
                }
              }
              return earliest < 9999 ? new Date().getFullYear() - earliest : undefined;
            })(),
          };

          const { data, error } = await invokeWithCredits<{
            subject?: string;
            message?: string;
            personalization_points?: string[];
          }>('generate-outreach-message', 'outreach_message', {
            profile: profileData,
            job: job ? {
              title: job.title,
              client: job.client,
              skills: job.skills || [],
              description: job.description,
              location: job.location,
              accompagnement: job.accompagnement || [],
            } : undefined,
            tone: step.aiTone || 'professional',
            accountId,
            profileId: profile.provider_id || profile.id,
            candidateLinkedInUrl: (profile as any).profile_url || (profile as any).public_profile_url || (profile as any).linkedin_url,
            messageTemplate: step.messageTemplate,
            subjectTemplate: step.subjectTemplate,
            // Contexte séquence : permet à l'edge function de différencier
            // PREMIER MESSAGE / RELANCE 1 / INMAIL DE RELANCE / etc.
            // Aligné sur le shared module sequence-message-context.ts.
            sequenceContext: {
              currentActionType: step.actionType,
              prevSentSteps,
            },
          });

          if (error) throw error;

          const formattedMessage = (data?.message || step.messageTemplate)
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

          const generatedMsg: GeneratedMessage = {
            subject: data?.subject || step.subjectTemplate || '',
            message: formattedMessage,
            personalizationPoints: data?.personalization_points,
            isGenerated: true,
            isGenerating: false,
            isEdited: false,
          };
          // Met à jour l'accumulator local AVANT setPreview pour que la
          // prochaine itération de la boucle voie bien ce step comme
          // déjà généré (utilisé pour construire prevSentSteps des
          // steps suivants).
          localPreviews.set(step.stepId, generatedMsg);
          setPreview(profile.id, step.stepId, generatedMsg);
        } catch (err: any) {
          console.error('Preview generation error:', err);
          // Fallback to template with variables resolved
          const fallbackMsg: GeneratedMessage = {
            subject: resolveVariables(step.subjectTemplate, profile),
            message: resolveVariables(step.messageTemplate, profile),
            isGenerated: false,
            isGenerating: false,
            error: 'Impossible de générer — le message template sera utilisé tel quel',
          };
          localPreviews.set(step.stepId, fallbackMsg);
          setPreview(profile.id, step.stepId, fallbackMsg);
        }
      } else {
        // No AI: resolve variables (template only)
        const noAiMsg: GeneratedMessage = {
          subject: resolveVariables(step.subjectTemplate, profile),
          message: resolveVariables(step.messageTemplate, profile),
          isGenerated: true,
          isGenerating: false,
          isEdited: false,
        };
        // Important : on l'ajoute aussi à localPreviews pour que les
        // steps suivants reçoivent ce message comme prevSentStep (même
        // pour les steps non-IA, le message a été "envoyé" du point de
        // vue séquentiel).
        localPreviews.set(step.stepId, noAiMsg);
        setPreview(profile.id, step.stepId, noAiMsg);
      }
    }
  }, [messageSteps, steps, job, accountId, previews, setPreview]);

  const generateForCandidateById = useCallback(async (candidateId: string) => {
    const profile = profiles.find(p => p.id === candidateId);
    if (!profile) return;
    await generateForCandidate(profile);
    setGeneratedCount(prev => prev + 1);
  }, [profiles, generateForCandidate]);

  const regenerateStep = useCallback(async (candidateId: string, stepId: string) => {
    const profile = profiles.find(p => p.id === candidateId);
    const step = messageSteps.find(s => s.stepId === stepId);
    if (!profile || !step) return;

    // Clear edited state to allow regeneration
    setPreview(candidateId, stepId, { isEdited: false, isGenerated: false });

    // Force regeneration by temporarily clearing the preview
    const tempPreviews = new Map(previews);
    const candidateMap = tempPreviews.get(candidateId);
    if (candidateMap) {
      candidateMap.delete(stepId);
    }

    // Re-run generation for this specific step
    setPreview(candidateId, stepId, { isGenerating: true, error: undefined });

    if (step.useAiPersonalization) {
      try {
        const profileData = {
          id: profile.id,
          name: profile.name,
          first_name: profile.first_name,
          last_name: profile.last_name,
          headline: profile.headline,
          location: profile.location,
          summary: profile.summary,
          current_company: profile.work_experience?.[0]?.company,
          current_title: profile.work_experience?.[0]?.role || profile.work_experience?.[0]?.position,
          skills: profile.skills?.map(s => s.name) || [],
        };

        // Idem qu'au-dessus : on simule prevSentSteps pour que le LLM
        // sache si c'est un 1er message, une RELANCE 1, un INMAIL de
        // relance, etc.
        const prevSentSteps = steps
          .filter(s =>
            s.stepOrder < step.stepOrder &&
            ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message']
              .includes(s.actionType)
          )
          .sort((a, b) => a.stepOrder - b.stepOrder)
          .map(s => {
            const prev = previews.get(candidateId)?.get(s.stepId);
            return {
              actionType: s.actionType,
              finalMessage: prev?.message
                ? prev.message.replace(/<br\s*\/?>(\s*)/gi, '\n')
                : '',
              stepOrder: s.stepOrder,
            };
          });

        const { data, error } = await invokeWithCredits<{
          subject?: string;
          message?: string;
          personalization_points?: string[];
        }>('generate-outreach-message', 'outreach_message', {
          profile: profileData,
          job: job ? {
            title: job.title,
            client: job.client,
            skills: job.skills || [],
            description: job.description,
            location: job.location,
            accompagnement: job.accompagnement || [],
          } : undefined,
          tone: step.aiTone || 'professional',
          accountId,
          profileId: profile.provider_id || profile.id,
          messageTemplate: step.messageTemplate,
          subjectTemplate: step.subjectTemplate,
          sequenceContext: {
            currentActionType: step.actionType,
            prevSentSteps,
          },
        });

        if (error) throw error;

        const formattedMessage = (data?.message || step.messageTemplate)
          .replace(/\n\n/g, '<br><br>')
          .replace(/\n/g, '<br>');

        setPreview(candidateId, stepId, {
          subject: data?.subject || '',
          message: formattedMessage,
          personalizationPoints: data?.personalization_points,
          isGenerated: true,
          isGenerating: false,
          isEdited: false,
        });
      } catch {
        setPreview(candidateId, stepId, {
          subject: resolveVariables(step.subjectTemplate, profile),
          message: resolveVariables(step.messageTemplate, profile),
          isGenerated: false,
          isGenerating: false,
          error: 'Impossible de générer — le message template sera utilisé tel quel',
        });
      }
    } else {
      setPreview(candidateId, stepId, {
        subject: resolveVariables(step.subjectTemplate, profile),
        message: resolveVariables(step.messageTemplate, profile),
        isGenerated: true,
        isGenerating: false,
        isEdited: false,
      });
    }
  }, [profiles, messageSteps, job, accountId, previews, setPreview]);

  const editMessage = useCallback((candidateId: string, stepId: string, field: 'subject' | 'message', value: string) => {
    setPreview(candidateId, stepId, {
      [field]: value,
      isEdited: true,
    });
  }, [setPreview]);

  // Bulk generate with concurrency limit
  const generateAll = useCallback(async (maxConcurrent = 3) => {
    setIsBulkGenerating(true);
    abortRef.current = false;
    setGeneratedCount(0);

    const queue = [...profiles];
    let completed = 0;

    const worker = async () => {
      while (queue.length > 0 && !abortRef.current) {
        const profile = queue.shift();
        if (!profile) break;
        await generateForCandidate(profile);
        completed++;
        setGeneratedCount(completed);
      }
    };

    const workers = Array.from({ length: Math.min(maxConcurrent, queue.length) }, () => worker());
    await Promise.all(workers);

    setIsBulkGenerating(false);
  }, [profiles, generateForCandidate]);

  const cancelBulkGeneration = useCallback(() => {
    abortRef.current = true;
    setIsBulkGenerating(false);
  }, []);

  // Get overrides for enrollment.
  //
  // Important : on inclut ICI tous les messages prévisualisés (générés
  // par l'IA ET édités manuellement). Avant on n'incluait que les
  // édits manuels — du coup les previews IA étaient régénérées à zéro
  // par le cron au moment d'envoyer, et la preview montrée à l'user
  // dans la modal n'avait AUCUN impact sur ce qui partait vraiment.
  //
  // Le cron process-sequences lit enrollment.tracking_data.message_overrides
  // avant d'appeler generatePersonalizedMessage : si un override existe
  // pour le step_id courant → il est utilisé tel quel comme final_message
  // (avec juste le replacement de variables non résolues). Sinon il
  // tombe dans le pipeline de génération from-scratch (legacy).
  const getMessageOverrides = useCallback((candidateId: string): Record<string, {
    subject?: string;
    message?: string;
    /** isEdited=true : l'user a édité manuellement la preview avant
     *  enrollment. Le cron doit JAMAIS la regénérer (intention user
     *  explicite). */
    isEdited?: boolean;
  }> => {
    const overrides: Record<string, { subject?: string; message?: string; isEdited?: boolean }> = {};
    const candidateMap = previews.get(candidateId);
    if (!candidateMap) return overrides;

    candidateMap.forEach((msg, stepId) => {
      if (msg.isGenerated || msg.isEdited) {
        // Convertit les <br> de l'éditeur en \n pour le stockage propre.
        const cleanMessage = (msg.message || '').replace(/<br\s*\/?>(\s*)/gi, '\n');
        overrides[stepId] = {
          subject: msg.subject,
          message: cleanMessage,
          isEdited: msg.isEdited,
        };
      }
    });
    return overrides;
  }, [previews]);

  // Candidate analysis for bulk mode
  const candidateAnalysis = {
    total: profiles.length,
    withEmail: profiles.filter(p => p.contact_info?.emails?.length).length,
    withPhone: profiles.filter(p => p.contact_info?.phones?.length).length,
    withoutEmail: profiles.filter(p => !p.contact_info?.emails?.length).length,
    withoutPhone: profiles.filter(p => !p.contact_info?.phones?.length).length,
  };

  const hasAiSteps = messageSteps.some(s => s.useAiPersonalization);
  const estimatedCredits = hasAiSteps ? profiles.length * 2 : 0; // ~2 credits per AI generation

  return {
    previews,
    messageSteps,
    hasMessageSteps: messageSteps.length > 0,
    hasAiSteps,
    generatedCount,
    totalToGenerate,
    isBulkGenerating,
    estimatedCredits,
    candidateAnalysis,
    getPreview,
    generateForCandidateById,
    regenerateStep,
    editMessage,
    generateAll,
    cancelBulkGeneration,
    getMessageOverrides,
  };
}
