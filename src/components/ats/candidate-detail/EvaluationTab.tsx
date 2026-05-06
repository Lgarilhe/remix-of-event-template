/**
 * EvaluationTab — onglet Évaluation redesigné dans le langage visuel
 * cohérent avec Aperçu / Profil (rounded-xl, font-display, icon-tile,
 * eyebrow uppercase, sections cards aérées).
 *
 * Avant : ScoreSummary plat + bouton "Nouvelle scorecard" en pointillés
 * + collapsibles en uppercase old-school. Ressemblait à un draft v0.
 *
 * Après : Hero score avec ring SVG animé + sections cards distinctes
 * pour Scorecard / Préparer / Vérification / Historique.
 *
 * Note : le composant ScorecardTab (1111 lignes) reste inchangé — on
 * encapsule son rendu dans une nouvelle section card sans toucher à
 * sa logique interne (criteria, ratings, persistence).
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Target, Phone, ShieldCheck, History, ChevronDown, ChevronUp,
  Award, Sparkles,
} from 'lucide-react';
import { ATSCandidate } from '@/hooks/useATSData';
import { CandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { ScorecardTab } from '../ScorecardTab';
import { PrepSheetTab } from './PrepSheetTab';
import { FraudDetectionTab } from '../FraudDetectionTab';
import { ScoringCard } from './ScoringCard';
import { cn } from '@/lib/utils';

interface Props {
  candidate: ATSCandidate;
  candidateWithProfileData: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  fullProfile: CandidateFullProfile;
  onOpenMobileProfile: () => void;
}

export const EvaluationTab: React.FC<Props> = ({
  candidate, candidateWithProfileData, enrichedProfile, fullProfile, onOpenMobileProfile,
}) => {
  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ═══ HERO SCORE (si score dispo) ═══ */}
      {candidate.score != null && candidate.score > 0 && (
        <ScoreHero
          score={candidate.score}
          recommendation={candidate.recommendation || null}
          historyCount={fullProfile.scoringHistory.length}
        />
      )}

      {/* ═══ SCORECARD (entretien) ═══ */}
      <SectionCard
        icon={Award}
        title="Scorecard d'entretien"
        eyebrow="Évaluation manuelle après le call"
      >
        <ScorecardTab
          candidate={candidate}
          enrichedProfile={enrichedProfile}
          onOpenProfile={onOpenMobileProfile}
        />
      </SectionCard>

      {/* ═══ PRÉPARER LE CALL (collapsible) ═══ */}
      <CollapsibleCard
        icon={Phone}
        title="Préparer le call"
        eyebrow="Questions à poser, points à creuser"
      >
        <PrepSheetTab
          candidateId={candidate.candidateId}
          jobId={candidate.jobId}
          candidateName={candidate.name}
        />
      </CollapsibleCard>

      {/* ═══ VÉRIFICATION ANTI-FRAUDE (collapsible) ═══ */}
      <CollapsibleCard
        icon={ShieldCheck}
        title="Vérification du profil"
        eyebrow="Détection de signaux suspects (CV, LinkedIn, dates...)"
      >
        <FraudDetectionTab candidate={candidateWithProfileData} />
      </CollapsibleCard>

      {/* ═══ HISTORIQUE DES SCORINGS (collapsible) ═══ */}
      {fullProfile.scoringHistory.length > 0 && (
        <CollapsibleCard
          icon={History}
          title="Historique des scorings"
          eyebrow={`${fullProfile.scoringHistory.length} scoring${fullProfile.scoringHistory.length > 1 ? 's' : ''} précédent${fullProfile.scoringHistory.length > 1 ? 's' : ''}`}
        >
          <div className="space-y-3">
            {fullProfile.scoringHistory.map(sr => (
              <ScoringCard key={sr.id} scoring={sr} />
            ))}
          </div>
        </CollapsibleCard>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

/**
 * ScoreHero — visualisation prominente du score IA avec ring animé.
 *
 * Note : le score est attaché au job courant du candidat (celui depuis
 * lequel la modale a été ouverte). On le mentionne ici car on est
 * dans l'onglet Évaluation — c'est attendu de voir un score job-fit.
 * Si l'user veut voir tous les scores cross-jobs, il a la section
 * "Historique des scorings" en bas.
 */
function ScoreHero({
  score, recommendation, historyCount,
}: {
  score: number;
  recommendation: string | null;
  historyCount: number;
}) {
  const tone = score >= 70 ? 'success' : score >= 50 ? 'warning' : 'destructive';
  const colors = {
    success: { ring: 'hsl(142 76% 36%)', text: 'hsl(142 76% 36%)', bg: 'hsl(142 76% 36% / 0.08)', border: 'hsl(142 76% 36% / 0.3)' },
    warning: { ring: 'hsl(38 92% 50%)', text: 'hsl(38 92% 50%)', bg: 'hsl(38 92% 50% / 0.08)', border: 'hsl(38 92% 50% / 0.3)' },
    destructive: { ring: 'hsl(0 84% 60%)', text: 'hsl(0 84% 60%)', bg: 'hsl(0 84% 60% / 0.08)', border: 'hsl(0 84% 60% / 0.3)' },
  }[tone];

  const recoLabel =
    recommendation === 'shortlist' ? 'Recommandé' :
    recommendation === 'skip' ? 'Non recommandé' :
    recommendation === 'maybe' ? 'À évaluer' : null;

  const verdict =
    score >= 70 ? 'Bon score sur la mission active' :
    score >= 50 ? 'Score moyen — à examiner' :
    'Score faible';

  // Ring viz
  const size = 80;
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border p-4 sm:p-5"
      style={{ background: colors.bg, borderColor: colors.border }}
    >
      <div className="flex items-start gap-4">
        {/* Ring score */}
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={radius} stroke="hsl(var(--border))" strokeWidth={stroke} fill="none" />
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={colors.ring}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              style={{ strokeDasharray: circumference }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center flex-col">
            <span className="font-display font-bold text-[22px] tabular-nums leading-none" style={{ color: colors.text }}>
              {score}
            </span>
            <span className="text-[9px] uppercase tracking-wider font-bold opacity-60 mt-0.5" style={{ color: colors.text }}>
              /100
            </span>
          </div>
        </div>

        {/* Texte droite */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
              Score IA · mission active
            </span>
            {recoLabel && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider border"
                style={{ background: colors.bg, color: colors.text, borderColor: colors.border }}
              >
                <Target className="w-2.5 h-2.5" />
                {recoLabel}
              </span>
            )}
          </div>
          <h3 className="font-display font-bold text-[15px] sm:text-[16px] tracking-tight mt-0.5" style={{ color: colors.text }}>
            {verdict}
          </h3>
          <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
            Score calculé pour la mission depuis laquelle ce candidat a été ouvert.
            {historyCount > 1 && (
              <> Le candidat a aussi été scoré sur <span className="font-semibold text-foreground">{historyCount - 1} autre{historyCount - 1 > 1 ? 's' : ''} mission{historyCount - 1 > 1 ? 's' : ''}</span> — voir l'historique en bas.</>
            )}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * SectionCard — section cardée toujours visible (pas collapsible).
 * Utilisé pour la Scorecard d'entretien qui doit être directement
 * éditable / accessible.
 */
function SectionCard({
  icon: Icon, title, eyebrow, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border bg-muted/15">
        <div className="h-8 w-8 rounded-lg bg-foreground/[0.06] grid place-items-center shrink-0">
          <Icon className="w-4 h-4 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-[14px] tracking-tight text-foreground leading-tight">
            {title}
          </h3>
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70 mt-0.5">
              {eyebrow}
            </p>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/**
 * CollapsibleCard — section cardée pliable. Header rounded-xl avec
 * icon-tile + titre + eyebrow. Chevron d'état rotation 180°.
 */
function CollapsibleCard({
  icon: Icon, title, eyebrow, children, defaultOpen,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || false);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2.5 px-4 py-3 transition-colors',
          open ? 'border-b border-border bg-muted/15' : 'hover:bg-muted/15',
        )}
      >
        <div className="h-8 w-8 rounded-lg bg-foreground/[0.06] grid place-items-center shrink-0">
          <Icon className="w-4 h-4 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <h3 className="font-display font-bold text-[14px] tracking-tight text-foreground leading-tight">
            {title}
          </h3>
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70 mt-0.5">
              {eyebrow}
            </p>
          )}
        </div>
        <div className={cn('shrink-0 h-7 w-7 rounded-md grid place-items-center transition-all', open ? 'bg-foreground/10 rotate-180' : 'hover:bg-muted')}>
          <ChevronDown className="w-3.5 h-3.5 text-foreground/70" />
        </div>
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? 'auto' : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={{ overflow: 'hidden' }}
      >
        <div className="p-4">{children}</div>
      </motion.div>
    </div>
  );
}
