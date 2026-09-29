// Refonte mission, lot 1 : écran fermé d'une mission archivée (conception 9,
// « tout en lecture »). Le Sourcing et la Prise de contact n'ont pas de mode
// lecture seule : sur une mission archivée, ils laissent la place à ce message,
// avec « Réactiver » pour qui en a le droit.
import { Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMissionStatusControl } from './missionStatus';

export function ArchivedNotice({ text }: { text: string }) {
  const status = useMissionStatusControl();
  return (
    <div
      role="status"
      data-testid="archived-notice"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-8 text-center"
    >
      <Archive aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">Mission archivée</p>
      <p className="text-sm text-muted-foreground">{text}</p>
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
