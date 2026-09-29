-- =====================================================================
-- Partenaires et équipe de mission : lot C1, réparations R6 et R7, et
-- gel de la Marketplace (décision 17).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/partner_engagements_audit.sql; ROLLBACK;
-- Vérifie 20260927233806_c1_reparations_fuites.sql :
--   R6  : get_open_hunt_missions ne renvoie que les champs de la carte (ni
--         client_name, ni interlocuteur, ni consignes, ni profils de
--         calibration, ni nom interne de la mission) ;
--         get_my_hunt_applications ne renvoie plus client_name.
--   R7  : un externe de mission (partenaire accepté) ne lit ni n'écrit
--         aucune ligne, note, grille, profil, note IA ou séquence de
--         l'entreprise, ne rattache aucune ligne ni séquence de sa propre
--         organisation à la mission de l'entreprise, et ne voit pas l'autre
--         partenaire de la mission ; un membre interne de l'équipe garde
--         tous ses accès.
--   D17 : une session utilisateur ne publie aucune mission, et
--         validate_marketplace_partner refuse, avec l'indice
--         MARKETPLACE_FROZEN.
-- Les deux familles de noms de policies (production et base neuve) sont
-- couvertes par le contrôle 14, qui lit pg_policies.
-- Entreprise E (propriétaire u_e, membre u_m dans l'équipe de la mission),
-- partenaires P1 (u_p1) et P2 (u_p2) acceptés sur la même mission, tiers C
-- (u_c). Ids fixes. Les fonctions appelées sous le rôle authenticated lui
-- sont accordées ; validate_marketplace_partner, réservée à service_role,
-- est appelée sans changement de rôle.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_e  uuid := '91111111-1111-4111-8111-111111111111';
  u_m  uuid := '92222222-2222-4222-8222-222222222222';
  u_p1 uuid := '93333333-3333-4333-8333-333333333333';
  u_p2 uuid := '94444444-4444-4444-8444-444444444444';
  u_c  uuid := '95555555-5555-4555-8555-555555555555';
  org_e  uuid := '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_p1 uuid := '9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  org_p2 uuid := '9ccccccc-cccc-4ccc-8ccc-cccccccccccc';
  org_c  uuid := '9ddddddd-dddd-4ddd-8ddd-dddddddddddd';
  proj_e  uuid := '9e000000-0000-4000-8000-000000000001';
  proj_e2 uuid := '9e000000-0000-4000-8000-000000000002';
  proj_e3 uuid := '9e000000-0000-4000-8000-000000000003';
  proj_e4 uuid := '9e000000-0000-4000-8000-000000000004';
  proj_p1 uuid := '9e000000-0000-4000-8000-000000000011';
  proj_p1x uuid := '9e000000-0000-4000-8000-000000000012';
  proj_ex uuid := '9e000000-0000-4000-8000-000000000013';
  v_pid uuid;
  v_missing text;
  card_keys text[] := ARRAY['id', 'name', 'job_details', 'hunt_bounty_percent', 'hunt_max_recruiters',
                            'hunt_deadline', 'hunt_status', 'created_at', 'organization_name',
                            'accepted_count', 'my_application_status'];
  card_jd_keys text[] := ARRAY['title', 'contract_type', 'location', 'remote_policy', 'seniority',
                               'skills_must_have'];
  v_row jsonb;
  v_extra text[];
  v_hint text;
  v_stats_before integer;
  v_stats_after integer;
  n integer;
  failures text := '';
BEGIN
  -- Fonctions appelées sous SET ROLE authenticated : un droit retiré ferait
  -- tomber le Postgres de l'image au lieu d'un échec lisible (CLAUDE.md).
  SELECT string_agg(f, ', ') INTO v_missing
  FROM unnest(ARRAY['public.get_open_hunt_missions()', 'public.get_my_hunt_applications()',
                    'public.get_mission_team_profiles(uuid)',
                    'public.save_hunt_mission_settings(uuid,numeric,integer,timestamptz,boolean)',
                    -- aides des policies évaluées sous ce rôle (R7-b, mission_team_select)
                    'public.project_organization_id(uuid)', 'public.is_org_member_for_project(uuid,uuid)']) AS f
  WHERE CASE WHEN to_regprocedure(f) IS NULL THEN true
             ELSE NOT has_function_privilege('authenticated', to_regprocedure(f), 'EXECUTE') END;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'partner_engagements_audit : non exécutable par authenticated, contrôles non joués : %', v_missing;
  END IF;

  -- ===== Jeu de données (sans jeton : aucun contrôle de plan ni de rôle) =====
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_e,  'e@partners.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_m,  'm@partners.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_p1, 'p1@partners.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_p2, 'p2@partners.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c,  'c@partners.test',  'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org_e,  'Partners Entreprise', 'partners-entreprise', u_e,  'enterprise'),
         (org_p1, 'Partners Cabinet Un', 'partners-cabinet-un', u_p1, 'agency'),
         (org_p2, 'Partners Cabinet Deux', 'partners-cabinet-deux', u_p2, 'agency'),
         (org_c,  'Partners Tiers', 'partners-tiers', u_c, 'agency');
  -- Les propriétaires sont rattachés par le déclencheur de création.
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_e, u_m, 'member');
  IF coalesce(public.get_org_role(u_e, org_e), '') <> 'owner'
     OR coalesce(public.get_org_role(u_p1, org_p1), '') <> 'owner'
     OR coalesce(public.get_org_role(u_p2, org_p2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id, display_name)
  VALUES (u_e, org_e, 'Entreprise E'), (u_m, org_e, 'Membre M'),
         (u_p1, org_p1, 'Cabinet Un'), (u_p2, org_p2, 'Cabinet Deux'), (u_c, org_c, 'Tiers C')
  ON CONFLICT (user_id) DO UPDATE
    SET active_organization_id = EXCLUDED.active_organization_id,
        display_name = EXCLUDED.display_name;

  INSERT INTO public.feature_activations (organization_id, feature, status)
  VALUES (org_p1, 'marketplace_recruit', 'active'), (org_p2, 'marketplace_recruit', 'active');

  -- Missions de E : proj_e en chasse, poste complet avec les champs
  -- confidentiels et une compétence héritée non textuelle ; proj_e2 hors
  -- Marketplace ; proj_e3 en chasse, sans intitulé de poste, dont le nom
  -- interne cite le client.
  INSERT INTO public.sourcing_projects (id, organization_id, created_by, name, client_name, job_title, job_details,
                                        hunt_mode, hunt_status, hunt_bounty_percent, hunt_max_recruiters)
  VALUES (proj_e, org_e, u_e, 'Mission chasse', 'Client Confidentiel SA', 'Directeur financier',
          jsonb_build_object(
            'title', 'Directeur financier', 'contract_type', 'cdi', 'location', 'Lyon',
            'remote_policy', 'hybrid', 'seniority', 'Senior',
            'skills_must_have', jsonb_build_array('IFRS', 'Consolidation',
              jsonb_build_object('name', 'Compétence héritée')),
            'salary_max', 120000,
            'client', jsonb_build_object('name', 'Client Confidentiel SA',
              'hiring_manager', jsonb_build_object('name', 'Claire Martin',
                'email', 'claire.martin@client.test', 'phone', '+33600000000')),
            'calibration_profiles', jsonb_build_array(jsonb_build_object('name', 'Profil Calibrage',
              'headline', 'DAF', 'linkedin_url', 'https://www.linkedin.com/in/calibrage',
              'why_good_fit', jsonb_build_array('x'))),
            'outreach_config', jsonb_build_object('sender_role', 'talent_acquisition'),
            'raw_brief', 'Brief confidentiel'),
          true, 'in_progress', 20, 3),
         (proj_e2, org_e, u_e, 'Autre mission', NULL, 'Contrôleur de gestion', '{}'::jsonb,
          false, 'draft', NULL, NULL),
         (proj_e3, org_e, u_e, 'DAF Client Confidentiel SA', 'Client Confidentiel SA', NULL, '{}'::jsonb,
          true, 'published', 15, 2),
         (proj_e4, org_e, u_e, 'Mission retirée', NULL, 'Juriste', '{}'::jsonb,
          false, 'published', 10, 1),
         (proj_p1, org_p1, u_p1, 'Mission de P1', NULL, 'Juriste', '{}'::jsonb,
          false, 'draft', NULL, NULL);
  -- Deux organisations suivent le même poste externe (R7-d) ; la mission de
  -- E est la plus récente, celle qu'un rattachement sans filtre choisirait.
  INSERT INTO public.sourcing_projects (id, organization_id, created_by, name, job_title, job_details, job_id, created_at)
  VALUES (proj_p1x, org_p1, u_p1, 'Poste externe de P1', 'Juriste', '{}'::jsonb, 'EXT-POSTE-1', now() - interval '1 day'),
         (proj_ex, org_e, u_e, 'Poste externe de E', 'Juriste', '{}'::jsonb, 'EXT-POSTE-1', now());

  INSERT INTO public.hunt_applications (project_id, recruiter_user_id, recruiter_org_id, status)
  VALUES (proj_e, u_p1, org_p1, 'accepted'), (proj_e, u_p2, org_p2, 'accepted');
  INSERT INTO public.mission_team (project_id, user_id, role)
  VALUES (proj_e, u_p1, 'freelance'), (proj_e, u_p2, 'freelance'), (proj_e, u_m, 'sourcer');
  INSERT INTO public.mission_process_steps (project_id, organization_id, step_order, name)
  VALUES (proj_e, org_e, 1, 'Entretien RH');

  -- Données de E : le candidat est sur les deux missions ; une ligne a été
  -- ajoutée par P2 avant la réparation (organisation E, auteur P2).
  INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
  VALUES ('PE-CAND-1', 'project:' || proj_e::text,  proj_e,  org_e, u_e),
         ('PE-CAND-1', 'project:' || proj_e2::text, proj_e2, org_e, u_e),
         ('PE-CAND-2', 'project:' || proj_e::text,  proj_e,  org_e, u_p2);
  INSERT INTO public.candidate_notes (candidate_id, content, organization_id, created_by)
  VALUES ('PE-CAND-1', 'note privée de E', org_e, u_e);
  INSERT INTO public.candidate_evaluations (candidate_id, job_id, organization_id, created_by, overall_score)
  VALUES ('PE-CAND-1', 'project:' || proj_e2::text, org_e, u_e, 4);
  INSERT INTO public.candidate_profiles (candidate_id, name, organization_id, created_by)
  VALUES ('PE-CAND-1', 'Candidat Un', org_e, u_e);
  INSERT INTO public.match_scores (candidate_id, job_id, score, organization_id, created_by)
  VALUES ('PE-CAND-1', 'project:' || proj_e2::text, 80, org_e, u_e);
  INSERT INTO public.outreach_sequences (name, organization_id, project_id, created_by)
  VALUES ('Séquence de E', org_e, proj_e, u_e);

  SELECT stats_total_found INTO v_stats_before FROM public.sourcing_projects WHERE id = proj_e;

  -- ===== Contexte : P1, partenaire accepté sur la mission de E =====
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u_p1, 'role', 'authenticated', 'email', 'p1@partners.test')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_p1::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. P1 ne lit aucune ligne candidat de E, ni la sienne ni celle de P2.
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[1. P1 lit %s ligne(s) candidat de E] ', n); END IF;

  -- 2. P1 ne change pas l'étape d'une ligne de E.
  BEGIN
    UPDATE public.job_candidate_status SET pipeline_stage = 'rejected' WHERE organization_id = org_e;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[2. P1 modifie %s ligne(s) de E] ', n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[2. modification par P1 : %s] ', SQLERRM);
  END;

  -- 3. P1 ne crée pas de ligne candidat chez E.
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
    VALUES ('PE-CAND-3', 'project:' || proj_e::text, proj_e, org_e, u_p1);
    failures := failures || '[3. P1 crée une ligne candidat chez E] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[3. insertion par P1 : %s] ', SQLERRM);
    END IF;
  END;

  -- 3 bis. P1 ne rattache pas une ligne de sa propre organisation à la
  --        mission de E, ni par project_id, ni par job_id seul (le
  --        déclencheur resolve_jcs_project_id complète project_id). Une
  --        ligne hors mission reste permise. Insertions sans statut : une
  --        ligne Retenu serait refusée par la garde du lot 0b (mode refus)
  --        avant la RLS, qui est le contrôle visé ici.
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
    VALUES ('P1-INJ-1', 'project:' || proj_e::text, proj_e, org_p1, u_p1);
    failures := failures || '[3 bis. P1 rattache une ligne à la mission de E par project_id] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[3 bis. insertion par project_id : %s] ', SQLERRM);
    END IF;
  END;
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by)
    VALUES ('P1-INJ-2', 'project:' || proj_e::text, org_p1, u_p1);
    failures := failures || '[3 bis. P1 rattache une ligne à la mission de E par job_id] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[3 bis. insertion par job_id : %s] ', SQLERRM);
    END IF;
  END;
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by)
    VALUES ('P1-OWN-1', 'audit-poste-hors-mission', org_p1, u_p1);
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[3 bis. ligne hors mission de P1 refusée : %s] ', SQLERRM);
  END;
  -- Ligne rattachée à une mission de P1 qui porte le job_id de la mission de
  -- E : acceptée ou refusée, elle ne doit pas compter dans les chiffres de E
  -- (contrôle stats_total_found plus bas).
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by)
    VALUES ('P1-INJ-3', 'project:' || proj_e::text, proj_p1, org_p1, u_p1);
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[3 bis. insertion par job_id croisé : %s] ', SQLERRM);
    END IF;
  END;
  -- Même rattachement par modification d'une ligne existante (policy
  -- RESTRICTIVE mission_same_org_update).
  BEGIN
    UPDATE public.job_candidate_status SET project_id = proj_e
     WHERE candidate_id = 'P1-OWN-1' AND organization_id = org_p1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[3 bis. P1 rattache une ligne à la mission de E par modification] '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[3 bis. modification par P1 : %s] ', SQLERRM);
    END IF;
  END;

  -- 16. Deux organisations suivent le même poste externe : la ligne de P1
  --     est rattachée à la mission de P1, jamais à celle de E (R7-d).
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by)
    VALUES ('P1-EXT-1', 'EXT-POSTE-1', org_p1, u_p1);
    SELECT project_id INTO v_pid FROM public.job_candidate_status
     WHERE candidate_id = 'P1-EXT-1' AND organization_id = org_p1;
    IF v_pid IS DISTINCT FROM proj_p1x THEN
      failures := failures || format('[16. ligne de P1 rattachée à %s, attendu la mission de P1] ',
                                     coalesce(v_pid::text, 'aucune mission'));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[16. ligne de P1 sur son poste externe refusée : %s] ', SQLERRM);
  END;

  -- 4. P1 ne lit ni notes, ni grilles, ni profils, ni notes IA de E, sur
  --    aucune mission (le candidat est aussi sur une mission hors équipe).
  SELECT count(*) INTO n FROM public.candidate_notes WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[4. P1 lit %s note(s) de E] ', n); END IF;
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[4. P1 lit %s grille(s) de E] ', n); END IF;
  SELECT count(*) INTO n FROM public.candidate_profiles WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[4. P1 lit %s profil(s) de E] ', n); END IF;
  SELECT count(*) INTO n FROM public.match_scores WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[4. P1 lit %s note(s) IA de E] ', n); END IF;

  -- 5. P1 ne modifie ni ne crée de grille chez E.
  BEGIN
    UPDATE public.candidate_evaluations SET overall_score = 1 WHERE organization_id = org_e;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[5. P1 modifie %s grille(s) de E] ', n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[5. modification de grille par P1 : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.candidate_evaluations (candidate_id, job_id, organization_id, created_by, overall_score)
    VALUES ('PE-CAND-1', 'project:' || proj_e::text, org_e, u_p1, 5);
    failures := failures || '[5. P1 crée une grille chez E] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[5. création de grille par P1 : %s] ', SQLERRM);
    END IF;
  END;

  -- 6. P1 n'écrit pas de note chez E.
  BEGIN
    INSERT INTO public.candidate_notes (candidate_id, content, organization_id, created_by)
    VALUES ('PE-CAND-1', 'injection', org_e, u_p1);
    failures := failures || '[6. P1 écrit une note chez E] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[6. note par P1 : %s] ', SQLERRM);
    END IF;
  END;

  -- 7. P1 ne lit pas les séquences de E.
  SELECT count(*) INTO n FROM public.outreach_sequences WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[7. P1 lit %s séquence(s) de E] ', n); END IF;

  -- 7 bis. P1 ne rattache pas une séquence de sa propre organisation à la
  --        mission de E ; une séquence hors mission reste permise.
  BEGIN
    INSERT INTO public.outreach_sequences (name, organization_id, project_id, created_by)
    VALUES ('Séquence de P1 sur E', org_p1, proj_e, u_p1);
    failures := failures || '[7 bis. P1 rattache une séquence à la mission de E] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[7 bis. séquence de P1 : %s] ', SQLERRM);
    END IF;
  END;
  BEGIN
    INSERT INTO public.outreach_sequences (name, organization_id, created_by)
    VALUES ('Séquence de P1', org_p1, u_p1);
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[7 bis. séquence hors mission de P1 refusée : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.outreach_sequences SET project_id = proj_e
     WHERE name = 'Séquence de P1' AND organization_id = org_p1;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || '[7 bis. P1 rattache une séquence à la mission de E par modification] '; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%row-level security%' THEN
      failures := failures || format('[7 bis. modification de séquence par P1 : %s] ', SQLERRM);
    END IF;
  END;

  -- 8. P1 ne voit pas P2 : ni sa ligne d'équipe, ni son nom.
  SELECT count(*) INTO n FROM public.mission_team WHERE project_id = proj_e AND user_id <> u_p1;
  IF n <> 0 THEN failures := failures || format('[8. P1 lit %s autre(s) ligne(s) d''équipe] ', n); END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.get_mission_team_profiles(proj_e) AS t
    WHERE (t->>'user_id')::uuid <> u_p1;
    IF n <> 0 THEN failures := failures || format('[8. get_mission_team_profiles rend %s autre(s) membre(s) à P1] ', n); END IF;
    SELECT count(*) INTO n FROM public.get_mission_team_profiles(proj_e) AS t
    WHERE (t->>'user_id')::uuid = u_p1;
    IF n <> 1 THEN failures := failures || format('[8. P1 voit %s fois sa propre ligne] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[8. get_mission_team_profiles par P1 : %s] ', SQLERRM);
  END;

  -- 9. Transition jusqu'au lot P1 : le partenaire accepté lit toujours la
  --    ligne de mission et ses étapes d'entretien.
  SELECT count(*) INTO n FROM public.sourcing_projects WHERE id = proj_e;
  IF n <> 1 THEN failures := failures || format('[9. P1 lit %s ligne(s) de la mission, attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.mission_process_steps WHERE project_id = proj_e;
  IF n <> 1 THEN failures := failures || format('[9. P1 lit %s étape(s), attendu 1] ', n); END IF;

  -- 10. R6 : la liste des missions ouvertes ne porte que les champs de la
  --     carte, des compétences textuelles, et jamais le nom interne.
  BEGIN
    SELECT x INTO v_row FROM public.get_open_hunt_missions() AS x WHERE x->>'id' = proj_e::text;
    IF v_row IS NULL THEN
      failures := failures || '[10. mission publiée absente de la liste de P1] ';
    ELSE
      SELECT array_agg(k) INTO v_extra FROM jsonb_object_keys(v_row) AS k WHERE k <> ALL (card_keys);
      IF v_extra IS NOT NULL THEN
        failures := failures || format('[10. champs hors liste blanche : %s] ', v_extra);
      END IF;
      IF jsonb_typeof(v_row->'job_details') = 'object' THEN
        SELECT array_agg(k) INTO v_extra FROM jsonb_object_keys(v_row->'job_details') AS k WHERE k <> ALL (card_jd_keys);
        IF v_extra IS NOT NULL THEN
          failures := failures || format('[10. champs du poste hors liste blanche : %s] ', v_extra);
        END IF;
      END IF;
      IF v_row::text ILIKE ANY (ARRAY['%Client Confidentiel%', '%claire.martin%', '%Profil Calibrage%',
                                      '%Brief confidentiel%', '%Mission chasse%']) THEN
        failures := failures || '[10. donnée confidentielle dans la carte] ';
      END IF;
      IF v_row->>'name' IS DISTINCT FROM 'Directeur financier'
         OR v_row->'job_details'->>'location' IS DISTINCT FROM 'Lyon'
         OR v_row->>'organization_name' IS DISTINCT FROM 'Partners Entreprise' THEN
        failures := failures || format('[10. carte incomplète : %s] ', v_row);
      END IF;
      IF v_row->'job_details'->'skills_must_have' IS DISTINCT FROM '["IFRS", "Consolidation"]'::jsonb THEN
        failures := failures || format('[10. compétences de la carte : %s] ', v_row->'job_details'->'skills_must_have');
      END IF;
    END IF;

    SELECT x INTO v_row FROM public.get_open_hunt_missions() AS x WHERE x->>'id' = proj_e3::text;
    IF v_row IS NULL THEN
      failures := failures || '[10. mission sans intitulé absente de la liste de P1] ';
    ELSIF v_row->>'name' IS DISTINCT FROM 'Poste sans intitulé'
          OR v_row::text ILIKE '%Client Confidentiel%' THEN
      failures := failures || format('[10. carte sans intitulé : %s] ', v_row);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[10. get_open_hunt_missions par P1 : %s] ', SQLERRM);
  END;

  -- 11. R6 : ses candidatures ne rendent pas le nom du client.
  BEGIN
    SELECT x INTO v_row FROM public.get_my_hunt_applications() AS x WHERE x->>'project_id' = proj_e::text;
    IF v_row IS NULL THEN
      failures := failures || '[11. candidature de P1 absente] ';
    ELSIF v_row ? 'client_name' OR v_row::text ILIKE '%Client Confidentiel%' THEN
      failures := failures || '[11. nom du client dans les candidatures de P1] ';
    ELSIF v_row->>'mission_name' IS DISTINCT FROM 'Directeur financier' THEN
      failures := failures || format('[11. intitulé de la candidature : %s, attendu celui de la carte] ', v_row->>'mission_name');
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[11. get_my_hunt_applications par P1 : %s] ', SQLERRM);
  END;

  -- ===== Contexte : C, organisation tierce, hors cercle et hors équipe =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u_c, 'role', 'authenticated', 'email', 'c@partners.test')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_c::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 12. C ne lit rien de E et ne voit aucune mission ouverte.
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[12. C lit %s ligne(s) de E] ', n); END IF;
  SELECT count(*) INTO n FROM public.mission_team WHERE project_id = proj_e;
  IF n <> 0 THEN failures := failures || format('[12. C lit %s ligne(s) d''équipe de E] ', n); END IF;
  SELECT count(*) INTO n FROM public.sourcing_projects WHERE organization_id = org_e;
  IF n <> 0 THEN failures := failures || format('[12. C lit %s mission(s) de E] ', n); END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.get_open_hunt_missions();
    IF n <> 0 THEN failures := failures || format('[12. C, hors cercle, voit %s mission(s) ouverte(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[12. get_open_hunt_missions par C : %s] ', SQLERRM);
  END;

  -- ===== Contexte : M, membre de E dans l'équipe de la mission =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u_m, 'role', 'authenticated', 'email', 'm@partners.test')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_m::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 13. Le membre interne garde tous ses accès, sur les deux missions de E,
  --     et rattache toujours une ligne à une mission de son organisation.
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE organization_id = org_e;
  IF n <> 3 THEN failures := failures || format('[13. M lit %s ligne(s) de E, attendu 3] ', n); END IF;
  SELECT count(*) INTO n FROM public.candidate_notes WHERE organization_id = org_e;
  IF n <> 1 THEN failures := failures || format('[13. M lit %s note(s), attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.candidate_evaluations WHERE organization_id = org_e;
  IF n <> 1 THEN failures := failures || format('[13. M lit %s grille(s), attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.candidate_profiles WHERE organization_id = org_e;
  IF n <> 1 THEN failures := failures || format('[13. M lit %s profil(s), attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.match_scores WHERE organization_id = org_e;
  IF n <> 1 THEN failures := failures || format('[13. M lit %s note(s) IA, attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.outreach_sequences WHERE organization_id = org_e;
  IF n <> 1 THEN failures := failures || format('[13. M lit %s séquence(s), attendu 1] ', n); END IF;
  SELECT count(*) INTO n FROM public.mission_team WHERE project_id = proj_e;
  IF n <> 3 THEN failures := failures || format('[13. M lit %s ligne(s) d''équipe, attendu 3] ', n); END IF;
  BEGIN
    SELECT count(*) INTO n FROM public.get_mission_team_profiles(proj_e);
    IF n <> 3 THEN failures := failures || format('[13. get_mission_team_profiles rend %s membre(s) à M, attendu 3] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[13. get_mission_team_profiles par M : %s] ', SQLERRM);
  END;
  -- Écriture sans changement d'étape : l'étape ne s'écrit plus en direct (garde du lot 0b).
  BEGIN
    UPDATE public.job_candidate_status SET tags = '{audit}'
    WHERE organization_id = org_e AND project_id = proj_e AND candidate_id = 'PE-CAND-1';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[13. M modifie %s ligne(s), attendu 1] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[13. modification par M : %s] ', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by)
    VALUES ('PE-CAND-4', 'project:' || proj_e::text, org_e, u_m);
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[13. ligne de M sur sa mission refusée : %s] ', SQLERRM);
  END;

  -- ===== Contexte : E, propriétaire de l'entreprise (décision 17) =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u_e, 'role', 'authenticated', 'email', 'e@partners.test')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_e::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 15. Marketplace gelée : la publication est refusée par la fonction de
  --     réglage comme par une écriture directe, un passage en cours aussi ;
  --     l'enregistrement d'un brouillon reste possible.
  BEGIN
    PERFORM public.save_hunt_mission_settings(proj_e2, 20, 3, NULL::timestamptz, true);
    failures := failures || '[15. save_hunt_mission_settings publie] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'MARKETPLACE_FROZEN' THEN
      failures := failures || format('[15. publication par réglage : %s (indice %s)] ', SQLERRM, coalesce(nullif(v_hint, ''), 'aucun'));
    END IF;
  END;
  BEGIN
    UPDATE public.sourcing_projects
       SET hunt_mode = true, hunt_status = 'published', hunt_bounty_percent = 20
     WHERE id = proj_e2;
    failures := failures || '[15. publication par écriture directe acceptée] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'MARKETPLACE_FROZEN' THEN
      failures := failures || format('[15. publication directe : %s (indice %s)] ', SQLERRM, coalesce(nullif(v_hint, ''), 'aucun'));
    END IF;
  END;
  BEGIN
    PERFORM public.save_hunt_mission_settings(proj_e2, 20, 3, NULL::timestamptz, false);
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[15. brouillon refusé : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.sourcing_projects SET hunt_status = 'in_progress' WHERE id = proj_e2;
    failures := failures || '[15. passage en cours accepté] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'MARKETPLACE_FROZEN' THEN
      failures := failures || format('[15. passage en cours : %s (indice %s)] ', SQLERRM, coalesce(nullif(v_hint, ''), 'aucun'));
    END IF;
  END;
  -- Réactiver le mode chasse d'une mission restée « published » la ferait
  -- entrer sur la Marketplace sans toucher à hunt_status.
  BEGIN
    UPDATE public.sourcing_projects SET hunt_mode = true WHERE id = proj_e4;
    failures := failures || '[15. réactivation du mode chasse d''une mission publiée acceptée] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'MARKETPLACE_FROZEN' THEN
      failures := failures || format('[15. réactivation du mode chasse : %s (indice %s)] ', SQLERRM, coalesce(nullif(v_hint, ''), 'aucun'));
    END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  SELECT count(*) INTO n FROM public.sourcing_projects
   WHERE id = proj_e2 AND hunt_mode AND hunt_status = 'draft' AND hunt_bounty_percent = 20;
  IF n <> 1 THEN failures := failures || '[15. brouillon non enregistré] '; END IF;

  -- La validation d'un partenaire est refusée, même sans session.
  INSERT INTO public.feature_activations (organization_id, feature, status, requested_at, requested_by)
  VALUES (org_c, 'marketplace_recruit', 'pending_validation', now(), u_c);
  BEGIN
    PERFORM public.validate_marketplace_partner(org_c);
    failures := failures || '[15. validate_marketplace_partner valide un partenaire] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'MARKETPLACE_FROZEN' THEN
      failures := failures || format('[15. validation : %s (indice %s)] ', SQLERRM, coalesce(nullif(v_hint, ''), 'aucun'));
    END IF;
  END;
  SELECT count(*) INTO n FROM public.feature_activations
   WHERE organization_id = org_c AND feature = 'marketplace_recruit' AND status = 'active';
  IF n <> 0 THEN failures := failures || '[15. C est devenu partenaire] '; END IF;

  -- 3 bis (suite). Les chiffres de la mission de E n'ont compté aucune ligne
  --     de P1 ; la seule ligne ajoutée est celle de M.
  SELECT stats_total_found INTO v_stats_after FROM public.sourcing_projects WHERE id = proj_e;
  IF v_stats_after IS DISTINCT FROM v_stats_before + 1 THEN
    failures := failures || format('[3 bis. stats_total_found de E : %s, attendu %s] ',
                                   v_stats_after, v_stats_before + 1);
  END IF;
  SELECT count(*) INTO n FROM public.job_candidate_status
   WHERE organization_id = org_p1 AND project_id = proj_e;
  IF n <> 0 THEN failures := failures || format('[3 bis. %s ligne(s) de P1 rattachée(s) à E] ', n); END IF;

  -- 3 ter. Une écriture sans RLS (clé de service, comme add-to-shortlist)
  --     d'une ligne de P1 qui porte l'identifiant de la mission de E ne
  --     change pas les chiffres de E : ils ne comptent que les lignes de
  --     son organisation (R7-c).
  INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by, status)
  VALUES ('P1-SVC-1', proj_e::text, org_p1, u_p1, 'shortlisted');
  SELECT stats_total_found INTO v_stats_after FROM public.sourcing_projects WHERE id = proj_e;
  IF v_stats_after IS DISTINCT FROM v_stats_before + 1 THEN
    failures := failures || format('[3 ter. stats_total_found de E après une écriture de service : %s, attendu %s] ',
                                   v_stats_after, v_stats_before + 1);
  END IF;

  -- 17. R11 : une invitation au rôle Collaborateur est refusée, même sans
  --     session (clé de service, outil d'invitation de l'assistant) ; une
  --     invitation sans rôle précisé passe, en membre.
  BEGIN
    INSERT INTO public.organization_invitations (organization_id, email, role, invited_by, token)
    VALUES (org_e, 'collab@partners.test', 'collaborator', u_e, 'c1-audit-collab');
    failures := failures || '[17. invitation au rôle Collaborateur acceptée] ';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'COLLABORATOR_FROZEN' THEN
      failures := failures || format('[17. invitation Collaborateur : %s (indice %s)] ', SQLERRM, coalesce(nullif(v_hint, ''), 'aucun'));
    END IF;
  END;
  BEGIN
    INSERT INTO public.organization_invitations (organization_id, email, invited_by, token)
    VALUES (org_e, 'membre@partners.test', u_e, 'c1-audit-member');
    SELECT count(*) INTO n FROM public.organization_invitations
     WHERE organization_id = org_e AND email = 'membre@partners.test' AND role = 'member';
    IF n <> 1 THEN failures := failures || '[17. invitation sans rôle : rôle différent de member] '; END IF;
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[17. invitation sans rôle refusée : %s] ', SQLERRM);
  END;

  -- 14. Structure : plus aucune policy d'équipe de mission hors de la ligne
  --     de mission, de ses étapes et de l'équipe, dans aucune famille de
  --     noms ; les policies RESTRICTIVE de R7-b sont en place.
  --     À réécrire au lot C2, qui pose un accès limité fondé sur l'équipe.
  SELECT count(*) INTO n FROM pg_policies pol
  WHERE pol.schemaname = 'public'
    AND pol.tablename NOT IN ('sourcing_projects', 'mission_process_steps', 'mission_team')
    AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ILIKE '%mission_team%';
  IF n <> 0 THEN failures := failures || format('[14. %s policy(ies) d''équipe de mission subsistent] ', n); END IF;
  SELECT count(*) INTO n FROM pg_policies pol
  WHERE pol.schemaname = 'public' AND pol.tablename = 'mission_team'
    AND (coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '')) ILIKE '%is_mission_team_member%';
  IF n <> 0 THEN failures := failures || format('[14. %s policy(ies) de mission_team ouvrent l''équipe à ses membres] ', n); END IF;
  IF to_regprocedure('public.is_mission_team_member_for_candidate(uuid, text, uuid)') IS NOT NULL THEN
    failures := failures || '[14. is_mission_team_member_for_candidate existe encore] ';
  END IF;
  SELECT count(*) INTO n FROM pg_policies pol
  WHERE pol.schemaname = 'public'
    AND pol.tablename IN ('job_candidate_status', 'outreach_sequences')
    AND pol.policyname IN ('mission_same_org_insert', 'mission_same_org_update')
    AND pol.permissive = 'RESTRICTIVE';
  IF n <> 4 THEN failures := failures || format('[14. %s policy(ies) RESTRICTIVE mission_same_org, attendu 4] ', n); END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'partner_engagements_audit : %', failures;
  END IF;
  RAISE NOTICE 'partner_engagements_audit : 17 contrôles passés';
END $$;
