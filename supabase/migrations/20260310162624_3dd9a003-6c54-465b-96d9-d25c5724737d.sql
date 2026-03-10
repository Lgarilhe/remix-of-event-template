
CREATE OR REPLACE FUNCTION public.get_vivier_companies(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
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
  last_interaction_date timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH company_shortlists AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_shortlists WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  company_placements AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_placements WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  company_contacts AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt
    FROM airtable_contacts WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  company_notes AS (
    SELECT ct.company_airtable_id AS coid, COUNT(*) AS cnt, MAX(n.created_at) AS last_date
    FROM airtable_notes n
    JOIN airtable_contacts ct ON ct.airtable_id = n.contact_airtable_id
    WHERE ct.company_airtable_id IS NOT NULL
    GROUP BY ct.company_airtable_id
  ),
  company_appts AS (
    SELECT ct.company_airtable_id AS coid, COUNT(*) AS cnt, MAX(a.created_at) AS last_date
    FROM airtable_appointments a
    JOIN airtable_contacts ct ON ct.airtable_id = a.contact_airtable_id
    WHERE ct.company_airtable_id IS NOT NULL
    GROUP BY ct.company_airtable_id
  ),
  stats AS (
    SELECT
      co.airtable_id AS company_airtable_id,
      co.name AS company_name,
      co.city,
      co.headcount,
      co.description,
      co.source_base,
      COALESCE(cc.cnt, 0) AS contact_count,
      COALESCE(cs.cnt, 0) AS shortlist_count,
      COALESCE(cp.cnt, 0) AS placement_count,
      COALESCE(cn.cnt, 0) AS note_count,
      COALESCE(ca.cnt, 0) AS appointment_count,
      GREATEST(cs.last_date, cp.last_date, cn.last_date, ca.last_date) AS last_interaction_date
    FROM airtable_companies co
    LEFT JOIN company_shortlists cs ON cs.coid = co.airtable_id
    LEFT JOIN company_placements cp ON cp.coid = co.airtable_id
    LEFT JOIN company_contacts cc ON cc.coid = co.airtable_id
    LEFT JOIN company_notes cn ON cn.coid = co.airtable_id
    LEFT JOIN company_appts ca ON ca.coid = co.airtable_id
    WHERE COALESCE(cs.cnt, 0) >= p_min_shortlists
      AND (p_source_base IS NULL OR co.source_base = p_source_base)
      AND (p_search IS NULL OR co.name ILIKE '%' || p_search || '%' OR co.city ILIKE '%' || p_search || '%')
  )
  SELECT
    s.company_airtable_id,
    s.company_name,
    s.city,
    s.headcount,
    s.description,
    s.source_base,
    s.contact_count,
    s.shortlist_count,
    s.placement_count,
    s.note_count,
    s.appointment_count,
    s.last_interaction_date,
    COUNT(*) OVER() AS total_count
  FROM stats s
  ORDER BY s.last_interaction_date DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;
