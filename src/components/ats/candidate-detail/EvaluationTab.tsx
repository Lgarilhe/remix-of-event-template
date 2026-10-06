/**
 * EvaluationTab : la note de l'assistant, la scorecard d'entretien, puis trois
 * sections pliables (préparer l'appel, vérification du profil, historique des
 * notes). Design simplifié (docs/design/06-simplicite.md) : des sections
 * séparées par un filet, sans cadre ni pastille de couleur ; la note en anneau.
 *
 * Le composant ScorecardTab (1111 lignes) reste inchangé : on l'encapsule
 * sans toucher à sa logique interne (critères, notes, enregistrement).
 */

import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ATSCandidate } from '@/hooks/useATSData';
import { CandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { ScorecardTab } from '../ScorecardTab';
import { PrepSheetTab } from './PrepSheetTab';
import { FraudDetectionTab } from '../FraudDetectionTab';
import { ScoringCard } from './ScoringCard';
import { ScorePill } from '@/components/missions/v3/pipeline/CandidateListRow';
import { normalizeScore, scoreLevel, type ScoreLevel } from '@/lib/scoreScale';
import { aiRecommendationMeta } from '@/lib/verdicts';
import { cn } from '@/lib/utils';

interface Props {
  candidate: ATSCandidate;
  candidateWithProfileData: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  fullProfile: CandidateFullProfile;
  onOpenMobileProfile: () => void;
  /** Si true, déclenche la génération de scorecard automatiquement à
   *  l'ouverture (utilisé par le CTA "Préparer l'entretien" du calendrier). */
  autoGenerate?: boolean;
}

export const EvaluationTab: React.FC<Props> = ({
  candidate, candidateWithProfileData, enrichedProfile, fullProfile, onOpenMobileProfile,
  autoGenerate,
}) => {
  const scoringCount = fullProfile.scoringHistory.length;
  return (
    <div className="space-y-8">
      {/* ═══ NOTE (si disponible) ═══ */}
      {candidate.score != null && candidate.score > 0 && (
        <ScoreSummary
          score={candidate.score}
          recommendation={candidate.recommendation || null}
          historyCount={scoringCount}
        />
      )}

      {/* ═══ SCORECARD (entretien) ═══ */}
      <Section title="Scorecard d'entretien" hint="Évaluation manuelle après l'appel">
        <ScorecardTab
          candidate={candidate}
          enrichedProfile={enrichedProfile}
          onOpenProfile={onOpenMobileProfile}
          autoGenerate={autoGenerate}
        />
      </Section>

      {/* ═══ PRÉPARER L'APPEL (pliable) ═══ */}
      <FoldedSection title="Préparer l'appel" hint="Questions à poser, points à creuser">
        <PrepSheetTab
          candidateId={candidate.candidateId}
          jobId={candidate.jobId}
          candidateName={candidate.name}
        />
      </FoldedSection>

      {/* ═══ VÉRIFICATION DU PROFIL (pliable) ═══ */}
      <FoldedSection title="Vérification du profil" hint="Signaux suspects dans le CV, LinkedIn ou les dates">
        <FraudDetectionTab candidate={candidateWithProfileData} />
      </FoldedSection>

      {/* ═══ HISTORIQUE DES NOTES (pliable) ═══ */}
      {scoringCount > 0 && (
        <FoldedSection
          title="Historique des notes"
          hint={`${scoringCount} note${scoringCount > 1 ? 's' : ''} calculée${scoringCount > 1 ? 's' : ''}`}
        >
          <div className="space-y-3">
            {fullProfile.scoringHistory.map(sr => (
              <ScoringCard key={sr.id} scoring={sr} />
            ))}
          </div>
        </FoldedSection>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

const LEVEL_PHRASE: Record<ScoreLevel, string> = {
  strong: 'Note forte',
  medium: 'Note moyenne',
  weak: 'Note faible',
};

/**
 * ScoreSummary : la note en anneau, son niveau (barème de `scoreScale.ts`,
 * le même partout) et la recommandation de l'assistant. La note est celle de
 * la mission depuis laquelle la fiche a été ouverte ; les autres missions sont
 * dans l'historique en bas.
 */
function ScoreSummary({
  score, recommendation, historyCount,
}: {
  score: number;
  recommendation: string | null;
  historyCount: number;
}) {
  const level = scoreLevel(score);
  const value = normalizeScore(score);
  const recommendationLabel = aiRecommendationMeta(recommendation)?.label ?? null;
  const verdict = [level ? LEVEL_PHRASE[level] : 'Note', recommendationLabel].filter(Boolean).join(' · ');
  const others = historyCount - 1;

  return (
    <section className="flex items-center gap-4" aria-label="Note de l'assistant">
      <ScorePill score={value} size={56} title={value !== null ? `Note ${value} sur 100` : undefined} />
      <div className="min-w-0 flex-1">
        <p className="text-md font-semibold text-foreground">{verdict}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Calculée pour la mission depuis laquelle ce candidat a été ouvert.
          {others > 0 && ` Il est aussi noté sur ${others} autre${others > 1 ? 's' : ''} mission${others > 1 ? 's' : ''}, voir l'historique plus bas.`}
        </p>
      </div>
    </section>
  );
}

/** Une section toujours visible : titre, une ligne d'aide, le contenu. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h3 className="text-md font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Une section pliable. Le contenu reste monté quand elle est repliée : les
 * fiches qu'elle porte gardent ce qu'elles ont chargé ou généré.
 */
function FoldedSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = React.useId();

  return (
    <section className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="group flex w-full items-center gap-3 rounded-lg py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-md font-semibold text-foreground">{title}</span>
          {hint && <span className="block text-sm text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:text-foreground motion-reduce:transition-none', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="pt-4">
        {children}
      </div>
    </section>
  );
}
