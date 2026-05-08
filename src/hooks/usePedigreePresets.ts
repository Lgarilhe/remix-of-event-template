import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';
import type { ClientPedigreePreset, PedigreeRequirements } from '@/types/pedigreePreset';

/**
 * CRUD pour les presets de critères pedigree client.
 *
 * Auto-fetch les presets de l'org au mount + à chaque change d'orgId.
 * Expose les helpers create/update/delete avec toast feedback.
 *
 * Pour récupérer le preset auto-applied pour un client_company_name donné,
 * utiliser getDefaultForClient(name).
 */
export function usePedigreePresets() {
  const { organizationId } = useOrganization();
  const [presets, setPresets] = useState<ClientPedigreePreset[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPresets = useCallback(async () => {
    if (!organizationId) {
      setPresets([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from('client_pedigree_presets' as never)
        .select('*')
        .eq('organization_id', organizationId)
        .order('updated_at', { ascending: false }) as unknown as Promise<{ data: ClientPedigreePreset[] | null; error: { message: string } | null }>);
      if (error) throw error;
      setPresets((data || []) as ClientPedigreePreset[]);
    } catch (err) {
      console.error('[usePedigreePresets] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const createPreset = useCallback(async (input: {
    name: string;
    description?: string;
    client_company_name?: string;
    pedigree_requirements: PedigreeRequirements;
    is_default_for_client?: boolean;
  }): Promise<ClientPedigreePreset | null> => {
    if (!organizationId) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Non connecté');
        return null;
      }
      const { data, error } = await (supabase
        .from('client_pedigree_presets' as never)
        .insert({
          organization_id: organizationId,
          created_by: user.id,
          ...input,
        } as never)
        .select()
        .single() as unknown as Promise<{ data: ClientPedigreePreset | null; error: { message: string } | null }>);
      if (error) throw error;
      const created = data as ClientPedigreePreset;
      setPresets(prev => [created, ...prev]);
      toast.success('Preset créé');
      return created;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      console.error('[usePedigreePresets] create error:', err);
      toast.error(`Erreur lors de la création : ${message}`);
      return null;
    }
  }, [organizationId]);

  const updatePreset = useCallback(async (
    id: string,
    patch: Partial<{
      name: string;
      description: string | null;
      client_company_name: string | null;
      pedigree_requirements: PedigreeRequirements;
      is_default_for_client: boolean;
    }>,
  ): Promise<boolean> => {
    if (!organizationId) return false;
    try {
      const { error } = await (supabase
        .from('client_pedigree_presets' as never)
        .update(patch as never)
        .eq('id', id)
        .eq('organization_id', organizationId) as unknown as Promise<{ error: { message: string } | null }>);
      if (error) throw error;
      setPresets(prev => prev.map(p => p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } as ClientPedigreePreset : p));
      toast.success('Preset mis à jour');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      console.error('[usePedigreePresets] update error:', err);
      toast.error(`Erreur lors de la mise à jour : ${message}`);
      return false;
    }
  }, [organizationId]);

  const deletePreset = useCallback(async (id: string): Promise<boolean> => {
    if (!organizationId) return false;
    try {
      const { error } = await (supabase
        .from('client_pedigree_presets' as never)
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId) as unknown as Promise<{ error: { message: string } | null }>);
      if (error) throw error;
      setPresets(prev => prev.filter(p => p.id !== id));
      toast.success('Preset supprimé');
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      console.error('[usePedigreePresets] delete error:', err);
      toast.error(`Erreur lors de la suppression : ${message}`);
      return false;
    }
  }, [organizationId]);

  /**
   * Retourne le preset par défaut pour un nom de client donné, ou null si
   * aucun n'est configuré. Utilisé pour auto-appliquer le preset au moment
   * de créer une nouvelle mission.
   */
  const getDefaultForClient = useCallback((clientName: string | null | undefined): ClientPedigreePreset | null => {
    if (!clientName) return null;
    const normalized = clientName.toLowerCase().trim();
    return presets.find(p =>
      p.is_default_for_client
      && p.client_company_name
      && p.client_company_name.toLowerCase().trim() === normalized
    ) ?? null;
  }, [presets]);

  return {
    presets,
    loading,
    refresh: fetchPresets,
    createPreset,
    updatePreset,
    deletePreset,
    getDefaultForClient,
  };
}
