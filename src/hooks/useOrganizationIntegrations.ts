import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from './useOrganization';
import { toast } from 'sonner';

/**
 * Projection publique de organization_integrations (vue organization_integrations_public).
 * Les secrets ne sont JAMAIS renvoyés au navigateur : seules les clés saisies par le client
 * (Notion / Calendly / Airtable / Aircall) exposent un suffixe masqué `*_hint` ("••••abcd").
 * Les clés provisionnées par Konekt n'apparaissent pas du tout.
 */
export interface OrganizationIntegrations {
  id: string;
  organization_id: string;
  notion_postes_db_id: string | null;
  notion_candidats_db_id: string | null;
  notion_shortlist_db_id: string | null;
  notion_connected: boolean;
  notion_api_key_hint: string | null;
  calendly_connected: boolean;
  calendly_api_key_hint: string | null;
  unipile_connected: boolean;
  airtable_base_id: string | null;
  airtable_base_id_2: string | null;
  airtable_connected: boolean;
  airtable_api_key_hint: string | null;
  aircall_api_id: string | null;
  aircall_connected: boolean;
  aircall_api_token_hint: string | null;
  coresignal_enabled: boolean;
}

/** Champs secrets saisis par le client — écrits uniquement via la RPC set_integration_secret. */
const SECRET_FIELDS: readonly string[] = [
  'notion_api_key',
  'calendly_api_key',
  'airtable_api_key',
  'aircall_api_token',
];

export type IntegrationUpdates = Record<string, string | boolean | null>;

export const useOrganizationIntegrations = () => {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();

  const { data: integrations, isLoading } = useQuery({
    queryKey: ['org-integrations', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      // Lecture via la vue publique : jamais de colonne secrète côté navigateur.
      // Pas de ligne → null (la ligne est créée à la première sauvegarde par la RPC).
      const { data, error } = await supabase
        .from('organization_integrations_public')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) throw error;
      return (data as OrganizationIntegrations | null) ?? null;
    },
    enabled: !!organizationId && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const updateIntegration = useMutation({
    mutationFn: async (updates: IntegrationUpdates) => {
      if (!organizationId) throw new Error('No organization');

      const settings: IntegrationUpdates = {};
      const secrets: Array<[string, string]> = [];
      for (const [key, value] of Object.entries(updates)) {
        if (SECRET_FIELDS.includes(key)) {
          // Champ write-only : chaîne vide = secret inchangé
          if (typeof value === 'string' && value.trim()) secrets.push([key, value.trim()]);
        } else {
          settings[key] = value;
        }
      }

      // Secrets d'abord : si l'un échoue, on ne marque pas l'intégration comme connectée
      for (const [field, value] of secrets) {
        const { error } = await supabase.rpc('set_integration_secret', {
          p_organization_id: organizationId,
          p_field: field,
          p_value: value,
        });
        if (error) throw error;
      }

      const { error } = await supabase.rpc('update_integration_settings', {
        p_organization_id: organizationId,
        p_updates: settings,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-integrations', organizationId] });
      toast.success('Intégration mise à jour');
    },
    onError: (err: Error) => {
      toast.error(`Erreur: ${err.message}`);
    },
  });

  return {
    integrations,
    isLoading,
    updateIntegration: updateIntegration.mutateAsync,
    isUpdating: updateIntegration.isPending,
  };
};
