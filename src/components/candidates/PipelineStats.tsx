/**
 * Indicateurs de la shortlist client, en tuiles neutres comme ceux du
 * pipeline global (revue design E-28). Le taux affiché ici rapporte les
 * gagnés à toute la shortlist : il s'appelle « Taux de placement », pour ne
 * pas le confondre avec le « Taux de réussite » du pipeline (gagnés parmi les
 * candidats sortis). Sous 1280 px, les trois premiers seulement.
 */
import React from 'react';
import { StatGrid, StatTile } from '@/components/layout';

interface PipelineStatsProps {
  data: Record<string, { id: string }[]>;
}

export const PipelineStats: React.FC<PipelineStatsProps> = ({ data }) => {
  const totalCandidates = Object.values(data).reduce((sum, entries) => sum + entries.length, 0);

  const wonCount = data['Gagné']?.length || 0;
  const lostCount = data['Perdu']?.length || 0;
  const inProgressCount = totalCandidates - wonCount - lostCount;
  const placementRate = totalCandidates > 0 ? Math.round((wonCount / totalCandidates) * 100) : 0;

  return (
    <StatGrid cols={{ base: 3 }} className="mb-4 xl:grid-cols-5">
      <StatTile label="Candidatures" value={totalCandidates} />
      <StatTile label="En cours" value={inProgressCount} />
      <StatTile label="Gagnés" value={wonCount} />
      <StatTile label="Perdus" value={lostCount} className="hidden xl:flex" />
      <StatTile label="Taux de placement" value={`${placementRate}\u00a0%`} className="hidden xl:flex" />
    </StatGrid>
  );
};
