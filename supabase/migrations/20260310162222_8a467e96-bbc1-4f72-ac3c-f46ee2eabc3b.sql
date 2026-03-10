
CREATE OR REPLACE FUNCTION public.get_vivier_contacts(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_source_base text DEFAULT NULL,
  p_contact_type text DEFAULT NULL,
  p_min_shortlists integer DEFAULT 1,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
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
  last_interaction_date timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH contact_stats AS (
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
      COALESCE(s.cnt, 0) AS shortlist_count,
      COALESCE(n.cnt, 0) AS note_count,
      COALESCE(a.cnt, 0) AS appointment_count,
      COALESCE(p.cnt, 0) AS placement_count,
      GREATEST(s.last_date, n.last_date, a.last_date, p.last_date) AS last_interaction_date
    FROM airtable_contacts ct
    LEFT JOIN airtable_companies co ON co.airtable_id = ct.company_airtable_id
    -- Shortlists linked to this contact OR to the same company
    LEFT JOIN (
      SELECT contact_airtable_id, company_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_shortlists
      WHERE contact_airtable_id IS NOT NULL OR company_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id, company_airtable_id
    ) s ON (s.contact_airtable_id = ct.airtable_id OR (s.company_airtable_id = ct.company_airtable_id AND ct.company_airtable_id IS NOT NULL))
    -- Notes linked to this contact
    LEFT JOIN (
      SELECT contact_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_notes
      WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id
    ) n ON n.contact_airtable_id = ct.airtable_id
    -- Appointments linked to this contact
    LEFT JOIN (
      SELECT contact_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_appointments
      WHERE contact_airtable_id IS NOT NULL
      GROUP BY contact_airtable_id
    ) a ON a.contact_airtable_id = ct.airtable_id
    -- Placements linked to the company
    LEFT JOIN (
      SELECT company_airtable_id, COUNT(*) AS cnt, MAX(created_at) AS last_date
      FROM airtable_placements
      WHERE company_airtable_id IS NOT NULL
      GROUP BY company_airtable_id
    ) p ON p.company_airtable_id = ct.company_airtable_id AND ct.company_airtable_id IS NOT NULL
    WHERE COALESCE(s.cnt, 0) >= p_min_shortlists
      AND (COALESCE(n.cnt, 0) > 0 OR COALESCE(a.cnt, 0) > 0 OR COALESCE(p.cnt, 0) > 0)
      AND (p_source_base IS NULL OR ct.source_base = p_source_base)
      AND (p_contact_type IS NULL OR ct.contact_type = p_contact_type)
      AND (p_search IS NULL OR ct.full_name ILIKE '%' || p_search || '%' OR ct.email ILIKE '%' || p_search || '%' OR co.name ILIKE '%' || p_search || '%')
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
$$;
