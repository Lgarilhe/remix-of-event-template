import React from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateStatesMap } from './types';
import { Users, Sparkles, MailWarning, PhoneOff } from 'lucide-react';
import { Pill } from '@/components/missions/v2/Pill';

interface Props {
  profiles: LinkedInProfile[];
  states: CandidateStatesMap;
  generatedCount: number;
  totalToGenerate: number;
  estimatedCredits: number;
  hasAiSteps: boolean;
}

/**
 * Bandeau stats du modal d'enrollment.
 *
 * Refonte 2026-05-06 : migration vers la primitive Pill v2 partagée
 * (cf. src/components/missions/v2/Pill.tsx). Cohérence avec le reste
 * du site (rounded-full, dot pulse animé, variant ai pour gradient
 * Skalr sur la pill IA).
 */
export function DynamicSummaryBanner({
  profiles, states, generatedCount, totalToGenerate, estimatedCredits, hasAiSteps,
}: Props) {
  const removed = Array.from(states.values()).filter(s => s.removed).length;
  const skipped = Array.from(states.values()).filter(s => s.skipped).length;
  const active = profiles.length - removed - skipped;

  const withEmail = profiles.filter(p =>
    !states.get(p.id)?.removed
    && !states.get(p.id)?.skipped
    && p.contact_info?.emails?.length
  ).length;
  const withoutEmail = active - withEmail;
  const withoutPhone = profiles.filter(p =>
    !states.get(p.id)?.removed
    && !states.get(p.id)?.skipped
    && !p.contact_info?.phones?.length
  ).length;

  const isComplete = totalToGenerate > 0 && generatedCount >= totalToGenerate;

  return (
    <div className="px-4 py-2.5 border-b border-border bg-muted/15 flex items-center gap-2 flex-wrap konekt-fade-up" style={{ animationDelay: '60ms' }}>
      {/* Compteur candidats actifs */}
      <Pill icon={Users} variant="muted">
        <strong className="tabular-nums text-foreground">{active}</strong>
        <span className="opacity-60">/ {profiles.length} candidat{profiles.length > 1 ? 's' : ''}</span>
        {(removed > 0 || skipped > 0) && (
          <span className="text-[10px] opacity-60">
            ({removed > 0 && `${removed} retiré${removed > 1 ? 's' : ''}`}
            {removed > 0 && skipped > 0 && ' · '}
            {skipped > 0 && `${skipped} passé${skipped > 1 ? 's' : ''}`})
          </span>
        )}
      </Pill>

      {/* Pill email — verte si tout le monde a un email, warning sinon */}
      {active > 0 && (
        <Pill
          icon={MailWarning}
          variant={withoutEmail === 0 ? 'success' : 'warning'}
        >
          {withoutEmail === 0
            ? 'tous avec email'
            : <><strong className="tabular-nums">{withoutEmail}</strong> sans email</>}
        </Pill>
      )}

      {/* Pill téléphone — n'apparaît que si manque */}
      {withoutPhone > 0 && (
        <Pill icon={PhoneOff} variant="warning">
          <strong className="tabular-nums">{withoutPhone}</strong> sans tél
        </Pill>
      )}

      {/* Pill previews IA — variant ai (gradient skalr) en cours, success quand complet */}
      {hasAiSteps && (
        <Pill
          icon={Sparkles}
          variant={isComplete ? 'success' : 'ai'}
          pulse={!isComplete && generatedCount > 0}
          className="ml-auto"
        >
          <span className="tabular-nums font-semibold">{generatedCount}/{totalToGenerate}</span>
          <span className="opacity-70 text-[10px]">
            previews · ~{estimatedCredits} cr
          </span>
        </Pill>
      )}
    </div>
  );
}
