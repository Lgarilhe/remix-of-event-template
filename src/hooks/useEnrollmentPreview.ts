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
    for (const step of messageSteps) {
      if (abortRef.current) return;

      const existing = previews.get(profile.id)?.get(step.stepId);
      if (existing?.isGenerated && !existing.isEdited) continue; // Already generated

      setPreview(profile.id, step.stepId, { isGenerating: true, error: undefined });

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
          });

          if (error) throw error;

          const formattedMessage = (data?.message || step.messageTemplate)
            .replace(/\n\n/g, '<br><br>')
            .replace(/\n/g, '<br>');

          setPreview(profile.id, step.stepId, {
            subject: data?.subject || step.subjectTemplate || '',
            message: formattedMessage,
            personalizationPoints: data?.personalization_points,
            isGenerated: true,
            isGenerating: false,
            isEdited: false,
          });
        } catch (err: any) {
          console.error('Preview generation error:', err);
          // Fallback to template with variables resolved
          setPreview(profile.id, step.stepId, {
            subject: resolveVariables(step.subjectTemplate, profile),
            message: resolveVariables(step.messageTemplate, profile),
            isGenerated: false,
            isGenerating: false,
            error: 'Impossible de générer — le message template sera utilisé tel quel',
          });
        }
      } else {
        // No AI: resolve variables
        setPreview(profile.id, step.stepId, {
          subject: resolveVariables(step.subjectTemplate, profile),
          message: resolveVariables(step.messageTemplate, profile),
          isGenerated: true,
          isGenerating: false,
          isEdited: false,
        });
      }
    }
  }, [messageSteps, job, accountId, previews, setPreview]);

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

  // Get overrides for enrollment (edited messages)
  const getMessageOverrides = useCallback((candidateId: string): Record<string, { subject?: string; message?: string }> => {
    const overrides: Record<string, { subject?: string; message?: string }> = {};
    const candidateMap = previews.get(candidateId);
    if (!candidateMap) return overrides;

    candidateMap.forEach((msg, stepId) => {
      if (msg.isEdited) {
        overrides[stepId] = {
          subject: msg.subject,
          message: msg.message,
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
