// Ligne de rythme sous l'en-tête d'une séquence (lot 5c-2) : depuis quel
// compte partent les envois, vos horaires d'envoi, la prochaine action, et un
// point de santé qui mène au Journal quand un envoi est en échec. Un élément
// inconnu n'est pas écrit (jamais de zéro ni d'horaire inventé).
//
// Les points séparent deux éléments d'une même ligne seulement : chaque
// élément porte son point à gauche, et celui d'un début de ligne tombe hors
// de la zone visible (marge négative et débordement masqué), quelle que soit
// la largeur.
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { whenLabel } from '@/lib/enrollmentStatusLine';
import type { SequenceStatusKind } from './SequenceStatusPill';

export interface SendingHours {
  start: number;
  end: number;
  timezone: string;
}

interface RhythmLineProps {
  hours: SendingHours | null;
  /** Prochaine étape envoyable d'un candidat en cours ; null : aucune ; undefined : en lecture. */
  nextAt: string | null | undefined;
  /** Candidats en échec d'envoi (send_failed, auto_paused) ; null si inconnu. */
  failedCount: number | null;
  /** Statut de la pastille : un brouillon n'est pas une séquence en pause. */
  status: SequenceStatusKind;
  onShowJournal: () => void;
}

function zoneLabel(timezone: string): string {
  if (timezone === 'Europe/Paris') return 'heure de Paris';
  const city = timezone.split('/').pop()?.replace(/_/g, ' ');
  return city ? `heure de ${city}` : timezone;
}

export function RhythmLine({ hours, nextAt, failedCount, status, onShowJournal }: RhythmLineProps) {
  const parts: ReactNode[] = ['Depuis le compte LinkedIn de la personne qui inscrit'];
  if (hours) parts.push(`du lundi au vendredi, de ${hours.start}\u00a0h à ${hours.end}\u00a0h (${zoneLabel(hours.timezone)})`);
  if (status === 'active' && nextAt) {
    // Échue : elle part au prochain passage de l'envoi automatique.
    parts.push(Date.parse(nextAt) <= Date.now() ? 'prochaine action au prochain passage' : `prochaine action ${whenLabel(nextAt)}`);
  }
  if (status === 'paused') parts.push('aucun envoi tant que la séquence est en pause');
  if (failedCount !== null && failedCount > 0) {
    parts.push(
      <Button type="button" variant="link" onClick={onShowJournal} className="h-auto gap-1.5 p-0 text-xs text-danger max-md:min-h-11">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
        {failedCount > 1 ? `${failedCount} candidats en échec` : '1 candidat en échec'}
      </Button>,
    );
  }
  return (
    // Le débordement masqué coupe le point d'un début de ligne ; la marge de 4 px garde l'anneau de focus visible.
    <div className="-mx-1 overflow-hidden px-1 py-0.5">
      <p className="-ml-3 flex flex-wrap items-center gap-y-1 text-xs text-muted-foreground">
        {parts.map((part, i) => (
          <span key={i} className="relative inline-flex items-center pl-3">
            <span aria-hidden="true" className="absolute left-1">·</span>
            {part}
          </span>
        ))}
      </p>
    </div>
  );
}
