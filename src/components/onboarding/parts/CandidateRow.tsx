import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Skeleton } from '@/components/ui/skeleton';
import type { PreviewCandidate, PreviewScore } from '@/lib/onboarding/search';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';
import { ScoreRing } from './ScoreRing';

const Avatar: React.FC<{ candidate: PreviewCandidate }> = ({ candidate }) => {
  const [failed, setFailed] = useState(false);
  if (!candidate.photo || failed) {
    return (
      <span aria-hidden="true" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground-secondary">
        {candidate.initials}
      </span>
    );
  }
  return (
    <img
      src={candidate.photo}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-11 w-11 shrink-0 rounded-full border border-border object-cover"
    />
  );
};

interface Props {
  candidate: PreviewCandidate;
  index: number;
  score: PreviewScore | undefined;
  scoring: 'pending' | 'done' | 'none';
}

/** Un candidat de l'aperçu : photo, poste, société, lieu, et son score quand l'IA l'a lu. */
export const CandidateRow: React.FC<Props> = ({ candidate: c, index, score, scoring }) => {
  const d = useDelay();
  const meta = [c.role && c.company ? `${c.role}, ${c.company}` : c.role || c.company, c.location].filter(Boolean).join(' · ');
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 26, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING_SOFT, delay: d(index * 0.08) }}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
    >
      <Avatar candidate={c} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
        {c.headline && <p className="truncate text-xs text-foreground-secondary">{c.headline}</p>}
        {meta && <p className="truncate text-2xs text-muted-foreground">{meta}</p>}
        {score?.strengths[0] && <p className="mt-1 line-clamp-1 text-2xs text-foreground-secondary">{score.strengths[0]}</p>}
      </div>
      {score ? <ScoreRing score={score.score} /> : scoring === 'pending' ? <Skeleton aria-hidden="true" className="h-11 w-11 shrink-0 rounded-full" /> : null}
    </motion.li>
  );
};
