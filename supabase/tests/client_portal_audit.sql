-- =====================================================================
-- Portail client (/client/:token) : lot C1, réparation R4.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/client_portal_audit.sql; ROLLBACK;
-- Vérifie les blocs R4-a et R4-b de 20260927233806_c1_reparations_fuites.sql,
-- et le bloc 6 de 20261005155516_scorecard_live_lot1_rattachement.sql :
--  * client_portal_candidates(token) ne renvoie que les candidats retenus
--    ou au-delà des missions du lien, jamais « À trier », seulement
--    contactés ni écartés, et traduit l'étape dans le vocabulaire du
--    portail ;
--  * un lien échu, inconnu, ou pointant une mission d'une autre
--    organisation ne renvoie rien ; une ligne d'une autre organisation
--    rattachée à la mission du lien n'apparaît jamais ;
--  * expires_at est obligatoire, 90 jours par défaut ;
--  * seul service_role exécute la fonction ; anon ne lit ni les liens ni
--    les candidats en direct (le portail passe par l'edge function) ;
--  * client_portal_candidate_profile_id (refonte scorecard, lot 1) rend
--    l'identifiant du profil d'une ligne visible du lien, jamais celui d'une
--    ligne exclue, et rien pour un lien échu, inconnu ou d'une autre mission.
-- Aucun appel sous SET ROLE anon ou authenticated d'une fonction refusée à
-- ce rôle (plantage de l'image locale, voir CLAUDE.md) : les droits sont
-- contrôlés par has_function_privilege, le refus réel par l'API dans
-- .github/workflows/e2e.yml.
-- Organisation O1 (missions P1, P2), organisation O2 (mission P3).
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '84111111-1111-4111-8111-111111111111';
  u_c uuid := '84333333-3333-4333-8333-333333333333';
  o1 uuid := '84aaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  o2 uuid := '84bbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  p1 uuid := '84000000-0000-4000-8000-000000000001';
  p2 uuid := '84000000-0000-4000-8000-000000000002';
  p3 uuid := '84000000-0000-4000-8000-000000000003';
  s1 uuid;
  s2 uuid;
  x_dism uuid;
  r_short uuid;
  got text;
  n integer;
  d timestamptz;
  failures text := '';
BEGIN
  -- ===== Jeu de données (sans jeton) =====
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@portal.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@portal.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Portal Org 1', 'portal-org-1', u_a),
         (o2, 'Portal Org 2', 'portal-org-2', u_c);
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (p1, 'Mission P1', o1, u_a), (p2, 'Mission P2', o1, u_a), (p3, 'Mission P3', o2, u_c);
  INSERT INTO public.mission_process_steps (project_id, organization_id, step_order, name)
  VALUES (p1, o1, 1, 'Entretien RH') RETURNING id INTO s1;
  INSERT INTO public.mission_process_steps (project_id, organization_id, step_order, name)
  VALUES (p2, o1, 1, 'Entretien P2') RETURNING id INTO s2;

  -- Lignes de P1. Préfixe R : retenu ou au-delà (visible). Préfixe X : à
  -- trier, seulement contacté, écarté, signal automatique non fiable, ou
  -- ligne d'une autre organisation (invisible).
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage)
  VALUES
    ('R-short',        p1::text, p1, o1, u_a, 'shortlisted',    NULL),
    ('R-static',       p1::text, p1, o1, u_a, 'shortlisted',    'shortlisted'),
    ('R-pressenti',    p1::text, p1, o1, u_a, 'shortlisted',    'Pressenti'),
    ('R-press-msg',    p1::text, p1, o1, u_a, 'messaged',       'Pressenti'),
    ('R-cv',           p1::text, p1, o1, u_a, 'scored',         'CV envoyé'),
    ('R-step',         p1::text, p1, o1, u_a, 'shortlisted',    s1::text),
    ('R-itw',          p1::text, p1, o1, u_a, 'shortlisted',    'ITW en cours'),
    ('R-offre',        p1::text, p1, o1, u_a, 'shortlisted',    'Offre'),
    ('R-hired',        p1::text, p1, o1, u_a, 'shortlisted',    'hired'),
    ('R-gagne',        p1::text, p1, o1, u_a, 'shortlisted',    'Gagné'),
    ('X-msg',          p1::text, p1, o1, u_a, 'messaged',       NULL),
    ('X-msgstage',     p1::text, p1, o1, u_a, 'messaged',       'messaged'),
    ('X-contacte',     p1::text, p1, o1, u_a, 'scored',         'Contacté'),
    ('X-disc',         p1::text, p1, o1, u_a, 'discovered',     NULL),
    ('X-scored',       p1::text, p1, o1, u_a, 'scored',         NULL),
    ('X-new',          p1::text, p1, o1, u_a, 'new',            NULL),
    ('X-blank',        p1::text, p1, o1, u_a, 'discovered',     '  '),
    ('X-untreated',    p1::text, p1, o1, u_a, 'untreated',      'untreated'),
    ('X-sourced',      p1::text, p1, o1, u_a, 'shortlisted',    'sourced'),
    ('X-nouveau',      p1::text, p1, o1, u_a, 'messaged',       'Nouveau'),
    ('X-dism',         p1::text, p1, o1, u_a, 'dismissed',      NULL),
    ('X-dism-step',    p1::text, p1, o1, u_a, 'dismissed',      s1::text),
    ('X-dism-stage',   p1::text, p1, o1, u_a, 'untreated',      'dismissed'),
    ('X-perdu',        p1::text, p1, o1, u_a, 'shortlisted',    'Perdu'),
    ('X-notint',       p1::text, p1, o1, u_a, 'not_interested', 'Répondu'),
    ('X-replied',      p1::text, p1, o1, u_a, 'replied',        'Répondu'),
    ('X-replied-null', p1::text, p1, o1, u_a, 'replied',        NULL),
    ('X-interested',   p1::text, p1, o1, u_a, 'interested',     'Répondu'),
    ('X-prequalif',    p1::text, p1, o1, u_a, 'qualification',  'Pré-qualif'),
    ('X-foreign-step', p1::text, p1, o1, u_a, 'shortlisted',    s2::text),
    ('X-legacy',       p1::text, p1, o1, u_a, 'shortlisted',    'ITW 1'),
    ('X-foreign-org',  p1::text, p1, o2, u_c, 'shortlisted',    'Offre'),
    ('Y-p2',           p2::text, p2, o1, u_a, 'shortlisted',    NULL),
    ('Z-p3',           p3::text, p3, o2, u_c, 'shortlisted',    NULL);
  SELECT id INTO x_dism FROM public.job_candidate_status WHERE candidate_id = 'X-dism' AND project_id = p1;
  SELECT id INTO r_short FROM public.job_candidate_status WHERE candidate_id = 'R-short' AND project_id = p1;

  -- ARRAY[uuid] s'affecte à la colonne text[] (prod) comme uuid[] (base neuve).
  INSERT INTO public.client_portal_tokens (organization_id, client_name, token, project_ids, expires_at)
  VALUES (o1, 'Lien P1',      'audit-portal-p1',    ARRAY[p1], now() + interval '90 days'),
         (o1, 'Lien échu',    'audit-portal-exp',   ARRAY[p1], now() - interval '1 minute'),
         (o1, 'Lien org',     'audit-portal-all',   NULL,      now() + interval '90 days'),
         (o1, 'Lien croisé',  'audit-portal-cross', ARRAY[p3], now() + interval '90 days');

  -- 1. Lien P1 : exactement les 10 lignes retenues ou au-delà, étape traduite.
  SELECT string_agg(j.candidate_id || '=' || c.pipeline_stage, ',' ORDER BY j.candidate_id) INTO got
    FROM public.client_portal_candidates('audit-portal-p1') c
    JOIN public.job_candidate_status j ON j.id = c.id;
  IF got IS DISTINCT FROM
     'R-cv=to_evaluate,R-gagne=hired,R-hired=hired,R-itw=interview,R-offre=offer,'
     'R-press-msg=sourced,R-pressenti=sourced,R-short=sourced,R-static=sourced,R-step=interview' THEN
    failures := failures || format('[1. lien P1 : %s] ', coalesce(got, 'aucune ligne'));
  END IF;

  -- 2. Aucune ligne à trier, seulement contactée, écartée ou non fiable ne
  --    sort (nomme les fuites).
  SELECT string_agg(j.candidate_id, ',' ORDER BY j.candidate_id) INTO got
    FROM public.client_portal_candidates('audit-portal-p1') c
    JOIN public.job_candidate_status j ON j.id = c.id
   WHERE j.candidate_id LIKE 'X-%';
  IF got IS NOT NULL THEN
    failures := failures || format('[2. lignes exclues visibles : %s] ', got);
  END IF;

  -- 3. Aucun identifiant d'étape interne ni code technique dans l'étape renvoyée.
  SELECT count(*) INTO n FROM public.client_portal_candidates('audit-portal-p1')
   WHERE pipeline_stage NOT IN ('sourced', 'to_evaluate', 'interview', 'offer', 'hired');
  IF n <> 0 THEN
    failures := failures || format('[3. %s étape(s) hors vocabulaire du portail] ', n);
  END IF;

  -- 4. Lien échu : rien.
  SELECT count(*) INTO n FROM public.client_portal_candidates('audit-portal-exp');
  IF n <> 0 THEN
    failures := failures || format('[4. lien échu : %s ligne(s)] ', n);
  END IF;

  -- 5. Lien sans mission précisée : toutes les missions de O1 (Y-p2), jamais O2 (Z-p3).
  SELECT string_agg(j.candidate_id, ',' ORDER BY j.candidate_id) INTO got
    FROM public.client_portal_candidates('audit-portal-all') c
    JOIN public.job_candidate_status j ON j.id = c.id
   WHERE j.candidate_id IN ('Y-p2', 'Z-p3');
  IF got IS DISTINCT FROM 'Y-p2' THEN
    failures := failures || format('[5. lien org : %s, attendu Y-p2] ', coalesce(got, 'aucune ligne'));
  END IF;

  -- 6. Lien de O1 qui cite une mission de O2 : rien.
  SELECT count(*) INTO n FROM public.client_portal_candidates('audit-portal-cross');
  IF n <> 0 THEN
    failures := failures || format('[6. mission d''une autre organisation : %s ligne(s)] ', n);
  END IF;

  -- 7. Jeton inconnu ou NULL : rien.
  SELECT count(*) INTO n FROM public.client_portal_candidates('audit-portal-inconnu');
  IF n <> 0 THEN failures := failures || format('[7. jeton inconnu : %s ligne(s)] ', n); END IF;
  SELECT count(*) INTO n FROM public.client_portal_candidates(NULL);
  IF n <> 0 THEN failures := failures || format('[7. jeton NULL : %s ligne(s)] ', n); END IF;

  -- 8. Avis du client : la recherche par id de l'edge function trouve un
  --    candidat visible (avec sa mission) et refuse un écarté.
  SELECT count(*) INTO n FROM public.client_portal_candidates('audit-portal-p1')
   WHERE id = r_short AND project_id = p1;
  IF n <> 1 THEN failures := failures || '[8. candidat retenu non évaluable] '; END IF;
  SELECT count(*) INTO n FROM public.client_portal_candidates('audit-portal-p1') WHERE id = x_dism;
  IF n <> 0 THEN failures := failures || '[8. candidat écarté évaluable] '; END IF;

  -- 9. expires_at obligatoire, 90 jours par défaut.
  INSERT INTO public.client_portal_tokens (organization_id, client_name, token, project_ids)
  VALUES (o1, 'Lien sans date', 'audit-portal-default', ARRAY[p1])
  RETURNING expires_at INTO d;
  IF d IS NULL OR d < now() + interval '89 days' OR d > now() + interval '91 days' THEN
    failures := failures || format('[9. défaut expires_at : %s] ', coalesce(d::text, 'NULL'));
  END IF;
  BEGIN
    INSERT INTO public.client_portal_tokens (organization_id, client_name, token, project_ids, expires_at)
    VALUES (o1, 'Lien NULL', 'audit-portal-null', ARRAY[p1], NULL);
    failures := failures || '[9. lien sans expiration accepté] ';
  EXCEPTION WHEN not_null_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[9. insertion NULL : %s] ', SQLERRM);
  END;

  -- 10. Droits : seul service_role exécute la fonction.
  IF has_function_privilege('anon', 'public.client_portal_candidates(text)', 'EXECUTE') THEN
    failures := failures || '[10. anon exécute client_portal_candidates] ';
  END IF;
  IF has_function_privilege('authenticated', 'public.client_portal_candidates(text)', 'EXECUTE') THEN
    failures := failures || '[10. authenticated exécute client_portal_candidates] ';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.client_portal_candidates(text)', 'EXECUTE') THEN
    failures := failures || '[10. service_role n''exécute pas client_portal_candidates] ';
  END IF;

  -- 11. Lecture anonyme : ni les liens ni les candidats en direct, et aucune
  --     policy de lecture ouverte (USING true) sur les liens, dans les deux
  --     familles de noms.
  IF has_table_privilege('anon', 'public.client_portal_tokens', 'SELECT') THEN
    failures := failures || '[11. anon a SELECT sur client_portal_tokens] ';
  END IF;
  IF has_table_privilege('anon', 'public.job_candidate_status', 'SELECT') THEN
    failures := failures || '[11. anon a SELECT sur job_candidate_status] ';
  END IF;
  SELECT string_agg(policyname, ', ') INTO got FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'client_portal_tokens'
     AND cmd IN ('SELECT', 'ALL')
     AND regexp_replace(coalesce(qual, ''), '[\s()]', '', 'g') = 'true';
  IF got IS NOT NULL THEN
    failures := failures || format('[11. policy de lecture ouverte : %s] ', got);
  END IF;

  -- 12. Une ligne d'une autre organisation rattachée à la mission du lien
  --     (injection d'un partenaire avant C1, ou écriture serveur) n'apparaît
  --     ni sur le lien de la mission, ni sur le lien de toute l'organisation.
  SELECT count(*) INTO n
    FROM (SELECT id FROM public.client_portal_candidates('audit-portal-p1')
          UNION ALL
          SELECT id FROM public.client_portal_candidates('audit-portal-all')) c
    JOIN public.job_candidate_status j ON j.id = c.id
   WHERE j.organization_id IS DISTINCT FROM o1;
  IF n <> 0 THEN
    failures := failures || format('[12. %s ligne(s) d''une autre organisation au portail de O1] ', n);
  END IF;

  -- 13. Identifiant du profil d'une ligne visible (avis du client, lot 1 de la
  --     refonte scorecard) : celui de la ligne visible du lien, rien pour une
  --     ligne écartée, un lien échu, inconnu, d'une autre mission, ou sans ligne.
  SELECT public.client_portal_candidate_profile_id('audit-portal-p1', r_short) INTO got;
  IF got IS DISTINCT FROM 'R-short' THEN
    failures := failures || format('[13. profil de la ligne visible : %s, attendu R-short] ', coalesce(got, 'NULL'));
  END IF;
  SELECT public.client_portal_candidate_profile_id('audit-portal-p1', x_dism) INTO got;
  IF got IS NOT NULL THEN failures := failures || format('[13. profil d''une ligne écartée rendu : %s] ', got); END IF;
  SELECT public.client_portal_candidate_profile_id('audit-portal-exp', r_short) INTO got;
  IF got IS NOT NULL THEN failures := failures || format('[13. profil rendu sur un lien échu : %s] ', got); END IF;
  SELECT public.client_portal_candidate_profile_id('audit-portal-inconnu', r_short) INTO got;
  IF got IS NOT NULL THEN failures := failures || format('[13. profil rendu sur un lien inconnu : %s] ', got); END IF;
  SELECT public.client_portal_candidate_profile_id('audit-portal-cross', r_short) INTO got;
  IF got IS NOT NULL THEN failures := failures || format('[13. profil rendu sur le lien d''une autre mission : %s] ', got); END IF;
  SELECT public.client_portal_candidate_profile_id('audit-portal-p1', NULL) INTO got;
  IF got IS NOT NULL THEN failures := failures || format('[13. profil rendu sans ligne : %s] ', got); END IF;
  SELECT public.client_portal_candidate_profile_id(NULL, r_short) INTO got;
  IF got IS NOT NULL THEN failures := failures || format('[13. profil rendu sans jeton : %s] ', got); END IF;
  IF has_function_privilege('anon', 'public.client_portal_candidate_profile_id(text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.client_portal_candidate_profile_id(text, uuid)', 'EXECUTE') THEN
    failures := failures || '[13. anon ou authenticated exécute client_portal_candidate_profile_id] ';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.client_portal_candidate_profile_id(text, uuid)', 'EXECUTE') THEN
    failures := failures || '[13. service_role n''exécute pas client_portal_candidate_profile_id] ';
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'client_portal_audit : %', failures;
  END IF;
  RAISE NOTICE 'client_portal_audit : 13 contrôles passés';
END $$;
