// Refonte mission, lot 1 : écran fermé d'une mission archivée (conception 9,
// « tout en lecture »). Le Sourcing et la Prise de contact n'ont pas de mode
// lecture seule : sur une mission archivée, ils laissent la place à ce message.
// Design simplifié (04/10/2026) : une phrase, sans cadre ni icône. « Réactiver »
// est déjà dans le bandeau de la page (MissionStateBanner) : un seul par écran.
// `withAction` le remet ici seulement quand le bandeau n'est pas atteignable,
// c'est-à-dire dans le panneau plein écran (sous lg), où le reste de la page est
// inerte.
import { Button } from '@/components/ui/button';
import { useMissionStatusControl } from './missionStatus';

export function ArchivedNotice({ text, withAction = false }: { text: string; withAction?: boolean }) {
  const status = useMissionStatusControl();
  return (
    <div
      role="status"
      data-testid="archived-notice"
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-8 text-center"
    >
      <p className="text-md text-foreground-secondary">{text}</p>
      {withAction && status.canManage && (
        <Button
          type="button"
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
