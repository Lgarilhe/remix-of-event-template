import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VivierCandidate {
  airtable_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  status: string | null;
  skills: string[] | null;
  source_base: string;
  experience: string | null;
  education_level: string | null;
  shortlist_count: number;
  note_count: number;
  appointment_count: number;
  placement_count: number;
  last_interaction_date: string | null;
}

export interface VivierFilters {
  search: string;
  source_base: string | null;
  skill: string | null;
  min_shortlists: number;
  has_notes: boolean | null;
  has_appointments: boolean | null;
}

const DEFAULT_FILTERS: VivierFilters = {
  search: '',
  source_base: null,
  skill: null,
  min_shortlists: 1,
  has_notes: null,
  has_appointments: null,
};

export function useVivierCandidates() {
  const [candidates, setCandidates] = useState<VivierCandidate[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<VivierFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const fetchCandidates = useCallback(async (f?: VivierFilters, p?: number) => {
    const activeFilters = f ?? filters;
    const activePage = p ?? page;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_vivier_candidates', {
        p_limit: PAGE_SIZE,
        p_offset: activePage * PAGE_SIZE,
        p_source_base: activeFilters.source_base,
        p_skill: activeFilters.skill,
        p_min_shortlists: activeFilters.min_shortlists,
        p_has_notes: activeFilters.has_notes,
        p_has_appointments: activeFilters.has_appointments,
        p_search: activeFilters.search || null,
      });

      if (error) throw error;

      const rows = (data || []) as any[];
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      setTotalCount(total);
      setCandidates(rows.map(r => ({
        airtable_id: r.airtable_id,
        full_name: r.full_name,
        email: r.email,
        phone: r.phone,
        linkedin_url: r.linkedin_url,
        status: r.status,
        skills: r.skills,
        source_base: r.source_base,
        experience: r.experience,
        education_level: r.education_level,
        shortlist_count: Number(r.shortlist_count),
        note_count: Number(r.note_count),
        appointment_count: Number(r.appointment_count),
        placement_count: Number(r.placement_count),
        last_interaction_date: r.last_interaction_date,
      })));
    } catch (err) {
      console.error('Error fetching vivier candidates:', err);
      setCandidates([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  const updateFilters = useCallback((partial: Partial<VivierFilters>) => {
    setFilters(prev => {
      const next = { ...prev, ...partial };
      setPage(0);
      fetchCandidates(next, 0);
      return next;
    });
  }, [fetchCandidates]);

  const goToPage = useCallback((p: number) => {
    setPage(p);
    fetchCandidates(filters, p);
  }, [fetchCandidates, filters]);

  return {
    candidates,
    totalCount,
    loading,
    filters,
    updateFilters,
    fetchCandidates,
    page,
    goToPage,
    pageSize: PAGE_SIZE,
  };
}
