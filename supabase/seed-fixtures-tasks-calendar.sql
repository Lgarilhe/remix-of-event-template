-- ════════════════════════════════════════════════════════════════════════
-- Seed fixtures : tâches + événements calendrier pour test Tasks/Calendar
-- ════════════════════════════════════════════════════════════════════════
--
-- Comment utiliser :
-- 1. Ouvrir https://supabase.com/dashboard/project/crckfywoyjxkawathdff/sql
-- 2. Coller TOUT ce fichier et cliquer Run
-- 3. Hard-refresh /tasks et /calendar pour voir les données
--
-- Tout est tagué `[FIXTURE]` dans description/notes/message pour cleanup
-- facile :
--   DELETE FROM candidate_reminders WHERE description LIKE '%[FIXTURE]%';
--   DELETE FROM qualification_sessions WHERE notes LIKE '%[FIXTURE]%';
--   DELETE FROM inmail_queue WHERE message LIKE '%[FIXTURE]%';
--
-- ════════════════════════════════════════════════════════════════════════

-- Identifie l'user Laurent + son active org
WITH me AS (
  SELECT id AS user_id FROM auth.users WHERE email = 'l.garilhe@konekt.fr' LIMIT 1
),
my_org AS (
  SELECT active_organization_id AS org_id
  FROM profiles
  WHERE user_id = (SELECT user_id FROM me)
  LIMIT 1
)

-- ─── 1. TÂCHES (candidate_reminders) ─────────────────────────────────────
INSERT INTO candidate_reminders (
  organization_id, created_by, candidate_id, candidate_name,
  job_title, title, description, due_at, completed_at
)
SELECT
  (SELECT org_id FROM my_org),
  (SELECT user_id FROM me),
  candidate_uuid,
  candidate_name,
  job_title,
  title,
  description,
  due_at,
  completed_at
FROM (VALUES
  -- ════ EN RETARD (overdue) — 3 tâches ═════════════════════════════════
  (gen_random_uuid(), 'Sophie Martin', 'Senior Backend Engineer',
   'Relancer après silence radio',
   '[FIXTURE] Pas de réponse depuis 3 jours, relancer avec une nouvelle approche personnalisée',
   (NOW() - INTERVAL '2 days')::timestamptz, NULL::timestamptz),

  (gen_random_uuid(), 'Thomas Dubois', 'Lead Data Scientist',
   'Envoyer la fiche de poste détaillée',
   '[FIXTURE] Demandée lors du dernier échange — Tom a besoin du package complet pour décider',
   (NOW() - INTERVAL '4 days')::timestamptz, NULL::timestamptz),

  (gen_random_uuid(), 'Camille Leroy', 'Product Designer',
   'Caler le call de qualification',
   '[FIXTURE] Disponibilités : mardi 14h ou mercredi 10h. À confirmer avec elle.',
   (NOW() - INTERVAL '1 day')::timestamptz, NULL::timestamptz),

  -- ════ AUJOURD'HUI (today) — 2 tâches ═════════════════════════════════
  (gen_random_uuid(), 'Marc Lefèvre', 'CTO Fractional',
   'Préparer le brief client pour BNP',
   '[FIXTURE] Réunion à 16h30 — finaliser les critères must-have et le pitch',
   (NOW() + INTERVAL '3 hours')::timestamptz, NULL::timestamptz),

  (gen_random_uuid(), 'Léa Bernard', 'VP Engineering',
   'Faire le debrief avec le client',
   '[FIXTURE] Retour à chaud après l''ITW de ce matin — points forts et red flags',
   (NOW() + INTERVAL '5 hours')::timestamptz, NULL::timestamptz),

  -- ════ CETTE SEMAINE (week) — 2 tâches ════════════════════════════════
  (gen_random_uuid(), 'Antoine Garcia', 'Engineering Manager',
   'Valider la shortlist finale',
   '[FIXTURE] 5 candidats à présenter — vérifier que tous ont accepté la confidentialité',
   (NOW() + INTERVAL '2 days')::timestamptz, NULL::timestamptz),

  (gen_random_uuid(), 'Inès Petit', 'Senior Frontend Engineer',
   'Envoyer la proposition d''offre',
   '[FIXTURE] Salaire 75k + variable 8% + RTT, relire avant envoi pour ne pas se planter',
   (NOW() + INTERVAL '3 days')::timestamptz, NULL::timestamptz),

  -- ════ PLUS TARD (later) — 1 tâche ═════════════════════════════════════
  (gen_random_uuid(), 'Hugo Moreau', 'Staff Software Engineer',
   'Vérifier les références',
   '[FIXTURE] Contacts de 2 anciens managers fournis, à appeler après signature de l''offre',
   (NOW() + INTERVAL '12 days')::timestamptz, NULL::timestamptz),

  -- ════ TERMINÉES (done) — 2 tâches ════════════════════════════════════
  (gen_random_uuid(), 'Julie Roux', 'Backend Engineer',
   'Programmer l''entretien technique',
   '[FIXTURE] ✓ Calendly envoyé, créneau choisi par Julie',
   (NOW() - INTERVAL '5 days')::timestamptz, (NOW() - INTERVAL '4 days')::timestamptz),

  (gen_random_uuid(), 'Pierre Lemaire', 'DevOps Engineer',
   'Faire signer le NDA',
   '[FIXTURE] ✓ Signé via DocuSign, archivé dans le dossier client',
   (NOW() - INTERVAL '3 days')::timestamptz, (NOW() - INTERVAL '2 days')::timestamptz)

) AS fixtures(candidate_uuid, candidate_name, job_title, title, description, due_at, completed_at);


-- ─── 2. ÉVÉNEMENTS CALENDRIER (qualification_sessions) ───────────────────
WITH me AS (
  SELECT id AS user_id FROM auth.users WHERE email = 'l.garilhe@konekt.fr' LIMIT 1
),
my_org AS (
  SELECT active_organization_id AS org_id
  FROM profiles
  WHERE user_id = (SELECT user_id FROM me)
  LIMIT 1
)
INSERT INTO qualification_sessions (
  organization_id, created_by, candidate_name, candidate_headline, client_name,
  job_title, event_name, event_start_at, event_end_at, event_location,
  status, notes
)
SELECT
  (SELECT org_id FROM my_org),
  (SELECT user_id FROM me),
  candidate_name, candidate_headline, client_name, job_title,
  event_name, event_start_at, event_end_at, event_location,
  'scheduled', notes
FROM (VALUES
  -- Aujourd'hui matin
  ('Sophie Martin', 'Senior Backend Engineer @ Datadog', 'BNP Paribas',
   'Senior Backend Engineer',
   'Qualif Sophie Martin', (NOW() + INTERVAL '4 hours')::timestamptz,
   (NOW() + INTERVAL '4 hours 30 minutes')::timestamptz,
   'Google Meet', '[FIXTURE] Qualif initiale — 30 min'),

  -- Demain
  ('Thomas Dubois', 'Lead Data Scientist @ Criteo', 'Doctolib',
   'Lead Data Scientist',
   'Qualif Thomas Dubois', (NOW() + INTERVAL '1 day 10 hours')::timestamptz,
   (NOW() + INTERVAL '1 day 10 hours 45 minutes')::timestamptz,
   'Zoom', '[FIXTURE] Deep-dive technique sur le scoring ML'),

  -- Dans 3 jours
  ('Camille Leroy', 'Product Designer @ Alan', 'Spendesk',
   'Senior Product Designer',
   'Qualif Camille Leroy', (NOW() + INTERVAL '3 days 14 hours')::timestamptz,
   (NOW() + INTERVAL '3 days 14 hours 30 minutes')::timestamptz,
   'Google Meet', '[FIXTURE] Présentation portfolio + cas d''usage'),

  -- Dans 5 jours
  ('Marc Lefèvre', 'Engineering Manager @ Datadog', 'Qonto',
   'Engineering Manager',
   'Qualif Marc Lefèvre', (NOW() + INTERVAL '5 days 9 hours 30 minutes')::timestamptz,
   (NOW() + INTERVAL '5 days 10 hours 15 minutes')::timestamptz,
   'Bureau Konekt', '[FIXTURE] Premier rdv physique — café au bureau'),

  -- Dans 6 jours
  ('Léa Bernard', 'VP Engineering @ ContentSquare', 'Mirakl',
   'VP Engineering',
   'Qualif Léa Bernard', (NOW() + INTERVAL '6 days 16 hours')::timestamptz,
   (NOW() + INTERVAL '6 days 16 hours 60 minutes')::timestamptz,
   'Zoom', '[FIXTURE] Deuxième tour — discussion package + start date')

) AS fixtures(candidate_name, candidate_headline, client_name, job_title,
  event_name, event_start_at, event_end_at, event_location, notes);


-- ════════════════════════════════════════════════════════════════════════
-- Fini ! Hard-refresh /tasks et /calendar pour voir les fixtures.
--
-- Pour supprimer plus tard :
--   DELETE FROM candidate_reminders WHERE description LIKE '%[FIXTURE]%';
--   DELETE FROM qualification_sessions WHERE notes LIKE '%[FIXTURE]%';
-- ════════════════════════════════════════════════════════════════════════
