
CREATE OR REPLACE FUNCTION public.get_vivier_candidates(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_skill text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_has_notes boolean DEFAULT NULL,
  p_has_appointments boolean DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  airtable_id text,
  full_name text,
  email text,
  phone text,
  linkedin_url text,
  status text,
  skills text[],
  source_base text,
  experience text,
  education_level text,
  shortlist_count bigint,
  note_count bigint,
  appointment_count bigint,
  placement_count bigint,
  last_interaction_date timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH candidate_stats AS (
    SELECT
      c.airtable_id,
      c.full_name,
      c.email,
      c.phone,
      c.linkedin_url,
      c.status,
      c.skills,
      c.source_base,
      c.experience,
      c.education_level,
      COALESCE(s.cnt, 0) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(p.cnt, 0) AS placement_count,
      GREATEST(s.last_date, n.last_date, a.last_date, p.last_date) AS last_interaction_date
    FROM airtable_candidates c
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_shortlists
      GROUP BY candidate_airtable_id
    ) s ON s.candidate_airtable_id = c.airtable_id
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_notes
      GROUP BY candidate_airtable_id
    ) n ON n.candidate_airtable_id = c.airtable_id
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_appointments
      GROUP BY candidate_airtable_id
    ) a ON a.candidate_airtable_id = c.airtable_id
    LEFT JOIN (
      SELECT candidate_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_placements
      GROUP BY candidate_airtable_id
    ) p ON p.candidate_airtable_id = c.airtable_id
    WHERE COALESCE(s.cnt, 0) >= p_min_shortlists
      AND (COALESCE(n.cnt, 0) > 0 OR COALESCE(a.cnt, 0) > 0)
      AND (p_source_base IS NULL OR c.source_base = p_source_base)
      AND (p_skill IS NULL OR p_skill = ANY(c.skills))
      AND (p_has_notes IS NULL OR (p_has_notes = true AND COALESCE(n.cnt, 0) > 0) OR (p_has_notes = false))
      AND (p_has_appointments IS NULL OR (p_has_appointments = true AND COALESCE(a.cnt, 0) > 0) OR (p_has_appointments = false))
      AND (p_search IS NULL OR c.full_name ILIKE '%' || p_search || '%' OR c.email ILIKE '%' || p_search || '%' OR c.phone ILIKE '%' || p_search || '%')
  )
  SELECT
    cs.airtable_id,
    cs.full_name,
    cs.email,
    cs.phone,
    cs.linkedin_url,
    cs.status,
    cs.skills,
    cs.source_base,
    cs.experience,
    cs.education_level,
    cs.shortlist_count,
    cs.note_count,
    cs.appointment_count,
    cs.placement_count,
    cs.last_interaction_date,
    COUNT(*) OVER() AS total_count
  FROM candidate_stats cs
  ORDER BY cs.last_interaction_date DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;
