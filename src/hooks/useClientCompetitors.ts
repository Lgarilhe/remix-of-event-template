import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { toast } from 'sonner';
import type { ClientCompetitor, CompetitorSuggestion } from '@/types/clientCompetitor';

/**
 * CRUD pour la liste de concurrents d'un client donné.
 *
 * Le clientName en input est normalisé (lowercase trim) côté DB via trigger,
 * donc on peut lui passer le nom tel que saisi dans le brief.
 *
 * Exposé :
 * - competitors : liste filtrée par client_company_name_normalized
 * - addCompetitor / removeCompetitor / toggleCompetitor
 * - bulkInsertSuggestions : insère un lot de suggestions AI en une fois
 * - generateSuggestions : appelle l'edge fn generate-client-competitors
 */
export function useClientCompetitors(clientName: string | null | undefined) {
  const { organizationId } = useOrganization();
  const [competitors, setCompetitors] = useState<ClientCompetitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const normalized = useMemo(
    () => (clientName ? clientName.toLowerCase().trim() : ''),
    [clientName],
  );

  const fetch = useCallback(async () => {
    if (!organizationId || !normalized) {
      setCompetitors([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from('client_competitors' as never)
        .select('*')
        .eq('organization_id', organizationId)
        .eq('client_company_name_normalized', normalized)
        .order('relation_kind', { ascending: true })
        .order('created_at', { ascending: true }) as unknown as Promise<{ data: ClientCompetitor[] | null; error: { message: string } | null }>);
      if (error) throw error;
      setCompetitors((data || []) as ClientCompetitor[]);
    } catch (err) {
      console.error('[useClientCompetitors] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [organizationId, normalized]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const addCompetitor = useCallback(async (input: {
    competitor_name: string;
    relation_kind?: ClientCompetitor['relation_kind'];
    reason?: string;
    country?: string;
    domain?: string;
    source?: 'manual' | 'ai_suggested';
  }): Promise<ClientCompetitor | null> => {
    if (!organizationId || !clientName) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await (supabase
        .from('client_competitors' as never)
        .insert({
          organization_id: organizationId,
          client_company_name: clientName,
          client_company_name_normalized: normalized,
          competitor_name: input.competitor_name.trim(),
          relation_kind: input.relation_kind || 'direct',
          reason: input.reason,
          country: input.country,
          domain: input.domain,
          source: input.source || 'manual',
          created_by: user?.id,
        } as never)
        .select()
        .single() as unknown as Promise<{ data: ClientCompetitor | null; error: { message: string } | null }>);
      if (error) throw error;
      const created = data as ClientCompetitor;
      setCompetitors((prev) => [...prev, created]);
      return created;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      // 23505 = duplicate, on ne toast pas
      if (!message.includes('duplicate') && !message.includes('23505')) {
        console.error('[useClientCompetitors] add error:', err);
        toast.error(`Erreur ajout : ${message}`);
      }
      return null;
    }
  }, [organizationId, clientName, normalized]);

  const removeCompetitor = useCallback(async (id: string): Promise<boolean> => {
    if (!organizationId) return false;
    try {
      const { error } = await (supabase
        .from('client_competitors' as never)
        .delete()
        .eq('id', id) as unknown as Promise<{ error: { message: string } | null }>);
      if (error) throw error;
      setCompetitors((prev) => prev.filter((c) => c.id !== id));
      return true;
    } catch (err) {
      console.error('[useClientCompetitors] remove error:', err);
      return false;
    }
  }, [organizationId]);

  const toggleCompetitor = useCallback(async (id: string): Promise<boolean> => {
    const current = competitors.find((c) => c.id === id);
    if (!current) return false;
    try {
      const { error } = await (supabase
        .from('client_competitors' as never)
        .update({ enabled: !current.enabled })
        .eq('id', id) as unknown as Promise<{ error: { message: string } | null }>);
      if (error) throw error;
      setCompetitors((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
      return true;
    } catch (err) {
      console.error('[useClientCompetitors] toggle error:', err);
      return false;
    }
  }, [competitors]);

  const bulkInsertSuggestions = useCallback(async (suggestions: CompetitorSuggestion[]): Promise<number> => {
    if (!organizationId || !clientName || suggestions.length === 0) return 0;
    let inserted = 0;
    for (const s of suggestions) {
      const result = await addCompetitor({
        competitor_name: s.name,
        relation_kind: s.relation_kind,
        reason: s.reason,
        country: s.country,
        domain: s.domain,
        source: 'ai_suggested',
      });
      if (result) inserted++;
    }
    return inserted;
  }, [organizationId, clientName, addCompetitor]);

  const generateSuggestions = useCallback(async (
    clientSector?: string,
    clientCountry?: string,
    clientDescription?: string,
  ): Promise<CompetitorSuggestion[]> => {
    if (!clientName) return [];
    setGenerating(true);
    try {
      const { data, error } = await invokeWithCredits('generate-client-competitors', 'generate_client_competitors', {
        client_company_name: clientName,
        client_sector: clientSector,
        client_country: clientCountry,
        client_description: clientDescription,
        organization_id: organizationId,
      });
      if (error) throw error;
      if (!data?.success) throw new Error('Génération échouée');
      return (data.competitors || []) as CompetitorSuggestion[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      console.error('[useClientCompetitors] generate error:', err);
      toast.error(`Génération impossible : ${message}`);
      return [];
    } finally {
      setGenerating(false);
    }
  }, [clientName, organizationId]);

  return {
    competitors,
    enabledCompetitors: useMemo(() => competitors.filter((c) => c.enabled), [competitors]),
    loading,
    generating,
    refresh: fetch,
    addCompetitor,
    removeCompetitor,
    toggleCompetitor,
    bulkInsertSuggestions,
    generateSuggestions,
  };
}
