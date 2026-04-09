
-- Replace get_vivier_contacts with new filter params
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
  p_title text DEFAULT NULL
)
RETURNS TABLE(
  airtable_id text, full_name text, email text, title text,
  contact_type text, city text, status text, source_base text,
  company_airtable_id text, company_name text,
  shortlist_count bigint, note_count bigint, appointment_count bigint,
  placement_count bigint, last_interaction_date timestamptz, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  WITH shortlist_by_contact AS (
    SELECT contact_airtable_id AS cid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_shortlists WHERE contact_airtable_id IS NOT NULL
    GROUP BY contact_airtable_id
  ),
  contact_company_via_shortlist AS (
    SELECT DISTINCT ON (s.contact_airtable_id)
      s.contact_airtable_id AS cid, s.company_airtable_id AS coid
    FROM airtable_shortlists s
    WHERE s.contact_airtable_id IS NOT NULL AND s.company_airtable_id IS NOT NULL
    ORDER BY s.contact_airtable_id, s.created_at DESC
  ),
  shortlist_by_company AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_shortlists WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  notes_by_contact AS (
    SELECT contact_airtable_id AS cid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_notes WHERE contact_airtable_id IS NOT NULL
    GROUP BY contact_airtable_id
  ),
  appts_by_contact AS (
    SELECT contact_airtable_id AS cid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_appointments WHERE contact_airtable_id IS NOT NULL
    GROUP BY contact_airtable_id
  ),
  placements_by_company AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_placements WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  contact_stats AS (
    SELECT
      ct.airtable_id, ct.full_name, ct.email, ct.title, ct.contact_type,
      ct.city, ct.status, ct.source_base,
      COALESCE(ct.company_airtable_id, csvs.coid) AS company_airtable_id,
      co.name AS company_name,
      GREATEST(COALESCE(sc.cnt, 0), COALESCE(sco.cnt, 0)) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(p.cnt, 0) AS placement_count,
      GREATEST(sc.last_date, sco.last_date, n.last_date, a.last_date, p.last_date) AS last_interaction_date
    FROM airtable_contacts ct
    LEFT JOIN contact_company_via_shortlist csvs ON csvs.cid = ct.airtable_id AND ct.company_airtable_id IS NULL
    LEFT JOIN airtable_companies co ON co.airtable_id = COALESCE(ct.company_airtable_id, csvs.coid)
    LEFT JOIN shortlist_by_contact sc ON sc.cid = ct.airtable_id
    LEFT JOIN shortlist_by_company sco ON sco.coid = COALESCE(ct.company_airtable_id, csvs.coid)
    LEFT JOIN notes_by_contact n ON n.cid = ct.airtable_id
    LEFT JOIN appts_by_contact a ON a.cid = ct.airtable_id
    LEFT JOIN placements_by_company p ON p.coid = COALESCE(ct.company_airtable_id, csvs.coid)
    WHERE GREATEST(COALESCE(sc.cnt, 0), COALESCE(sco.cnt, 0)) >= p_min_shortlists
      AND (p_source_base IS NULL OR ct.source_base = p_source_base)
      AND (p_contact_type IS NULL OR ct.contact_type = p_contact_type)
      AND (p_city IS NULL OR ct.city ILIKE '%' || p_city || '%' OR co.city ILIKE '%' || p_city || '%')
      AND (p_has_placements IS NULL OR (p_has_placements = true AND COALESCE(p.cnt, 0) > 0) OR (p_has_placements = false AND COALESCE(p.cnt, 0) = 0))
      AND (p_search IS NULL
        OR unaccent(ct.full_name) ILIKE '%' || unaccent(p_search) || '%'
        OR ct.email ILIKE '%' || p_search || '%'
        OR unaccent(co.name) ILIKE '%' || unaccent(p_search) || '%'
      )
      -- New filters
      AND (p_has_email IS NULL OR (p_has_email = true AND ct.email IS NOT NULL AND ct.email <> '') OR (p_has_email = false AND (ct.email IS NULL OR ct.email = '')))
      AND (p_has_notes IS NULL OR (p_has_notes = true AND COALESCE(n.cnt, 0) > 0) OR (p_has_notes = false AND COALESCE(n.cnt, 0) = 0))
      AND (p_has_appointments IS NULL OR (p_has_appointments = true AND COALESCE(a.cnt, 0) > 0) OR (p_has_appointments = false AND COALESCE(a.cnt, 0) = 0))
      AND (p_status IS NULL OR ct.status ILIKE p_status)
      AND (p_title IS NULL OR ct.title ILIKE '%' || p_title || '%')
  )
  SELECT
    cs.airtable_id, cs.full_name, cs.email, cs.title, cs.contact_type,
    cs.city, cs.status, cs.source_base,
    cs.company_airtable_id, cs.company_name,
    cs.shortlist_count, cs.note_count, cs.appointment_count,
    cs.placement_count, cs.last_interaction_date,
    COUNT(*) OVER() AS total_count
  FROM contact_stats cs
  WHERE (p_last_interaction_days IS NULL OR cs.last_interaction_date >= now() - (p_last_interaction_days || ' days')::interval)
  ORDER BY
    CASE WHEN p_sort_by = 'recent' THEN 0 END,
    CASE WHEN p_sort_by = 'recent' THEN cs.last_interaction_date END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'shortlists' THEN cs.shortlist_count END DESC,
    CASE WHEN p_sort_by = 'placements' THEN cs.placement_count END DESC,
    CASE WHEN p_sort_by = 'name' THEN cs.full_name END ASC,
    cs.last_interaction_date DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- Replace get_vivier_companies with new filter params
CREATE OR REPLACE FUNCTION public.get_vivier_companies(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_has_placements boolean DEFAULT NULL,
  p_min_placements integer DEFAULT 0,
  p_sort_by text DEFAULT 'recent',
  p_has_notes boolean DEFAULT NULL,
  p_last_interaction_days integer DEFAULT NULL,
  p_min_contacts integer DEFAULT 0
)
RETURNS TABLE(
  company_airtable_id text, company_name text, city text, headcount text,
  description text, source_base text,
  contact_count bigint, shortlist_count bigint, placement_count bigint,
  note_count bigint, appointment_count bigint,
  last_interaction_date timestamptz, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
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
    SELECT coid, COUNT(DISTINCT cid) AS cnt FROM (
      SELECT company_airtable_id AS coid, airtable_id AS cid
      FROM airtable_contacts WHERE company_airtable_id IS NOT NULL
      UNION
      SELECT s.company_airtable_id AS coid, s.contact_airtable_id AS cid
      FROM airtable_shortlists s
      WHERE s.company_airtable_id IS NOT NULL AND s.contact_airtable_id IS NOT NULL
    ) sub
    GROUP BY coid
  ),
  company_notes AS (
    SELECT sub.coid, COUNT(*) AS cnt, MAX(n.created_at) AS last_date
    FROM airtable_notes n
    JOIN (
      SELECT airtable_id AS cid, company_airtable_id AS coid FROM airtable_contacts WHERE company_airtable_id IS NOT NULL
      UNION
      SELECT contact_airtable_id AS cid, company_airtable_id AS coid FROM airtable_shortlists WHERE contact_airtable_id IS NOT NULL AND company_airtable_id IS NOT NULL
    ) sub ON sub.cid = n.contact_airtable_id
    GROUP BY sub.coid
  ),
  company_appts AS (
    SELECT sub.coid, COUNT(*) AS cnt, MAX(a.created_at) AS last_date
    FROM airtable_appointments a
    JOIN (
      SELECT airtable_id AS cid, company_airtable_id AS coid FROM airtable_contacts WHERE company_airtable_id IS NOT NULL
      UNION
      SELECT contact_airtable_id AS cid, company_airtable_id AS coid FROM airtable_shortlists WHERE contact_airtable_id IS NOT NULL AND company_airtable_id IS NOT NULL
    ) sub ON sub.cid = a.contact_airtable_id
    GROUP BY sub.coid
  ),
  stats AS (
    SELECT
      co.airtable_id AS company_airtable_id, co.name AS company_name,
      co.city, co.headcount, co.description, co.source_base,
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
      AND (p_city IS NULL OR co.city ILIKE '%' || p_city || '%')
      AND (p_has_placements IS NULL OR (p_has_placements = true AND COALESCE(cp.cnt, 0) > 0) OR (p_has_placements = false AND COALESCE(cp.cnt, 0) = 0))
      AND COALESCE(cp.cnt, 0) >= p_min_placements
      -- New filters
      AND (p_has_notes IS NULL OR (p_has_notes = true AND COALESCE(cn.cnt, 0) > 0) OR (p_has_notes = false AND COALESCE(cn.cnt, 0) = 0))
      AND COALESCE(cc.cnt, 0) >= p_min_contacts
  )
  SELECT
    s.company_airtable_id, s.company_name, s.city, s.headcount,
    s.description, s.source_base,
    s.contact_count, s.shortlist_count, s.placement_count,
    s.note_count, s.appointment_count, s.last_interaction_date,
    COUNT(*) OVER() AS total_count
  FROM stats s
  WHERE (p_last_interaction_days IS NULL OR s.last_interaction_date >= now() - (p_last_interaction_days || ' days')::interval)
  ORDER BY
    CASE WHEN p_sort_by = 'recent' THEN 0 END,
    CASE WHEN p_sort_by = 'recent' THEN s.last_interaction_date END DESC NULLS LAST,
    CASE WHEN p_sort_by = 'shortlists' THEN s.shortlist_count END DESC,
    CASE WHEN p_sort_by = 'placements' THEN s.placement_count END DESC,
    CASE WHEN p_sort_by = 'contacts' THEN s.contact_count END DESC,
    CASE WHEN p_sort_by = 'name' THEN s.company_name END ASC,
    s.last_interaction_date DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;
