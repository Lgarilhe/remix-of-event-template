import React from 'react';
import { ShortlistEntry } from '@/pages/Candidates';
import { CandidateCard } from './CandidateCard';

interface CandidateListProps {
  entries: ShortlistEntry[];
}

export const CandidateList: React.FC<CandidateListProps> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="bg-background border border-border p-12 text-center">
        <p className="text-muted-foreground">Aucune candidature ne correspond à vos critères</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map(entry => (
        <CandidateCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
};
