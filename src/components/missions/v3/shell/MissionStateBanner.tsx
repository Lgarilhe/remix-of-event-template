// Refonte mission, lot 1 : bandeau d'état sous l'en-tête (conception, 9).
// Mission archivée : lecture seule, avec « Réactiver » pour qui en a le droit.
// Hors ligne : bandeau existant de la barre latérale, rien de nouveau ici.
import { Archive } from 'lucide-react';
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
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-muted px-3 py-2 text-sm text-foreground sm:px-4"
    >
      <Archive aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="min-w-0 flex-1">Mission archivée. Elle est en lecture seule.</p>
      {status.canManage && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={status.saving}
          aria-busy={status.saving}
          onClick={() => void status.changeStatus('active')}
        >
          {status.saving ? 'Réactivation…' : 'Réactiver'}
        </Button>
      )}
    </div>
  );
}
