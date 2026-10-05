// Ligne de rythme sous l'en-tête d'une séquence (lot 5c-2) : depuis quel
// compte partent les envois, vos horaires d'envoi, la prochaine action, et un
// point de santé qui mène au Journal quand un envoi est en échec. Un élément
// inconnu n'est pas écrit (jamais de zéro ni d'horaire inventé).
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { whenLabel } from '@/lib/enrollmentStatusLine';

export interface SendingHours {
  start: number;
  end: number;
  timezone: string;
}

interface RhythmLineProps {
  hours: SendingHours | null;
  /** Prochaine étape prévue d'un candidat en cours ; null : aucune ; undefined : en lecture. */
  nextAt: string | null | undefined;
  /** Candidats en échec d'envoi (send_failed, auto_paused) ; null si inconnu. */
  failedCount: number | null;
  sequenceActive: boolean;
  onShowJournal: () => void;
}

function zoneLabel(timezone: string): string {
  if (timezone === 'Europe/Paris') return 'heure de Paris';
  const city = timezone.split('/').pop()?.replace(/_/g, ' ');
  return city ? `heure de ${city}` : timezone;
}

export function RhythmLine({ hours, nextAt, failedCount, sequenceActive, onShowJournal }: RhythmLineProps) {
  const parts: ReactNode[] = ['Depuis le compte LinkedIn de la personne qui inscrit'];
  if (hours) parts.push(`du lundi au vendredi, de ${hours.start}\u00a0h à ${hours.end}\u00a0h (${zoneLabel(hours.timezone)})`);
  if (sequenceActive && nextAt) {
    // Échue : elle part au prochain passage de l'envoi automatique.
    parts.push(Date.parse(nextAt) <= Date.now() ? 'prochaine action au prochain passage' : `prochaine action ${whenLabel(nextAt)}`);
  }
  if (!sequenceActive) parts.push('aucun envoi tant que la séquence est en pause');
  return (
    // Téléphone : un élément par ligne, sans séparateur ; au-delà, une ligne séparée par des points.
    <p className="flex flex-col gap-0.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="hidden sm:inline">·</span>}
          {part}
        </span>
      ))}
      {failedCount !== null && failedCount > 0 && (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className="hidden sm:inline">·</span>
          <Button type="button" variant="link" onClick={onShowJournal} className="h-auto gap-1.5 p-0 text-xs text-danger max-md:min-h-11">
            <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
            {failedCount > 1 ? `${failedCount} candidats en échec` : '1 candidat en échec'}
          </Button>
        </span>
      )}
    </p>
  );
}
