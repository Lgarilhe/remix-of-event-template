-- =====================================================================
-- Refonte mission, lot 0c-1 : les lectures (socle SQL).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/candidate_stage_readers_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/candidate_stage_readers_audit.sql -c 'ROLLBACK;')
-- Vérifie la migration 20260929112827_refonte_mission_lot0c_lectures.sql :
--  * S : structure et droits (vue en security_invoker, fermée à anon, lecture
--        seule ; fonctions et leurs droits ; aucune fonction SECURITY DEFINER
--        nouvelle) ;
--  * V : ligne canonique de la vue (doublons, formes de job_id, écart d'une
--        personne, IA, note du groupe, jamais ouverts, jalons, organisation) ;
--  * C : get_mission_stage_counts (effectifs, étapes d'entretien, cumuls,
--        mission vide, mission d'une autre organisation, service_role) ;
--  * St : compteurs stats_* (doublon, cumuls qui ne reculent pas, recalcul
--        sans écriture) ;
--  * U : undo_candidate_stages (état d'avant, jalons, geste groupé, écart de
--        l'IA, moved_since, colonne d'entretien du /pipeline, annulation
--        forgée sur une ligne déplacée par le serveur, bornes et refus) ;
--  * I : candidate_mission_sends, InMail répondu ;
--  * P : rgpd_purge_candidate_rows (fenêtres, compte seulement, suppression) ;
--        plan de la vue filtrée par mission (avertissement seulement) ;
--  * Rc et B : application de la migration sur les données de l'audit
--        (reprise des recommendation libres, compteurs corrigés sans
--        updated_at ni indexation), puis seconde application sans effet.
-- Aucune fonction n'est appelée sous SET ROLE authenticated ou service_role
-- sans que son droit ait été vérifié par has_function_privilege (plantage de
-- l'image locale sur un refus, voir CLAUDE.md) ; anon n'appelle rien : son
-- refus réel est contrôlé par l'API dans .github/workflows/e2e.yml.
-- Procédés : dates remises dans le passé sous le drapeau konekt.stage_write
-- = '*' (toute la transaction partage le même now()) ; updated_at daté avec
-- son déclencheur coupé dans la transaction ; absence d'écriture prouvée par
-- ctid ; serveur simulé par request.jwt.claim.role vide ou 'service_role'.
-- Garde des écritures directes coupée dans la transaction (mode off) : le
-- montage écrit l'ancien couple en direct, comme candidate_stage_model_audit.
-- O1 (u_a propriétaire, u_b membre, compte cr-acc-a) : M1 (sans étape), M2
-- (vide), M3 (étape S3), M4 (compteurs), M5 (étape S5), M6 (sans étape), MC
-- (étapes SC1, SC2). O2 (u_c) : M9.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
SET LOCAL lock_timeout = '30s';

DO $cr_mode$
BEGIN
  IF to_regprocedure('public.jcs_stage_write_mode()') IS NOT NULL THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION public.jcs_stage_write_mode()
      RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $m$ SELECT 'off'::text $m$ $f$;
  END IF;
END
$cr_mode$;

CREATE TEMP TABLE cr_fail (block text, msg text) ON COMMIT DROP;
CREATE TEMP TABLE cr_ids (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO cr_ids VALUES
  ('u_a', 'e0c00000-0000-4000-8000-0000000000a1'), ('u_b', 'e0c00000-0000-4000-8000-0000000000a2'),
  ('u_c', 'e0c00000-0000-4000-8000-0000000000a3'),
  ('o1', 'e0c00000-0000-4000-8000-0000000000f1'), ('o2', 'e0c00000-0000-4000-8000-0000000000f2'),
  ('m1', 'e0c00000-0000-4000-8000-0000000000b1'), ('m2', 'e0c00000-0000-4000-8000-0000000000b2'),
  ('m3', 'e0c00000-0000-4000-8000-0000000000b3'), ('m4', 'e0c00000-0000-4000-8000-0000000000b4'),
  ('m5', 'e0c00000-0000-4000-8000-0000000000b5'), ('m6', 'e0c00000-0000-4000-8000-0000000000b6'),
  ('mc', 'e0c00000-0000-4000-8000-0000000000b7'), ('m9', 'e0c00000-0000-4000-8000-0000000000b9'),
  ('s3', 'e0c00000-0000-4000-8000-0000000000c3'), ('s5', 'e0c00000-0000-4000-8000-0000000000c5'),
  ('sc1', 'e0c00000-0000-4000-8000-0000000000c1'), ('sc2', 'e0c00000-0000-4000-8000-0000000000c2'),
  ('q1', 'e0c00000-0000-4000-8000-0000000000d1'), ('e1', 'e0c00000-0000-4000-8000-0000000000e1');

CREATE FUNCTION pg_temp.cr_id(p_name text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM cr_ids WHERE name = p_name $$;

-- Contexte d'appel : utilisateur connecté (p_uid, rôle du jeton authenticated),
-- serveur sans jeton (NULL, p_role NULL) ou clé de service (NULL, 'service_role').
CREATE FUNCTION pg_temp.cr_as(p_uid uuid, p_role text DEFAULT NULL) RETURNS void
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

CREATE FUNCTION pg_temp.cr_eq(p_label text, p_got anyelement, p_want anyelement) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_got IS NOT DISTINCT FROM p_want THEN ''
              ELSE format('[%s : %s, attendu %s] ', p_label, coalesce(p_got::text, 'NULL'), coalesce(p_want::text, 'NULL')) END
$$;

-- Ligne candidat écrite sans jeton (chemin des écrivains actuels), quel que
-- soit le contexte en cours.
CREATE FUNCTION pg_temp.cr_row(p_proj uuid, p_cand text, p_status text, p_ps text DEFAULT NULL,
                               p_score numeric DEFAULT NULL, p_reco text DEFAULT NULL,
                               p_by uuid DEFAULT NULL, p_job text DEFAULT NULL, p_org uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v  uuid;
  c1 text := coalesce(current_setting('request.jwt.claims', true), '');
  c2 text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  c3 text := coalesce(current_setting('request.jwt.claim.role', true), '');
BEGIN
  PERFORM pg_temp.cr_as(NULL);
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage, score, recommendation)
  SELECT p_cand, coalesce(p_job, 'project:' || p.id), p.id, coalesce(p_org, p.organization_id),
         coalesce(p_by, p.created_by), p_status, p_ps, p_score, p_reco
    FROM public.sourcing_projects p WHERE p.id = p_proj
  RETURNING id INTO v;
  PERFORM set_config('request.jwt.claims', c1, true);
  PERFORM set_config('request.jwt.claim.sub', c2, true);
  PERFORM set_config('request.jwt.claim.role', c3, true);
  RETURN v;
END $$;

-- Écrit une colonne datée en passant les déclencheurs (dater dans le passé).
-- updated_at : son déclencheur est coupé le temps de l'écriture.
CREATE FUNCTION pg_temp.cr_force(p_id uuid, p_col text, p_val timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_col = 'updated_at' THEN
    ALTER TABLE public.job_candidate_status DISABLE TRIGGER update_job_candidate_status_updated_at;
  END IF;
  PERFORM set_config('konekt.stage_write', '*', true);
  EXECUTE format('UPDATE public.job_candidate_status SET %I = $1 WHERE id = $2', p_col) USING p_val, p_id;
  PERFORM set_config('konekt.stage_write', '', true);
  IF p_col = 'updated_at' THEN
    ALTER TABLE public.job_candidate_status ENABLE TRIGGER update_job_candidate_status_updated_at;
  END IF;
END $$;

-- set_candidate_stage appelée par le serveur (sans jeton, organisation O1 ou
-- donnée) : rend la réponse, ou l'erreur (état, indice).
CREATE FUNCTION pg_temp.cr_set(p_id uuid, p_stage text, p_source text, p_org uuid,
                               p_step uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
  v_hint text;
BEGIN
  PERFORM pg_temp.cr_as(NULL);
  RETURN public.set_candidate_stage(p_id, p_stage, p_source, p_org, p_step, NULL);
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
  RETURN jsonb_build_object('error', v_state, 'hint', v_hint);
END $$;

-- Ligne canonique d'un candidat dans une mission : étape/origine/taille du groupe/jamais ouvert.
CREATE FUNCTION pg_temp.cr_v(p_proj uuid, p_cand text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT string_agg(c.general_stage || '/' || coalesce(c.decision_source, '-') || '/' || c.group_size || '/'
                    || c.is_unopened, ';' ORDER BY c.id)
    FROM public.mission_candidate_rows c WHERE c.project_id = p_proj AND c.candidate_id = p_cand
$$;

-- État d'avant d'une ligne, tel que le navigateur le lit juste avant un geste.
CREATE FUNCTION pg_temp.cr_before(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'general_stage', j.general_stage, 'process_step_id', j.process_step_id,
    'legacy_stage', CASE WHEN j.general_stage = 'interviewing' AND j.process_step_id IS NULL
                          AND j.pipeline_stage IN ('Pré-qualif','ITW en cours','Offre','CV envoyé')
                         THEN j.pipeline_stage END,
    'stage_entered_at', j.stage_entered_at, 'decision_source', j.decision_source,
    'rejected_at', j.rejected_at, 'rejected_from_stage', j.rejected_from_stage,
    'presented_at', j.presented_at)
    FROM public.job_candidate_status j WHERE j.id = p_id
$$;

-- Élément d'annulation : ligne, date d'entrée rendue par le geste, état d'avant.
CREATE FUNCTION pg_temp.cr_move(p_id uuid, p_rows jsonb, p_before jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object('id', p_id,
    'after_entered_at', (SELECT e->>'stage_entered_at' FROM jsonb_array_elements(p_rows) e
                          WHERE e->>'id' = p_id::text LIMIT 1),
    'before', p_before)
$$;

-- Résultat d'une ligne dans la réponse d'undo_candidate_stages.
CREATE FUNCTION pg_temp.cr_res(p_out jsonb, p_id uuid) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT (SELECT coalesce(e->>'result', '?') || coalesce('/' || (e->>'hint'), '')
            FROM jsonb_array_elements(p_out -> 'rows') e WHERE e->>'id' = p_id::text LIMIT 1)
$$;

-- Jalons d'une ligne : contact/réponse/entretien/présentation/embauche (x = posé, - = vide).
CREATE FUNCTION pg_temp.cr_jal(p_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN j.contacted_at IS NULL THEN '-' ELSE 'x' END || CASE WHEN j.replied_at IS NULL THEN '-' ELSE 'x' END
      || CASE WHEN j.first_interview_at IS NULL THEN '-' ELSE 'x' END || CASE WHEN j.presented_at IS NULL THEN '-' ELSE 'x' END
      || CASE WHEN j.hired_at IS NULL THEN '-' ELSE 'x' END
    FROM public.job_candidate_status j WHERE j.id = p_id
$$;

CREATE FUNCTION pg_temp.cr_ct(p_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT ctid::text FROM public.job_candidate_status WHERE id = p_id $$;

-- Appels HTTP d'indexation en file d'attente de pg_net pour une table (NULL si
-- pg_net manque). Les clés d'appel posées avant les applications de la
-- migration visent cette adresse, jamais servie ; seules ces lignes, non
-- validées, sont comptées (champ « table » du corps).
CREATE FUNCTION pg_temp.cr_http(p_table text) RETURNS integer
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
                 'http://127.0.0.1:9/cr-audit/%', coalesce(v_body, 'NULL::text'), p_table) INTO n;
  RETURN n;
END $$;


-- ===== Montage, S (structure et droits) =====
DO $$
DECLARE
  u_a uuid := pg_temp.cr_id('u_a'); u_b uuid := pg_temp.cr_id('u_b'); u_c uuid := pg_temp.cr_id('u_c');
  o1 uuid := pg_temp.cr_id('o1'); o2 uuid := pg_temp.cr_id('o2');
  sig_cnt text := 'public.get_mission_stage_counts(uuid[])';
  sig_undo text := 'public.undo_candidate_stages(jsonb)';
  sig_send text := 'public.candidate_mission_sends(uuid, uuid, jsonb)';
  sig_purge text := 'public.rgpd_purge_candidate_rows(timestamptz, timestamptz, boolean, integer)';
  sig_rms text := 'public.recompute_mission_stats(uuid[])';
  got text;
  n integer;
  failures text := '';
BEGIN
  -- ===== Jeu de données (sans jeton) =====
  PERFORM pg_temp.cr_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@readers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@readers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@readers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Readers Org 1', 'readers-org-1', u_a), (o2, 'Readers Org 2', 'readers-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur de création.
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner' OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (o1, u_b, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (u_a, o1), (u_b, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (pg_temp.cr_id('m1'), 'Mission M1', o1, u_a), (pg_temp.cr_id('m2'), 'Mission M2', o1, u_a),
         (pg_temp.cr_id('m3'), 'Mission M3', o1, u_a), (pg_temp.cr_id('m4'), 'Mission M4', o1, u_a),
         (pg_temp.cr_id('m5'), 'Mission M5', o1, u_a), (pg_temp.cr_id('m6'), 'Mission M6', o1, u_a),
         (pg_temp.cr_id('mc'), 'Mission MC', o1, u_a), (pg_temp.cr_id('m9'), 'Mission M9', o2, u_c);
  INSERT INTO public.mission_process_steps (id, project_id, organization_id, step_order, name)
  VALUES (pg_temp.cr_id('s3'), pg_temp.cr_id('m3'), o1, 1, 'Entretien M3'),
         (pg_temp.cr_id('s5'), pg_temp.cr_id('m5'), o1, 1, 'Entretien M5'),
         (pg_temp.cr_id('sc1'), pg_temp.cr_id('mc'), o1, 1, 'Entretien RH'),
         (pg_temp.cr_id('sc2'), pg_temp.cr_id('mc'), o1, 2, 'Entretien client');
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_a, 'cr-acc-a', u_a);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, project_id, is_active)
  VALUES (pg_temp.cr_id('q1'), 'Séquence M1', o1, u_a, pg_temp.cr_id('m1'), true);

  -- ===== S. Structure et droits (catalogues seulement) =====
  -- S1. Vue présente, en security_invoker.
  SELECT count(*) INTO n FROM pg_class c
   WHERE c.oid = to_regclass('public.mission_candidate_rows') AND c.relkind = 'v'
     AND c.reloptions @> ARRAY['security_invoker=true'];
  failures := failures || pg_temp.cr_eq('S1 vue en security_invoker', n, 1);

  -- S2. Colonnes de la vue, dans l'ordre.
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO got
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.mission_candidate_rows') AND a.attnum > 0 AND NOT a.attisdropped;
  failures := failures || pg_temp.cr_eq('S2 colonnes de la vue', got,
    'id,organization_id,project_id,candidate_id,job_id,created_by,candidate_name,candidate_headline,'
    'linkedin_profile_url,linkedin_profile_data,status,pipeline_stage,general_stage,process_step_id,'
    'stage_entered_at,decision_source,score,recommendation,scoring_details,skip_reason,reply_summary,tags,'
    'rejected_at,rejected_from_stage,contacted_at,replied_at,first_interview_at,presented_at,hired_at,'
    'created_at,updated_at,mission_name,mission_kind,is_unopened,group_ids,group_size');

  -- S3. Droits sur la vue : anon rien ; authenticated et service_role lecture seule ; PUBLIC rien.
  SELECT string_agg(r.rol || ':' || p.priv, ',' ORDER BY r.rol, p.priv) INTO got
    FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
   WHERE has_table_privilege(r.rol, 'public.mission_candidate_rows', p.priv);
  failures := failures || pg_temp.cr_eq('S3 droits sur la vue', got, 'authenticated:SELECT,service_role:SELECT');
  SELECT count(*) INTO n FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = to_regclass('public.mission_candidate_rows') AND a.grantee = 0;
  failures := failures || pg_temp.cr_eq('S3 droits de PUBLIC sur la vue', n, 0);

  -- S4. Droits des fonctions (exécutables par) ; aucune n'est à PUBLIC.
  SELECT string_agg(f.sig || '=' || coalesce(f.roles, '-'), ' ; ' ORDER BY f.sig) INTO got FROM (
    SELECT s.sig, (SELECT string_agg(r.rol, ',' ORDER BY r.rol)
                     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(rol)
                    WHERE has_function_privilege(r.rol, s.sig, 'EXECUTE')) AS roles
      FROM unnest(ARRAY[sig_cnt, sig_undo, sig_send, sig_purge, sig_rms]) s(sig)) f;
  failures := failures || pg_temp.cr_eq('S4 droits des fonctions', got,
    'public.candidate_mission_sends(uuid, uuid, jsonb)=service_role ; '
    'public.get_mission_stage_counts(uuid[])=authenticated,service_role ; '
    'public.recompute_mission_stats(uuid[])=service_role ; '
    'public.rgpd_purge_candidate_rows(timestamptz, timestamptz, boolean, integer)=service_role ; '
    'public.undo_candidate_stages(jsonb)=authenticated');
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO got FROM pg_proc p
   WHERE p.oid IN (to_regprocedure(sig_cnt), to_regprocedure(sig_undo), to_regprocedure(sig_send),
                   to_regprocedure(sig_purge), to_regprocedure(sig_rms))
     AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0));
  failures := failures || pg_temp.cr_eq('S4 fonctions exécutables par PUBLIC', got, NULL::text);

  -- S5. Aucune fonction SECURITY DEFINER nouvelle ; recompute_mission_stats reste
  --     DEFINER (elle compte en propriétaire) ; get_mission_stage_counts est STABLE.
  SELECT string_agg(p.proname || '=' || p.prosecdef::text || '/' || p.provolatile::text, ',' ORDER BY p.proname) INTO got
    FROM pg_proc p
   WHERE p.oid IN (to_regprocedure(sig_cnt), to_regprocedure(sig_undo), to_regprocedure(sig_send),
                   to_regprocedure(sig_purge), to_regprocedure(sig_rms));
  failures := failures || pg_temp.cr_eq('S5 SECURITY DEFINER / volatilité', got,
    'candidate_mission_sends=false/s,get_mission_stage_counts=false/s,recompute_mission_stats=true/v,'
    'rgpd_purge_candidate_rows=false/v,undo_candidate_stages=false/v');

  -- S6. Lectures de la vue sous la RLS de l'appelant : authenticated lit les tables sources.
  SELECT string_agg(t.tbl, ',') INTO got
    FROM unnest(ARRAY['public.job_candidate_status', 'public.sourcing_projects', 'public.sequence_enrollments',
                      'public.outreach_sequences', 'public.inmail_queue']) t(tbl)
   WHERE NOT has_table_privilege('authenticated', t.tbl, 'SELECT');
  failures := failures || pg_temp.cr_eq('S6 tables sources illisibles par authenticated', got, NULL::text);

  -- S7. Le déclencheur des compteurs suit l'étape (définition du lot 0c).
  IF position('general_stage' IN pg_get_functiondef('public.trg_sync_mission_stats()'::regprocedure)) = 0
     OR position('get_mission_stage_counts' IN pg_get_functiondef(sig_rms::regprocedure)) = 0 THEN
    failures := failures || '[S7 compteurs de mission encore sur les définitions du lot 0a] ';
  END IF;

  INSERT INTO cr_fail SELECT 'S', failures WHERE failures <> '';
END $$;


-- ===== V (ligne canonique), C (comptages), St (compteurs) =====
DO $$
DECLARE
  u_a uuid := pg_temp.cr_id('u_a'); u_b uuid := pg_temp.cr_id('u_b'); u_c uuid := pg_temp.cr_id('u_c');
  o1 uuid := pg_temp.cr_id('o1'); o2 uuid := pg_temp.cr_id('o2');
  m1 uuid := pg_temp.cr_id('m1'); m2 uuid := pg_temp.cr_id('m2'); m3 uuid := pg_temp.cr_id('m3');
  m4 uuid := pg_temp.cr_id('m4'); mc uuid := pg_temp.cr_id('mc'); m9 uuid := pg_temp.cr_id('m9');
  sc1 uuid := pg_temp.cr_id('sc1'); sc2 uuid := pg_temp.cr_id('sc2');
  sig_cnt text := 'public.get_mission_stage_counts(uuid[])';
  a uuid; b uuid; x uuid;
  v jsonb;
  got text; want text;
  n integer;
  ct text;
  t0 timestamptz := now() - interval '20 days';
  t1 timestamptz := now() - interval '10 days';
  t2 timestamptz := now() - interval '2 days';
  failures text := '';
BEGIN
  PERFORM pg_temp.cr_as(NULL);

  -- ===== V. Ligne canonique (M1 sans étape, sauf mention) =====
  -- V1. Deux auteurs, même forme, deux lignes trouvées : une ligne, groupe de 2, jamais ouverte.
  PERFORM pg_temp.cr_row(m1, 'V1', 'discovered', p_by => u_a);
  PERFORM pg_temp.cr_row(m1, 'V1', 'discovered', p_by => u_b);
  failures := failures || pg_temp.cr_eq('V1 deux auteurs', pg_temp.cr_v(m1, 'V1'), 'to_sort/-/2/true');

  -- V2. Deux formes de job_id (project:<uuid> et <uuid>) : une ligne, la forme project: à égalité.
  PERFORM pg_temp.cr_row(m1, 'V2', 'discovered', p_by => u_a, p_job => m1::text);
  PERFORM pg_temp.cr_row(m1, 'V2', 'discovered', p_by => u_a);
  SELECT string_agg(c.job_id || '/' || c.group_size, ';') INTO got
    FROM public.mission_candidate_rows c WHERE c.project_id = m1 AND c.candidate_id = 'V2';
  failures := failures || pg_temp.cr_eq('V2 deux formes', got, 'project:' || m1 || '/2');

  -- V3 (C1). Ligne en entretien et doublon À trier, puis un envoi Konekt (Contacté
  --     en origine system sur les deux) : le doublon passe Contacté, la vue rend
  --     toujours En entretien.
  a := pg_temp.cr_row(m3, 'V3', 'shortlisted', pg_temp.cr_id('s3')::text, p_by => u_a);
  b := pg_temp.cr_row(m3, 'V3', 'discovered', p_by => u_b);
  PERFORM pg_temp.cr_as(NULL, 'service_role');
  v := public.record_candidate_outbound(o1, 'cr-acc-a', jsonb_build_object('ids', jsonb_build_array('V3')),
                                        'manual', m3);
  PERFORM pg_temp.cr_as(NULL);
  SELECT j.general_stage INTO got FROM public.job_candidate_status j WHERE j.id = b;
  failures := failures || pg_temp.cr_eq('V3 doublon contacté', got, 'contacted')
                       || pg_temp.cr_eq('V3 vue', pg_temp.cr_v(m3, 'V3'), 'interviewing/user/2/false');
  SELECT (c.contacted_at IS NOT NULL)::text INTO got FROM public.mission_candidate_rows c
   WHERE c.project_id = m3 AND c.candidate_id = 'V3';
  failures := failures || pg_temp.cr_eq('V3 jalon du groupe', got, 'true');

  -- V4 (C1). Contacté ancien (système) contre Retenu récent (personne) : Contacté.
  a := pg_temp.cr_row(m1, 'V4', 'discovered', p_by => u_a);
  v := pg_temp.cr_set(a, 'contacted', 'system', o1);
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', t0);
  b := pg_temp.cr_row(m1, 'V4', 'discovered', p_by => u_b);
  v := pg_temp.cr_set(b, 'retained', 'user', o1);
  PERFORM pg_temp.cr_force(b, 'stage_entered_at', t2);
  failures := failures || pg_temp.cr_eq('V4 contacté contre retenu', pg_temp.cr_v(m1, 'V4'), 'contacted/system/2/false');

  -- V5. A Contacté (t1), B écarté par une personne (t2), sa dernière décision : Écarté.
  a := pg_temp.cr_row(m1, 'V5', 'discovered', p_by => u_a);
  v := pg_temp.cr_set(a, 'contacted', 'system', o1);
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', t1);
  b := pg_temp.cr_row(m1, 'V5', 'discovered', p_by => u_b);
  v := pg_temp.cr_set(b, 'rejected', 'user', o1);
  PERFORM pg_temp.cr_force(b, 'stage_entered_at', t2);
  PERFORM pg_temp.cr_force(b, 'rejected_at', t2);
  failures := failures || pg_temp.cr_eq('V5 écart d''une personne, dernière décision', pg_temp.cr_v(m1, 'V5'), 'rejected/user/2/false');

  -- V6. A Retenu par une personne (t2), B écarté par une personne (t1) : Retenu.
  a := pg_temp.cr_row(m1, 'V6', 'discovered', p_by => u_a);
  v := pg_temp.cr_set(a, 'retained', 'user', o1);
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', t2);
  b := pg_temp.cr_row(m1, 'V6', 'discovered', p_by => u_b);
  v := pg_temp.cr_set(b, 'rejected', 'user', o1);
  PERFORM pg_temp.cr_force(b, 'stage_entered_at', t1);
  failures := failures || pg_temp.cr_eq('V6 écart plus ancien qu''une retenue', pg_temp.cr_v(m1, 'V6'), 'retained/user/2/false');

  -- V7. Écart de l'IA contre Contacté : Contacté ; contre À trier : Écarté.
  a := pg_temp.cr_row(m1, 'V7a', 'scored', NULL, 40, 'NO_MATCH', p_by => u_a);
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = a;
  b := pg_temp.cr_row(m1, 'V7a', 'discovered', p_by => u_b);
  v := pg_temp.cr_set(b, 'contacted', 'system', o1);
  failures := failures || pg_temp.cr_eq('V7 IA contre contacté', pg_temp.cr_v(m1, 'V7a'), 'contacted/system/2/false');
  a := pg_temp.cr_row(m1, 'V7b', 'scored', NULL, 40, 'NO_MATCH', p_by => u_a);
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = a;
  PERFORM pg_temp.cr_row(m1, 'V7b', 'discovered', p_by => u_b);
  failures := failures || pg_temp.cr_eq('V7 IA contre à trier', pg_temp.cr_v(m1, 'V7b'), 'rejected/ai/2/false');

  -- V8 (C7). Doublon noté, ligne canonique Retenue sans note : la vue rend la note du groupe.
  PERFORM pg_temp.cr_row(m1, 'V8', 'shortlisted', p_by => u_a);
  PERFORM pg_temp.cr_row(m1, 'V8', 'scored', NULL, 70, 'GOOD_MATCH', p_by => u_b);
  SELECT string_agg(c.general_stage || '/' || c.score || '/' || c.recommendation, ';') INTO got
    FROM public.mission_candidate_rows c WHERE c.project_id = m1 AND c.candidate_id = 'V8';
  failures := failures || pg_temp.cr_eq('V8 note du groupe', got, 'retained/70/GOOD_MATCH');

  -- V9. À trier noté contre jamais ouvert : le noté, pas jamais ouvert.
  PERFORM pg_temp.cr_row(m1, 'V9', 'discovered', p_by => u_a);
  b := pg_temp.cr_row(m1, 'V9', 'scored', NULL, 70, p_by => u_b);
  SELECT string_agg((c.id = b)::text || '/' || c.is_unopened, ';') INTO got
    FROM public.mission_candidate_rows c WHERE c.project_id = m1 AND c.candidate_id = 'V9';
  failures := failures || pg_temp.cr_eq('V9 noté contre trouvé', got, 'true/false');

  -- V10. Restauré (écarté puis remis À trier par une personne) : pas jamais ouvert.
  a := pg_temp.cr_row(m1, 'V10', 'discovered', p_by => u_a);
  v := pg_temp.cr_set(a, 'rejected', 'user', o1);
  v := pg_temp.cr_set(a, 'to_sort', 'user', o1);
  failures := failures || pg_temp.cr_eq('V10 restauré', pg_temp.cr_v(m1, 'V10'), 'to_sort/user/1/false');

  -- V11 (E4). Trouvé et inscrit à une séquence sans étape posée : pas jamais ouvert.
  --      Trouvé et visé par un InMail programmé : pas jamais ouvert.
  PERFORM pg_temp.cr_row(m1, 'V11a', 'discovered', p_by => u_a);
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status,
                                           current_step_order)
  VALUES (pg_temp.cr_id('e1'), pg_temp.cr_id('q1'), 'cr-acc-a', 'V11a', o1, u_a, 'active', 0);
  PERFORM pg_temp.cr_row(m1, 'V11b', 'discovered', p_by => u_a);
  INSERT INTO public.inmail_queue (account_id, created_by, message, subject, recipient_profile_id, status,
                                   organization_id, project_id)
  VALUES ('cr-acc-a', u_a, 'Bonjour', 'Poste', 'V11b', 'scheduled', o1, m1);
  failures := failures || pg_temp.cr_eq('V11 inscrit', pg_temp.cr_v(m1, 'V11a'), 'to_sort/-/1/false')
                       || pg_temp.cr_eq('V11 InMail programmé', pg_temp.cr_v(m1, 'V11b'), 'to_sort/-/1/false');

  -- V12. Jalons : le plus ancien du groupe.
  a := pg_temp.cr_row(m1, 'V12', 'discovered', p_by => u_a);
  v := pg_temp.cr_set(a, 'contacted', 'system', o1);
  PERFORM pg_temp.cr_force(a, 'contacted_at', t1);
  b := pg_temp.cr_row(m1, 'V12', 'discovered', p_by => u_b);
  v := pg_temp.cr_set(b, 'contacted', 'system', o1);
  PERFORM pg_temp.cr_force(b, 'contacted_at', t2);
  SELECT string_agg((c.contacted_at = t1)::text, ';') INTO got
    FROM public.mission_candidate_rows c WHERE c.project_id = m1 AND c.candidate_id = 'V12';
  failures := failures || pg_temp.cr_eq('V12 jalon le plus ancien', got, 'true');

  -- V13. Ligne de O2 rattachée à M1 (mission de O1) : absente de la vue.
  PERFORM pg_temp.cr_row(m1, 'V13', 'discovered', p_by => u_c, p_org => o2);
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE project_id = m1 AND candidate_id = 'V13';
  failures := failures || pg_temp.cr_eq('V13 montage', n, 1)
                       || pg_temp.cr_eq('V13 ligne d''une autre organisation', pg_temp.cr_v(m1, 'V13'), NULL::text);

  -- V14. Membre de O1 (RLS) : aucune ligne de O2 ; ses lignes de M1, comme en propriétaire.
  PERFORM pg_temp.cr_row(m9, 'V14', 'shortlisted', p_by => u_c);
  SELECT count(*)::text INTO want FROM public.mission_candidate_rows WHERE project_id = m1;
  IF has_table_privilege('authenticated', 'public.mission_candidate_rows', 'SELECT') THEN
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.mission_candidate_rows WHERE organization_id = o2;
    SELECT count(*)::text INTO got FROM public.mission_candidate_rows WHERE project_id = m1;
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    failures := failures || pg_temp.cr_eq('V14 lignes de O2 lues par un membre de O1', n, 0)
                         || pg_temp.cr_eq('V14 lignes de M1 lues par un membre de O1', got, want);
  ELSE
    failures := failures || '[V14 authenticated ne lit pas la vue] ';
  END IF;

  -- ===== C. get_mission_stage_counts (MC : étapes SC1, SC2) =====
  PERFORM pg_temp.cr_row(mc, 'C-u1', 'discovered');
  PERFORM pg_temp.cr_row(mc, 'C-u2', 'discovered');
  PERFORM pg_temp.cr_row(mc, 'C-ts', 'scored', NULL, 60);
  PERFORM pg_temp.cr_row(mc, 'C-ret', 'shortlisted', p_by => u_a);
  PERFORM pg_temp.cr_row(mc, 'C-ret', 'discovered', p_by => u_b);          -- doublon, compté une fois
  x := pg_temp.cr_row(mc, 'C-con', 'messaged');
  PERFORM pg_temp.cr_force(x, 'contacted_at', NULL);                        -- Contacté sans jalon (reprise)
  PERFORM pg_temp.cr_row(mc, 'C-rep', 'replied');
  PERFORM pg_temp.cr_row(mc, 'C-i1', 'shortlisted', sc1::text);
  PERFORM pg_temp.cr_row(mc, 'C-i2', 'shortlisted', sc2::text);
  PERFORM pg_temp.cr_row(mc, 'C-i0', 'shortlisted', 'CV envoyé');
  PERFORM pg_temp.cr_row(mc, 'C-hir', 'shortlisted', 'hired');
  x := pg_temp.cr_row(mc, 'C-rej', 'shortlisted');
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = x;  -- écarté depuis Retenu (C5)
  PERFORM pg_temp.cr_row(mc, 'C-o2', 'shortlisted', p_by => u_c, p_org => o2);  -- autre organisation
  SELECT format('%s,%s,%s,%s,%s,%s,%s,%s|%s|%s|%s,%s,%s,%s,%s,%s|%s|%s',
                c.unopened, c.to_sort, c.retained, c.contacted, c.replied, c.interviewing, c.hired, c.rejected,
                (c.interviewing_by_step = jsonb_build_object(sc1::text, 1, sc2::text, 1, 'none', 1)),
                c.scored, c.ever_retained, c.ever_contacted, c.ever_replied, c.ever_interviewed, c.ever_presented,
                c.ever_hired, c.triaged_by_user, (c.last_stage_move_at = now()))
    INTO got FROM public.get_mission_stage_counts(ARRAY[mc]) c;
  -- effectifs (jamais ouverts, À trier, Retenu, Contacté, A répondu, En entretien,
  -- Embauché, Écarté) | par étape | notés | cumuls (retenus, contactés, ont
  -- répondu, entretiens, présentés, embauchés) | décidés par une personne | dernier mouvement
  failures := failures || pg_temp.cr_eq('C1 comptage de MC', got, '2,1,1,1,1,3,1,1|t|1|8,6,5,4,1,1|6|t');

  -- C2. Mission sans candidat : une ligne à zéros.
  SELECT count(*)::text || ':' || string_agg(format('%s/%s/%s/%s', c.unopened + c.to_sort + c.rejected, c.ever_contacted,
                                                     c.interviewing_by_step, coalesce(c.last_stage_move_at::text, '-')), ';')
    INTO got FROM public.get_mission_stage_counts(ARRAY[m2]) c;
  failures := failures || pg_temp.cr_eq('C2 mission vide', got, '1:0/0/{}/-');

  -- C3. Appel en membre : même résultat pour MC ; aucune ligne pour M9 de O2 (C10),
  --     même visible par l'équipe de mission ; mission inconnue : aucune ligne.
  BEGIN
    INSERT INTO public.mission_team (project_id, user_id, role) VALUES (m9, u_a, 'freelance');
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'candidate_stage_readers_audit : C3, équipe de M9 non montée (%)', SQLERRM;
  END;
  SELECT string_agg(format('%s:%s,%s,%s', c.project_id = mc, c.unopened, c.ever_contacted, c.interviewing_by_step), ';')
    INTO want FROM public.get_mission_stage_counts(ARRAY[mc]) c;
  IF has_function_privilege('authenticated', sig_cnt, 'EXECUTE') THEN
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.sourcing_projects WHERE id = m9;
    SELECT string_agg(format('%s:%s,%s,%s', c.project_id = mc, c.unopened, c.ever_contacted, c.interviewing_by_step), ';')
      INTO got FROM public.get_mission_stage_counts(ARRAY[mc, m9, gen_random_uuid()]) c;
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    failures := failures || pg_temp.cr_eq('C3 membre : MC seule', got, want);
    IF n = 0 THEN
      RAISE NOTICE 'candidate_stage_readers_audit : C3, M9 invisible pour u_a (contrôle C10 affaibli)';
    END IF;
  ELSE
    failures := failures || '[C3 authenticated n''exécute pas get_mission_stage_counts] ';
  END IF;
  -- C4. Clé de service : M9 rendue, avec sa ligne.
  IF has_function_privilege('service_role', sig_cnt, 'EXECUTE') THEN
    PERFORM pg_temp.cr_as(NULL, 'service_role');
    SET LOCAL ROLE service_role;
    SELECT string_agg(c.retained::text, ',') INTO got FROM public.get_mission_stage_counts(ARRAY[m9]) c;
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    failures := failures || pg_temp.cr_eq('C4 service_role : M9', got, '1');
  ELSE
    failures := failures || '[C4 service_role n''exécute pas get_mission_stage_counts] ';
  END IF;

  -- ===== St. Compteurs stats_* (M4, sans étape) =====
  -- total_found, scored, messaged (contactés au total), dismissed, shortlisted (retenus au total).
  a := pg_temp.cr_row(m4, 'St-a', 'discovered', p_by => u_a);
  b := pg_temp.cr_row(m4, 'St-b', 'shortlisted', p_by => u_a);
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted]::text INTO got
    FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('St1 montage', got, '{2,0,0,0,1}');
  PERFORM pg_temp.cr_row(m4, 'St-b', 'discovered', p_by => u_b);          -- doublon de B
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted]::text INTO got
    FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('St2 doublon', got, '{2,0,0,0,1}');
  v := pg_temp.cr_set(a, 'retained', 'user', o1);
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted]::text INTO got
    FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('St3 À trier vers Retenu', got, '{2,0,0,0,2}');
  v := pg_temp.cr_set(a, 'contacted', 'user', o1);
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted]::text INTO got
    FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('St4 Retenu vers Contacté', got, '{2,0,1,0,2}');
  v := pg_temp.cr_set(b, 'rejected', 'user', o1);
  SELECT ARRAY[stats_total_found, stats_scored, stats_messaged, stats_dismissed, stats_shortlisted]::text INTO got
    FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('St5 Retenu vers Écarté (retenus au total inchangé)', got, '{2,0,1,1,2}');
  SELECT ctid::text INTO ct FROM public.sourcing_projects WHERE id = m4;
  PERFORM public.recompute_mission_stats(ARRAY[m4]);
  SELECT ctid::text INTO got FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('St6 recalcul sans changement réécrit la mission', got, ct);

  INSERT INTO cr_fail SELECT 'VCSt', failures WHERE failures <> '';
END $$;


-- ===== U (annulation), I (preuve d'envoi), P (purge) =====
DO $$
DECLARE
  u_a uuid := pg_temp.cr_id('u_a'); u_b uuid := pg_temp.cr_id('u_b'); u_c uuid := pg_temp.cr_id('u_c');
  o1 uuid := pg_temp.cr_id('o1');
  m1 uuid := pg_temp.cr_id('m1'); m5 uuid := pg_temp.cr_id('m5'); m6 uuid := pg_temp.cr_id('m6');
  m9 uuid := pg_temp.cr_id('m9'); s5 uuid := pg_temp.cr_id('s5');
  sig_undo text := 'public.undo_candidate_stages(jsonb)';
  sig_sets text := 'public.set_candidate_stages(uuid[], text, text, uuid, uuid, text, text[])';
  sig_purge text := 'public.rgpd_purge_candidate_rows(timestamptz, timestamptz, boolean, integer)';
  t_b timestamptz := now() - interval '5 days';
  t_0 timestamptz := now() - interval '30 days';
  t_r timestamptz := now() - interval '8 days';
  t_g timestamptz := now() - interval '1 hour';
  a uuid; b uuid; x uuid; y uuid;
  bf_a jsonb; bf_b jsonb; bf_x jsonb; bf_y jsonb;
  g jsonb; u jsonb; v jsonb; mv jsonb;
  ct_a text; ct_x text;
  got text; want text;
  n integer;
  line text;
  v_seen_window boolean := false;
  v_pushed boolean := false;
  failures text := '';
BEGIN
  PERFORM pg_temp.cr_as(NULL);

  -- ===== U. undo_candidate_stages (u_a, navigateur) =====
  IF NOT (has_function_privilege('authenticated', sig_undo, 'EXECUTE')
          AND has_function_privilege('authenticated', sig_sets, 'EXECUTE')
          AND has_table_privilege('authenticated', 'public.job_candidate_status', 'UPDATE')) THEN
    failures := failures || '[U droits de authenticated incomplets : bloc U non joué] ';
  ELSE
    -- Montage (serveur) : états d'avant datés dans le passé.
    -- U1 : À trier (M6), sans origine.
    x := pg_temp.cr_row(m6, 'U1', 'discovered', p_by => u_a);
    PERFORM pg_temp.cr_force(x, 'stage_entered_at', t_b);
    -- U2 : Contacté (t_0) par une personne, contacted_at t_0.
    y := pg_temp.cr_row(m6, 'U2', 'discovered', p_by => u_a);
    v := pg_temp.cr_set(y, 'contacted', 'user', o1);
    PERFORM pg_temp.cr_force(y, 'contacted_at', t_0);
    PERFORM pg_temp.cr_force(y, 'stage_entered_at', t_0);
    bf_x := pg_temp.cr_before(x);
    bf_y := pg_temp.cr_before(y);

    -- U1. À trier vers A répondu, annulé : À trier, jalons vides, date et origine d'avant.
    -- U2. Contacté vers Écarté, annulé : Contacté, contacted_at t_0, écart d'avant rendu (aucun).
    --     Aucune fonction pg_temp n'est appelée sous SET ROLE authenticated.
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[x], 'replied', 'user');
    RESET ROLE;
    mv := jsonb_build_array(pg_temp.cr_move(x, g, bf_x));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    g := public.set_candidate_stages(ARRAY[y], 'rejected', 'user');
    RESET ROLE;
    got := pg_temp.cr_res(u, x);
    mv := jsonb_build_array(pg_temp.cr_move(y, g, bf_y));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    want := pg_temp.cr_res(u, y);
    SELECT got || '|' || j.general_stage || '/' || coalesce(j.decision_source, '-') || '/' || (j.stage_entered_at = t_b)
           || '/' || pg_temp.cr_jal(j.id) || '/' || coalesce(j.rejected_at::text, '-')
      INTO got FROM public.job_candidate_status j WHERE j.id = x;
    failures := failures || pg_temp.cr_eq('U1 À trier vers A répondu, annulé', got, 'updated|to_sort/-/true/-----/-');
    SELECT want || '|' || j.general_stage || '/' || j.decision_source || '/' || (j.stage_entered_at = t_0) || '/'
           || (j.contacted_at = t_0) || '/' || pg_temp.cr_jal(j.id) || '/' || coalesce(j.rejected_at::text, '-')
           || '/' || coalesce(j.rejected_from_stage, '-')
      INTO got FROM public.job_candidate_status j WHERE j.id = y;
    failures := failures || pg_temp.cr_eq('U2 Contacté vers Écarté, annulé', got, 'updated|contacted/user/true/true/x----/-/-');

    -- U3 (C2). Geste groupé : X déjà Contacté (unchanged, jalon t_0), Y À trier.
    x := pg_temp.cr_row(m6, 'U3', 'discovered', p_by => u_a);
    v := pg_temp.cr_set(x, 'contacted', 'user', o1);
    PERFORM pg_temp.cr_force(x, 'contacted_at', t_0);
    PERFORM pg_temp.cr_force(x, 'stage_entered_at', t_0);
    y := pg_temp.cr_row(m6, 'U3', 'discovered', p_by => u_b);
    PERFORM pg_temp.cr_force(y, 'stage_entered_at', t_b);
    bf_x := pg_temp.cr_before(x);
    bf_y := pg_temp.cr_before(y);
    ct_x := pg_temp.cr_ct(x);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[x, y], 'contacted', 'user');
    RESET ROLE;
    -- Le navigateur n'envoie que les lignes changées par le geste.
    mv := jsonb_build_array(pg_temp.cr_move(y, g, bf_y));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    got := (SELECT e->>'result' FROM jsonb_array_elements(g) e WHERE e->>'id' = x::text) || '|' || pg_temp.cr_res(u, y);
    SELECT got || '|' || (pg_temp.cr_ct(x) = ct_x) || '/' || (j.contacted_at = t_0) INTO got
      FROM public.job_candidate_status j WHERE j.id = x;
    SELECT got || '|' || j.general_stage || '/' || pg_temp.cr_jal(j.id) || '/' || (j.stage_entered_at = t_b) INTO got
      FROM public.job_candidate_status j WHERE j.id = y;
    failures := failures || pg_temp.cr_eq('U3 geste groupé, ligne non envoyée', got,
                                          'unchanged|updated|true/true|to_sort/-----/true');
    -- Envoyée quand même (date d'entrée inchangée, déjà à l'étape d'avant) : unchanged, rien d'écrit.
    mv := jsonb_build_array(jsonb_build_object('id', x, 'after_entered_at', bf_x->>'stage_entered_at', 'before', bf_x));
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    failures := failures || pg_temp.cr_eq('U3 ligne envoyée quand même', pg_temp.cr_res(u, x) || '/' || (pg_temp.cr_ct(x) = ct_x),
                                          'unchanged/true');

    -- U4 (C3, C11). Groupe {En entretien S5 (personne), écarté par l'IA (t_r)} vers
    --     Embauché, annulé : chaque ligne retrouve son étape ; l'écart garde
    --     l'origine ai, sa date et son étape quittée ; jalons du geste effacés.
    a := pg_temp.cr_row(m5, 'U4', 'shortlisted', s5::text, p_by => u_a);
    PERFORM pg_temp.cr_force(a, 'stage_entered_at', t_b);
    b := pg_temp.cr_row(m5, 'U4', 'scored', NULL, 40, 'NO_MATCH', p_by => u_b);
    UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = b;
    PERFORM pg_temp.cr_force(b, 'rejected_at', t_r);
    PERFORM pg_temp.cr_force(b, 'stage_entered_at', t_r);
    bf_a := pg_temp.cr_before(a);
    bf_b := pg_temp.cr_before(b);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[a, b], 'hired', 'user');
    RESET ROLE;
    mv := jsonb_build_array(pg_temp.cr_move(a, g, bf_a), pg_temp.cr_move(b, g, bf_b));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    got := pg_temp.cr_res(u, a) || '/' || pg_temp.cr_res(u, b);
    SELECT got || '|' || j.general_stage || '/' || (j.process_step_id = s5) || '/' || j.decision_source || '/'
           || (j.stage_entered_at = t_b) || '/' || pg_temp.cr_jal(j.id)
      INTO got FROM public.job_candidate_status j WHERE j.id = a;
    SELECT got || '|' || j.general_stage || '/' || j.decision_source || '/' || (j.stage_entered_at = t_r) || '/'
           || (j.rejected_at = t_r) || '/' || j.rejected_from_stage || '/' || pg_temp.cr_jal(j.id)
      INTO got FROM public.job_candidate_status j WHERE j.id = b;
    failures := failures || pg_temp.cr_eq('U4 geste groupé annulé', got,
      'updated/updated|interviewing/true/user/true/-----|rejected/ai/true/true/to_sort/-----');
    failures := failures || pg_temp.cr_eq('U4 vue', pg_temp.cr_v(m5, 'U4'), 'interviewing/user/2/false');

    -- U5. Ligne reprise En entretien sans jalons (M6, libellé ITW en cours), reculée
    --     vers Retenu, annulée : En entretien, aucun jalon (dates de l'annulation effacées).
    x := pg_temp.cr_row(m6, 'U5', 'shortlisted', 'ITW en cours', p_by => u_a);
    PERFORM pg_temp.cr_force(x, 'stage_entered_at', t_b);
    bf_x := pg_temp.cr_before(x);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[x], 'retained', 'user');
    RESET ROLE;
    mv := jsonb_build_array(pg_temp.cr_move(x, g, bf_x));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    got := pg_temp.cr_res(u, x);
    SELECT got || '|' || j.general_stage || '/' || j.pipeline_stage || '/' || (j.stage_entered_at = t_b) || '/'
           || pg_temp.cr_jal(j.id)
      INTO got FROM public.job_candidate_status j WHERE j.id = x;
    failures := failures || pg_temp.cr_eq('U5 reprise sans jalons', got, 'updated|interviewing/ITW en cours/true/-----');

    -- U6. Réponse du candidat entre le geste et l'annulation : moved_since, rien d'écrit.
    --     (Le geste est daté t_g : dans la transaction, now() ne bouge pas.)
    x := pg_temp.cr_row(m6, 'U6', 'discovered', p_by => u_a);
    bf_x := pg_temp.cr_before(x);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[x], 'contacted', 'user');
    RESET ROLE;
    PERFORM pg_temp.cr_force(x, 'stage_entered_at', t_g);
    PERFORM pg_temp.cr_as(NULL, 'service_role');
    v := public.record_candidate_inbound(o1, 'cr-acc-a', jsonb_build_object('ids', jsonb_build_array('U6')));
    ct_x := pg_temp.cr_ct(x);
    mv := jsonb_build_array(jsonb_build_object('id', x, 'after_entered_at', t_g, 'before', bf_x));
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    SELECT pg_temp.cr_res(u, x) || '/' || j.general_stage || '/' || (pg_temp.cr_ct(x) = ct_x) INTO got
      FROM public.job_candidate_status j WHERE j.id = x;
    failures := failures || pg_temp.cr_eq('U6 réponse entre geste et annulation', got, 'moved_since/replied/true');

    -- U10. Colonne d'entretien du /pipeline (M6, sans étape) : Pré-qualif vers
    --      CV envoyé, annulé : Pré-qualif, date d'entrée gardée, presented_at
    --      posé par le geste effacé.
    x := pg_temp.cr_row(m6, 'U10', 'shortlisted', 'Pré-qualif', p_by => u_a);
    PERFORM pg_temp.cr_force(x, 'stage_entered_at', t_b);
    bf_x := pg_temp.cr_before(x);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[x], 'interviewing', 'user', NULL, NULL, 'CV envoyé');
    RESET ROLE;
    got := pg_temp.cr_jal(x);
    mv := jsonb_build_array(pg_temp.cr_move(x, g, bf_x) || jsonb_build_object('after_pipeline_stage', 'CV envoyé'));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    SELECT got || '|' || pg_temp.cr_res(u, x) || '|' || j.general_stage || '/' || j.pipeline_stage || '/'
           || (j.stage_entered_at = t_b) || '/' || pg_temp.cr_jal(j.id)
      INTO got FROM public.job_candidate_status j WHERE j.id = x;
    failures := failures || pg_temp.cr_eq('U10 Pré-qualif vers CV envoyé, annulé', got,
                                          '---x-|updated|interviewing/Pré-qualif/true/-----');

    -- U12. Colonne d'entretien d'une ligne entrée en entretien par l'application
    --      (jalons contact, réponse et entretien à la date d'entrée) : Pré-qualif
    --      vers Offre, annulé : Pré-qualif, date d'entrée et jalons d'avant gardés
    --      (le geste n'a changé ni l'étape ni la date).
    x := pg_temp.cr_row(m6, 'U12', 'shortlisted', 'Pré-qualif', p_by => u_a);
    PERFORM pg_temp.cr_force(x, 'stage_entered_at', t_b);
    PERFORM pg_temp.cr_force(x, 'contacted_at', t_b);
    PERFORM pg_temp.cr_force(x, 'replied_at', t_b);
    PERFORM pg_temp.cr_force(x, 'first_interview_at', t_b);
    bf_x := pg_temp.cr_before(x);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    g := public.set_candidate_stages(ARRAY[x], 'interviewing', 'user', NULL, NULL, 'Offre');
    RESET ROLE;
    got := pg_temp.cr_jal(x);
    mv := jsonb_build_array(pg_temp.cr_move(x, g, bf_x) || jsonb_build_object('after_pipeline_stage', 'Offre'));
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    SELECT got || '|' || pg_temp.cr_res(u, x) || '|' || j.general_stage || '/' || j.pipeline_stage || '/'
           || (j.stage_entered_at = t_b) || '/' || pg_temp.cr_jal(j.id)
      INTO got FROM public.job_candidate_status j WHERE j.id = x;
    failures := failures || pg_temp.cr_eq('U12 Pré-qualif vers Offre, annulé : jalons d''avant gardés', got,
                                          'xxx--|updated|interviewing/Pré-qualif/true/xxx--');

    -- U11. Annulation forgée sur une ligne contactée par le serveur (date
    --      d'entrée exacte) : moved_since, rien d'écrit, contacted_at intact.
    y := pg_temp.cr_row(m6, 'U11', 'discovered', p_by => u_a);
    v := pg_temp.cr_set(y, 'contacted', 'system', o1);
    ct_x := pg_temp.cr_ct(y);
    SELECT jsonb_build_array(jsonb_build_object('id', j.id, 'after_entered_at', j.stage_entered_at,
             'before', jsonb_build_object('general_stage', 'retained', 'decision_source', 'user')))
      INTO mv FROM public.job_candidate_status j WHERE j.id = y;
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    u := public.undo_candidate_stages(mv);
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    SELECT pg_temp.cr_res(u, y) || '/' || j.general_stage || '/' || j.decision_source || '/'
           || (pg_temp.cr_ct(y) = ct_x) || '/' || pg_temp.cr_jal(j.id)
      INTO got FROM public.job_candidate_status j WHERE j.id = y;
    failures := failures || pg_temp.cr_eq('U11 annulation forgée après un envoi serveur', got,
                                          'moved_since/contacted/system/true/x----');

    -- U7 à U9. Plafond, ligne d'une autre organisation, état d'avant invalide.
    y := pg_temp.cr_row(m9, 'U8', 'shortlisted', p_by => u_c);
    PERFORM pg_temp.cr_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      u := public.undo_candidate_stages((SELECT jsonb_agg(jsonb_build_object('id', gen_random_uuid(),
               'after_entered_at', now(), 'before', jsonb_build_object('general_stage', 'to_sort')))
             FROM generate_series(1, 201)));
      got := 'accepté';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
    END;
    u := public.undo_candidate_stages(jsonb_build_array(
           jsonb_build_object('id', y, 'after_entered_at', now(), 'before', jsonb_build_object('general_stage', 'to_sort')),
           jsonb_build_object('id', x, 'after_entered_at', now(),
                              'before', jsonb_build_object('general_stage', 'to_sort', 'decision_source', 'x'))));
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    failures := failures || pg_temp.cr_eq('U7 201 lignes', got, 'STAGE_BATCH_TOO_LARGE')
                         || pg_temp.cr_eq('U8 ligne de O2', pg_temp.cr_res(u, y), 'error/STAGE_ROW_NOT_FOUND')
                         || pg_temp.cr_eq('U9 origine inconnue', pg_temp.cr_res(u, x), 'error/STAGE_UNDO_INVALID');
    SELECT general_stage INTO got FROM public.job_candidate_status WHERE id = y;
    failures := failures || pg_temp.cr_eq('U8 ligne de O2 intacte', got, 'retained');
  END IF;

  -- ===== I. InMail répondu : preuve d'envoi (M1, lignes Retenues, lien sans envoi) =====
  INSERT INTO public.mission_conversations (organization_id, project_id, account_id, candidate_id, source, last_inbound_at)
  VALUES (o1, m1, 'cr-acc-a', 'I-yes', 'inferred', now() - interval '2 days'),
         (o1, m1, 'cr-acc-a', 'I-no', 'inferred', now() - interval '2 days'),
         (o1, m1, 'cr-acc-a', 'I-pend', 'inferred', now() - interval '2 days');
  a := pg_temp.cr_row(m1, 'I-yes', 'shortlisted', p_by => u_a);
  b := pg_temp.cr_row(m1, 'I-no', 'shortlisted', p_by => u_a);
  x := pg_temp.cr_row(m1, 'I-pend', 'shortlisted', p_by => u_a);
  INSERT INTO public.inmail_queue (account_id, created_by, message, subject, recipient_profile_id, status, sent_at,
                                   organization_id, project_id)
  VALUES ('cr-acc-a', u_a, 'Bonjour', 'Poste', 'I-yes', 'replied', now() - interval '3 days', o1, m1),
         ('cr-acc-a', u_a, 'Bonjour', 'Poste', 'I-no', 'replied', NULL, o1, m1),
         ('cr-acc-a', u_a, 'Bonjour', 'Poste', 'I-pend', 'pending', NULL, o1, m1);
  SELECT string_agg(c.cand || '=' || (s.first_send_at IS NOT NULL), ',' ORDER BY c.cand) INTO got
    FROM unnest(ARRAY['I-yes', 'I-no', 'I-pend']) c(cand)
    CROSS JOIN LATERAL public.candidate_mission_sends(o1, m1, jsonb_build_object('ids', jsonb_build_array(c.cand))) s;
  failures := failures || pg_temp.cr_eq('I1 preuve d''envoi', got, 'I-no=false,I-pend=false,I-yes=true');
  PERFORM pg_temp.cr_as(NULL, 'service_role');
  v := public.record_candidate_inbound(o1, 'cr-acc-a', jsonb_build_object('ids', jsonb_build_array('I-yes')));
  v := public.record_candidate_inbound(o1, 'cr-acc-a', jsonb_build_object('ids', jsonb_build_array('I-no')));
  v := public.record_candidate_inbound(o1, 'cr-acc-a', jsonb_build_object('ids', jsonb_build_array('I-pend')));
  PERFORM pg_temp.cr_as(NULL);
  SELECT string_agg(j.candidate_id || '=' || j.general_stage || '/' || (j.contacted_at IS NOT NULL), ',' ORDER BY j.candidate_id)
    INTO got FROM public.job_candidate_status j WHERE j.id IN (a, b, x);
  failures := failures || pg_temp.cr_eq('I2 réponse après InMail', got,
                                        'I-no=retained/false,I-pend=retained/false,I-yes=replied/true');

  -- ===== P. rgpd_purge_candidate_rows (M1, lignes P-*) =====
  a := pg_temp.cr_row(m1, 'P-old', 'discovered');                             -- 25 mois sans activité
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', now() - interval '25 months');
  PERFORM pg_temp.cr_force(a, 'updated_at', now() - interval '25 months');
  PERFORM pg_temp.cr_row(m1, 'P-recent', 'discovered');
  a := pg_temp.cr_row(m1, 'P-rej', 'discovered');                             -- écarté il y a 13 mois
  v := pg_temp.cr_set(a, 'rejected', 'user', o1);
  PERFORM pg_temp.cr_force(a, 'rejected_at', now() - interval '13 months');
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', now() - interval '13 months');
  PERFORM pg_temp.cr_force(a, 'updated_at', now() - interval '13 months');
  a := pg_temp.cr_row(m1, 'P-rej-new', 'discovered');                         -- écarté il y a 2 mois
  v := pg_temp.cr_set(a, 'rejected', 'user', o1);
  PERFORM pg_temp.cr_force(a, 'rejected_at', now() - interval '2 months');
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', now() - interval '2 months');
  PERFORM pg_temp.cr_force(a, 'updated_at', now() - interval '2 months');
  a := pg_temp.cr_row(m1, 'P-rej-null', 'discovered');                        -- écart repris sans date, entré il y a 14 mois
  v := pg_temp.cr_set(a, 'rejected', 'user', o1);
  PERFORM pg_temp.cr_force(a, 'rejected_at', NULL);
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', now() - interval '14 months');
  PERFORM pg_temp.cr_force(a, 'updated_at', now() - interval '14 months');
  a := pg_temp.cr_row(m1, 'P-hired', 'discovered');                           -- Embauché il y a 30 mois
  v := pg_temp.cr_set(a, 'hired', 'user', o1);
  PERFORM pg_temp.cr_force(a, 'contacted_at', now() - interval '30 months');
  PERFORM pg_temp.cr_force(a, 'replied_at', now() - interval '30 months');
  PERFORM pg_temp.cr_force(a, 'first_interview_at', now() - interval '30 months');
  PERFORM pg_temp.cr_force(a, 'hired_at', now() - interval '30 months');
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', now() - interval '30 months');
  PERFORM pg_temp.cr_force(a, 'updated_at', now() - interval '30 months');
  a := pg_temp.cr_row(m1, 'P-cont', 'discovered');                            -- contacté il y a 1 mois
  v := pg_temp.cr_set(a, 'contacted', 'system', o1);
  PERFORM pg_temp.cr_force(a, 'contacted_at', now() - interval '1 month');
  PERFORM pg_temp.cr_force(a, 'stage_entered_at', now() - interval '25 months');
  PERFORM pg_temp.cr_force(a, 'updated_at', now() - interval '25 months');

  -- P1. Fenêtres trop courtes, limite hors bornes : refus.
  BEGIN
    PERFORM * FROM public.rgpd_purge_candidate_rows(now() - interval '23 months', now() - interval '12 months');
    got := 'accepté';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
  END;
  failures := failures || pg_temp.cr_eq('P1 fenêtre de 23 mois', got, 'PURGE_WINDOW_TOO_SHORT');
  BEGIN
    PERFORM * FROM public.rgpd_purge_candidate_rows(now() - interval '24 months', now() - interval '11 months');
    got := 'accepté';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
  END;
  failures := failures || pg_temp.cr_eq('P1 fenêtre d''écart de 11 mois', got, 'PURGE_WINDOW_TOO_SHORT');
  BEGIN
    PERFORM * FROM public.rgpd_purge_candidate_rows(now() - interval '24 months', now() - interval '12 months', true, 0);
    got := 'accepté';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
  END;
  failures := failures || pg_temp.cr_eq('P1 limite nulle', got, 'PURGE_LIMIT_INVALID');

  -- P2. Compte seulement (par défaut) : les bonnes lignes, rien de supprimé.
  SELECT string_agg(f.candidate_id || ':' || f.reason, ' ' ORDER BY f.candidate_id COLLATE "C") INTO got
    FROM public.rgpd_purge_candidate_rows(now() - interval '24 months', now() - interval '12 months') f
   WHERE f.organization_id = o1 AND f.candidate_id LIKE 'P-%';
  failures := failures || pg_temp.cr_eq('P2 compte seulement', got, 'P-old:inactive_24m P-rej:rejected_12m P-rej-null:rejected_12m');
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE project_id = m1 AND candidate_id LIKE 'P-%';
  failures := failures || pg_temp.cr_eq('P2 lignes gardées', n, 7);
  -- P3. Clé de service, compte seulement.
  IF has_function_privilege('service_role', sig_purge, 'EXECUTE') THEN
    PERFORM pg_temp.cr_as(NULL, 'service_role');
    SET LOCAL ROLE service_role;
    SELECT count(*) INTO n FROM public.rgpd_purge_candidate_rows(now() - interval '24 months', now() - interval '12 months', true, 5000) f
     WHERE f.organization_id = o1 AND f.candidate_id LIKE 'P-%';
    RESET ROLE;
    PERFORM pg_temp.cr_as(NULL);
    failures := failures || pg_temp.cr_eq('P3 service_role, compte seulement', n, 3);
  ELSE
    failures := failures || '[P3 service_role n''exécute pas rgpd_purge_candidate_rows] ';
  END IF;
  -- P4. Suppression réelle (p_dry_run = false explicite) : les mêmes lignes.
  SELECT string_agg(f.candidate_id || ':' || f.reason, ' ' ORDER BY f.candidate_id COLLATE "C") INTO got
    FROM public.rgpd_purge_candidate_rows(now() - interval '24 months', now() - interval '12 months', false, 5000) f
   WHERE f.organization_id = o1 AND f.candidate_id LIKE 'P-%';
  failures := failures || pg_temp.cr_eq('P4 suppression', got, 'P-old:inactive_24m P-rej:rejected_12m P-rej-null:rejected_12m');
  SELECT string_agg(candidate_id, ' ' ORDER BY candidate_id COLLATE "C") INTO got
    FROM public.job_candidate_status WHERE project_id = m1 AND candidate_id LIKE 'P-%';
  failures := failures || pg_temp.cr_eq('P4 lignes restantes', got, 'P-cont P-hired P-recent P-rej-new');

  -- P5. Plan de la vue filtrée par mission : filtre sous les fenêtres (avertissement seulement).
  FOR line IN EXECUTE format('EXPLAIN SELECT * FROM public.mission_candidate_rows WHERE project_id = %L', m1) LOOP
    IF line LIKE '%WindowAgg%' THEN
      v_seen_window := true;
    ELSIF v_seen_window AND line LIKE '%project_id%' AND (line LIKE '%Cond%' OR line LIKE '%Filter%') THEN
      v_pushed := true;
    END IF;
  END LOOP;
  IF NOT v_pushed THEN
    RAISE WARNING 'candidate_stage_readers_audit : P5, le filtre project_id ne descend pas sous les fenêtres de mission_candidate_rows';
  END IF;

  INSERT INTO cr_fail SELECT 'UIP', failures WHERE failures <> '';
END $$;


-- ===== Rc et B : application de la migration sur les données de l'audit =====
-- Montage : recommendation libres (ancienne analyse d'une réponse), compteurs
-- faux et updated_at ancien sur M4 (déclencheurs coupés le temps de
-- l'écriture), clés d'appel de l'indexation posées (annulées au ROLLBACK).
DO $$
DECLARE
  u_a uuid := pg_temp.cr_id('u_a');
  o1 uuid := pg_temp.cr_id('o1');
  m1 uuid := pg_temp.cr_id('m1');
  m4 uuid := pg_temp.cr_id('m4');
BEGIN
  PERFORM pg_temp.cr_as(NULL);
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, score, recommendation, created_at, updated_at)
  VALUES ('Rc-1', 'project:' || m1, m1, o1, u_a, 'scored', 72, 'Le candidat est intéressé', now() - interval '10 days', now() - interval '10 days'),
         ('Rc-2', 'project:' || m1, m1, o1, u_a, 'discovered', NULL, 'Réponse positive, à relancer la semaine prochaine', now() - interval '10 days', now() - interval '10 days'),
         ('Rc-3', 'project:' || m1, m1, o1, u_a, 'scored', 72, 'GOOD_MATCH', now() - interval '10 days', now() - interval '10 days'),
         ('Rc-4', 'project:' || m1, m1, o1, u_a, 'scored', 90, 'fit', now() - interval '10 days', now() - interval '10 days');
  ALTER TABLE public.sourcing_projects DISABLE TRIGGER update_sourcing_projects_updated_at;
  ALTER TABLE public.sourcing_projects DISABLE TRIGGER trg_auto_ingest_sourcing_projects;
  UPDATE public.sourcing_projects SET stats_total_found = 999, updated_at = now() - interval '7 days' WHERE id = m4;
  ALTER TABLE public.sourcing_projects ENABLE TRIGGER update_sourcing_projects_updated_at;
  ALTER TABLE public.sourcing_projects ENABLE TRIGGER trg_auto_ingest_sourcing_projects;
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    INSERT INTO public.internal_config (key, value)
    VALUES ('supabase_functions_url', 'http://127.0.0.1:9/cr-audit/functions/v1'), ('supabase_anon_key', 'cr-audit')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END $$;

CREATE TEMP TABLE cr_replay ON COMMIT DROP AS
SELECT 'jcs' AS t, id, ctid::text AS ct FROM public.job_candidate_status
UNION ALL SELECT 'sp', id, ctid::text FROM public.sourcing_projects;
CREATE TEMP TABLE cr_replay_http ON COMMIT DROP AS
SELECT pg_temp.cr_http('job_candidate_status') AS jcs, pg_temp.cr_http('sourcing_projects') AS sp;
SET LOCAL client_min_messages = warning;
\ir ../migrations/20260929112827_refonte_mission_lot0c_lectures.sql
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  m4 uuid := pg_temp.cr_id('m4');
  got text;
  n integer;
  failures text := '';
BEGIN
  -- Rc (C6). Texte libre noté : valeur de la note ; libre sans note : NULL ;
  --     valeur connue et valeur courte inconnue : inchangées ; updated_at intact.
  SELECT string_agg(j.candidate_id || '=' || coalesce(j.recommendation, 'NULL') || '/'
                    || (j.updated_at = now() - interval '10 days'), ' ' ORDER BY j.candidate_id) INTO got
    FROM public.job_candidate_status j WHERE j.candidate_id LIKE 'Rc-%';
  failures := failures || pg_temp.cr_eq('Rc reprise des recommendation', got,
    'Rc-1=GOOD_MATCH/true Rc-2=NULL/true Rc-3=GOOD_MATCH/true Rc-4=fit/true');
  -- B1 (C4). Compteurs de M4 corrigés, updated_at de la mission intact.
  SELECT stats_total_found || '/' || (updated_at = now() - interval '7 days') INTO got
    FROM public.sourcing_projects WHERE id = m4;
  failures := failures || pg_temp.cr_eq('B1 recalcul complet de M4', got, '2/true');
  -- B2. Seules les deux recommendation libres et la mission M4 sont réécrites.
  SELECT string_agg(r.t || ':' || coalesce(j.candidate_id, p.name), ',' ORDER BY r.t COLLATE "C", coalesce(j.candidate_id, p.name) COLLATE "C") INTO got
    FROM cr_replay r
    LEFT JOIN public.job_candidate_status j ON r.t = 'jcs' AND j.id = r.id
    LEFT JOIN public.sourcing_projects p ON r.t = 'sp' AND p.id = r.id
   WHERE r.ct IS DISTINCT FROM coalesce(j.ctid::text, p.ctid::text);
  failures := failures || pg_temp.cr_eq('B2 lignes réécrites par l''application', got, 'jcs:Rc-1,jcs:Rc-2,sp:Mission M4');
  -- B3. Aucun appel HTTP d'indexation (lignes candidat, missions).
  failures := failures
    || pg_temp.cr_eq('B3 appels HTTP (lignes candidat)', coalesce(pg_temp.cr_http('job_candidate_status') - (SELECT h.jcs FROM cr_replay_http h), 0), 0)
    || pg_temp.cr_eq('B3 appels HTTP (missions)', coalesce(pg_temp.cr_http('sourcing_projects') - (SELECT h.sp FROM cr_replay_http h), 0), 0);
  -- B4. Déclencheurs coupés par la migration rétablis.
  SELECT string_agg(t.tgname || '=' || t.tgenabled::text, ',' ORDER BY t.tgname) INTO got FROM pg_trigger t
   WHERE (t.tgrelid = 'public.sourcing_projects'::regclass
          AND t.tgname IN ('update_sourcing_projects_updated_at', 'trg_auto_ingest_sourcing_projects'))
      OR (t.tgrelid = 'public.job_candidate_status'::regclass
          AND t.tgname IN ('update_job_candidate_status_updated_at', 'trg_auto_ingest_job_candidate_status'));
  failures := failures || pg_temp.cr_eq('B4 déclencheurs rétablis', got,
    'trg_auto_ingest_job_candidate_status=O,trg_auto_ingest_sourcing_projects=O,'
    'update_job_candidate_status_updated_at=O,update_sourcing_projects_updated_at=O');
  INSERT INTO cr_fail SELECT 'RcB', failures WHERE failures <> '';
END $$;

-- B5. Seconde application : rien n'est réécrit (lignes candidat, missions), aucun appel HTTP.
TRUNCATE cr_replay;
INSERT INTO cr_replay
SELECT 'jcs', id, ctid::text FROM public.job_candidate_status
UNION ALL SELECT 'sp', id, ctid::text FROM public.sourcing_projects;
TRUNCATE cr_replay_http;
INSERT INTO cr_replay_http SELECT pg_temp.cr_http('job_candidate_status'), pg_temp.cr_http('sourcing_projects');
SET LOCAL client_min_messages = warning;
\ir ../migrations/20260929112827_refonte_mission_lot0c_lectures.sql
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  n integer;
  failures text := '';
BEGIN
  SELECT count(*) INTO n FROM cr_replay r
   WHERE r.ct IS DISTINCT FROM CASE r.t
           WHEN 'jcs' THEN (SELECT j.ctid::text FROM public.job_candidate_status j WHERE j.id = r.id)
           ELSE (SELECT p.ctid::text FROM public.sourcing_projects p WHERE p.id = r.id) END;
  failures := failures || pg_temp.cr_eq('B5 lignes réécrites par la seconde application', n, 0)
    || pg_temp.cr_eq('B5 appels HTTP (lignes candidat)', coalesce(pg_temp.cr_http('job_candidate_status') - (SELECT h.jcs FROM cr_replay_http h), 0), 0)
    || pg_temp.cr_eq('B5 appels HTTP (missions)', coalesce(pg_temp.cr_http('sourcing_projects') - (SELECT h.sp FROM cr_replay_http h), 0), 0);
  INSERT INTO cr_fail SELECT 'B5', failures WHERE failures <> '';
END $$;

-- ===== Bilan =====
DO $$
DECLARE
  failures text;
BEGIN
  SELECT string_agg(block || ' ' || msg, ' ' ORDER BY block) INTO failures FROM cr_fail;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'candidate_stage_readers_audit : %', failures;
  END IF;
  RAISE NOTICE 'candidate_stage_readers_audit : tous les contrôles passés (S1-S7, V1-V14, C1-C4, St1-St6, U1-U12, I1-I2, P1-P5, Rc, B1-B5)';
END $$;
