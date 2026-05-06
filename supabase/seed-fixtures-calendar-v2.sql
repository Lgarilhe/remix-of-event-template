-- ════════════════════════════════════════════════════════════════════════
-- Seed fixtures CALENDRIER V2 — enrichi avec project_id + calendly + locations
-- ════════════════════════════════════════════════════════════════════════
--
-- Cleanup d'abord, puis re-seed avec des données plus riches :
-- - project_id lié à une vraie mission active (rattachement visible)
-- - calendly_event_id sur 2/5 events (badge "via Calendly")
-- - event_location varié (Google Meet / Zoom / Bureau / Calendly URL)
-- - candidate_headline pour preview
--
-- ════════════════════════════════════════════════════════════════════════

-- 1. Cleanup ancien seed
DELETE FROM qualification_sessions WHERE notes LIKE '%[FIXTURE]%';

-- 2. Nouveau seed enrichi
WITH me AS (
  SELECT id AS user_id FROM auth.users WHERE email = 'l.garilhe@konekt.fr' LIMIT 1
),
my_org AS (
  SELECT active_organization_id AS org_id
  FROM profiles
  WHERE user_id = (SELECT user_id FROM me)
  LIMIT 1
),
my_projects AS (
  -- Récupère jusqu'à 3 missions actives pour distribuer les events
  SELECT id, name, client_name, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM sourcing_projects
  WHERE organization_id = (SELECT org_id FROM my_org)
    AND status = 'active'
  LIMIT 3
)
INSERT INTO qualification_sessions (
  organization_id, created_by, project_id,
  candidate_name, candidate_headline, client_name, job_title,
  event_name, event_start_at, event_end_at, event_location,
  calendly_event_id, status, notes
)
SELECT
  (SELECT org_id FROM my_org),
  (SELECT user_id FROM me),
  CASE
    WHEN row_idx <= 2 THEN (SELECT id FROM my_projects WHERE rn = 1)
    WHEN row_idx <= 4 THEN (SELECT id FROM my_projects WHERE rn = 2)
    ELSE (SELECT id FROM my_projects WHERE rn = 3)
  END AS project_id,
  candidate_name, candidate_headline, client_name, job_title,
  event_name, event_start_at, event_end_at, event_location,
  calendly_event_id, 'scheduled', notes
FROM (VALUES
  -- Aujourd'hui matin
  (1, 'Sophie Martin',
   'Senior Backend Engineer @ Datadog · 8 ans d''expérience Go/Rust',
   'BNP Paribas', 'Senior Backend Engineer',
   'Qualif Sophie Martin · BNP', (NOW() + INTERVAL '4 hours')::timestamptz,
   (NOW() + INTERVAL '4 hours 30 minutes')::timestamptz,
   'https://meet.google.com/abc-defg-hij', NULL,
   '[FIXTURE] Qualif initiale — 30 min. Vérifier ses motivations sur le secteur banque vs tech pure.'),

  -- Aujourd'hui après-midi (via Calendly)
  (2, 'Thomas Dubois',
   'Lead Data Scientist @ Criteo · ML Ranking, Spark, Python',
   'Doctolib', 'Lead Data Scientist',
   'Entretien client · Doctolib × T. Dubois', (NOW() + INTERVAL '7 hours')::timestamptz,
   (NOW() + INTERVAL '7 hours 45 minutes')::timestamptz,
   'https://zoom.us/j/123456789', 'cal_evt_thomas_dubois_20260507',
   '[FIXTURE] RDV pris via Calendly. Présent : équipe data Doctolib + RH. Deep-dive technique sur le scoring ML.'),

  -- Demain matin
  (3, 'Camille Leroy',
   'Senior Product Designer @ Alan · Figma + design systems',
   'Spendesk', 'Senior Product Designer',
   'Qualif Camille Leroy', (NOW() + INTERVAL '1 day 10 hours')::timestamptz,
   (NOW() + INTERVAL '1 day 10 hours 30 minutes')::timestamptz,
   'https://meet.google.com/xyz-abcd-efg', NULL,
   '[FIXTURE] Présentation portfolio + cas d''usage retail.'),

  -- Dans 3 jours (via Calendly)
  (4, 'Marc Lefèvre',
   'Engineering Manager @ Datadog · 12 ans dont 5 en management',
   'Qonto', 'Engineering Manager',
   'Café découverte · Marc Lefèvre × Qonto', (NOW() + INTERVAL '3 days 9 hours 30 minutes')::timestamptz,
   (NOW() + INTERVAL '3 days 10 hours 15 minutes')::timestamptz,
   'Bureau Konekt · 5 rue Cadet, 75009 Paris', 'cal_evt_marc_lefevre_20260510',
   '[FIXTURE] Premier rdv physique au bureau. Ambiance détendue, croissance équipe Qonto.'),

  -- Dans 5 jours
  (5, 'Léa Bernard',
   'VP Engineering @ ContentSquare · Scaling 0→200 ingénieurs',
   'Mirakl', 'VP Engineering',
   'Final round · Léa Bernard × Mirakl', (NOW() + INTERVAL '5 days 14 hours')::timestamptz,
   (NOW() + INTERVAL '5 days 15 hours')::timestamptz,
   'https://zoom.us/j/987654321', NULL,
   '[FIXTURE] Final round avec CTO Mirakl. Discussion package + start date Q3.')

) AS fixtures(row_idx, candidate_name, candidate_headline, client_name, job_title,
  event_name, event_start_at, event_end_at, event_location, calendly_event_id, notes);

-- ════════════════════════════════════════════════════════════════════════
-- Vérification
-- ════════════════════════════════════════════════════════════════════════
SELECT
  candidate_name,
  job_title,
  client_name,
  to_char(event_start_at, 'YYYY-MM-DD HH24:MI') AS start_at,
  CASE WHEN calendly_event_id IS NOT NULL THEN 'Calendly' ELSE 'Manuel' END AS source,
  CASE
    WHEN event_location LIKE '%meet.google%' THEN 'Google Meet'
    WHEN event_location LIKE '%zoom%' THEN 'Zoom'
    WHEN event_location LIKE 'Bureau%' THEN 'Bureau'
    ELSE event_location
  END AS location_type,
  project_id IS NOT NULL AS has_mission
FROM qualification_sessions
WHERE notes LIKE '%[FIXTURE]%'
ORDER BY event_start_at;
