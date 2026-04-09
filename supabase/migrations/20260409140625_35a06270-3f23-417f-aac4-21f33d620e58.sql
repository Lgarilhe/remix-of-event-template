
-- Drop and recreate get_vivier_contacts with extra filters
CREATE OR REPLACE FUNCTION public.get_vivier_contacts(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_contact_type text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_has_placements boolean DEFAULT NULL,
  p_sort_by text DEFAULT 'recent',
  p_has_email boolean DEFAULT NULL,
  p_has_notes boolean DEFAULT NULL,
  p_has_appointments boolean DEFAULT NULL,
  p_last_interaction_days integer DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_title text DEFAULT NULL,
  -- NEW filters
  p_has_phone boolean DEFAULT NULL,
  p_min_notes integer DEFAULT 0,
  p_min_appointments integer DEFAULT 0,
  p_min_placements integer DEFAULT 0,
  p_company_name text DEFAULT NULL
)
RETURNS TABLE(
  airtable_id text,
  full_name text,
  email text,
  title text,
  contact_type text,
  city text,
  status text,
  source_base text,
  company_airtable_id text,
  company_name text,
  shortlist_count bigint,
  note_count bigint,
  appointment_count bigint,
  placement_count bigint,
  last_interaction_date text,
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH contact_stats AS (
    SELECT
      c.airtable_id,
      c.full_name,
      c.email,
      c.title,
      c.contact_type,
      c.city,
      c.status,
      c.source_base,
      c.company_airtable_id,
      comp.name AS company_name,
      COALESCE(sl.cnt, 0) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(pl.cnt, 0) AS placement_count,
      GREATEST(sl.last_date, n.last_date, a.last_date) AS last_interaction_date,
      -- phone from candidates table
      cand.phone AS candidate_phone
    FROM airtable_contacts c
    LEFT JOIN airtable_companies comp ON comp.airtable_id = c.company_airtable_id AND comp.source_base = c.source_base
    LEFT JOIN (
      SELECT contact_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(date_added) AS last_date
      FROM airtable_shortlists WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, source_base
    ) sl ON sl.contact_airtable_id = c.airtable_id AND sl.sb = c.source_base
    LEFT JOIN (
      SELECT contact_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(note_date) AS last_date
      FROM airtable_notes WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, source_base
    ) n ON n.contact_airtable_id = c.airtable_id AND n.sb = c.source_base
    LEFT JOIN (
      SELECT contact_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(appointment_date) AS last_date
      FROM airtable_appointments WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, source_base
    ) a ON a.contact_airtable_id = c.airtable_id AND a.sb = c.source_base
    LEFT JOIN (
      SELECT s.contact_airtable_id, s.source_base AS sb, COUNT(*) AS cnt
      FROM airtable_shortlists s
      JOIN airtable_placements p ON p.candidate_airtable_id = s.candidate_airtable_id AND p.source_base = s.source_base
      WHERE s.contact_airtable_id IS NOT NULL
      GROUP BY s.contact_airtable_id, s.source_base
    ) pl ON pl.contact_airtable_id = c.airtable_id AND pl.sb = c.source_base
    LEFT JOIN airtable_candidates cand ON cand.airtable_id = c.airtable_id AND cand.source_base = c.source_base
    WHERE
      (p_source_base IS NULL OR c.source_base = p_source_base)
      AND (p_contact_type IS NULL OR c.contact_type = p_contact_type)
      AND (p_search IS NULL OR c.full_name ILIKE '%' || p_search || '%' OR c.email ILIKE '%' || p_search || '%' OR c.title ILIKE '%' || p_search || '%')
      AND (p_city IS NULL OR c.city ILIKE '%' || p_city || '%')
      AND (p_has_email IS NULL OR (p_has_email = true AND c.email IS NOT NULL AND c.email <> '') OR (p_has_email = false AND (c.email IS NULL OR c.email = '')))
      AND (p_status IS NULL OR c.status = p_status)
      AND (p_title IS NULL OR c.title ILIKE '%' || p_title || '%')
      AND (p_company_name IS NULL OR comp.name ILIKE '%' || p_company_name || '%')
  )
  SELECT
    cs.airtable_id,
    cs.full_name,
    cs.email,
    cs.title,
    cs.contact_type,
    cs.city,
    cs.status,
    cs.source_base,
    cs.company_airtable_id,
    cs.company_name,
    cs.shortlist_count,
    cs.note_count,
    cs.appointment_count,
    cs.placement_count,
    cs.last_interaction_date::text,
    COUNT(*) OVER() AS total_count
  FROM contact_stats cs
  WHERE
    cs.shortlist_count >= p_min_shortlists
    AND (p_has_placements IS NULL OR (p_has_placements = true AND cs.placement_count > 0) OR (p_has_placements = false AND cs.placement_count = 0))
    AND (p_has_notes IS NULL OR (p_has_notes = true AND cs.note_count > 0) OR (p_has_notes = false AND cs.note_count = 0))
    AND (p_has_appointments IS NULL OR (p_has_appointments = true AND cs.appointment_count > 0) OR (p_has_appointments = false AND cs.appointment_count = 0))
    AND (p_last_interaction_days IS NULL OR cs.last_interaction_date >= (CURRENT_DATE - p_last_interaction_days * INTERVAL '1 day')::text)
    AND (p_has_phone IS NULL OR (p_has_phone = true AND cs.candidate_phone IS NOT NULL AND cs.candidate_phone <> '') OR (p_has_phone = false AND (cs.candidate_phone IS NULL OR cs.candidate_phone = '')))
    AND cs.note_count >= p_min_notes
    AND cs.appointment_count >= p_min_appointments
    AND cs.placement_count >= p_min_placements
  ORDER BY
    CASE WHEN p_sort_by = 'recent' THEN cs.last_interaction_date END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'shortlists' THEN cs.shortlist_count END DESC,
    CASE WHEN p_sort_by = 'placements' THEN cs.placement_count END DESC,
    CASE WHEN p_sort_by = 'name' THEN cs.full_name END ASC,
    cs.shortlist_count DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Drop and recreate get_vivier_companies with extra filters
CREATE OR REPLACE FUNCTION public.get_vivier_companies(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_has_placements boolean DEFAULT NULL,
  p_sort_by text DEFAULT 'recent',
  p_has_notes boolean DEFAULT NULL,
  p_last_interaction_days integer DEFAULT NULL,
  p_min_contacts integer DEFAULT 0,
  -- NEW filters
  p_headcount text DEFAULT NULL,
  p_min_notes integer DEFAULT 0,
  p_min_appointments integer DEFAULT 0,
  p_min_placements integer DEFAULT 0,
  p_has_appointments boolean DEFAULT NULL
)
RETURNS TABLE(
  company_airtable_id text,
  company_name text,
  city text,
  headcount text,
  description text,
  source_base text,
  contact_count bigint,
  shortlist_count bigint,
  placement_count bigint,
  note_count bigint,
  appointment_count bigint,
  last_interaction_date text,
  total_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH company_stats AS (
    SELECT
      co.airtable_id AS company_airtable_id,
      co.name AS company_name,
      co.city,
      co.headcount,
      co.description,
      co.source_base,
      COALESCE(ct.cnt, 0) AS contact_count,
      COALESCE(sl.cnt, 0) AS shortlist_count,
      COALESCE(pl.cnt, 0) AS placement_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      GREATEST(sl.last_date, n.last_date, a.last_date) AS last_interaction_date
    FROM airtable_companies co
    LEFT JOIN (
      SELECT company_airtable_id, source_base AS sb, COUNT(*) AS cnt
      FROM airtable_contacts WHERE company_airtable_id IS NOT NULL
      GROUP BY company_airtable_id, source_base
    ) ct ON ct.company_airtable_id = co.airtable_id AND ct.sb = co.source_base
    LEFT JOIN (
      SELECT company_airtable_id, source_base AS sb, COUNT(*) AS cnt, MAX(date_added) AS last_date
      FROM airtable_shortlists WHERE company_airtable_id IS NOT NULL
      GROUP BY company_airtable_id, source_base
    ) sl ON sl.company_airtable_id = co.airtable_id AND sl.sb = co.source_base
    LEFT JOIN (
      SELECT s.company_airtable_id, s.source_base AS sb, COUNT(DISTINCT p.airtable_id) AS cnt
      FROM airtable_shortlists s
      JOIN airtable_placements p ON p.company_airtable_id = s.company_airtable_id AND p.source_base = s.source_base
      WHERE s.company_airtable_id IS NOT NULL
      GROUP BY s.company_airtable_id, s.source_base
    ) pl ON pl.company_airtable_id = co.airtable_id AND pl.sb = co.source_base
    LEFT JOIN (
      SELECT j.company_airtable_id, j.source_base AS sb, COUNT(n2.id) AS cnt, MAX(n2.note_date) AS last_date
      FROM airtable_jobs j
      JOIN airtable_notes n2 ON n2.job_airtable_id = j.airtable_id AND n2.source_base = j.source_base
      WHERE j.company_airtable_id IS NOT NULL
      GROUP BY j.company_airtable_id, j.source_base
    ) n ON n.company_airtable_id = co.airtable_id AND n.sb = co.source_base
    LEFT JOIN (
      SELECT j.company_airtable_id, j.source_base AS sb, COUNT(a2.id) AS cnt, MAX(a2.appointment_date) AS last_date
      FROM airtable_jobs j
      JOIN airtable_appointments a2 ON a2.job_airtable_id = j.airtable_id AND a2.source_base = j.source_base
      WHERE j.company_airtable_id IS NOT NULL
      GROUP BY j.company_airtable_id, j.source_base
    ) a ON a.company_airtable_id = co.airtable_id AND a.sb = co.source_base
    WHERE
      (p_source_base IS NULL OR co.source_base = p_source_base)
      AND (p_search IS NULL OR co.name ILIKE '%' || p_search || '%' OR co.city ILIKE '%' || p_search || '%' OR co.description ILIKE '%' || p_search || '%')
      AND (p_city IS NULL OR co.city ILIKE '%' || p_city || '%')
      AND (p_headcount IS NULL OR co.headcount = p_headcount)
  )
  SELECT
    cs.company_airtable_id,
    cs.company_name,
    cs.city,
    cs.headcount,
    cs.description,
    cs.source_base,
    cs.contact_count,
    cs.shortlist_count,
    cs.placement_count,
    cs.note_count,
    cs.appointment_count,
    cs.last_interaction_date::text,
    COUNT(*) OVER() AS total_count
  FROM company_stats cs
  WHERE
    cs.shortlist_count >= p_min_shortlists
    AND cs.contact_count >= p_min_contacts
    AND (p_has_placements IS NULL OR (p_has_placements = true AND cs.placement_count > 0) OR (p_has_placements = false AND cs.placement_count = 0))
    AND (p_has_notes IS NULL OR (p_has_notes = true AND cs.note_count > 0) OR (p_has_notes = false AND cs.note_count = 0))
    AND (p_has_appointments IS NULL OR (p_has_appointments = true AND cs.appointment_count > 0) OR (p_has_appointments = false AND cs.appointment_count = 0))
    AND (p_last_interaction_days IS NULL OR cs.last_interaction_date >= (CURRENT_DATE - p_last_interaction_days * INTERVAL '1 day')::text)
    AND cs.note_count >= p_min_notes
    AND cs.appointment_count >= p_min_appointments
    AND cs.placement_count >= p_min_placements
  ORDER BY
    CASE WHEN p_sort_by = 'recent' THEN cs.last_interaction_date END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'shortlists' THEN cs.shortlist_count END DESC,
    CASE WHEN p_sort_by = 'placements' THEN cs.placement_count END DESC,
    CASE WHEN p_sort_by = 'contacts' THEN cs.contact_count END DESC,
    CASE WHEN p_sort_by = 'name' THEN cs.company_name END ASC,
    cs.shortlist_count DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
