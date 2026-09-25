/**
 * Indicateurs du pipeline global, en tuiles neutres sans survol (revue design
 * E-24) : rien ne s'y clique. Sous 1280 px, les trois comptes seulement, pour
 * que chaque libellé reste lisible en entier (E-21).
 */
import React from 'react';
import { StatGrid, StatTile } from '@/components/layout';
import type { ATSCandidate } from '@/hooks/useATSData';

interface ATSStatsProps {
  candidates: ATSCandidate[];
}

function isContacted(c: ATSCandidate): boolean {
  if (['messaged', 'replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
  if (['Contacté', 'Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
  // Only count sequence as contacted if a message was actually sent (completed/replied), not just enrolled (active)
  if (c.sequenceStatus && ['completed', 'replied'].includes(c.sequenceStatus)) return true;
  if (c.source === 'inmail' && !['Nouveau'].includes(c.stage)) return true;
  return false;
}

function isReplied(c: ATSCandidate): boolean {
  if (['Répondu', 'Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre', 'Gagné'].includes(c.stage)) return true;
  if (['replied', 'interested', 'not_interested'].includes(c.outreachStatus || '')) return true;
  if (c.sequenceStatus === 'replied') return true;
  return false;
}

const percent = (value: number) => `${value}\u00a0%`;

export const ATSStats: React.FC<ATSStatsProps> = ({ candidates }) => {
  const stats = React.useMemo(() => {
    const total = candidates.length;
    const contacted = candidates.filter(isContacted).length;
    const replied = candidates.filter(isReplied).length;
    const inProgress = candidates.filter(c =>
      ['Pré-qualif', 'CV envoyé', 'ITW en cours', 'Offre'].includes(c.stage)
    ).length;
    const won = candidates.filter(c => c.stage === 'Gagné').length;
    const lost = candidates.filter(c => c.stage === 'Perdu').length;

    const responseRate = contacted > 0 ? Math.round((replied / contacted) * 100) : 0;
    const successRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;

    return { total, contacted, inProgress, won, responseRate, successRate };
  }, [candidates]);

  return (
    <StatGrid cols={{ base: 3, xl: 6 }} className="mb-4">
      <StatTile label="Candidats" value={stats.total} />
      <StatTile label="Contactés" value={stats.contacted} />
      <StatTile label="Taux de réponse" value={percent(stats.responseRate)} className="hidden xl:flex" />
      <StatTile label="En cours" value={stats.inProgress} />
      <StatTile label="Gagnés" value={stats.won} className="hidden xl:flex" />
      <StatTile label="Taux de réussite" value={percent(stats.successRate)} className="hidden xl:flex" />
    </StatGrid>
  );
};
