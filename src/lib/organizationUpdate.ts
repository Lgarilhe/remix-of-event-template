import { supabase } from '@/integrations/supabase/client';
import type { Tables, TablesUpdate } from '@/integrations/supabase/types';

// Refus posés par le trigger organizations_update_guard (champ hint de l'erreur).
const REFUSALS: Record<string, string> = {
  ORG_OWNER_ONLY: 'Seul le propriétaire de l’organisation peut modifier ce réglage.',
  ORG_FREELANCE_NOT_SOLO:
    'Impossible de passer en Indépendant : retirez d’abord les autres membres et annulez les invitations en attente.',
  ORG_IMMUTABLE: 'Ce champ de l’organisation n’est pas modifiable.',
};

/**
 * UPDATE sur public.organizations qui ne ment pas. Sans .select(), un refus RLS
 * répond « succès » avec 0 ligne : on relit la ligne écrite et on lève une
 * erreur en français si rien n'a changé ou si le serveur refuse.
 */
export async function updateOrganization(
  organizationId: string,
  patch: TablesUpdate<'organizations'>,
): Promise<Tables<'organizations'>> {
  const { data, error } = await supabase
    .from('organizations')
    .update(patch)
    .eq('id', organizationId)
    .select();
  if (error) {
    console.error('[updateOrganization]', error);
    throw new Error(REFUSALS[error.hint ?? ''] ?? 'L’enregistrement a échoué. Réessayez.');
  }
  // 0 ligne : la policy admins_update a filtré la ligne (membre, collaborateur,
  // rôle retiré entre-temps). Nom, logo, site et consignes IA restent ouverts
  // aux administrateurs, d'où le renvoi vers l'un ou l'autre.
  if (!data?.length) {
    throw new Error(
      'Vous n’avez pas les droits pour modifier ce réglage. Demandez au propriétaire de l’organisation ou à un administrateur.',
    );
  }
  return data[0];
}
