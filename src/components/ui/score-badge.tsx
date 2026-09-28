import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SCORE_LEVELS, normalizeScore, scoreAccessibleLabel, scoreLevel } from "@/lib/scoreScale";

/**
 * ScoreBadge : le score d'adéquation d'un candidat, le même rendu sur toutes
 * les vues (carte, tableau, fiche, scorecard, assistant). Barème de
 * `src/lib/scoreScale.ts` ; le nombre suffit à l'écran (« 72 »), le « sur
 * 100 » et le niveau sont dans le nom accessible et l'infobulle.
 */

interface ScoreBadgeProps {
  score: number | null | undefined;
  /** Écrit le niveau à côté du nombre (« 72 · Fort »). */
  showLevel?: boolean;
  /** Texte quand il n'y a pas de score ; rien n'est rendu s'il est absent. */
  emptyLabel?: string;
  className?: string;
}

export function ScoreBadge({ score, showLevel = false, emptyLabel, className }: ScoreBadgeProps) {
  const value = normalizeScore(score);
  const level = scoreLevel(value);

  if (value === null || level === null) {
    if (!emptyLabel) return null;
    return (
      <Badge variant="muted" className={className}>
        {emptyLabel}
      </Badge>
    );
  }

  const meta = SCORE_LEVELS[level];
  const label = scoreAccessibleLabel(value);
  return (
    <Badge variant={meta.tone} className={cn("tabular-nums", className)} title={label} aria-label={label} role="img">
      {value}
      {showLevel && <span aria-hidden="true"> · {meta.label}</span>}
    </Badge>
  );
}
