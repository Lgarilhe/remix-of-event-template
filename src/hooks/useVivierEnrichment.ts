import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

export interface VivierEnrichment {
  id: string;
  contact_airtable_id: string;
  linkedin_url: string | null;
  match_type: string | null;
  current_job_title: string | null;
  current_company: string | null;
  headline: string | null;
  location: string | null;
  apollo_data: any;
  still_same_company: boolean | null;
  company_change_detail: string | null;
  notable_events: string[] | null;
  is_relevant: boolean | null;
  relevance_reason: string | null;
  generated_message: string | null;
  message_type: string | null;
  message_status: string | null;
  enriched_at: string | null;
}

const BATCH_SIZE = 10;

export function useVivierEnrichment() {
  const [enrichments, setEnrichments] = useState<Map<string, VivierEnrichment>>(new Map());
  const [isEnriching, setIsEnriching] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const fetchEnrichments = useCallback(async (contactIds: string[]) => {
    if (contactIds.length === 0) return;
    const { data } = await supabase
      .from('vivier_enrichments' as any)
      .select('*')
      .in('contact_airtable_id', contactIds);
    if (data) {
      const map = new Map<string, VivierEnrichment>();
      (data as any[]).forEach((e: any) => map.set(e.contact_airtable_id, e));
      setEnrichments(map);
    }
  }, []);

  const enrichContacts = useCallback(async (contactIds: string[], forceReEnrich = false) => {
    if (contactIds.length === 0) return;
    setIsEnriching(true);

    // Get sender name from current user profile
    let senderName = "Laurent";
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', user.id)
          .single();
        if (profile?.display_name) {
          senderName = profile.display_name.split(' ')[0]; // First name only
        }
      }
    } catch {} 
    setProgress({ done: 0, total: contactIds.length });

    // Filter out already enriched (unless force)
    const existing = new Set([...enrichments.keys()]);
    const toEnrich = forceReEnrich ? contactIds : contactIds.filter(id => !existing.has(id));

    if (toEnrich.length === 0) {
      toast.info('Tous les contacts sont déjà enrichis. Utilise "Ré-enrichir" pour forcer.');
      setIsEnriching(false);
      return;
    }

    let processed = contactIds.length - toEnrich.length;
    setProgress({ done: processed, total: contactIds.length });

    for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
      const batch = toEnrich.slice(i, i + BATCH_SIZE);
      try {
        const { data, error } = await invokeEdgeFunction('enrich-vivier-contacts', {
          contact_ids: batch,
        });
        if (error || !data?.success) {
          console.error('Enrichment batch error:', error || data?.error);
          toast.error(`Erreur sur le batch ${Math.floor(i / BATCH_SIZE) + 1}`);
        }
      } catch (e) {
        console.error('Enrichment exception:', e);
      }

      processed += batch.length;
      setProgress({ done: processed, total: contactIds.length });

      // Delay between batches
      if (i + BATCH_SIZE < toEnrich.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Re-fetch all enrichments
    await fetchEnrichments(contactIds);
    setIsEnriching(false);
    toast.success(`Enrichissement terminé : ${toEnrich.length} contacts traités`);
  }, [enrichments, fetchEnrichments]);

  const updateMessageStatus = useCallback(async (contactAirtableId: string, status: string) => {
    await supabase
      .from('vivier_enrichments' as any)
      .update({ message_status: status } as any)
      .eq('contact_airtable_id', contactAirtableId);
    setEnrichments(prev => {
      const next = new Map(prev);
      const existing = next.get(contactAirtableId);
      if (existing) next.set(contactAirtableId, { ...existing, message_status: status });
      return next;
    });
  }, []);

  return {
    enrichments,
    isEnriching,
    progress,
    fetchEnrichments,
    enrichContacts,
    updateMessageStatus,
  };
}
