-- ─────────────────────────────────────────────────────────────────────────────
-- Crée une séquence "Outreach Adaptatif" avec branchement complet :
--
--   Étape 1 : Visite de profil (signal "vu" doux)
--   Étape 2 : Vérifier connexion
--      ├── DÉJÀ CONNECTÉ (1er degré) :
--      │   ├── Étape 3 : Message LinkedIn direct (J+1)
--      │   ├── Étape 4 : Wait reply (timeout 5j)
--      │   └── Étape 5 : Message de relance (J+3 après wait)
--      │       → END
--      │
--      └── PAS CONNECTÉ (2e/3e degré) :
--          ├── Étape 6 : Demande de connexion + note 280 char (J+1)
--          ├── Étape 7 : Wait connection (timeout 3j)
--          │   ├── ACCEPTÉE :
--          │   │   ├── Étape 8 : Message LinkedIn (J+1)
--          │   │   ├── Étape 9 : Wait reply (timeout 5j)
--          │   │   └── Étape 10 : Message de relance (J+3)
--          │   │       → END
--          │   └── PAS ACCEPTÉE (timeout 3j) :
--          │       └── Étape 11 : InMail fallback
--          │           → END
--
-- Routing :
-- - check_connection.if_true_goto_step  → step 3 (branche connecté)
-- - check_connection.if_false_goto_step → step 6 (branche pas connecté)
-- - wait_connection.next_step_id        → step 8 (branche acceptée)
-- - wait_connection.timeout_branch_step_id → step 11 (branche timeout)
-- - Steps terminales (5, 10, 11) ont next_step_id=NULL et sont des
--   "branch targets" → la cron complète l'enrollment proprement.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_user_id      uuid := '16583eb3-1284-4110-b2a6-b845dc7b677a';
  v_org_id       uuid := '23e5e6d5-6e11-4ea1-8a7c-1a4efe6cf2e8';
  v_seq_id       uuid;
  v_s0           uuid;  -- profile_visit
  v_s1           uuid;  -- check_connection
  v_s2_msg       uuid;  -- branche YES : message direct
  v_s3_wait      uuid;  -- branche YES : wait_reply
  v_s4_relance   uuid;  -- branche YES : message relance
  v_s5_invite    uuid;  -- branche NO : connection_request
  v_s6_waitc     uuid;  -- branche NO : wait_connection
  v_s7_msg       uuid;  -- branche NO/accepté : message
  v_s8_wait      uuid;  -- branche NO/accepté : wait_reply
  v_s9_relance   uuid;  -- branche NO/accepté : message relance
  v_s10_inmail   uuid;  -- branche NO/timeout : InMail fallback
BEGIN

-- 1. Crée la séquence (inactive)
INSERT INTO public.outreach_sequences (
  name, description, is_active, created_by, organization_id,
  multi_sender_enabled, stop_on_company_reply
)
VALUES (
  'Outreach Adaptatif — Branchement IA',
  'Séquence intelligente qui s''adapte au degré de connexion : message direct si déjà 1er degré, sinon invitation puis fallback InMail si non acceptée. Personnalisation IA active partout. 100% conforme rate limits LinkedIn.',
  false,
  v_user_id, v_org_id,
  false, true
)
RETURNING id INTO v_seq_id;

-- 2. Insert tous les steps SANS les FK de branchement (qu'on ajoute en UPDATE après)
INSERT INTO public.sequence_steps (
  sequence_id, organization_id, step_order, action_type, condition_type,
  delay_days, delay_hours, delay_minutes, use_ai_personalization, ai_tone,
  message_template, subject_template, timeout_days,
  preferred_hour_start, preferred_hour_end, include_unsubscribe
)
VALUES
  -- Étape 0 : Visite de profil (J0)
  (v_seq_id, v_org_id, 0, 'profile_visit', 'always',
   0, 0, 0, false, NULL,
   NULL, NULL, NULL,
   9, 18, false),
  -- Étape 1 : Vérifier connexion
  (v_seq_id, v_org_id, 1, 'check_connection', 'always',
   0, 0, 30, false, NULL,
   NULL, NULL, NULL,
   9, 18, false),
  -- Étape 2 (branche YES) : Message direct si déjà connecté
  (v_seq_id, v_org_id, 2, 'message', 'always',
   1, 0, 0, true, 'professional',
   E'Bonjour {{first_name}}, on est déjà connectés sur LinkedIn 👋\n\nJe suis recruteur chez Konekt. {{ai_snippet}}\n\nJ''accompagne actuellement une scale-up qui cherche un profil avec votre expertise. Si vous avez 10 minutes pour en discuter (sans engagement), voici mon agenda : {{calendly_link}}\n\nDans tous les cas, ravi d''être en contact !',
   NULL, NULL,
   9, 18, false),
  -- Étape 3 (branche YES) : Wait reply (5j)
  (v_seq_id, v_org_id, 3, 'wait_reply', 'always',
   0, 0, 0, false, NULL,
   NULL, NULL, 5,
   9, 18, false),
  -- Étape 4 (branche YES) : Message de relance
  (v_seq_id, v_org_id, 4, 'message', 'always',
   3, 0, 0, true, 'casual',
   E'Hello {{first_name}}, je relance brièvement — je sais que LinkedIn déborde 😅\n\nSi le timing n''est pas bon ou que ça ne vous parle pas, dites-le moi en un mot et je vous laisse tranquille. Sinon, mon agenda reste ouvert : {{calendly_link}}\n\nBonne semaine !',
   NULL, NULL,
   9, 18, false),
  -- Étape 5 (branche NO) : Demande de connexion avec note
  (v_seq_id, v_org_id, 5, 'connection_request', 'always',
   1, 0, 0, true, 'professional',
   E'Bonjour {{first_name}}, j''ai vu votre parcours chez {{company}} — votre expertise sur {{ai_snippet}} m''a interpellé. J''aimerais échanger sur une opportunité qui pourrait correspondre à votre prochaine étape.',
   NULL, NULL,
   9, 17, false),
  -- Étape 6 (branche NO) : Wait connection (timeout 3j)
  (v_seq_id, v_org_id, 6, 'wait_connection', 'always',
   0, 0, 0, false, NULL,
   NULL, NULL, 3,
   9, 18, false),
  -- Étape 7 (branche NO, après acceptation) : Message LinkedIn
  (v_seq_id, v_org_id, 7, 'message', 'always',
   1, 0, 0, true, 'professional',
   E'Merci d''avoir accepté {{first_name}} !\n\nJe suis recruteur chez Konekt. {{ai_snippet}}\n\nNous travaillons avec une scale-up qui cherche un profil comme le vôtre. Sans vouloir être trop direct : seriez-vous ouvert à découvrir le contexte ? Je peux vous partager les détails (mission, équipe, salaire) en 10 min de visio si ça vous intéresse.\n\nRavi d''être en contact dans tous les cas.',
   NULL, NULL,
   9, 18, false),
  -- Étape 8 (branche NO, après acceptation) : Wait reply (5j)
  (v_seq_id, v_org_id, 8, 'wait_reply', 'always',
   0, 0, 0, false, NULL,
   NULL, NULL, 5,
   9, 18, false),
  -- Étape 9 (branche NO, après acceptation) : Message de relance
  (v_seq_id, v_org_id, 9, 'message', 'always',
   3, 0, 0, true, 'casual',
   E'Hello {{first_name}}, je relance brièvement 😊\n\nSi ce que je vous proposais ne correspond pas à votre moment, dites-le moi en un mot — je préfère savoir et vous laisser tranquille plutôt que d''insister. Si au contraire vous voulez en savoir plus : {{calendly_link}}\n\nMerci pour le temps !',
   NULL, NULL,
   9, 18, false),
  -- Étape 10 (branche NO, timeout) : InMail fallback
  (v_seq_id, v_org_id, 10, 'inmail', 'always',
   0, 0, 0, true, 'professional',
   E'Bonjour {{first_name}},\n\nJ''avais initié une mise en relation LinkedIn il y a quelques jours, sans suite — je tente ma chance via InMail au cas où vous n''ayez pas vu la demande.\n\n{{ai_snippet}}\n\nJ''ai un poste qui pourrait vous intéresser. Si c''est le bon moment pour explorer une opportunité, voici mon agenda : {{calendly_link}}\n\nSinon, pas de souci, je n''insiste plus.\n\nBonne journée,\n{{signature}}',
   'Une opportunité pour vous {{first_name}} ?', NULL,
   9, 17, false);

-- 3. Récupère les IDs créés
SELECT id INTO v_s0          FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 0;
SELECT id INTO v_s1          FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 1;
SELECT id INTO v_s2_msg      FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 2;
SELECT id INTO v_s3_wait     FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 3;
SELECT id INTO v_s4_relance  FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 4;
SELECT id INTO v_s5_invite   FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 5;
SELECT id INTO v_s6_waitc    FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 6;
SELECT id INTO v_s7_msg      FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 7;
SELECT id INTO v_s8_wait     FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 8;
SELECT id INTO v_s9_relance  FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 9;
SELECT id INTO v_s10_inmail  FROM public.sequence_steps WHERE sequence_id = v_seq_id AND step_order = 10;

-- 4. Câble les FK de branchement / next_step_id
-- Étape 1 (check_connection) : if_true → step 2 (déjà connecté), if_false → step 5 (pas connecté)
UPDATE public.sequence_steps
   SET if_true_goto_step  = v_s2_msg,
       if_false_goto_step = v_s5_invite
 WHERE id = v_s1;

-- Étape 2 → 3 → 4 (branche YES, linéaire via next_step_id)
UPDATE public.sequence_steps SET next_step_id = v_s3_wait    WHERE id = v_s2_msg;
UPDATE public.sequence_steps SET next_step_id = v_s4_relance WHERE id = v_s3_wait;
-- Étape 4 : terminale (next_step_id = NULL, branch target via step 3 → cron complète)

-- Étape 5 → 6 (branche NO)
UPDATE public.sequence_steps SET next_step_id = v_s6_waitc   WHERE id = v_s5_invite;

-- Étape 6 (wait_connection) : success → step 7, timeout → step 10 (InMail)
UPDATE public.sequence_steps
   SET next_step_id            = v_s7_msg,
       timeout_branch_step_id  = v_s10_inmail
 WHERE id = v_s6_waitc;

-- Étape 7 → 8 → 9 (branche NO/accepté, linéaire)
UPDATE public.sequence_steps SET next_step_id = v_s8_wait    WHERE id = v_s7_msg;
UPDATE public.sequence_steps SET next_step_id = v_s9_relance WHERE id = v_s8_wait;
-- Étape 9 : terminale (branch target via step 8)

-- Étape 10 : terminale (branch target via step 6.timeout_branch_step_id)

RAISE NOTICE '✅ Séquence créée : %', v_seq_id;
RAISE NOTICE 'Étapes : 0=visit, 1=check, 2-4=YES branch, 5-6=NO base, 7-9=accepted, 10=inmail timeout';

END $$;

-- Verify
SELECT
  s.id,
  s.name,
  s.is_active,
  COUNT(st.id) AS steps_count
FROM public.outreach_sequences s
LEFT JOIN public.sequence_steps st ON st.sequence_id = s.id
WHERE s.name = 'Outreach Adaptatif — Branchement IA'
GROUP BY s.id, s.name, s.is_active;
