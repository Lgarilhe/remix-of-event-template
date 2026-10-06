/**
 * Bandeau hors ligne (D42, §2.3), une seule fois en tête du panneau.
 * Gris, pas rouge : ce n'est pas une panne de Konekt. « Réessayer » relance
 * les lectures de la barre (React Query relance aussi seul les requêtes en
 * pause au retour du réseau). « Réessayer » est un Button du kit (lot 12).
 */
import { WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSidebarOffline } from '@/hooks/sidebar/useSidebarOffline';
import { SIDEBAR_GHOST_CLASS } from './sidebarButtonClass';

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function OfflineBanner() {
  const { offline, dataTime } = useSidebarOffline();
  const queryClient = useQueryClient();

  if (!offline) return null;

  const retry = () => {
    void queryClient.invalidateQueries({ queryKey: ['sidebar'] });
    void queryClient.invalidateQueries({ queryKey: ['all-reminders', 'overdue-count'] });
  };

  return (
    <div
      role="status"
      className="mx-1 mb-1 flex items-center gap-2 rounded-md bg-sidebar-accent/40 px-2 py-1.5 text-xs text-muted-foreground"
    >
      <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
      {/* Sur deux lignes si besoin : l'heure des données est l'information utile. */}
      <span className="min-w-0 flex-1 leading-4">
        {dataTime !== null ? `Hors ligne · données de ${formatTime(dataTime)}` : 'Hors ligne'}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={retry}
        className={cn(SIDEBAR_GHOST_CLASS, 'shrink-0 rounded-md px-2 text-xs font-medium text-sidebar-foreground min-h-11 md:min-h-7')}
      >
        Réessayer
      </Button>
    </div>
  );
}
