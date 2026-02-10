import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInFiltersState } from '@/components/outreach/types';
import { toast } from 'sonner';

export interface SavedFilterPreset {
  id: string;
  name: string;
  description: string | null;
  filters: LinkedInFiltersState;
  job_id: string | null;
  job_title: string | null;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export const useSavedFilterPresets = () => {
  const [presets, setPresets] = useState<SavedFilterPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchPresets = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setPresets([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('saved_filter_presets')
        .select('*')
        .order('usage_count', { ascending: false })
        .order('updated_at', { ascending: false });

      if (error) throw error;

      // Cast the JSONB filters to the correct type
      const typedPresets = (data || []).map(preset => ({
        ...preset,
        filters: preset.filters as unknown as LinkedInFiltersState,
      }));

      setPresets(typedPresets);
    } catch (error) {
      console.error('Error fetching filter presets:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPresets();
  }, [fetchPresets]);

  const savePreset = useCallback(async (
    name: string,
    filters: LinkedInFiltersState,
    jobId?: string | null,
    jobTitle?: string | null,
    description?: string
  ): Promise<boolean> => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        toast.error('Vous devez être connecté pour sauvegarder des filtres');
        return false;
      }
      const user = session.user;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase
        .from('saved_filter_presets')
        .insert([{
          created_by: user.id,
          name,
          description: description || null,
          filters: JSON.parse(JSON.stringify(filters)),
          job_id: jobId || null,
          job_title: jobTitle || null,
        }] as any);

      if (error) throw error;

      toast.success('Filtres sauvegardés !');
      await fetchPresets();
      return true;
    } catch (error) {
      console.error('Error saving filter preset:', error);
      toast.error('Erreur lors de la sauvegarde');
      return false;
    } finally {
      setSaving(false);
    }
  }, [fetchPresets]);

  const applyPreset = useCallback(async (preset: SavedFilterPreset): Promise<LinkedInFiltersState | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return preset.filters;

      // Update usage count and last_used_at
      await supabase
        .from('saved_filter_presets')
        .update({
          usage_count: preset.usage_count + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', preset.id);

      // Refetch to update local state
      fetchPresets();

      return preset.filters;
    } catch (error) {
      console.error('Error applying preset:', error);
      return preset.filters;
    }
  }, [fetchPresets]);

  const deletePreset = useCallback(async (presetId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from('saved_filter_presets')
        .delete()
        .eq('id', presetId);

      if (error) throw error;

      toast.success('Preset supprimé');
      setPresets(prev => prev.filter(p => p.id !== presetId));
      return true;
    } catch (error) {
      console.error('Error deleting preset:', error);
      toast.error('Erreur lors de la suppression');
      return false;
    }
  }, []);

  const updatePreset = useCallback(async (
    presetId: string,
    updates: Partial<Pick<SavedFilterPreset, 'name' | 'description' | 'filters'>>
  ): Promise<boolean> => {
    try {
      const updateData: Record<string, unknown> = {};
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.filters !== undefined) updateData.filters = updates.filters as unknown as Record<string, unknown>;

      const { error } = await supabase
        .from('saved_filter_presets')
        .update(updateData)
        .eq('id', presetId);

      if (error) throw error;

      toast.success('Preset mis à jour');
      await fetchPresets();
      return true;
    } catch (error) {
      console.error('Error updating preset:', error);
      toast.error('Erreur lors de la mise à jour');
      return false;
    }
  }, [fetchPresets]);

  return {
    presets,
    loading,
    saving,
    savePreset,
    applyPreset,
    deletePreset,
    updatePreset,
    refetch: fetchPresets,
  };
};
