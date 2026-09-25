import React from 'react';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/layout';
import { ShortlistEntry } from '@/types/shortlist';
import { CandidateCard } from './CandidateCard';

interface CandidateListProps {
  entries: ShortlistEntry[];
}

export const CandidateList: React.FC<CandidateListProps> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <EmptyState
        variant="compact"
        icon={SearchX}
        title="Aucune candidature ne correspond aux filtres"
        description="Modifiez ou effacez les filtres pour revoir toute la shortlist."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {entries.map(entry => (
        <li key={entry.id}>
          <CandidateCard entry={entry} />
        </li>
      ))}
    </ul>
  );
};
