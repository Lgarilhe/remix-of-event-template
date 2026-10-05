// Onglet « Journal » de la page d'une séquence (lot 5c-2) : la carte « État
// de l'envoi », puis la file des étapes de cette séquence (celle du Journal
// d'activité, dans la page), paginée par curseur sur (scheduled_at, id).
import { forwardRef } from 'react';
import { SequenceActivityLog } from '@/components/outreach/SequenceActivityLog';
import { SendHealthCard } from './SendHealthCard';

interface JournalTabProps {
  sequenceId: string;
  onShowJourney: (enrollmentId: string) => void;
}

export const JournalTab = forwardRef<HTMLElement, JournalTabProps>(function JournalTab({ sequenceId, onShowJourney }, healthRef) {
  return (
    <div className="space-y-8">
      <SendHealthCard ref={healthRef} sequenceId={sequenceId} active onShowJourney={onShowJourney} />
      <section aria-labelledby="journal-file-titre" className="space-y-4">
        <h2 id="journal-file-titre" className="eyebrow">Étapes envoyées et prévues</h2>
        <SequenceActivityLog isOpen={false} onClose={() => undefined} embedded sequenceId={sequenceId} />
      </section>
    </div>
  );
});
