import React from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateStatesMap } from './types';
import { Users, Sparkles, MailWarning, PhoneOff } from 'lucide-react';
import { Pill } from '@/components/missions/v2/Pill';

interface Props {
  profiles: LinkedInProfile[];
  states: CandidateStatesMap;
  /**
   * Candidats qui seront réellement inscrits (hors retirés, passés, déjà
   * contactés et incompatibles). Sans lui, seuls les retirés et passés sont
   * déduits.
   */
  activeProfiles?: LinkedInProfile[];
  /** Exclus car déjà contactés par l'organisation (détail du compteur). */
  duplicateExcludedCount?: number;
  /** Exclus car incompatibles avec la séquence (détail du compteur). */
  incompatibleExcludedCount?: number;
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
  profiles, states, activeProfiles, duplicateExcludedCount, incompatibleExcludedCount,
  generatedCount, totalToGenerate, estimatedCredits, hasAiSteps,
}: Props) {
  const removed = profiles.filter(p => states.get(p.id)?.removed).length;
  const skipped = profiles.filter(p => !states.get(p.id)?.removed && states.get(p.id)?.skipped).length;
  const pool = activeProfiles
    ?? profiles.filter(p => !states.get(p.id)?.removed && !states.get(p.id)?.skipped);
  const active = pool.length;
  // Déjà contactés ou incompatibles avec la séquence : exclus de l'inscription.
  const excluded = Math.max(0, profiles.length - removed - skipped - active);
  const duplicates = duplicateExcludedCount ?? 0;
  const incompatible = incompatibleExcludedCount ?? 0;
  // Exclus sans raison détaillée par l'appelant (compatibilité ascendante).
  const otherExcluded = Math.max(0, excluded - duplicates - incompatible);

  const withEmail = pool.filter(p => p.contact_info?.emails?.length).length;
  const withoutEmail = active - withEmail;
  const withoutPhone = pool.filter(p => !p.contact_info?.phones?.length).length;

  const isComplete = totalToGenerate > 0 && generatedCount >= totalToGenerate;

  return (
    <div className="px-4 py-2.5 border-b border-border bg-muted/15 flex items-center gap-2 flex-wrap konekt-fade-up" style={{ animationDelay: '60ms' }}>
      {/* Compteur candidats actifs */}
      <Pill icon={Users} variant="muted">
        <strong className="tabular-nums text-foreground">{active}</strong>
        <span className="opacity-60">sur {profiles.length} {active > 1 ? 'seront inscrits' : 'sera inscrit'}</span>
        {(removed > 0 || skipped > 0 || excluded > 0) && (
          <span className="text-[10px] opacity-60">
            ({[
              duplicates > 0 && `${duplicates} déjà contacté${duplicates > 1 ? 's' : ''}`,
              incompatible > 0 && `${incompatible} incompatible${incompatible > 1 ? 's' : ''}`,
              otherExcluded > 0 && `${otherExcluded} exclu${otherExcluded > 1 ? 's' : ''}`,
              removed > 0 && `${removed} retiré${removed > 1 ? 's' : ''}`,
              skipped > 0 && `${skipped} passé${skipped > 1 ? 's' : ''}`,
            ].filter(Boolean).join(', ')})
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
            ? 'tous avec e-mail'
            : <><strong className="tabular-nums">{withoutEmail}</strong> sans e-mail</>}
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
            aperçus · ~{estimatedCredits} cr
          </span>
        </Pill>
      )}
    </div>
  );
}
