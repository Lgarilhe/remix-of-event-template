CREATE OR REPLACE FUNCTION public.get_vivier_contacts(
  p_limit integer,
  p_offset integer,
  p_source_base text DEFAULT NULL::text,
  p_contact_type text DEFAULT NULL::text,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL::text
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
  last_interaction_date timestamp with time zone,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH shortlist_by_contact AS (
    SELECT contact_airtable_id AS cid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_shortlists
    WHERE contact_airtable_id IS NOT NULL
    GROUP BY contact_airtable_id
  ),
  shortlist_by_company AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_shortlists
    WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  notes_by_contact AS (
    SELECT contact_airtable_id AS cid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_notes
    WHERE contact_airtable_id IS NOT NULL
    GROUP BY contact_airtable_id
  ),
  appts_by_contact AS (
    SELECT contact_airtable_id AS cid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_appointments
    WHERE contact_airtable_id IS NOT NULL
    GROUP BY contact_airtable_id
  ),
  placements_by_company AS (
    SELECT company_airtable_id AS coid, COUNT(*) AS cnt, MAX(created_at) AS last_date
    FROM airtable_placements
    WHERE company_airtable_id IS NOT NULL
    GROUP BY company_airtable_id
  ),
  contact_stats AS (
    SELECT
      ct.airtable_id,
      ct.full_name,
      ct.email,
      ct.title,
      ct.contact_type,
      ct.city,
      ct.status,
      ct.source_base,
      ct.company_airtable_id,
      co.name AS company_name,
      GREATEST(COALESCE(sc.cnt, 0), COALESCE(sco.cnt, 0)) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(p.cnt, 0) AS placement_count,
      GREATEST(sc.last_date, sco.last_date, n.last_date, a.last_date, p.last_date) AS last_interaction_date
    FROM airtable_contacts ct
    LEFT JOIN airtable_companies co ON co.airtable_id = ct.company_airtable_id
    LEFT JOIN shortlist_by_contact sc ON sc.cid = ct.airtable_id
    LEFT JOIN shortlist_by_company sco ON sco.coid = ct.company_airtable_id AND ct.company_airtable_id IS NOT NULL
    LEFT JOIN notes_by_contact n ON n.cid = ct.airtable_id
    LEFT JOIN appts_by_contact a ON a.cid = ct.airtable_id
    LEFT JOIN placements_by_company p ON p.coid = ct.company_airtable_id AND ct.company_airtable_id IS NOT NULL
    WHERE GREATEST(COALESCE(sc.cnt, 0), COALESCE(sco.cnt, 0)) >= p_min_shortlists
      AND (p_source_base IS NULL OR ct.source_base = p_source_base)
      AND (p_contact_type IS NULL OR ct.contact_type = p_contact_type)
      AND (
        p_search IS NULL
        OR unaccent(ct.full_name) ILIKE '%' || unaccent(p_search) || '%'
        OR ct.email ILIKE '%' || p_search || '%'
        OR unaccent(co.name) ILIKE '%' || unaccent(p_search) || '%'
      )
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
    cs.last_interaction_date,
    COUNT(*) OVER() AS total_count
  FROM contact_stats cs
  ORDER BY cs.last_interaction_date DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$function$;