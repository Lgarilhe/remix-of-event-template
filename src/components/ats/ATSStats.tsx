/**
 * Indicateurs du pipeline global, en tuiles neutres sans survol (revue design
 * E-24) : rien ne s'y clique. Deux colonnes au téléphone et trois ensuite,
 * pour que chaque libellé (« Contactés au total ») reste lisible en entier (E-21).
 *
 * Design simplifié (lot Suite) : affichés dans l'onglet Analyse seulement, en
 * tuiles sans cadre (fond doux, comme le Bilan de la page mission) ; une tuile
 * à zéro ne s'affiche pas.
 *
 * Lot 0c-4 : les tuiles comptent des cumuls « au total » (plan 0c, section
 * 4.1), sur l'étape générale et les jalons, mêmes définitions que les ever_*
 * de get_mission_stage_counts : un candidat contacté puis écarté reste compté.
 */
import React from 'react';
import { StatGrid, StatTile } from '@/components/layout';
import type { ATSCandidate } from '@/hooks/useATSData';
import { CUMULATIVE_LABEL } from '@/lib/stageDisplay';

interface ATSStatsProps {
  candidates: ATSCandidate[];
}

/** Étape atteinte : jalon, étape actuelle, ou étape d'avant un écart (colonnes ever_*). */
const reached = (c: ATSCandidate, milestone: string | null | undefined, stages: readonly string[]): boolean =>
  !!milestone
  || (!!c.generalStage && stages.includes(c.generalStage))
  || (!!c.rejectedFromStage && stages.includes(c.rejectedFromStage));

const CONTACTED_STAGES = ['contacted', 'replied', 'interviewing', 'hired'];
const REPLIED_STAGES = ['replied', 'interviewing', 'hired'];
const INTERVIEWED_STAGES = ['interviewing', 'hired'];
const HIRED_STAGES = ['hired'];

const percent = (value: number) => `${value}\u00a0%`;

/** Tuile sans cadre : fond doux, comme les chiffres du Bilan de la page mission. */
const TILE = 'rounded-xl border-0 bg-muted/60';

export const ATSStats: React.FC<ATSStatsProps> = ({ candidates }) => {
  const stats = React.useMemo(() => {
    const total = candidates.length;
    const contacted = candidates.filter(c => reached(c, c.contactedAt, CONTACTED_STAGES)).length;
    const replied = candidates.filter(c => reached(c, c.repliedAt, REPLIED_STAGES)).length;
    const interviewed = candidates.filter(c => reached(c, c.firstInterviewAt, INTERVIEWED_STAGES)).length;
    const hired = candidates.filter(c => reached(c, c.hiredAt, HIRED_STAGES)).length;

    const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;

    return { total, contacted, replied, interviewed, hired, responseRate };
  }, [candidates]);

  return (
    <StatGrid cols={{ base: 2, sm: 3, xl: 6 }}>
      <StatTile label="Candidats" value={stats.total} className={TILE} />
      {stats.contacted > 0 && <StatTile label={CUMULATIVE_LABEL.ever_contacted} value={stats.contacted} className={TILE} />}
      {stats.replied > 0 && <StatTile label={CUMULATIVE_LABEL.ever_replied} value={stats.replied} className={TILE} />}
      {stats.replied > 0 && <StatTile label="Taux de réponse" value={percent(stats.responseRate)} className={TILE} />}
      {stats.interviewed > 0 && <StatTile label={CUMULATIVE_LABEL.ever_interviewed} value={stats.interviewed} className={TILE} />}
      {stats.hired > 0 && <StatTile label={CUMULATIVE_LABEL.ever_hired} value={stats.hired} className={TILE} />}
    </StatGrid>
  );
};
