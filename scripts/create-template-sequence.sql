-- ─────────────────────────────────────────────────────────────────────────────
-- Crée une séquence "modèle" outreach recruteur tech.
-- Inactive par défaut — l'utilisateur l'active après revue.
--
-- Workflow (best practice 2026, conforme rate limits LinkedIn) :
--   1. Visite de profil (J0) — signal "vu" doux, pas de message
--   2. Invitation LinkedIn personnalisée (J+1) — IA Konekt adapte par profil
--   3. Wait connection (timeout 7j) — pause jusqu'à acceptation
--   4. Message LinkedIn de qualification (J+2 après acceptation) — IA Konekt
--   5. Wait reply (timeout 5j) — pause jusqu'à réponse
--   6. Email de relance multicanal (J+5) — diversifie le canal
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_user_id      uuid := '16583eb3-1284-4110-b2a6-b845dc7b677a';  -- l.garilhe@konekt.fr
  v_org_id       uuid := '23e5e6d5-6e11-4ea1-8a7c-1a4efe6cf2e8';  -- konekt
  v_sequence_id  uuid;
  v_step_visit   uuid;
  v_step_invite  uuid;
  v_step_waitc   uuid;
  v_step_msg     uuid;
  v_step_waitr   uuid;
  v_step_email   uuid;
BEGIN

-- 1. Crée la séquence (inactive)
INSERT INTO public.outreach_sequences (
  name,
  description,
  is_active,
  created_by,
  organization_id,
  multi_sender_enabled,
  stop_on_company_reply
)
VALUES (
  'Outreach Tech — Modèle Konekt',
  'Séquence de référence outreach tech : visite → invitation → wait → message → wait → email. Personnalisation IA active partout. Délais conformes aux rate limits LinkedIn (100 invit/sem max).',
  false,        -- INACTIVE : revoir avant d'activer
  v_user_id,
  v_org_id,
  false,        -- mono-sender (utilise le compte LinkedIn de l'user)
  true          -- stop si une réponse arrive d'un autre candidat de la même boîte
)
RETURNING id INTO v_sequence_id;

-- 2. Step 0 — Visite de profil (J0, immédiat)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes, use_ai_personalization,
  preferred_hour_start, preferred_hour_end
)
VALUES (
  v_sequence_id, v_org_id, 0, 'profile_visit', 'always',
  0, 0, 0, false,
  9, 18  -- entre 9h et 18h, heures de bureau
)
RETURNING id INTO v_step_visit;

-- 3. Step 1 — Invitation LinkedIn personnalisée (J+1)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes,
  message_template, use_ai_personalization, ai_tone,
  preferred_hour_start, preferred_hour_end
)
VALUES (
  v_sequence_id, v_org_id, 1, 'connection_request', 'always',
  1, 0, 0,
  -- Note d'invitation max 280 char (marge avant 300 limit LinkedIn)
  E'Bonjour {{first_name}}, j''ai vu votre parcours chez {{company}} — votre expertise sur {{ai_snippet}} m''a interpellé. J''aimerais échanger sur une opportunité qui pourrait correspondre à votre prochaine étape. Bonne journée !',
  true,         -- IA Konekt personnalise par profil
  'professional',
  9, 17         -- invitations seulement en pleine journée
)
RETURNING id INTO v_step_invite;

-- 4. Step 2 — Wait connection (timeout 7j, complète si pas accepté)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes, use_ai_personalization,
  timeout_days
)
VALUES (
  v_sequence_id, v_org_id, 2, 'wait_connection', 'always',
  0, 0, 0, false,
  7  -- 7 jours d'attente max, sinon enrollment complete (LinkedIn nettoie auto les invits >2sem)
)
RETURNING id INTO v_step_waitc;

-- 5. Step 3 — Message LinkedIn de qualification (J+2 après acceptation)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes,
  message_template, use_ai_personalization, ai_tone,
  preferred_hour_start, preferred_hour_end
)
VALUES (
  v_sequence_id, v_org_id, 3, 'message', 'always',
  2, 0, 0,
  E'Merci d''avoir accepté {{first_name}} !\n\nJe suis recruteur chez Konekt, et nous travaillons avec une scale-up qui cherche un profil comme le vôtre. Sans vouloir être trop direct : seriez-vous ouvert à découvrir le contexte ? Je peux vous partager les détails (mission, équipe, salaire) en 10 min de visio si ça vous intéresse.\n\nDans tous les cas, ravi d''être en contact.',
  true,
  'professional',
  9, 18
)
RETURNING id INTO v_step_msg;

-- 6. Step 4 — Wait reply (timeout 5j, continue vers email si pas de réponse)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes, use_ai_personalization,
  timeout_days
)
VALUES (
  v_sequence_id, v_org_id, 4, 'wait_reply', 'always',
  0, 0, 0, false,
  5
)
RETURNING id INTO v_step_waitr;

-- 7. Step 5 — Email de relance multicanal (J+5 après wait_reply)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes,
  subject_template, message_template, use_ai_personalization, ai_tone,
  preferred_hour_start, preferred_hour_end,
  include_unsubscribe
)
VALUES (
  v_sequence_id, v_org_id, 5, 'email', 'always',
  0, 0, 0,  -- pas de délai supp, le wait_reply a déjà gardé 5j
  'Une dernière fois — {{first_name}}',
  E'Bonjour {{first_name}},\n\nJe vous écris ici car LinkedIn est parfois saturé. Je relance brièvement sur l''opportunité dont je vous parlais — il s''agit d''un poste {{job_title}} dans une scale-up tech française en forte croissance.\n\nSi le timing n''est pas bon, pas de souci, je comprends totalement. Si vous voulez en discuter, voici mon agenda : {{calendly_link}}\n\nBonne semaine,\n{{signature}}',
  true,
  'casual',     -- ton plus relâché à l''email
  9, 17,
  true          -- footer désinscription RGPD
)
RETURNING id INTO v_step_email;

-- Output récap
RAISE NOTICE 'Séquence créée : %', v_sequence_id;
RAISE NOTICE 'Steps : visit=%, invite=%, wait_conn=%, msg=%, wait_reply=%, email=%',
  v_step_visit, v_step_invite, v_step_waitc, v_step_msg, v_step_waitr, v_step_email;

END $$;

-- Verify result
SELECT
  s.id,
  s.name,
  s.is_active,
  COUNT(st.id) AS steps_count
FROM public.outreach_sequences s
LEFT JOIN public.sequence_steps st ON st.sequence_id = s.id
WHERE s.name = 'Outreach Tech — Modèle Konekt'
GROUP BY s.id, s.name, s.is_active;
