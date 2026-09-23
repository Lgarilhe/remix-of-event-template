/**
 * Bandeau hors ligne (D42, §2.3), une seule fois en tête du panneau.
 * Gris, pas rouge : ce n'est pas une panne de Konekt. « Réessayer » relance
 * les lectures de la barre (React Query relance aussi seul les requêtes en
 * pause au retour du réseau).
 */
import { WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSidebarOffline } from '@/hooks/sidebar/useSidebarOffline';

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
      className="mx-1 mb-1 flex items-center gap-2 rounded-md bg-sidebar-accent/40 px-2 py-1.5 text-[12px] text-muted-foreground"
    >
      <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
      {/* Sur deux lignes si besoin : l'heure des données est l'information utile. */}
      <span className="min-w-0 flex-1 leading-4">
        {dataTime !== null ? `Hors ligne · données de ${formatTime(dataTime)}` : 'Hors ligne'}
      </span>
      <button
        type="button"
        onClick={retry}
        className="shrink-0 rounded-md px-2 text-[12px] font-medium text-sidebar-foreground min-h-11 md:min-h-7 hover:bg-sidebar-accent/60 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        Réessayer
      </button>
    </div>
  );
}
