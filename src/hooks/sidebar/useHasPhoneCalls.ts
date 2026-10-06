/**
 * L'organisation a-t-elle déjà reçu un appel de son opérateur (table
 * phone_calls) ? Le lien « Appels » de la rangée basse n'apparaît qu'alors :
 * une organisation sans téléphonie reliée ne voit rien changer.
 *
 * Comptage seul, sans lignes ; la RLS limite à l'organisation active.
 * false tant que la réponse n'est pas là ou en cas d'erreur : un lien de moins
 * vaut mieux qu'un lien vers une page vide.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';

export function useHasPhoneCalls(): boolean {
  const { organizationId } = useOrganization();
  const query = useQuery({
    queryKey: ['sidebar', 'has-phone-calls', organizationId],
    queryFn: async (): Promise<boolean> => {
      const { count, error } = await supabase.from('phone_calls').select('id', { count: 'exact', head: true });
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
  return query.data === true;
}
