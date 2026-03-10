import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VivierContact {
  airtable_id: string;
  full_name: string | null;
  email: string | null;
  title: string | null;
  contact_type: string | null;
  city: string | null;
  status: string | null;
  source_base: string;
  company_airtable_id: string | null;
  company_name: string | null;
  shortlist_count: number;
  note_count: number;
  appointment_count: number;
  placement_count: number;
  last_interaction_date: string | null;
}

export interface VivierFilters {
  search: string;
  source_base: string | null;
  contact_type: string | null;
  min_shortlists: number;
}

const DEFAULT_FILTERS: VivierFilters = {
  search: '',
  source_base: null,
  contact_type: null,
  min_shortlists: 1,
};

export function useVivierContacts() {
  const [contacts, setContacts] = useState<VivierContact[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<VivierFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const fetchContacts = useCallback(async (f?: VivierFilters, p?: number) => {
    const activeFilters = f ?? filters;
    const activePage = p ?? page;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_vivier_contacts', {
        p_limit: PAGE_SIZE,
        p_offset: activePage * PAGE_SIZE,
        p_source_base: activeFilters.source_base,
        p_contact_type: activeFilters.contact_type,
        p_min_shortlists: activeFilters.min_shortlists,
        p_search: activeFilters.search || null,
      });

      if (error) throw error;

      const rows = (data || []) as any[];
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      setTotalCount(total);
      setContacts(rows.map(r => ({
        airtable_id: r.airtable_id,
        full_name: r.full_name,
        email: r.email,
        title: r.title,
        contact_type: r.contact_type,
        city: r.city,
        status: r.status,
        source_base: r.source_base,
        company_airtable_id: r.company_airtable_id,
        company_name: r.company_name,
        shortlist_count: Number(r.shortlist_count),
        note_count: Number(r.note_count),
        appointment_count: Number(r.appointment_count),
        placement_count: Number(r.placement_count),
        last_interaction_date: r.last_interaction_date,
      })));
    } catch (err) {
      console.error('Error fetching vivier contacts:', err);
      setContacts([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const updateFilters = useCallback((partial: Partial<VivierFilters>) => {
    setFilters(prev => {
      const next = { ...prev, ...partial };
      setPage(0);
      fetchContacts(next, 0);
      return next;
    });
  }, [fetchContacts]);

  const goToPage = useCallback((p: number) => {
    setPage(p);
    fetchContacts(filters, p);
  }, [fetchContacts, filters]);

  return {
    contacts,
    totalCount,
    loading,
    filters,
    updateFilters,
    fetchContacts,
    page,
    goToPage,
    pageSize: PAGE_SIZE,
  };
}
