-- =====================================================================
-- Lot « steps-1 » du module séquences : save_sequence_steps et les renvois
-- vers une étape absente du lot (comportement save-steps-dangling-ref).
--
-- Contrat : SEQ-016 (docs/audit-2026-09-25-sequences.md, tableau des
-- décisions) interdit une branche vide ou qui vise une étape supprimée « à
-- l'enregistrement, sans changement moteur » : c'est l'éditeur qui bloque
-- (validateStepGraph, src/components/outreach/sequence/sequenceGraph.ts,
-- avant onSave). La RPC ne porte aucune règle de graphe : depuis sa première
-- version, elle réécrit les renvois vers les ids de base et met à NULL un
-- renvoi absent du lot, sans erreur. Test aligné sur ce comportement voulu
-- (rapport save-steps-dangling-ref réfuté par les deux relectures) : un
-- renvoi absent du lot est écrit NULL, jamais conservé tel quel ni dirigé
-- vers une autre étape ; les renvois valides du même lot restent remappés.
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

  -- T1. Branche « Si non connecté » vers une étape absente du lot : enregistrement
  -- accepté, branche orpheline écrite NULL, branche valide remappée sur l'étape du lot.
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_branch, jsonb_build_array(
      jsonb_build_object('id', 'c', 'step_order', 0, 'action_type', 'check_connection',
                         'if_true_goto_step', 'm', 'if_false_goto_step', 'inexistante'),
      jsonb_build_object('id', 'm', 'step_order', 1, 'action_type', 'message', 'message_template', 'Bonjour')
    ));
    SELECT * INTO r_check FROM public.sequence_steps WHERE sequence_id = seq_branch AND step_order = 0;
    SELECT * INTO r_msg FROM public.sequence_steps WHERE sequence_id = seq_branch AND step_order = 1;
    IF r_check.if_false_goto_step IS NOT NULL OR r_check.if_true_goto_step IS DISTINCT FROM r_msg.id THEN
      failures := failures || format('[save-steps-dangling-ref branche : si non connecté %s, si connecté %s (attendu NULL et %s)] ',
        r_check.if_false_goto_step, r_check.if_true_goto_step, r_msg.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[save-steps-dangling-ref branche : enregistrement refusé : %s] ', SQLERRM);
  END;

  -- T2. « Étape suivante » vers une étape absente du lot : enregistrement accepté,
  -- next_step_id écrit NULL (le moteur passe alors à l'étape d'ordre suivant).
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_next, jsonb_build_array(
      jsonb_build_object('id', 'a', 'step_order', 0, 'action_type', 'message', 'message_template', 'Un', 'next_step_id', 'supprimee'),
      jsonb_build_object('id', 'b', 'step_order', 1, 'action_type', 'message', 'message_template', 'Deux')
    ));
    SELECT count(*) INTO n FROM public.sequence_steps WHERE sequence_id = seq_next;
    SELECT string_agg(step_order::text, ',') INTO v_null_refs FROM public.sequence_steps
    WHERE sequence_id = seq_next AND next_step_id IS NOT NULL;
    IF n <> 2 OR v_null_refs IS NOT NULL THEN
      failures := failures || format('[save-steps-dangling-ref étape suivante : %s étape(s) écrite(s), next_step_id conservé (étape %s)] ', n, v_null_refs);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[save-steps-dangling-ref étape suivante : enregistrement refusé : %s] ', SQLERRM);
  END;

  -- T3. Étape de repli d'une attente vers une étape absente du lot : enregistrement
  -- accepté, timeout_branch_step_id écrit NULL (« continuer » à l'expiration).
  checks := checks + 1;
  BEGIN
    PERFORM public.save_sequence_steps(seq_timeout, jsonb_build_array(
      jsonb_build_object('id', 'w', 'step_order', 0, 'action_type', 'wait_connection', 'wait_for_event', 'connection_accepted',
                         'timeout_days', 5, 'timeout_branch_step_id', 'disparue'),
      jsonb_build_object('id', 'm', 'step_order', 1, 'action_type', 'message', 'message_template', 'Merci')
    ));
    SELECT count(*) INTO n FROM public.sequence_steps
    WHERE sequence_id = seq_timeout AND action_type = 'wait_connection' AND timeout_branch_step_id IS NULL;
    IF n <> 1 THEN
      failures := failures || format('[save-steps-dangling-ref repli : attente avec repli NULL : %s (attendu 1)] ', n);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[save-steps-dangling-ref repli : enregistrement refusé : %s] ', SQLERRM);
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
