-- =====================================================================
-- Refonte mission, lot 0a : modèle des étapes candidat.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/candidate_stage_model_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/candidate_stage_model_audit.sql -c 'ROLLBACK;')
-- Vérifie la migration 20260928201409_refonte_mission_lot0a_modele_etapes.sql :
--  * S : colonnes, contraintes, clé étrangère, déclencheurs, défaut de status ;
--  * D : droits des fonctions (has_function_privilege, jamais d'appel refusé) ;
--  * M : correspondance pure candidate_stage_from_legacy, aller-retour ;
--  * T : déclencheur de transition sur des écritures directes réalistes ;
--  * F : set_candidate_stage (paramètres, événements, IA, couple hérité) ;
--  * St : compteurs de mission (clé project_id + organisation ; depuis le
--    lot 0c, définitions de get_mission_stage_counts sur l'étape générale,
--    cumuls « au total ») ;
--  * B : reprise jcs_stage_backfill (jalons exacts ou NULL, updated_at intact,
--    aucun appel HTTP d'indexation), puis seconde application de la
--    migration sur ces données, en chaîne avec celle du lot 0c
--    (20260929112827 : aucune ligne candidat réécrite, aucun appel HTTP
--    d'indexation des lignes candidat) ;
--  * R : replace_process_steps (l'étape suit, la date reste).
-- Aucune fonction n'est appelée sous SET ROLE authenticated sans que son
-- droit ait été vérifié par has_function_privilege (plantage de l'image
-- locale sur un refus, voir CLAUDE.md) ; anon n'appelle rien : son refus
-- réel est contrôlé par l'API dans .github/workflows/e2e.yml.
-- Procédés : dates d'entrée remises dans le passé sous le drapeau
-- konekt.stage_write = '*' (toute la transaction partage le même now()) ;
-- absence d'écriture prouvée par ctid ; serveur simulé par
-- request.jwt.claim.role vide ou 'service_role'.
-- Non testable ici : les verrous (SKIP LOCKED), laissés à la recette du lot 0b.
-- O1 (A propriétaire) : P1 (étapes « Entretien RH », « Entretien client »),
-- P2 (une étape), P4 (compteurs), P5 (sans étape), P6 (reprise).
-- O2 (C propriétaire) : P3.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Lot 0b : la garde des écritures directes (stage_write_guard) est coupée dans
-- la transaction (mode off) : les écritures directes de cet audit portent sur
-- le déclencheur de transition du lot 0a, que le mode refus masquerait.
-- =====================================================================
SET LOCAL lock_timeout = '30s';

DO $csm_mode$
BEGIN
  IF to_regprocedure('public.jcs_stage_write_mode()') IS NOT NULL THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION public.jcs_stage_write_mode()
      RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $m$ SELECT 'off'::text $m$ $f$;
  END IF;
END
$csm_mode$;

-- Contexte d'appel : utilisateur connecté (p_uid, rôle du jeton authenticated),
-- serveur sans jeton (NULL, p_role NULL) ou clé de service (NULL, 'service_role').
CREATE FUNCTION pg_temp.csm_as(p_uid uuid, p_role text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NOT NULL THEN json_build_object('sub', p_uid, 'role', 'authenticated')::text
         WHEN p_role IS NOT NULL THEN json_build_object('role', p_role)::text
         ELSE '' END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role',
    CASE WHEN p_uid IS NOT NULL THEN 'authenticated' ELSE coalesce(p_role, '') END, true);
END $$;

-- Ligne candidat écrite par le serveur (chemin des écrivains actuels).
CREATE FUNCTION pg_temp.csm_row(p_proj uuid, p_cand text, p_status text, p_ps text DEFAULT NULL,
                                p_score numeric DEFAULT NULL, p_reco text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v uuid;
BEGIN
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage, score, recommendation)
  SELECT p_cand, 'project:' || p.id, p.id, p.organization_id, p.created_by, p_status, p_ps, p_score, p_reco
    FROM public.sourcing_projects p WHERE p.id = p_proj
  RETURNING id INTO v;
  RETURN v;
END $$;

-- Écrit une colonne du modèle en passant le déclencheur (dater dans le passé).
CREATE FUNCTION pg_temp.csm_force(p_id uuid, p_col text, p_val timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('konekt.stage_write', '*', true);
  EXECUTE format('UPDATE public.job_candidate_status SET %I = $1 WHERE id = $2', p_col) USING p_val, p_id;
  PERFORM set_config('konekt.stage_write', '', true);
END $$;

-- set_candidate_stage appelée en postgres : rend la réponse, ou l'erreur (état, indice).
CREATE FUNCTION pg_temp.csm_set(p_id uuid, p_stage text, p_source text, p_org uuid,
                                p_step uuid DEFAULT NULL, p_legacy text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_hint text;
  v_msg text;
BEGIN
  RETURN public.set_candidate_stage(p_id, p_stage, p_source, p_org, p_step, p_legacy);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT, v_msg = MESSAGE_TEXT;
  RETURN jsonb_build_object('error', v_state, 'hint', v_hint, 'message', v_msg);
END $$;

CREATE FUNCTION pg_temp.csm_eq(p_label text, p_got anyelement, p_want anyelement) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_got IS NOT DISTINCT FROM p_want THEN ''
              ELSE format('[%s : %s, attendu %s] ', p_label, coalesce(p_got::text, 'NULL'), coalesce(p_want::text, 'NULL')) END
$$;

-- Appels HTTP d'indexation des lignes candidat en file d'attente de pg_net
-- (NULL si pg_net manque). Les clés d'appel posées au bloc B visent cette
-- adresse, jamais servie ; seules ces lignes, non validées, sont comptées (le
-- démon ne vide que les validées). Lot 0c : seuls les appels de la table
-- p_table sont comptés (champ « table » du corps) ; depuis le lot 0c, les
-- compteurs de mission suivent aussi l'étape, et leur mise à jour indexe la
-- mission (sourcing_projects), hors du sujet des contrôles B8 et B12.
CREATE FUNCTION pg_temp.csm_http(p_table text DEFAULT 'job_candidate_status') RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
  v_body text;
BEGIN
  IF to_regclass('net.http_request_queue') IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT CASE format_type(a.atttypid, NULL) WHEN 'bytea' THEN 'convert_from(body, ''UTF8'')' ELSE 'body::text' END
    INTO v_body
    FROM pg_attribute a
   WHERE a.attrelid = 'net.http_request_queue'::regclass AND a.attname = 'body' AND NOT a.attisdropped;
  EXECUTE format('SELECT count(*) FROM net.http_request_queue WHERE url LIKE %L AND (%s)::jsonb ->> ''table'' = %L',
                 'http://127.0.0.1:9/csm-audit/%', coalesce(v_body, 'NULL::text'), p_table) INTO n;
  RETURN n;
END $$;

DO $$
DECLARE
  u_a uuid := 'e0a00000-0000-4000-8000-0000000000a1';
  u_c uuid := 'e0a00000-0000-4000-8000-0000000000a3';
  o1 uuid := 'e0a00000-0000-4000-8000-0000000000f1';
  o2 uuid := 'e0a00000-0000-4000-8000-0000000000f2';
  p1 uuid := 'e0a00000-0000-4000-8000-0000000000b1';
  p2 uuid := 'e0a00000-0000-4000-8000-0000000000b2';
  p3 uuid := 'e0a00000-0000-4000-8000-0000000000b3';
  p4 uuid := 'e0a00000-0000-4000-8000-0000000000b4';
  p5 uuid := 'e0a00000-0000-4000-8000-0000000000b5';
  p6 uuid := 'e0a00000-0000-4000-8000-0000000000b6';
  s_rh uuid := 'e0a00000-0000-4000-8000-0000000000c1';
  s_cl uuid := 'e0a00000-0000-4000-8000-0000000000c2';
  s_p2 uuid := 'e0a00000-0000-4000-8000-0000000000c3';
  s_tmp uuid := 'e0a00000-0000-4000-8000-0000000000c4';
  sig_set text := 'public.set_candidate_stage(uuid, text, text, uuid, uuid, text)';
  sig_map text := 'public.candidate_stage_from_legacy(text, text, uuid)';
  sig_bf text := 'public.jcs_stage_backfill(uuid[])';
  sig_rps text := 'public.replace_process_steps(uuid, jsonb)';
  sig_rms text := 'public.recompute_mission_stats(uuid[])';
  sig_trg text := 'public.jcs_stage_sync_from_legacy()';
  past timestamptz := now() - interval '5 days';
  t0 timestamptz := now() - interval '40 days';
  v_auth_ok boolean;
  m2 record;
  rw public.job_candidate_status%ROWTYPE;
  v jsonb;
  x uuid; y uuid; z uuid;
  id_a uuid; id_b uuid; id_c uuid; id_d uuid; id_e uuid; id_f uuid; id_g uuid; id_h uuid;
  b uuid[];
  new_rh uuid; new_rh2 uuid;
  ct text;
  got text;
  n integer;
  st_before int[];
  st_after int[];
  snap jsonb;
  q0 integer;
  failures text := '';
BEGIN
  -- ===== Jeu de données (serveur, sans jeton) =====
  PERFORM pg_temp.csm_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@stage.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@stage.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Stage Org 1', 'stage-org-1', u_a), (o2, 'Stage Org 2', 'stage-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur de création.
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner' OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (u_a, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (p1, 'Mission P1', o1, u_a), (p2, 'Mission P2', o1, u_a), (p3, 'Mission P3', o2, u_c),
         (p4, 'Mission P4', o1, u_a), (p5, 'Mission P5', o1, u_a), (p6, 'Mission P6', o1, u_a);
  INSERT INTO public.mission_process_steps (id, project_id, organization_id, step_order, name)
  VALUES (s_rh, p1, o1, 1, 'Entretien RH'), (s_cl, p1, o1, 2, 'Entretien client'),
         (s_p2, p2, o1, 1, 'Entretien P2'), (s_tmp, p1, o1, 3, 'Entretien final');

  -- ===== S. Structure =====
  -- S1. Colonnes et types ; general_stage et stage_entered_at obligatoires, avec défaut.
  SELECT string_agg(e.col || ':' || coalesce(c.udt_name, 'absente'), ', ' ORDER BY e.col) INTO got
    FROM (VALUES ('general_stage','text'), ('process_step_id','uuid'), ('stage_entered_at','timestamptz'),
                 ('decision_source','text'), ('contacted_at','timestamptz'), ('replied_at','timestamptz'),
                 ('first_interview_at','timestamptz'), ('presented_at','timestamptz'), ('hired_at','timestamptz'),
                 ('rejected_at','timestamptz'), ('rejected_from_stage','text'), ('reply_summary','text')) AS e(col, typ)
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = 'job_candidate_status' AND c.column_name = e.col
   WHERE c.udt_name IS DISTINCT FROM e.typ;
  failures := failures || pg_temp.csm_eq('S1 colonnes', got, NULL::text);
  SELECT string_agg(column_name || '=' || is_nullable || '/' || coalesce(column_default, 'sans défaut'), ', ') INTO got
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'job_candidate_status'
     AND ((column_name = 'general_stage' AND (is_nullable <> 'NO' OR column_default IS DISTINCT FROM '''to_sort''::text'))
       OR (column_name = 'stage_entered_at' AND (is_nullable <> 'NO' OR column_default IS DISTINCT FROM 'now()')));
  failures := failures || pg_temp.csm_eq('S1 obligatoires', got, NULL::text);

  -- S2. Les quatre CHECK, par leur nom.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.job_candidate_status'::regclass AND contype = 'c'
     AND conname IN ('jcs_general_stage_check', 'jcs_decision_source_check',
                     'jcs_rejected_from_stage_check', 'jcs_process_step_stage_check');
  failures := failures || pg_temp.csm_eq('S2 CHECK', n, 4);

  -- S3. Clé étrangère ON DELETE SET NULL vers les étapes, index partiel.
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.job_candidate_status'::regclass AND conname = 'job_candidate_status_process_step_id_fkey'
     AND contype = 'f' AND confrelid = 'public.mission_process_steps'::regclass AND confdeltype = 'n';
  failures := failures || pg_temp.csm_eq('S3 clé étrangère', n, 1);
  SELECT count(*) INTO n FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.idx_jcs_process_step_id') AND i.indpred IS NOT NULL;
  failures := failures || pg_temp.csm_eq('S3 index partiel', n, 1);

  -- S4. stage_sync_from_legacy : BEFORE, ROW, INSERT et UPDATE, sans liste de
  --     colonnes, trié après resolve_project_id_ins (ordre des noms, en C).
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE t.tgrelid = 'public.job_candidate_status'::regclass AND t.tgname = 'stage_sync_from_legacy'
     AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 16 = 16 AND t.tgtype & 8 = 0
     AND t.tgattr::text = '' AND t.tgenabled = 'O'
     AND t.tgname COLLATE "C" > 'resolve_project_id_ins' COLLATE "C"
     AND t.tgname COLLATE "C" < 'update_job_candidate_status_updated_at' COLLATE "C";
  failures := failures || pg_temp.csm_eq('S4 déclencheur de transition', n, 1);

  -- S5. Les 11 déclencheurs attendus : garde du lot 0b, nettoyage des
  -- actions après suppression et purge des copies de score dépendant d'une
  -- référence effacée, sans retour de l'ancien déclencheur par ligne.
  SELECT string_agg(tgname, ',' ORDER BY tgname) INTO got FROM pg_trigger
   WHERE tgrelid = 'public.job_candidate_status'::regclass AND NOT tgisinternal;
  failures := failures || pg_temp.csm_eq('S5 déclencheurs', got,
    'candidate_actions_remove_mission_candidate,resolve_project_id_ins,resolve_project_id_upd,sourcing_agent_score_privacy_guard,stage_sync_from_legacy,stage_write_guard,sync_mission_stats_del,'
    'sync_mission_stats_ins,sync_mission_stats_upd,trg_auto_ingest_job_candidate_status,'
    'update_job_candidate_status_updated_at');
  IF to_regprocedure('public.refresh_project_shortlist_stats()') IS NOT NULL THEN
    failures := failures || '[S5 refresh_project_shortlist_stats encore présente] ';
  END IF;
  -- This exact cleanup is AFTER DELETE ROW only. It cannot intercept an
  -- insertion or stage transition, and remains enabled with no condition.
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE t.tgrelid = 'public.job_candidate_status'::regclass
     AND t.tgname = 'candidate_actions_remove_mission_candidate' AND NOT t.tgisinternal
     AND t.tgtype = 9 AND t.tgenabled = 'O' AND t.tgattr::text = '' AND t.tgqual IS NULL
     AND t.tgfoid = to_regprocedure('private.candidate_actions_remove_mission_candidate()');
  failures := failures || pg_temp.csm_eq('S5 nettoyage actions après suppression', n, 1);
  -- Inspect every write target, not merely the trigger's name. The cleanup may
  -- delete its ledger and generated content; it may never write candidature
  -- rows, steps, stages or missions, or execute dynamic SQL that hides a write.
  SELECT string_agg(w.parts[1] || ' ' || w.parts[2], ',') INTO got
    FROM pg_proc p
    CROSS JOIN LATERAL regexp_matches(p.prosrc,
      '\m(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE|ALTER)\s+([a-zA-Z0-9_."]+)', 'gi') w(parts)
   WHERE p.oid = to_regprocedure('private.candidate_actions_remove_mission_candidate()')
     AND (upper(regexp_replace(w.parts[1], '\s+', ' ', 'g')) <> 'DELETE FROM'
       OR lower(w.parts[2]) NOT IN ('public.candidate_action_messages', 'public.candidate_action_plans',
          'public.candidate_notes', 'public.candidate_comments', 'public.notifications', 'public.knowledge_chunks'));
  failures := failures || pg_temp.csm_eq('S5 destinations écrites par le nettoyage', got, NULL::text);
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.oid = to_regprocedure('private.candidate_actions_remove_mission_candidate()')
     AND p.prorettype = 'trigger'::regtype AND p.prosrc !~* '\mEXECUTE\M'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  failures := failures || pg_temp.csm_eq('S5 nettoyage statique non appelable par le navigateur', n, 1);

  -- S6. Défaut de status aligné sur la production.
  SELECT column_default INTO got FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'job_candidate_status' AND column_name = 'status';
  failures := failures || pg_temp.csm_eq('S6 défaut de status', got, '''new''::text');

  -- ===== D. Droits (catalogues seulement) =====
  -- D1, D2. set_candidate_stage et candidate_stage_from_legacy : ni PUBLIC ni anon ;
  --         authenticated et service_role. SECURITY INVOKER.
  SELECT string_agg(f.sig || ' ' || f.why, '; ') INTO got FROM (
    SELECT s.sig, 'exécutable par anon' AS why FROM unnest(ARRAY[sig_set, sig_map]) s(sig)
     WHERE has_function_privilege('anon', s.sig, 'EXECUTE')
    UNION ALL
    SELECT s.sig, 'refusée à ' || r.rol FROM unnest(ARRAY[sig_set, sig_map]) s(sig)
     CROSS JOIN unnest(ARRAY['authenticated', 'service_role']) r(rol)
     WHERE NOT has_function_privilege(r.rol, s.sig, 'EXECUTE')
    UNION ALL
    SELECT p.oid::regprocedure::text, 'exécutable par PUBLIC' FROM pg_proc p
     WHERE p.oid IN (to_regprocedure(sig_set), to_regprocedure(sig_map))
       AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    UNION ALL
    SELECT p.oid::regprocedure::text, 'SECURITY DEFINER' FROM pg_proc p
     WHERE p.oid IN (to_regprocedure(sig_set), to_regprocedure(sig_map), to_regprocedure(sig_bf)) AND p.prosecdef
  ) f;
  failures := failures || pg_temp.csm_eq('D1 D2', got, NULL::text);
  -- D3. Reprise : refusée à anon, authenticated et service_role.
  SELECT string_agg(r.rol, ',') INTO got FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol)
   WHERE has_function_privilege(r.rol, sig_bf, 'EXECUTE');
  failures := failures || pg_temp.csm_eq('D3 jcs_stage_backfill exécutable par', got, NULL::text);
  -- D4. recompute_mission_stats : refusée à anon et authenticated.
  SELECT string_agg(r.rol, ',') INTO got FROM unnest(ARRAY['anon', 'authenticated']) r(rol)
   WHERE has_function_privilege(r.rol, sig_rms, 'EXECUTE');
  failures := failures || pg_temp.csm_eq('D4 recompute_mission_stats exécutable par', got, NULL::text);
  -- D5. replace_process_steps : refusée à anon, accordée à authenticated ; la
  --     fonction du déclencheur n'est ni à PUBLIC ni à anon.
  IF has_function_privilege('anon', sig_rps, 'EXECUTE') THEN failures := failures || '[D5 anon exécute replace_process_steps] '; END IF;
  IF NOT has_function_privilege('authenticated', sig_rps, 'EXECUTE') THEN failures := failures || '[D5 authenticated n''exécute pas replace_process_steps] '; END IF;
  IF has_function_privilege('anon', sig_trg, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(sig_trg)
                 AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))) THEN
    failures := failures || '[D5 fonction du déclencheur ouverte à PUBLIC ou anon] ';
  END IF;

  -- Droits exigés par le bloc navigateur (FOR KEY SHARE exige UPDATE sur les étapes).
  v_auth_ok := has_function_privilege('authenticated', sig_set, 'EXECUTE')
           AND has_function_privilege('authenticated', sig_map, 'EXECUTE')
           AND has_function_privilege('authenticated', sig_rps, 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.get_project_stats(uuid)', 'EXECUTE')
           AND has_function_privilege('authenticated', 'public.get_mission_stage_counts(uuid[])', 'EXECUTE')
           AND has_table_privilege('authenticated', 'public.mission_process_steps', 'UPDATE')
           AND has_table_privilege('authenticated', 'public.job_candidate_status', 'SELECT')
           AND has_table_privilege('authenticated', 'public.job_candidate_status', 'UPDATE');
  IF NOT v_auth_ok THEN
    failures := failures || '[droits de authenticated incomplets : blocs navigateur (T6, St4, F12, R) non joués] ';
  END IF;

  -- ===== M. Correspondance pure =====
  -- M1. Couples de client_portal_audit.sql, valeurs bizarres, étape d'entretien.
  SELECT string_agg(format('(%s, %s, %s) donne (%s, %s, %s, %s)', coalesce(c.st, 'NULL'), coalesce(c.ps, 'NULL'),
                           coalesce(c.step::text, 'NULL'), f.general_stage, coalesce(f.process_step_id::text, 'NULL'),
                           coalesce(f.rejected_from_stage, 'NULL'), f.presented), '; ') INTO got
    FROM (VALUES
      ('shortlisted'::text, NULL::text, NULL::uuid, 'retained'::text, NULL::uuid, NULL::text, false),
      ('shortlisted', 'shortlisted', NULL, 'retained', NULL, NULL, false),
      ('shortlisted', 'Pressenti', NULL, 'retained', NULL, NULL, false),
      ('messaged', 'Pressenti', NULL, 'contacted', NULL, NULL, false),
      ('scored', 'CV envoyé', NULL, 'interviewing', NULL, NULL, true),
      ('shortlisted', s_rh::text, s_rh, 'interviewing', s_rh, NULL, false),
      ('shortlisted', 'ITW en cours', NULL, 'interviewing', NULL, NULL, false),
      ('shortlisted', 'Offre', NULL, 'interviewing', NULL, NULL, false),
      ('shortlisted', 'hired', NULL, 'hired', NULL, NULL, false),
      ('shortlisted', 'Gagné', NULL, 'hired', NULL, NULL, false),
      ('messaged', NULL, NULL, 'contacted', NULL, NULL, false),
      ('messaged', 'messaged', NULL, 'contacted', NULL, NULL, false),
      ('scored', 'Contacté', NULL, 'contacted', NULL, NULL, false),
      ('discovered', NULL, NULL, 'to_sort', NULL, NULL, false),
      ('scored', NULL, NULL, 'to_sort', NULL, NULL, false),
      ('new', NULL, NULL, 'to_sort', NULL, NULL, false),
      ('discovered', '  ', NULL, 'to_sort', NULL, NULL, false),
      ('untreated', 'untreated', NULL, 'to_sort', NULL, NULL, false),
      ('shortlisted', 'sourced', NULL, 'retained', NULL, NULL, false),
      ('messaged', 'Nouveau', NULL, 'contacted', NULL, NULL, false),
      ('dismissed', NULL, NULL, 'rejected', NULL, 'to_sort', false),
      ('dismissed', s_rh::text, s_rh, 'rejected', NULL, 'interviewing', false),
      ('untreated', 'dismissed', NULL, 'rejected', NULL, 'to_sort', false),
      ('shortlisted', 'Perdu', NULL, 'rejected', NULL, 'retained', false),
      ('not_interested', 'Répondu', NULL, 'replied', NULL, NULL, false),
      ('replied', 'Répondu', NULL, 'replied', NULL, NULL, false),
      ('replied', NULL, NULL, 'replied', NULL, NULL, false),
      ('interested', 'Répondu', NULL, 'replied', NULL, NULL, false),
      ('qualification', 'Pré-qualif', NULL, 'interviewing', NULL, NULL, false),
      ('qualification', NULL, NULL, 'interviewing', NULL, NULL, false),
      ('shortlisted', s_p2::text, NULL, 'interviewing', NULL, NULL, false),
      ('shortlisted', 'ITW 1', NULL, 'retained', NULL, NULL, false),
      (NULL, NULL, NULL, 'to_sort', NULL, NULL, false),
      ('discovered', '', NULL, 'to_sort', NULL, NULL, false),
      ('discovered', 'NOUVEAU', NULL, 'to_sort', NULL, NULL, false),
      ('shortlisted', 'rejected', NULL, 'retained', NULL, NULL, false),
      ('shortlisted', 'Entretien RH', s_rh, 'retained', NULL, NULL, false),
      ('statut inconnu', NULL, NULL, 'to_sort', NULL, NULL, false),
      (' Shortlisted ', NULL, NULL, 'retained', NULL, NULL, false),
      ('shortlisted', 'Offre', s_rh, 'interviewing', NULL, NULL, false),
      ('shortlisted', s_p2::text, s_rh, 'interviewing', NULL, NULL, false),
      ('shortlisted', upper(s_rh::text), s_rh, 'interviewing', s_rh, NULL, false),
      ('dismissed', 'Gagné', NULL, 'rejected', NULL, 'hired', false)
    ) AS c(st, ps, step, g, gs, fr, pr)
    CROSS JOIN LATERAL public.candidate_stage_from_legacy(c.st, c.ps, c.step) f
   WHERE (f.general_stage, f.process_step_id, f.rejected_from_stage, f.presented) IS DISTINCT FROM (c.g, c.gs, c.fr, c.pr);
  failures := failures || pg_temp.csm_eq('M1 correspondance', got, NULL::text);

  -- M2. Aller-retour par set_candidate_stage sur une mission sans étape : chaque
  --     couple écrit redonne l'étape visée (tableau de la section 2.2).
  --     Un appel par instruction : une requête ne voit pas ses propres écritures.
  x := pg_temp.csm_row(p5, 'M2', 'scored', NULL, 70);
  got := '';
  FOR m2 IN SELECT * FROM (VALUES
      (1, 'to_sort', 'scored', NULL), (2, 'retained', 'shortlisted', NULL), (3, 'contacted', 'messaged', NULL),
      (4, 'replied', 'replied', 'Répondu'), (5, 'interviewing', 'shortlisted', 'ITW en cours'),
      (6, 'hired', 'shortlisted', 'hired'), (7, 'rejected', 'dismissed', NULL), (8, 'to_sort', 'scored', NULL))
      AS t(ord, stage, want_status, want_ps) ORDER BY ord
  LOOP
    v := pg_temp.csm_set(x, m2.stage, 'user', o1);
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
    IF v ? 'error'
       OR rw.general_stage IS DISTINCT FROM m2.stage OR rw.status IS DISTINCT FROM m2.want_status
       OR rw.pipeline_stage IS DISTINCT FROM m2.want_ps
       OR (SELECT f.general_stage FROM public.candidate_stage_from_legacy(rw.status, rw.pipeline_stage, NULL) f)
          IS DISTINCT FROM m2.stage THEN
      got := got || format('%s donne %s%s / %s / %s; ', m2.stage, coalesce(v->>'hint', ''), rw.general_stage, rw.status,
                           coalesce(rw.pipeline_stage, 'NULL'));
    END IF;
  END LOOP;
  failures := failures || pg_temp.csm_eq('M2 aller-retour', got, '');
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('M2 étape quittée', rw.rejected_from_stage, 'hired')
                       || pg_temp.csm_eq('M2 embauche datée', rw.hired_at IS NOT NULL, true);

  -- ===== T. Déclencheur de transition (écritures directes, serveur sauf mention) =====
  -- T1. Couples bizarres insérés : aucune erreur, étape attendue, couple intact ;
  --     colonnes du modèle fournies à l'insertion ignorées.
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage)
    VALUES ('T1-a', 'project:' || p1, p1, o1, u_a, 'statut inconnu', 'ITW 1'),
           ('T1-b', 'project:' || p1, p1, o1, u_a, 'shortlisted', '   '),
           ('T1-c', 'project:' || p1, p1, o1, u_a, 'dismissed', 'Gagné'),
           ('T1-d', 'project:' || p1, p1, o1, u_a, 'shortlisted', upper(s_rh::text)),
           ('T1-e', 'project:' || p1, p1, o1, u_a, 'shortlisted', s_p2::text),
           ('T1-f', 'project:' || p1, p1, o1, u_a, 'shortlisted', '00000000-0000-4000-8000-00000000dead'),
           ('T1-g', 'project:' || p1, p1, o1, u_a, 'qualification', NULL),
           ('T1-h', 'project:' || p1, p1, o1, u_a, 'new', 'NOUVEAU');
    INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by, status,
                                             general_stage, decision_source, contacted_at, process_step_id, rejected_from_stage)
    VALUES ('T1-i', 'project:' || p1, p1, o1, u_a, 'discovered', 'hired', 'system', now() - interval '9 days', s_rh, 'hired');
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[T1 insertion : %s] ', SQLERRM);
  END;
  SELECT string_agg(j.candidate_id || '=' || j.general_stage || '/' || coalesce(j.process_step_id::text, '-') || '/'
                    || coalesce(j.decision_source, '-') || '/' || coalesce(j.rejected_from_stage, '-') || '/'
                    || j.status || '/' || coalesce(j.pipeline_stage, '-') || '/' || (j.contacted_at IS NOT NULL),
                    ' ' ORDER BY j.candidate_id) INTO got
    FROM public.job_candidate_status j WHERE j.project_id = p1 AND j.candidate_id LIKE 'T1-%';
  failures := failures || pg_temp.csm_eq('T1', got,
    'T1-a=to_sort/-/-/-/statut inconnu/ITW 1/false T1-b=retained/-/user/-/shortlisted/   /false '
    'T1-c=rejected/-/user/hired/dismissed/Gagné/false '
    'T1-d=interviewing/' || s_rh || '/user/-/shortlisted/' || upper(s_rh::text) || '/false '
    'T1-e=interviewing/-/user/-/shortlisted/' || s_p2 || '/false '
    'T1-f=interviewing/-/user/-/shortlisted/00000000-0000-4000-8000-00000000dead/false '
    'T1-g=interviewing/-/system/-/qualification/-/false T1-h=to_sort/-/-/-/new/NOUVEAU/false '
    'T1-i=to_sort/-/-/-/discovered/-/false');

  -- T2. Insertion par job_id seul (project:<P1>) sur l'étape RH : resolve passe avant.
  INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by, status, pipeline_stage)
  VALUES ('T2', 'project:' || p1, o1, u_a, 'shortlisted', s_rh::text) RETURNING id INTO x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T2 mission', rw.project_id, p1)
                       || pg_temp.csm_eq('T2 étape', rw.general_stage, 'interviewing')
                       || pg_temp.csm_eq('T2 étape d''entretien', rw.process_step_id, s_rh);

  -- T3. discovered puis scored : date inchangée, origine ai.
  x := pg_temp.csm_row(p1, 'T3', 'discovered');
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  UPDATE public.job_candidate_status SET status = 'scored', score = 70, recommendation = 'GOOD_MATCH' WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T3 étape', rw.general_stage, 'to_sort')
                       || pg_temp.csm_eq('T3 date', rw.stage_entered_at, past)
                       || pg_temp.csm_eq('T3 origine', rw.decision_source, 'ai');

  -- T4. scored (NO_MATCH, 40) puis dismissed par la notation serveur : écart de l'IA.
  x := pg_temp.csm_row(p1, 'T4', 'scored', NULL, 40, 'NO_MATCH');
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T4 étape', rw.general_stage, 'rejected')
                       || pg_temp.csm_eq('T4 origine', rw.decision_source, 'ai')
                       || pg_temp.csm_eq('T4 étape quittée', rw.rejected_from_stage, 'to_sort')
                       || pg_temp.csm_eq('T4 date d''écart', rw.rejected_at, now());

  -- T5. messaged puis dismissed (statut seul) : écart humain depuis Contacté, contacted_at gardé.
  x := pg_temp.csm_row(p1, 'T5', 'messaged');
  PERFORM pg_temp.csm_force(x, 'contacted_at', now() - interval '3 days');
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T5 étape', rw.general_stage, 'rejected')
                       || pg_temp.csm_eq('T5 origine', rw.decision_source, 'user')
                       || pg_temp.csm_eq('T5 étape quittée', rw.rejected_from_stage, 'contacted')
                       || pg_temp.csm_eq('T5 contacted_at', rw.contacted_at, now() - interval '3 days');

  -- T6. Navigateur : shortlisted, messaged, replied, messaged. Jalons posés une seule fois.
  x := pg_temp.csm_row(p1, 'T6', 'shortlisted');
  IF v_auth_ok THEN
    PERFORM pg_temp.csm_as(u_a);
    SET LOCAL ROLE authenticated;
    UPDATE public.job_candidate_status SET status = 'messaged' WHERE id = x;
    RESET ROLE;
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
    failures := failures || pg_temp.csm_eq('T6 messaged', rw.general_stage || '/' || rw.decision_source || '/' || (rw.contacted_at = now()),
                                           'contacted/user/true');
    PERFORM pg_temp.csm_force(x, 'contacted_at', now() - interval '3 days');
    SET LOCAL ROLE authenticated;
    UPDATE public.job_candidate_status SET status = 'replied' WHERE id = x;
    RESET ROLE;
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
    failures := failures || pg_temp.csm_eq('T6 replied', rw.general_stage || '/' || (rw.replied_at = now()) || '/'
                                           || (rw.contacted_at = now() - interval '3 days'), 'replied/true/true');
    PERFORM pg_temp.csm_force(x, 'replied_at', now() - interval '2 days');
    SET LOCAL ROLE authenticated;
    UPDATE public.job_candidate_status SET status = 'messaged' WHERE id = x;
    RESET ROLE;
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
    failures := failures || pg_temp.csm_eq('T6 retour', rw.general_stage || '/' || (rw.contacted_at = now() - interval '3 days')
                                           || '/' || (rw.replied_at = now() - interval '2 days'), 'contacted/true/true');
    PERFORM pg_temp.csm_as(NULL);
  END IF;

  -- T7. Écritures directes des colonnes du modèle : ignorées, sans erreur de CHECK.
  x := pg_temp.csm_row(p1, 'T7', 'discovered');
  y := pg_temp.csm_row(p1, 'T7-rh', 'shortlisted', s_rh::text);
  BEGIN
    UPDATE public.job_candidate_status SET general_stage = 'hired' WHERE id = x;
    UPDATE public.job_candidate_status SET decision_source = 'system' WHERE id = x;
    UPDATE public.job_candidate_status SET contacted_at = now() - interval '1 day' WHERE id = x;
    UPDATE public.job_candidate_status SET process_step_id = s_rh WHERE id = x;
    UPDATE public.job_candidate_status SET process_step_id = NULL WHERE id = y;   -- l'étape existe
    UPDATE public.job_candidate_status SET process_step_id = s_cl WHERE id = y;
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[T7 écriture directe : %s] ', SQLERRM);
  END;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T7 ligne à trier', rw.general_stage || '/' || coalesce(rw.decision_source, '-') || '/'
                                         || coalesce(rw.contacted_at::text, '-') || '/' || coalesce(rw.process_step_id::text, '-'),
                                         'to_sort/-/-/-');
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = y;
  failures := failures || pg_temp.csm_eq('T7 étape d''entretien', rw.process_step_id, s_rh);

  -- T8. Étiquettes seules : date inchangée, ligne de la mission non réécrite.
  x := pg_temp.csm_row(p1, 'T8', 'scored', NULL, 70);
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  SELECT ctid::text INTO ct FROM public.sourcing_projects WHERE id = p1;
  UPDATE public.job_candidate_status SET tags = ARRAY['a'] WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T8 date', rw.stage_entered_at, past);
  SELECT ctid::text INTO got FROM public.sourcing_projects WHERE id = p1;
  failures := failures || pg_temp.csm_eq('T8 mission réécrite', got, ct);

  -- T9. De l'étape RH à l'étape client : date remise, nouvelle étape.
  x := pg_temp.csm_row(p1, 'T9', 'shortlisted', s_rh::text);
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  UPDATE public.job_candidate_status SET pipeline_stage = s_cl::text WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T9 étape', rw.process_step_id, s_cl)
                       || pg_temp.csm_eq('T9 date', rw.stage_entered_at, now());

  -- T10. project_id retiré : plus d'étape d'entretien, toujours En entretien, date gardée.
  x := pg_temp.csm_row(p1, 'T10', 'shortlisted', s_rh::text);
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  UPDATE public.job_candidate_status SET project_id = NULL WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T10', rw.general_stage || '/' || coalesce(rw.process_step_id::text, '-') || '/'
                                         || (rw.stage_entered_at = past), 'interviewing/-/true');

  -- T11. Suppression directe de l'étape (deleteStep) : process_step_id vidé,
  --      étape générale et date gardées, pipeline_stage orphelin comme aujourd'hui.
  x := pg_temp.csm_row(p1, 'T11', 'shortlisted', s_tmp::text);
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  BEGIN
    DELETE FROM public.mission_process_steps WHERE id = s_tmp;
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[T11 suppression : %s] ', SQLERRM);
  END;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T11', rw.general_stage || '/' || coalesce(rw.process_step_id::text, '-') || '/'
                                         || (rw.stage_entered_at = past) || '/' || rw.pipeline_stage,
                                         'interviewing/-/true/' || s_tmp);

  -- T12. not_interested : A répondu. qualification écrit par la clé de service : En entretien, system, sans jalon.
  x := pg_temp.csm_row(p1, 'T12-a', 'not_interested', 'Répondu');
  SELECT general_stage INTO got FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T12 not_interested', got, 'replied');
  x := pg_temp.csm_row(p1, 'T12-b', 'discovered');
  PERFORM pg_temp.csm_as(NULL, 'service_role');
  UPDATE public.job_candidate_status SET status = 'qualification', pipeline_stage = 'Pré-qualif' WHERE id = x;
  PERFORM pg_temp.csm_as(NULL);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T12 qualification', rw.general_stage || '/' || rw.decision_source || '/'
                                         || (rw.contacted_at IS NULL) || '/' || (rw.first_interview_at IS NULL),
                                         'interviewing/system/true/true');

  -- T13. Clé de service : replied sur une ligne scored (montée du webhook) :
  --      A répondu, system, aucun jalon (constat 15).
  x := pg_temp.csm_row(p1, 'T13', 'scored', NULL, 70);
  PERFORM pg_temp.csm_as(NULL, 'service_role');
  UPDATE public.job_candidate_status SET status = 'replied' WHERE id = x;
  PERFORM pg_temp.csm_as(NULL);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T13', rw.general_stage || '/' || rw.decision_source || '/'
                                         || coalesce(rw.contacted_at::text, '-') || '/' || coalesce(rw.replied_at::text, '-'),
                                         'replied/system/-/-');

  -- T14. Annulation d'un écart (discovered, note effacée) : À trier, user.
  x := pg_temp.csm_row(p1, 'T14', 'dismissed', NULL, 30, 'skip');
  UPDATE public.job_candidate_status SET status = 'discovered', score = NULL, recommendation = NULL, skip_reason = NULL WHERE id = x;
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('T14', rw.general_stage || '/' || coalesce(rw.decision_source, '-'), 'to_sort/user');

  -- ===== F. set_candidate_stage (appels serveur en postgres, organisation O1) =====
  -- Paramètres.
  x := pg_temp.csm_row(p1, 'F0', 'shortlisted');
  failures := failures
    || pg_temp.csm_eq('F0 étape inconnue', pg_temp.csm_set(x, 'shortlisted', 'user', o1)->>'hint', 'STAGE_UNKNOWN')
    || pg_temp.csm_eq('F0 origine inconnue', pg_temp.csm_set(x, 'retained', 'robot', o1)->>'hint', 'STAGE_SOURCE_UNKNOWN')
    || pg_temp.csm_eq('F0 événement', pg_temp.csm_set(x, 'hired', 'system', o1)->>'hint', 'STAGE_SYSTEM_FORBIDDEN')
    || pg_temp.csm_eq('F0 étape hors entretien', pg_temp.csm_set(x, 'retained', 'user', o1, s_rh)->>'hint', 'STAGE_STEP_WITHOUT_INTERVIEW');

  -- F1. system/replied sur une ligne À trier : not_contacted, aucune écriture.
  x := pg_temp.csm_row(p1, 'F1', 'discovered');
  SELECT ctid::text INTO ct FROM public.job_candidate_status WHERE id = x;
  v := pg_temp.csm_set(x, 'replied', 'system', o1);
  SELECT ctid::text INTO got FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F1 résultat', v->>'result', 'not_contacted')
                       || pg_temp.csm_eq('F1 ligne réécrite', got, ct);

  -- F2. system/replied sur une ligne contactée : A répondu, Répondu, replied_at posé.
  x := pg_temp.csm_row(p1, 'F2', 'messaged');
  v := pg_temp.csm_set(x, 'replied', 'system', o1);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F2', coalesce(v->>'error', v->>'result') || '/' || rw.general_stage || '/' || rw.status || '/'
                                         || rw.pipeline_stage || '/' || rw.decision_source || '/' || (rw.replied_at = now()),
                                         'updated/replied/replied/Répondu/system/true');
  -- F2 bis. Réponse sur une ligne déjà au-delà, contactée sans date de réponse :
  --         kept, seule replied_at est posée.
  x := pg_temp.csm_row(p1, 'F2b', 'qualification', 'Pré-qualif');
  PERFORM pg_temp.csm_force(x, 'contacted_at', past);
  v := pg_temp.csm_set(x, 'replied', 'system', o1);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F2 bis', coalesce(v->>'error', v->>'result') || '/' || (v->>'changed') || '/'
                                         || rw.general_stage || '/' || (rw.replied_at = now()) || '/' || rw.pipeline_stage,
                                         'kept/true/interviewing/true/Pré-qualif');

  -- F3. system/contacted sur une ligne en entretien : kept, couple non canonique intact.
  x := pg_temp.csm_row(p1, 'F3', 'qualification', 'Pré-qualif');
  SELECT ctid::text INTO ct FROM public.job_candidate_status WHERE id = x;
  v := pg_temp.csm_set(x, 'contacted', 'system', o1);
  SELECT ctid::text INTO got FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F3 résultat', v->>'result', 'kept')
                       || pg_temp.csm_eq('F3 ligne réécrite', got, ct);

  -- F4. Une personne, mission avec étapes, sans libellé : STAGE_STEP_REQUIRED.
  --     F4 bis : avec le libellé « Offre » du /pipeline, En entretien sans étape.
  x := pg_temp.csm_row(p1, 'F4', 'shortlisted');
  failures := failures || pg_temp.csm_eq('F4', pg_temp.csm_set(x, 'interviewing', 'user', o1)->>'hint', 'STAGE_STEP_REQUIRED');
  v := pg_temp.csm_set(x, 'interviewing', 'user', o1, NULL, 'Offre');
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F4 bis', coalesce(v->>'error', v->>'result') || '/' || rw.general_stage || '/'
                                         || coalesce(rw.process_step_id::text, '-') || '/' || rw.pipeline_stage || '/' || rw.status,
                                         'updated/interviewing/-/Offre/shortlisted');

  -- F5. Étape d'une autre mission : refus.
  x := pg_temp.csm_row(p1, 'F5', 'shortlisted');
  failures := failures || pg_temp.csm_eq('F5', pg_temp.csm_set(x, 'interviewing', 'user', o1, s_p2)->>'hint', 'STAGE_STEP_NOT_IN_MISSION');

  -- F6. Entretien sur l'étape RH : pipeline_stage = identifiant, jalons impliqués posés.
  id_a := pg_temp.csm_row(p1, 'F6', 'shortlisted');
  v := pg_temp.csm_set(id_a, 'interviewing', 'user', o1, s_rh);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_a;
  failures := failures || pg_temp.csm_eq('F6', coalesce(v->>'error', v->>'result') || '/' || rw.general_stage || '/'
                                         || rw.process_step_id || '/' || rw.pipeline_stage || '/' || rw.status || '/'
                                         || (rw.contacted_at = now()) || (rw.replied_at = now()) || (rw.first_interview_at = now()),
                                         'updated/interviewing/' || s_rh || '/' || s_rh || '/shortlisted/truetruetrue');

  -- F7. Même appel : unchanged, aucune écriture.
  SELECT ctid::text INTO ct FROM public.job_candidate_status WHERE id = id_a;
  v := pg_temp.csm_set(id_a, 'interviewing', 'user', o1, s_rh);
  SELECT ctid::text INTO got FROM public.job_candidate_status WHERE id = id_a;
  failures := failures || pg_temp.csm_eq('F7 résultat', v->>'result', 'unchanged')
                       || pg_temp.csm_eq('F7 ligne réécrite', got, ct);

  -- F8. L'IA ne fait que noter : jamais Retenu ni Écarté, jamais un écarté repris ;
  --     elle ne marque que l'origine d'une ligne À trier sans origine.
  x := pg_temp.csm_row(p1, 'F8-a', 'shortlisted');
  failures := failures || pg_temp.csm_eq('F8 ai retenu', pg_temp.csm_set(x, 'retained', 'ai', o1)->>'hint', 'STAGE_AI_FORBIDDEN')
                       || pg_temp.csm_eq('F8 ai écarté', pg_temp.csm_set(x, 'rejected', 'ai', o1)->>'hint', 'STAGE_AI_FORBIDDEN');
  id_b := pg_temp.csm_row(p1, 'F8-b', 'scored', NULL, 40, 'NO_MATCH');
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = id_b;
  v := pg_temp.csm_set(id_b, 'to_sort', 'ai', o1);
  SELECT general_stage INTO got FROM public.job_candidate_status WHERE id = id_b;
  failures := failures || pg_temp.csm_eq('F8 écart de l''IA', v->>'result' || '/' || got, 'kept/rejected');
  x := pg_temp.csm_row(p1, 'F8-c', 'discovered');
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  v := pg_temp.csm_set(x, 'to_sort', 'ai', o1);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F8 origine ai', coalesce(v->>'error', v->>'result') || '/' || rw.decision_source || '/'
                                         || (rw.stage_entered_at = past), 'updated/ai/true');
  x := pg_temp.csm_row(p1, 'F8-d', 'untreated', 'untreated');
  v := pg_temp.csm_set(x, 'to_sort', 'ai', o1);
  failures := failures || pg_temp.csm_eq('F8 origine user gardée', v->>'result' || '/' || (v->>'decision_source'), 'unchanged/user');

  -- F9. Écart depuis un entretien : étape quittée En entretien, dismissed, plus d'étape.
  v := pg_temp.csm_set(id_a, 'rejected', 'user', o1);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_a;
  failures := failures || pg_temp.csm_eq('F9', coalesce(v->>'error', v->>'result') || '/' || rw.general_stage || '/'
                                         || rw.rejected_from_stage || '/' || rw.status || '/' || coalesce(rw.pipeline_stage, '-') || '/'
                                         || coalesce(rw.process_step_id::text, '-') || '/' || (rw.rejected_at = now()),
                                         'updated/rejected/interviewing/dismissed/-/-/true');

  -- F10. Une personne confirme un écart de l'IA : origine user, date inchangée.
  PERFORM pg_temp.csm_force(id_b, 'stage_entered_at', past);
  v := pg_temp.csm_set(id_b, 'rejected', 'user', o1);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_b;
  failures := failures || pg_temp.csm_eq('F10', coalesce(v->>'error', v->>'result') || '/' || rw.decision_source || '/'
                                         || (rw.stage_entered_at = past), 'updated/user/true');

  -- F11. Libellés hérités.
  x := pg_temp.csm_row(p1, 'F11', 'shortlisted');
  v := pg_temp.csm_set(x, 'hired', 'user', o1, NULL, 'Gagné');
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F11 Gagné', coalesce(v->>'error', v->>'result') || '/' || rw.general_stage || '/'
                                         || rw.pipeline_stage || '/' || (rw.hired_at = now()), 'updated/hired/Gagné/true')
    || pg_temp.csm_eq('F11 Embauché + Offre', pg_temp.csm_set(x, 'hired', 'user', o1, NULL, 'Offre')->>'hint', 'STAGE_LEGACY_MISMATCH')
    || pg_temp.csm_eq('F11 étape + Offre', pg_temp.csm_set(x, 'interviewing', 'user', o1, s_rh, 'Offre')->>'hint', 'STAGE_LEGACY_MISMATCH')
    || pg_temp.csm_eq('F11 Écarté + uuid', pg_temp.csm_set(x, 'rejected', 'user', o1, NULL, s_rh::text)->>'hint', 'STAGE_LEGACY_MISMATCH')
    || pg_temp.csm_eq('F11 system + libellé', pg_temp.csm_set(x, 'interviewing', 'system', o1, NULL, 'Offre')->>'hint', 'STAGE_LEGACY_MISMATCH');

  -- F13. Hors navigateur : organisation obligatoire, et celle de la ligne.
  failures := failures
    || pg_temp.csm_eq('F13 sans organisation', pg_temp.csm_set(x, 'retained', 'user', NULL)->>'hint', 'STAGE_ORG_REQUIRED')
    || pg_temp.csm_eq('F13 autre organisation', pg_temp.csm_set(x, 'retained', 'user', o2)->>'error', 'P0002');

  -- F14. Une personne écarte une ligne écartée qui porte un uuid d'étape : pipeline_stage vidé, date inchangée.
  x := pg_temp.csm_row(p1, 'F14', 'dismissed', s_rh::text);
  PERFORM pg_temp.csm_force(x, 'stage_entered_at', past);
  v := pg_temp.csm_set(x, 'rejected', 'user', o1);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = x;
  failures := failures || pg_temp.csm_eq('F14', coalesce(v->>'error', v->>'result') || '/' || rw.general_stage || '/'
                                         || rw.status || '/' || coalesce(rw.pipeline_stage, '-') || '/' || (rw.stage_entered_at = past),
                                         'updated/rejected/dismissed/-/true');

  -- ===== St. Compteurs de mission (P4, sans étape) =====
  PERFORM pg_temp.csm_row(p4, 'St-1', 'discovered');
  PERFORM pg_temp.csm_row(p4, 'St-2', 'discovered');
  PERFORM pg_temp.csm_row(p4, 'St-3', 'scored', NULL, 70);
  PERFORM pg_temp.csm_row(p4, 'St-4', 'messaged', NULL, 80);
  PERFORM pg_temp.csm_row(p4, 'St-5', 'replied');
  id_c := pg_temp.csm_row(p4, 'St-6', 'dismissed', NULL, 30, 'skip');
  PERFORM pg_temp.csm_row(p4, 'St-7', 'shortlisted');
  -- St1. Définitions du lot 0c (get_mission_stage_counts) : 7 lignes (Sourcés),
  --      3 notées, 2 contactées au total (St-4 par son jalon, St-5 par son
  --      étape), 1 écartée, 3 retenues au total (St-4, St-5, St-7).
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted] INTO st_before
    FROM public.sourcing_projects WHERE id = p4;
  failures := failures || pg_temp.csm_eq('St1 compteurs de P4', st_before::text, '{7,3,2,1,3}');
  -- St4. Égaux à get_mission_stage_counts, appelée en membre (source unique des compteurs).
  IF v_auth_ok THEN
    PERFORM pg_temp.csm_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT ARRAY[g.unopened + g.to_sort + g.retained + g.contacted + g.replied + g.interviewing + g.hired + g.rejected,
                 g.scored, g.ever_contacted, g.rejected, g.ever_retained]::text INTO got
      FROM public.get_mission_stage_counts(ARRAY[p4]) g;
    RESET ROLE;
    PERFORM pg_temp.csm_as(NULL);
    failures := failures || pg_temp.csm_eq('St4 get_mission_stage_counts', got, st_before::text);
  END IF;
  -- St2. Une ligne de O2 rattachée à P4 ne change pas ses chiffres.
  INSERT INTO public.job_candidate_status (candidate_id, job_id, project_id, organization_id, created_by, status, score)
  VALUES ('St-o2', 'project:' || p4, p4, o2, u_c, 'dismissed', 20);
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted] INTO st_after
    FROM public.sourcing_projects WHERE id = p4;
  failures := failures || pg_temp.csm_eq('St2 ligne d''une autre organisation comptée', st_after::text, st_before::text);
  -- St3. Changer la mission d'une ligne déplace les comptes.
  SELECT ARRAY[stats_total_found, stats_dismissed] INTO st_before FROM public.sourcing_projects WHERE id = p2;
  UPDATE public.job_candidate_status SET project_id = p2, job_id = 'project:' || p2 WHERE id = id_c;
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted] INTO st_after
    FROM public.sourcing_projects WHERE id = p4;
  failures := failures || pg_temp.csm_eq('St3 P4', st_after::text, '{6,2,2,0,3}');
  SELECT ARRAY[stats_total_found - st_before[1], stats_dismissed - st_before[2]] INTO st_after
    FROM public.sourcing_projects WHERE id = p2;
  failures := failures || pg_temp.csm_eq('St3 P2', st_after::text, '{1,1}');

  -- ===== B. Reprise (P6, lignes datées dans le passé, inscriptions) =====
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_a, 'csm-acc-a', u_a);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, project_id, is_active)
  VALUES ('e0a00000-0000-4000-8000-0000000000d1', 'Séquence P6', o1, u_a, p6, true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES ('e0a00000-0000-4000-8000-0000000000e1', 'e0a00000-0000-4000-8000-0000000000d1', o1, 1, 'message', 'Bonjour'),
         ('e0a00000-0000-4000-8000-0000000000e2', 'e0a00000-0000-4000-8000-0000000000d1', o1, 2, 'message', 'Relance');
  WITH ins AS (
    INSERT INTO public.job_candidate_status
      (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage, score, recommendation,
       scoring_details, created_at, updated_at)
    VALUES
      ('B-dism-c2',  'project:' || p6, p6, o1, u_a, 'dismissed', NULL, 40, 'NO_MATCH', '{"total":40}', t0, t0 + interval '1 day'),
      ('B-dism-a',   'project:' || p6, p6, o1, u_a, 'dismissed', NULL, NULL, NULL, NULL, t0, t0 + interval '2 days'),
      ('B-dism-new', 'project:' || p6, p6, o1, u_a, 'dismissed', NULL, 20, 'skip', '{"total":20}', t0, t0),
      ('B-untreat',  'project:' || p6, p6, o1, u_a, 'untreated', 'untreated', NULL, NULL, NULL, t0, t0),
      ('B-scored',   'project:' || p6, p6, o1, u_a, 'scored', NULL, 70, 'GOOD_MATCH', '{"total":70}', t0, t0 + interval '1 day'),
      ('B-disc',     'project:' || p6, p6, o1, u_a, 'discovered', NULL, NULL, NULL, NULL, t0, t0 + interval '3 days'),
      ('B-msg',      'project:' || p6, p6, o1, u_a, 'messaged', NULL, 80, 'STRONG_MATCH', '{"total":80}', t0, t0 + interval '12 days'),
      ('B-nosend',   'project:' || p6, p6, o1, u_a, 'messaged', NULL, 75, 'GOOD_MATCH', '{"total":75}', t0, t0 + interval '13 days'),
      ('B-replied',  'project:' || p6, p6, o1, u_a, 'replied', NULL, 85, 'STRONG_MATCH', '{"total":85}', t0, t0 + interval '25 days'),
      ('B-dism-sent','project:' || p6, p6, o1, u_a, 'dismissed', NULL, 45, 'NO_MATCH', '{"total":45}', t0, t0 + interval '20 days'),
      ('B-portal',   'project:' || p6, p6, o1, u_a, 'shortlisted', NULL, 90, 'STRONG_MATCH', '{"total":90}', t0, t0 + interval '9 days'),
      ('B-annul',    'project:' || p6, p6, o1, u_a, 'discovered', NULL, NULL, NULL, '{"total":40}', t0, t0 + interval '5 days'),
      ('B-msg-exact','project:' || p6, p6, o1, u_a, 'messaged', NULL, NULL, NULL, NULL, t0, t0),
      ('B-sort-sent','project:' || p6, p6, o1, u_a, 'scored', NULL, 70, 'GOOD_MATCH', '{"total":70}', t0, t0 + interval '1 day')
    RETURNING id
  )
  SELECT array_agg(id) INTO b FROM ins;
  INSERT INTO public.candidate_evaluations (candidate_id, created_by, organization_id, created_at)
  SELECT j.id::text, '00000000-0000-0000-0000-000000000000', o1, t0 + interval '10 days'
    FROM public.job_candidate_status j WHERE j.project_id = p6 AND j.candidate_id = 'B-portal';
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status,
                                           current_step_order, created_at, replied_at)
  VALUES ('e0a00000-0000-4000-8000-000000000f07', 'e0a00000-0000-4000-8000-0000000000d1', 'csm-acc-a', 'B-msg', o1, u_a, 'active', 1, t0 + interval '10 days', NULL),
         ('e0a00000-0000-4000-8000-000000000f08', 'e0a00000-0000-4000-8000-0000000000d1', 'csm-acc-a', 'B-nosend', o1, u_a, 'active', 0, t0 + interval '10 days', NULL),
         ('e0a00000-0000-4000-8000-000000000f09', 'e0a00000-0000-4000-8000-0000000000d1', 'csm-acc-a', 'B-replied', o1, u_a, 'replied', 1, t0 + interval '10 days', t0 + interval '20 days'),
         ('e0a00000-0000-4000-8000-000000000f10', 'e0a00000-0000-4000-8000-0000000000d1', 'csm-acc-a', 'B-dism-sent', o1, u_a, 'stopped', 1, t0 + interval '10 days', NULL),
         ('e0a00000-0000-4000-8000-000000000f11', 'e0a00000-0000-4000-8000-0000000000d1', 'csm-acc-a', 'B-sort-sent', o1, u_a, 'replied', 1, t0 + interval '10 days', t0 + interval '15 days');
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES ('e0a00000-0000-4000-8000-000000000f07', 'e0a00000-0000-4000-8000-0000000000e1', 1, t0 + interval '11 days', 'sent', t0 + interval '11 days'),
         ('e0a00000-0000-4000-8000-000000000f08', 'e0a00000-0000-4000-8000-0000000000e1', 1, now() + interval '1 day', 'scheduled', NULL),
         ('e0a00000-0000-4000-8000-000000000f09', 'e0a00000-0000-4000-8000-0000000000e1', 1, t0 + interval '11 days', 'sent', t0 + interval '11 days'),
         ('e0a00000-0000-4000-8000-000000000f10', 'e0a00000-0000-4000-8000-0000000000e1', 1, t0 + interval '11 days', 'sent', t0 + interval '11 days'),
         ('e0a00000-0000-4000-8000-000000000f11', 'e0a00000-0000-4000-8000-0000000000e1', 1, t0 + interval '11 days', 'sent', t0 + interval '11 days');

  -- Clés d'appel de l'indexation posées (annulées au ROLLBACK) : un déclencheur
  -- d'indexation resté actif pendant la reprise mettrait des appels en file.
  IF pg_temp.csm_http() IS NOT NULL THEN
    INSERT INTO public.internal_config (key, value)
    VALUES ('supabase_functions_url', 'http://127.0.0.1:9/csm-audit/functions/v1'), ('supabase_anon_key', 'csm-audit')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  q0 := pg_temp.csm_http();
  n := public.jcs_stage_backfill(b);
  failures := failures || pg_temp.csm_eq('B lignes reprises', n, 14);
  SELECT string_agg(tgname || '=' || tgenabled::text, ',' ORDER BY tgname) INTO got FROM pg_trigger
   WHERE tgrelid = 'public.job_candidate_status'::regclass
     AND tgname IN ('update_job_candidate_status_updated_at', 'trg_auto_ingest_job_candidate_status');
  failures := failures || pg_temp.csm_eq('B déclencheurs rétablis', got,
    'trg_auto_ingest_job_candidate_status=O,update_job_candidate_status_updated_at=O');
  SELECT string_agg(format('%s=%s/%s/%s/%s/%s/%s/%s/%s', j.candidate_id, j.general_stage, coalesce(j.decision_source, '-'),
           coalesce(j.rejected_from_stage, '-'),
           coalesce(extract(day FROM j.stage_entered_at - t0)::text, '?'),
           coalesce(extract(day FROM j.contacted_at - t0)::text, '-'),
           coalesce(extract(day FROM j.replied_at - t0)::text, '-'),
           coalesce(extract(day FROM j.presented_at - t0)::text, '-'),
           coalesce(extract(day FROM j.rejected_at - t0)::text, '-')), ' ' ORDER BY j.candidate_id) INTO got
    FROM public.job_candidate_status j WHERE j.id = ANY (b);
  -- étape/origine/quittée/entrée/contact/réponse/présentation/écart, en jours après t0.
  failures := failures || pg_temp.csm_eq('B1 à B7, B9, B10', got,
    'B-annul=to_sort/user/-/0/-/-/-/- '                     -- B9 : écart annulé
    'B-disc=to_sort/-/-/0/-/-/-/- '                         -- B2
    'B-dism-a=rejected/ai/to_sort/2/-/-/-/- '               -- B1 : tout effacé, décision 3
    'B-dism-c2=rejected/ai/to_sort/1/-/-/-/- '              -- B1, B10 : modifiée, pas de date d'écart
    'B-dism-new=rejected/ai/to_sort/0/-/-/-/0 '             -- B10 : créée écartée, date exacte
    'B-dism-sent=rejected/ai/contacted/20/11/-/-/- '        -- B6
    'B-msg=contacted/user/-/11/11/-/-/- '                   -- B3
    'B-msg-exact=contacted/user/-/0/0/-/-/- '               -- créée contactée sans inscription
    'B-nosend=contacted/user/-/10/-/-/-/- '                 -- B4
    'B-portal=retained/user/-/9/-/-/10/- '                  -- B7
    'B-replied=replied/system/-/20/11/20/-/- '              -- B5
    'B-scored=to_sort/ai/-/0/-/-/-/- '                      -- B2
    'B-sort-sent=to_sort/ai/-/0/11/15/-/- '                 -- B11 : envoi et réponse gardés hors de l'étape
    'B-untreat=to_sort/user/-/0/-/-/-/-');                  -- B2
  -- B8. Second appel : mêmes valeurs, updated_at jamais touché.
  SELECT jsonb_object_agg(j.id, to_jsonb(j)) INTO snap FROM public.job_candidate_status j WHERE j.id = ANY (b);
  n := public.jcs_stage_backfill(b);
  SELECT count(*) INTO n FROM public.job_candidate_status j
   WHERE j.id = ANY (b) AND to_jsonb(j) IS DISTINCT FROM snap -> j.id::text;
  failures := failures || pg_temp.csm_eq('B8 lignes changées au second appel', n, 0);
  SELECT count(*) INTO n FROM public.job_candidate_status j
   WHERE j.id = ANY (b) AND j.updated_at NOT IN (t0, t0 + interval '1 day', t0 + interval '2 days', t0 + interval '3 days',
                                                 t0 + interval '5 days', t0 + interval '9 days', t0 + interval '12 days',
                                                 t0 + interval '13 days', t0 + interval '20 days', t0 + interval '25 days');
  failures := failures || pg_temp.csm_eq('B8 updated_at modifiés', n, 0);
  -- B8. Aucun appel HTTP pendant les deux reprises ; témoin : une écriture ordinaire en met un en file.
  failures := failures || pg_temp.csm_eq('B8 appels HTTP pendant la reprise', pg_temp.csm_http() - q0, 0);
  UPDATE public.job_candidate_status SET tags = tags WHERE id = b[1];
  failures := failures || pg_temp.csm_eq('B8 témoin d''indexation', pg_temp.csm_http() - q0, 1);

  -- ===== Navigateur (A, membre de O1) : F12 et replace_process_steps =====
  IF v_auth_ok THEN
    id_d := pg_temp.csm_row(p1, 'F12-o1', 'discovered');
    id_e := pg_temp.csm_row(p3, 'F12-o2', 'discovered');
    -- R : lignes sur les étapes, dates dans le passé.
    id_f := pg_temp.csm_row(p1, 'R-rh', 'shortlisted', s_rh::text);
    id_g := pg_temp.csm_row(p1, 'R-cl', 'shortlisted', s_cl::text);
    id_h := pg_temp.csm_row(p1, 'R-rej', 'dismissed', s_rh::text);
    PERFORM pg_temp.csm_force(id_f, 'stage_entered_at', past);
    PERFORM pg_temp.csm_force(id_g, 'stage_entered_at', past);

    PERFORM pg_temp.csm_as(u_a);
    SET LOCAL ROLE authenticated;
    -- F12. Succès sur une ligne de O1 (étape d'entretien : verrou sur l'étape sous la RLS).
    BEGIN
      v := public.set_candidate_stage(id_d, 'interviewing', 'user', NULL, s_rh);
      failures := failures || pg_temp.csm_eq('F12 ligne de O1', v->>'result' || '/' || (v->>'process_step_id'), 'updated/' || s_rh);
    EXCEPTION WHEN OTHERS THEN
      failures := failures || format('[F12 ligne de O1 : %s] ', SQLERRM);
    END;
    -- F12. Ligne de O2 invisible : introuvable.
    BEGIN
      v := public.set_candidate_stage(id_e, 'retained', 'user');
      failures := failures || '[F12 ligne de O2 modifiée] ';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS got = RETURNED_SQLSTATE;
      failures := failures || pg_temp.csm_eq('F12 ligne de O2', got, 'P0002');
    END;
    -- F12. Origine réservée au serveur.
    BEGIN
      v := public.set_candidate_stage(id_d, 'contacted', 'system');
      failures := failures || '[F12 origine system acceptée depuis le navigateur] ';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
      failures := failures || pg_temp.csm_eq('F12 origine system', got, 'STAGE_SOURCE_FORBIDDEN');
    END;

    -- R1, R3. Échange des étapes RH et client.
    BEGIN
      n := public.replace_process_steps(p1, '[{"name":"Entretien client"},{"name":"Entretien RH"}]'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      failures := failures || format('[R1 replace_process_steps : %s] ', SQLERRM);
    END;
    RESET ROLE;
    PERFORM pg_temp.csm_as(NULL);
    SELECT id INTO new_rh FROM public.mission_process_steps WHERE project_id = p1 AND name = 'Entretien RH';
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_f;
    failures := failures || pg_temp.csm_eq('R1', rw.general_stage || '/' || (rw.process_step_id = new_rh) || '/'
                                           || (rw.pipeline_stage = new_rh::text) || '/' || (rw.stage_entered_at = past) || '/'
                                           || rw.decision_source || '/' || (new_rh <> s_rh), 'interviewing/true/true/true/user/true');
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_h;
    failures := failures || pg_temp.csm_eq('R3', rw.general_stage || '/' || coalesce(rw.process_step_id::text, '-') || '/'
                                           || (rw.pipeline_stage = new_rh::text), 'rejected/-/true');
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_d;
    failures := failures || pg_temp.csm_eq('R1 ligne F12', (rw.process_step_id = new_rh)::text, 'true');

    -- R2. L'étape client disparaît : première étape, date gardée.
    PERFORM pg_temp.csm_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      n := public.replace_process_steps(p1, '[{"name":"Entretien RH"},{"name":"Entretien final"}]'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      failures := failures || format('[R2 replace_process_steps : %s] ', SQLERRM);
    END;
    RESET ROLE;
    PERFORM pg_temp.csm_as(NULL);
    SELECT id INTO new_rh2 FROM public.mission_process_steps WHERE project_id = p1 AND step_order = 1;
    SELECT * INTO rw FROM public.job_candidate_status WHERE id = id_g;
    failures := failures || pg_temp.csm_eq('R2', rw.general_stage || '/' || (rw.process_step_id = new_rh2) || '/'
                                           || (rw.pipeline_stage = new_rh2::text) || '/' || (rw.stage_entered_at = past),
                                           'interviewing/true/true/true');
    failures := failures || pg_temp.csm_eq('R drapeau levé', coalesce(current_setting('konekt.stage_remap', true), ''), '');
    -- Invariant : une étape d'entretien renseignée vaut toujours pipeline_stage.
    SELECT count(*) INTO n FROM public.job_candidate_status
     WHERE process_step_id IS NOT NULL AND lower(btrim(pipeline_stage)) IS DISTINCT FROM process_step_id::text;
    failures := failures || pg_temp.csm_eq('Invariant process_step_id = pipeline_stage', n, 0);
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'candidate_stage_model_audit : %', failures;
  END IF;
  RAISE NOTICE 'candidate_stage_model_audit : tous les contrôles passés (S1-S6, D1-D5, M1-M2, T1-T14, F0-F14, St1-St4, B1-B11, R1-R3)';
END $$;

-- ===== B12. Seconde application de la migration, sur les données de l'audit =====
-- Comme au déploiement : aucune ligne candidat réécrite (ctid) et aucun appel
-- HTTP d'indexation des lignes candidat (clés d'appel posées au bloc B).
-- Toutes les lignes ont une étape (NOT NULL) : la reprise ne prend rien.
-- Lot 0c : la migration 0a remet l'ancien recompute_mission_stats (sur
-- status) et son recalcul complet ; elle est donc rejouée en chaîne avec
-- celle du lot 0c, qui remet les définitions en vigueur. Contrôle des
-- missions : mêmes compteurs avant et après la chaîne, et définitions du
-- lot 0c en place. Ni ctid ni updated_at des missions : le recalcul du 0a,
-- rejoué déclencheurs actifs, les réécrit volontairement (et, dans la
-- transaction de l'audit, updated_at vaut déjà now()). Le recalcul du 0c
-- sans updated_at ni indexation est contrôlé par le bloc B de
-- candidate_stage_readers_audit.sql, missions datées dans le passé.
CREATE TEMP TABLE csm_replay ON COMMIT DROP AS
SELECT 'jcs' AS t, id, ctid::text AS ct FROM public.job_candidate_status;
CREATE TEMP TABLE csm_replay_sp ON COMMIT DROP AS
SELECT id, ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted] AS st
  FROM public.sourcing_projects;
CREATE TEMP TABLE csm_replay_http ON COMMIT DROP AS SELECT pg_temp.csm_http() AS n;
SET LOCAL client_min_messages = warning;
\ir ../migrations/20260928201409_refonte_mission_lot0a_modele_etapes.sql
\ir ../migrations/20260929112827_refonte_mission_lot0c_lectures.sql
SET LOCAL client_min_messages = notice;
DO $$
DECLARE
  n integer;
  failures text := '';
BEGIN
  SELECT count(*) INTO n FROM csm_replay r
   WHERE r.ct IS DISTINCT FROM (SELECT j.ctid::text FROM public.job_candidate_status j WHERE j.id = r.id);
  failures := pg_temp.csm_eq('B12 lignes candidat réécrites par la seconde application', n, 0)
    || pg_temp.csm_eq('B12 appels HTTP (lignes candidat) pendant la seconde application',
                      pg_temp.csm_http() - (SELECT h.n FROM csm_replay_http h), 0);
  SELECT count(*) INTO n FROM csm_replay_sp r
    JOIN public.sourcing_projects p ON p.id = r.id
   WHERE r.st IS DISTINCT FROM ARRAY[p.stats_total_found, p.stats_scored, p.stats_messaged, p.stats_dismissed, p.stats_shortlisted];
  failures := failures || pg_temp.csm_eq('B12 missions aux compteurs changés', n, 0);
  IF position('get_mission_stage_counts' IN pg_get_functiondef('public.recompute_mission_stats(uuid[])'::regprocedure)) = 0 THEN
    failures := failures || '[B12 recompute_mission_stats n''est plus celle du lot 0c] ';
  END IF;
  IF failures <> '' THEN
    RAISE EXCEPTION 'candidate_stage_model_audit : %', failures;
  END IF;
  RAISE NOTICE 'candidate_stage_model_audit : seconde application de la migration sans effet (B12)';
END $$;
