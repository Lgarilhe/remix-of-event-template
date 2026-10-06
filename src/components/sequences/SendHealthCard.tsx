// Carte « État de l'envoi » en tête du Journal d'une séquence (lot 5c-2) :
// le corps du diagnostic des envois (SequenceDiagnosticBody), filtré sur les
// inscriptions de cette séquence, sans le panneau latéral. Un échec nommé mène
// au parcours du candidat. « Diagnostic des envois » du menu « ... » y mène.
import { forwardRef } from 'react';
import { SequenceDiagnosticBody } from '@/components/outreach/SequenceDiagnostic';

interface SendHealthCardProps {
  sequenceId: string;
  active: boolean;
  onShowJourney: (enrollmentId: string) => void;
}

export const SendHealthCard = forwardRef<HTMLElement, SendHealthCardProps>(function SendHealthCard({ sequenceId, active, onShowJourney }, ref) {
  return (
    <section ref={ref} id="etat-envoi" tabIndex={-1} aria-labelledby="etat-envoi-titre" className="scroll-mt-4 space-y-4 outline-none">
      <h2 id="etat-envoi-titre" className="eyebrow">État de l’envoi</h2>
      <SequenceDiagnosticBody active={active} sequenceId={sequenceId} compact onShowJourney={onShowJourney} />
    </section>
  );
});
