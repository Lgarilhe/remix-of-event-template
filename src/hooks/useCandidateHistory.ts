import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CandidateHistoryData {
  candidate: {
    airtable_id: string;
    full_name: string | null;
    status: string | null;
    email: string | null;
    phone: string | null;
    source_base: string;
    skills: string[] | null;
  } | null;
  shortlists: Array<{
    airtable_id: string;
    status: string | null;
    date_added: string | null;
    job_title: string | null;
    company_name: string | null;
    salary_proposed: string | null;
  }>;
  placements: Array<{
    airtable_id: string;
    name: string | null;
    status: string | null;
    start_date: string | null;
    salary: string | null;
    contract_type: string | null;
    company_name: string | null;
  }>;
  notes: Array<{
    airtable_id: string;
    title: string | null;
    detail: string | null;
    note_type: string | null;
    note_date: string | null;
    author: string | null;
  }>;
  appointments: Array<{
    airtable_id: string;
    title: string | null;
    appointment_date: string | null;
    appointment_type: string | null;
    status: string | null;
    notes: string | null;
  }>;
}

// Global cache by key (linkedin url or airtable_id)
const historyCache = new Map<string, CandidateHistoryData | null>();

function extractLinkedInSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

interface UseCandidateHistoryOptions {
  linkedinUrl?: string | null;
  airtableId?: string | null;
}

/**
 * Fetch candidate history from Airtable cache tables.
 * Accepts either a LinkedIn URL or a direct Airtable ID (for fuzzy-matched candidates without LinkedIn URL).
 */
export function useCandidateHistory(
  linkedinUrlOrOptions: string | null | undefined | UseCandidateHistoryOptions
) {
  // Normalize input: support both old string API and new options API
  let resolvedOptions: UseCandidateHistoryOptions;
  if (linkedinUrlOrOptions == null || typeof linkedinUrlOrOptions === 'string') {
    resolvedOptions = { linkedinUrl: linkedinUrlOrOptions as string | null | undefined };
  } else {
    resolvedOptions = linkedinUrlOrOptions;
  }

  const { linkedinUrl, airtableId } = resolvedOptions;

  

  const [data, setData] = useState<CandidateHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const cacheKey = airtableId
    ? `history:v2:at:${airtableId}`
    : linkedinUrl
      ? `history:v2:li:${linkedinUrl.toLowerCase().replace(/\/$/, '')}`
      : null;

  const fetchHistory = useCallback(async () => {
    if ((!linkedinUrl && !airtableId) || loaded || loading) return;
    if (!cacheKey) return;

    const cached = historyCache.get(cacheKey);
    if (cached !== undefined) {
      setData(cached);
      setLoaded(true);
      return;
    }

    setLoading(true);
    try {
      let candidateAirtableId = airtableId || null;

      // If no direct airtable_id, look up by LinkedIn URL
      if (!candidateAirtableId && linkedinUrl) {
        const slug = extractLinkedInSlug(linkedinUrl);
        if (!slug) { setLoading(false); setLoaded(true); return; }

        const { data: candidates, error: candError } = await supabase
          .from('airtable_candidates')
          .select('airtable_id, full_name, status, email, phone, source_base, skills, linkedin_url')
          .ilike('linkedin_url', `%${slug}%`)
          .limit(1);

        if (candError || !candidates?.length) {
          historyCache.set(cacheKey, null);
          setLoaded(true);
          setLoading(false);
          return;
        }

        candidateAirtableId = candidates[0].airtable_id;
      }

      if (!candidateAirtableId) {
        historyCache.set(cacheKey, null);
        setLoaded(true);
        setLoading(false);
        return;
      }

      // Fetch candidate info (if we don't have it yet from URL lookup)
      let candidateInfo: CandidateHistoryData['candidate'] = null;
      const { data: candData } = await supabase
        .from('airtable_candidates')
        .select('airtable_id, full_name, status, email, phone, source_base, skills')
        .eq('airtable_id', candidateAirtableId)
        .limit(1);

      if (candData?.length) {
        const c = candData[0];
        candidateInfo = {
          airtable_id: c.airtable_id,
          full_name: c.full_name,
          status: c.status,
          email: c.email,
          phone: c.phone,
          source_base: c.source_base,
          skills: c.skills,
        };
      }

      // Fetch all related data in parallel
      const [shortlistsRes, placementsRes, notesRes, appointmentsRes] = await Promise.all([
        supabase
          .from('airtable_shortlists')
          .select('airtable_id, status, date_added, created_at, salary_proposed, job_airtable_id, company_airtable_id')
          .eq('candidate_airtable_id', candidateAirtableId),
        supabase
          .from('airtable_placements')
          .select('airtable_id, name, status, start_date, created_at, salary, contract_type, company_airtable_id')
          .eq('candidate_airtable_id', candidateAirtableId),
        supabase
          .from('airtable_notes')
          .select('airtable_id, title, detail, note_type, note_date, created_at, author')
          .eq('candidate_airtable_id', candidateAirtableId)
          .order('note_date', { ascending: false })
          .limit(20),
        supabase
          .from('airtable_appointments')
          .select('airtable_id, title, appointment_date, created_at, appointment_type, status, notes')
          .eq('candidate_airtable_id', candidateAirtableId)
          .order('appointment_date', { ascending: false })
          .limit(20),
      ]);

      // Resolve company & job names
      const companyIds = new Set<string>();
      const jobIds = new Set<string>();

      shortlistsRes.data?.forEach(s => {
        if (s.company_airtable_id) companyIds.add(s.company_airtable_id);
        if (s.job_airtable_id) jobIds.add(s.job_airtable_id);
      });
      placementsRes.data?.forEach(p => {
        if (p.company_airtable_id) companyIds.add(p.company_airtable_id);
      });

      const [companiesRes, jobsRes] = await Promise.all([
        companyIds.size > 0
          ? supabase.from('airtable_companies').select('airtable_id, name').in('airtable_id', [...companyIds])
          : Promise.resolve({ data: [] as { airtable_id: string; name: string }[], error: null }),
        jobIds.size > 0
          ? supabase.from('airtable_jobs').select('airtable_id, title').in('airtable_id', [...jobIds])
          : Promise.resolve({ data: [] as { airtable_id: string; title: string | null }[], error: null }),
      ]);

      const companyMap = new Map((companiesRes.data || []).map(c => [c.airtable_id, c.name]));
      const jobMap = new Map((jobsRes.data || []).map(j => [j.airtable_id, j.title]));

      const result: CandidateHistoryData = {
        candidate: candidateInfo,
        shortlists: (shortlistsRes.data || []).map(s => ({
          airtable_id: s.airtable_id,
          status: s.status,
          date_added: normalizeDate(s.date_added) || normalizeDate(s.created_at),
          job_title: s.job_airtable_id ? jobMap.get(s.job_airtable_id) || null : null,
          company_name: s.company_airtable_id ? companyMap.get(s.company_airtable_id) || null : null,
          salary_proposed: s.salary_proposed,
        })),
        placements: (placementsRes.data || []).map(p => ({
          airtable_id: p.airtable_id,
          name: p.name,
          status: p.status,
          start_date: normalizeDate(p.start_date) || normalizeDate(p.created_at),
          salary: p.salary,
          contract_type: p.contract_type,
          company_name: p.company_airtable_id ? companyMap.get(p.company_airtable_id) || null : null,
        })),
        notes: (notesRes.data || []).map(n => ({
          airtable_id: n.airtable_id,
          title: n.title,
          detail: n.detail,
          note_type: n.note_type,
          note_date: normalizeDate(n.note_date) || normalizeDate(n.created_at),
          author: n.author,
        })),
        appointments: (appointmentsRes.data || []).map(a => ({
          airtable_id: a.airtable_id,
          title: a.title,
          appointment_date: normalizeDate(a.appointment_date) || normalizeDate(a.created_at),
          appointment_type: a.appointment_type,
          status: a.status,
          notes: a.notes,
        })),
      };

      historyCache.set(cacheKey, result);
      setData(result);
      setLoaded(true);
    } catch (err) {
      console.error('Error fetching candidate history:', err);
    } finally {
      setLoading(false);
    }
  }, [linkedinUrl, airtableId, cacheKey, loaded, loading]);

  useEffect(() => {
    if ((linkedinUrl || airtableId) && !loaded) {
      fetchHistory();
    }
  }, [linkedinUrl, airtableId]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, loaded, refetch: fetchHistory };
}
