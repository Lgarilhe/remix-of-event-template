/* eslint-disable react-refresh/only-export-components -- Harnais isolé, sans serveur de développement. */
/** Le document SEO et la création de tâche ne sont pas le sujet de ce parcours. */
export const SEOHead = () => null;
export const CreateTaskModal = () => { throw new Error('Création de tâche inattendue dans l’aperçu'); };
export const CreateEventModal = ({ open }: { open: boolean }) => {
  if (open) throw new Error('Création de rendez-vous inattendue dans l’aperçu');
  return null;
};
const emptyEvents: never[] = [];
export function useCalendarEvents() {
  const w = window as Window & { calendarLiveReads: number };
  w.calendarLiveReads = (w.calendarLiveReads ?? 0) + 1;
  return { data: emptyEvents, isLoading: false, isError: false, isFetching: false, refetch: () => {} };
}
export const groupEventsByDay = () => ({});
export const useAuthReady = () => ({ user: null, isReady: true });
/** Échec explicite si une régression tente de lire/écrire la base ou des crédits. */
export const supabase = new Proxy({}, {
  get(_target, key) { throw new Error(`Accès Supabase inattendu dans l’aperçu : ${String(key)}`); },
});
