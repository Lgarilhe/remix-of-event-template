-- =====================================================================
-- Lot « steps-1 » du module séquences : save_sequence_steps et les renvois
-- vers une étape absente du lot (comportement save-steps-dangling-ref).
--
-- Contrat : SEQ-016 (docs/audit-2026-09-25-sequences.md, tableau des
-- décisions) : une branche vide ou qui vise une étape supprimée est
-- interdite à l'enregistrement. save_sequence_steps est l'enregistrement
-- (éditeur, duplication par modèle, appels directs) : un renvoi vers une
-- étape absente du lot ne doit jamais devenir NULL en silence, sinon le
-- moteur envoie le candidat vers l'étape d'ordre suivant (SEQ-016 recréé).
--
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK :
--   BEGIN; \i supabase/tests/seq_steps_1_audit.sql; ROLLBACK;
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Utilisateur, organisation et séquence synthétiques (ids fixes propres à ce
-- fichier).
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '5e951111-1111-4111-8111-111111111111';
  org_a uuid := '5e95aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  seq_ok uuid := '5e950000-0000-4000-8000-000000000001';
  seq_branch uuid := '5e950000-0000-4000-8000-000000000002';
  seq_next uuid := '5e950000-0000-4000-8000-000000000003';
  seq_timeout uuid := '5e950000-0000-4000-8000-000000000004';
  claims_a text := json_build_object('sub', '5e951111-1111-4111-8111-111111111111', 'role', 'authenticated', 'email', 'steps1@audit.test')::text;
  r_check record;
  r_msg record;
  n int;
  v_null_refs text;
  failures text := '';
  checks int := 0;
BEGIN
  -- Jeu de données, sans utilisateur connecté (chemin serveur).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  RESET ROLE;

  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'steps1@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (org_a, 'Audit steps-1', 'audit-steps-1', u_a);
  -- Le créateur devient propriétaire par déclencheur ; rien à insérer s'il l'est déjà.
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org_a AND user_id = u_a) THEN
    RAISE EXCEPTION 'seq_steps_1_audit : le créateur de l''organisation n''en est pas membre';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, org_a)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES (seq_ok, 'Contrôle', org_a, u_a, false),
         (seq_branch, 'Branche orpheline', org_a, u_a, false),
         (seq_next, 'Étape suivante orpheline', org_a, u_a, false),
         (seq_timeout, 'Repli orphelin', org_a, u_a, false);

  -- ===== Contexte : propriétaire de l'organisation =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.email', 'steps1@audit.test', true);
  SET LOCAL ROLE authenticated;

  -- T0. Témoin : des renvois vers des étapes du lot sont écrits avec les ids de base.
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_ok, jsonb_build_array(
      jsonb_build_object('id', 'c', 'step_order', 0, 'action_type', 'check_connection',
                         'if_true_goto_step', 'm', 'if_false_goto_step', 'i'),
      jsonb_build_object('id', 'm', 'step_order', 1, 'action_type', 'message', 'message_template', 'Bonjour'),
      jsonb_build_object('id', 'i', 'step_order', 2, 'action_type', 'connection_request', 'message_template', 'Invitation')
    ));
    SELECT * INTO r_check FROM public.sequence_steps WHERE sequence_id = seq_ok AND step_order = 0;
    SELECT * INTO r_msg FROM public.sequence_steps WHERE sequence_id = seq_ok AND step_order = 1;
    IF r_check.if_true_goto_step IS DISTINCT FROM r_msg.id OR r_check.if_false_goto_step IS NULL THEN
      failures := failures || '[témoin : renvois valides mal écrits] ';
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[témoin : %s] ', SQLERRM);
  END;

  -- T1. Branche « Si non connecté » vers une étape absente du lot : refus attendu.
  -- DÉFAUT save-steps-dangling-ref : NULLIF(v_map->>…) écrit NULL sans erreur (migration 20260925163421, l. 886-889).
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_branch, jsonb_build_array(
      jsonb_build_object('id', 'c', 'step_order', 0, 'action_type', 'check_connection',
                         'if_true_goto_step', 'm', 'if_false_goto_step', 'inexistante'),
      jsonb_build_object('id', 'm', 'step_order', 1, 'action_type', 'message', 'message_template', 'Bonjour')
    ));
    SELECT count(*) INTO n FROM public.sequence_steps
    WHERE sequence_id = seq_branch AND action_type = 'check_connection' AND if_false_goto_step IS NULL;
    failures := failures || format('[save-steps-dangling-ref branche : enregistrement accepté, if_false_goto_step NULL sur %s étape(s)] ', n);
  EXCEPTION WHEN OTHERS THEN NULL; -- refus : attendu
  END;

  -- T2. « Étape suivante » vers une étape absente du lot : refus attendu.
  -- DÉFAUT save-steps-dangling-ref : next_step_id écrit NULL sans erreur (même UPDATE, l. 889).
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_next, jsonb_build_array(
      jsonb_build_object('id', 'a', 'step_order', 0, 'action_type', 'message', 'message_template', 'Un', 'next_step_id', 'supprimee'),
      jsonb_build_object('id', 'b', 'step_order', 1, 'action_type', 'message', 'message_template', 'Deux')
    ));
    SELECT string_agg(step_order::text, ',') INTO v_null_refs FROM public.sequence_steps
    WHERE sequence_id = seq_next AND step_order = 0 AND next_step_id IS NULL;
    failures := failures || format('[save-steps-dangling-ref étape suivante : enregistrement accepté, next_step_id NULL (étape %s)] ', v_null_refs);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- T3. Étape de repli d'une attente vers une étape absente du lot : refus attendu.
  -- DÉFAUT save-steps-dangling-ref : timeout_branch_step_id écrit NULL sans erreur (même UPDATE, l. 888).
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_timeout, jsonb_build_array(
      jsonb_build_object('id', 'w', 'step_order', 0, 'action_type', 'wait_connection', 'wait_for_event', 'connection_accepted',
                         'timeout_days', 5, 'timeout_branch_step_id', 'disparue'),
      jsonb_build_object('id', 'm', 'step_order', 1, 'action_type', 'message', 'message_template', 'Merci')
    ));
    SELECT string_agg(step_order::text, ',') INTO v_null_refs FROM public.sequence_steps
    WHERE sequence_id = seq_timeout AND action_type = 'wait_connection' AND timeout_branch_step_id IS NULL;
    failures := failures || format('[save-steps-dangling-ref repli : enregistrement accepté, timeout_branch_step_id NULL (étape %s)] ', v_null_refs);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  IF failures <> '' THEN
    RAISE EXCEPTION 'seq_steps_1_audit : contrôles en échec (% au total) : %', checks, failures;
  END IF;
  RAISE NOTICE 'seq_steps_1_audit : % contrôles OK', checks;
END;
$$;
