-- ════════════════════════════════════════════════════════════════════════
-- Seed fixtures V3 — utilise de VRAIS candidats existants pour les events
-- (avec photos LinkedIn réelles depuis linkedin_profile_data)
-- ════════════════════════════════════════════════════════════════════════
--
-- Pourquoi : avant on utilisait gen_random_uuid() pour candidate_profile_id,
-- qui ne matchait aucun row dans job_candidate_status → pas de photo LinkedIn,
-- fallback sur initiales. En réutilisant des vrais candidate_id, l'avatar
-- batch fetch dans useCalendarEvents trouve le profile_picture_url réel.
--
-- Idem pour candidate_reminders → on attache aux vrais candidats.
-- ════════════════════════════════════════════════════════════════════════

-- Cleanup ancien seed
DELETE FROM qualification_sessions WHERE notes LIKE '%[FIXTURE]%';
DELETE FROM candidate_reminders WHERE description LIKE '%[FIXTURE]%';

-- Seed events calendar avec vrais candidats
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
  SELECT id, name, client_name, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
  FROM sourcing_projects
  WHERE organization_id = (SELECT org_id FROM my_org)
    AND status = 'active'
  LIMIT 3
),
real_candidates AS (
  -- Récupère 10 vrais candidats avec photo LinkedIn dispo
  SELECT
    candidate_id,
    candidate_name,
    candidate_headline,
    job_id,
    ROW_NUMBER() OVER (ORDER BY updated_at DESC) AS rn
  FROM job_candidate_status
  WHERE organization_id = (SELECT org_id FROM my_org)
    AND candidate_name IS NOT NULL
    AND linkedin_profile_data IS NOT NULL
    AND linkedin_profile_data->>'profile_picture_url' IS NOT NULL
  LIMIT 10
)
INSERT INTO qualification_sessions (
  organization_id, created_by, project_id,
  candidate_profile_id,
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
  rc.candidate_id AS candidate_profile_id,
  rc.candidate_name, COALESCE(rc.candidate_headline, headline_fallback), client_name, job_title,
  event_name, event_start_at, event_end_at, event_location,
  calendly_event_id, 'scheduled', notes
FROM (VALUES
  -- Aujourd'hui dans 4h
  (1, 'BNP Paribas', 'Senior Backend Engineer',
   'Senior Backend Engineer @ Datadog · 8 ans Go/Rust',
   'Qualif initiale · BNP × candidat 1', (NOW() + INTERVAL '4 hours')::timestamptz,
   (NOW() + INTERVAL '4 hours 30 minutes')::timestamptz,
   'https://meet.google.com/abc-defg-hij', NULL,
   '[FIXTURE] Qualif initiale — 30 min. Vérifier motivations secteur banque vs tech pure.'),

  -- Aujourd'hui dans 7h (via Calendly)
  (2, 'Doctolib', 'Lead Data Scientist',
   'Lead Data Scientist @ Criteo · ML Ranking, Spark',
   'Entretien client · Doctolib', (NOW() + INTERVAL '7 hours')::timestamptz,
   (NOW() + INTERVAL '7 hours 45 minutes')::timestamptz,
   'https://zoom.us/j/123456789', 'cal_evt_v3_20260507',
   '[FIXTURE] RDV via Calendly. Présent : équipe data Doctolib + RH. Deep-dive scoring ML.'),

  -- Demain
  (3, 'Spendesk', 'Senior Product Designer',
   'Product Designer @ Alan · Figma, design systems',
   'Qualif Camille', (NOW() + INTERVAL '1 day 10 hours')::timestamptz,
   (NOW() + INTERVAL '1 day 10 hours 30 minutes')::timestamptz,
   'https://meet.google.com/xyz-abcd-efg', NULL,
   '[FIXTURE] Présentation portfolio + cas usage retail.'),

  -- Dans 3 jours (via Calendly)
  (4, 'Qonto', 'Engineering Manager',
   'Engineering Manager @ Datadog · 12 ans dont 5 en mgt',
   'Café découverte · Qonto', (NOW() + INTERVAL '3 days 9 hours 30 minutes')::timestamptz,
   (NOW() + INTERVAL '3 days 10 hours 15 minutes')::timestamptz,
   'Bureau Konekt · 5 rue Cadet, 75009 Paris', 'cal_evt_v3_20260510',
   '[FIXTURE] Premier rdv physique au bureau. Croissance équipe Qonto Q3.'),

  -- Dans 5 jours
  (5, 'Mirakl', 'VP Engineering',
   'VP Engineering @ ContentSquare · Scaling 0→200',
   'Final round · Mirakl', (NOW() + INTERVAL '5 days 14 hours')::timestamptz,
   (NOW() + INTERVAL '5 days 15 hours')::timestamptz,
   'https://zoom.us/j/987654321', NULL,
   '[FIXTURE] Final round avec CTO Mirakl. Discussion package + start date Q3.')

) AS fixtures(row_idx, client_name, job_title, headline_fallback,
  event_name, event_start_at, event_end_at, event_location, calendly_event_id, notes)
JOIN real_candidates rc ON rc.rn = fixtures.row_idx;


-- Seed reminders Tasks avec vrais candidats
WITH me AS (
  SELECT id AS user_id FROM auth.users WHERE email = 'l.garilhe@konekt.fr' LIMIT 1
),
my_org AS (
  SELECT active_organization_id AS org_id
  FROM profiles
  WHERE user_id = (SELECT user_id FROM me)
  LIMIT 1
),
real_candidates_for_reminders AS (
  SELECT
    candidate_id,
    candidate_name,
    job_id,
    ROW_NUMBER() OVER (ORDER BY updated_at DESC) AS rn
  FROM job_candidate_status
  WHERE organization_id = (SELECT org_id FROM my_org)
    AND candidate_name IS NOT NULL
    AND linkedin_profile_data IS NOT NULL
    AND linkedin_profile_data->>'profile_picture_url' IS NOT NULL
  LIMIT 10
)
INSERT INTO candidate_reminders (
  organization_id, created_by, candidate_id, candidate_name,
  job_id, job_title, title, description, due_at, completed_at
)
SELECT
  (SELECT org_id FROM my_org),
  (SELECT user_id FROM me),
  rc.candidate_id,
  rc.candidate_name,
  rc.job_id,
  job_title,
  title, description, due_at, completed_at
FROM (VALUES
  -- En retard (overdue) — 3
  (1, 'Senior Backend Engineer @ BNP', 'Relancer après silence radio',
   '[FIXTURE] Pas de réponse depuis 3 jours, relancer avec une nouvelle approche personnalisée',
   (NOW() - INTERVAL '2 days')::timestamptz, NULL::timestamptz),
  (2, 'Lead Data Scientist @ Doctolib', 'Envoyer la fiche de poste détaillée',
   '[FIXTURE] Demandée lors du dernier échange — package complet pour décider',
   (NOW() - INTERVAL '4 days')::timestamptz, NULL::timestamptz),
  (3, 'Senior Product Designer @ Spendesk', 'Caler le call de qualification',
   '[FIXTURE] Disponibilités : mardi 14h ou mercredi 10h',
   (NOW() - INTERVAL '1 day')::timestamptz, NULL::timestamptz),

  -- Aujourd'hui — 2
  (4, 'Engineering Manager @ Qonto', 'Préparer le brief client BNP',
   '[FIXTURE] Réunion 16h30 — finaliser critères must-have et pitch',
   (NOW() + INTERVAL '3 hours')::timestamptz, NULL::timestamptz),
  (5, 'VP Engineering @ Mirakl', 'Faire le debrief client',
   '[FIXTURE] Retour à chaud après ITW de ce matin — points forts et red flags',
   (NOW() + INTERVAL '5 hours')::timestamptz, NULL::timestamptz),

  -- Cette semaine — 2
  (6, 'Senior Backend Engineer @ BNP', 'Valider la shortlist finale',
   '[FIXTURE] 5 candidats à présenter — vérifier confidentialité',
   (NOW() + INTERVAL '2 days')::timestamptz, NULL::timestamptz),
  (7, 'Senior Frontend Engineer @ Stripe', 'Envoyer la proposition d''offre',
   '[FIXTURE] Salaire 75k + variable 8% + RTT — relire avant envoi',
   (NOW() + INTERVAL '3 days')::timestamptz, NULL::timestamptz),

  -- Plus tard — 1
  (8, 'Staff Software Engineer @ Datadog', 'Vérifier les références',
   '[FIXTURE] 2 anciens managers fournis — appeler après signature',
   (NOW() + INTERVAL '12 days')::timestamptz, NULL::timestamptz),

  -- Terminées — 2
  (9, 'Backend Engineer @ Alan', 'Programmer l''entretien technique',
   '[FIXTURE] ✓ Calendly envoyé, créneau choisi',
   (NOW() - INTERVAL '5 days')::timestamptz, (NOW() - INTERVAL '4 days')::timestamptz),
  (10, 'DevOps Engineer @ ContentSquare', 'Faire signer le NDA',
   '[FIXTURE] ✓ Signé via DocuSign, archivé client',
   (NOW() - INTERVAL '3 days')::timestamptz, (NOW() - INTERVAL '2 days')::timestamptz)

) AS fixtures(row_idx, job_title, title, description, due_at, completed_at)
JOIN real_candidates_for_reminders rc ON rc.rn = fixtures.row_idx;


-- ═══ Vérification : count + check des avatars ═══
SELECT
  'qualifs' AS type,
  COUNT(*) AS total,
  COUNT(candidate_profile_id) AS with_real_candidate,
  COUNT(project_id) AS with_project,
  COUNT(calendly_event_id) AS with_calendly
FROM qualification_sessions
WHERE notes LIKE '%[FIXTURE]%'
UNION ALL
SELECT
  'reminders',
  COUNT(*),
  COUNT(candidate_id),
  COUNT(job_id),
  0
FROM candidate_reminders
WHERE description LIKE '%[FIXTURE]%';
