// Refonte mission, lot 1 : bandeau d'état sous l'en-tête (conception, 9).
// Mission archivée : Pipeline et Cadrage en lecture seule, Sourcing et Prise de
// contact fermés (ArchivedNotice), avec « Réactiver » pour qui en a le droit.
// Design simplifié (04/10/2026) : une phrase et le seul bouton plein de l'écran
// (aucun autre n'est affiché sur une mission archivée), sans icône ; c'est le
// seul « Réactiver » de la page. Hors ligne : bandeau existant de la barre
// latérale, rien de nouveau ici.
import { Button } from '@/components/ui/button';
import { useMissionV3 } from '../MissionV3Context';
import { useMissionStatusControl } from './missionStatus';

export function MissionStateBanner() {
  const { isArchived } = useMissionV3();
  const status = useMissionStatusControl();

  if (!isArchived) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted/60 py-2 pl-3 pr-2 text-sm text-foreground sm:pl-6 sm:pr-5"
    >
      <p className="min-w-0 flex-1">Mission archivée. Réactivez-la pour trier, sourcer ou contacter.</p>
      {status.canManage && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          disabled={status.saving}
          aria-busy={status.saving}
          onClick={() => void status.changeStatus('active')}
          className="max-sm:min-h-11"
        >
          {status.saving ? 'Réactivation…' : 'Réactiver'}
        </Button>
      )}
    </div>
  );
}
