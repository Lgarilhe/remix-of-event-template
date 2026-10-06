-- =====================================================================
-- Refonte mission, lot 0b-1 : lien conversation–mission, écrivains serveur,
-- garde des écritures directes.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/candidate_stage_writers_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/candidate_stage_writers_audit.sql -c 'ROLLBACK;')
-- Vérifie la migration 20260928235358_refonte_mission_lot0b_liens_et_ecrivains.sql :
--  * S : structure (mission_conversations, journal, garde, index, inmail_queue.project_id, mode) ;
--  * D : droits (has_function_privilege, has_table_privilege ; aucun appel refusé) ;
--  * W : set_candidate_stages depuis le navigateur (lignes, étapes de départ, autre organisation, plafond) ;
--  * A : apply_mission_candidate_stage (création, doublons, auteur, étapes de départ, slug) ;
--  * O : envoi (lien, Contacté, marqueur, rejeu, écarté, inscription, mission d'une autre organisation) ;
--  * R : réponse (mission de la conversation, rang 4, preuve d'envoi, rang 0, rattrapage) ;
--  * M : message propre (écho, note d'invitation, fil rattaché, U-I7) ;
--  * L : lecture des liens (collaborateur : ses liens seulement) ;
--  * E : effacement RGPD d'une inscription (liens du candidat supprimés) ;
--  * Y : résumé d'analyse ;
--  * C : rendez-vous ;
--  * G : garde (observation, journal indisponible, refus, arrêt) ;
--  * B : reprise des liens des inscriptions, puis seconde application de la
--        migration (aucune ligne candidat réécrite, aucun appel HTTP).
-- L et E sont joués après B, sur les liens repris.
-- Chaque partie pose son mode de garde dans la transaction (W à C en refus :
-- les écrivains du lot 0b ne passent jamais par une écriture directe). Le
-- bloc S accepte observe ou refuse : l'audit reste vert avant et après 0b-5.
-- Fonctions serveur appelées en postgres avec le jeton service_role, et une
-- fois sous SET ROLE service_role après contrôle des droits. Aucune fonction
-- n'est appelée sous SET ROLE authenticated ou anon sans que son droit ait
-- été vérifié par has_function_privilege (plantage de l'image locale sur un
-- refus, voir CLAUDE.md) ; anon n'appelle rien : son refus réel est contrôlé
-- par l'API dans .github/workflows/e2e.yml.
-- O1 (u_a propriétaire, u_b membre ; comptes acc_a et acc_b) : M1, M2 (sans
-- étape), M3 (étapes S1, S2), M4 (étapes, bloc G). O2 (u_c) : M9.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
SET LOCAL lock_timeout = '30s';

CREATE TEMP TABLE cw_fail (block text, msg text) ON COMMIT DROP;
CREATE TEMP TABLE cw_flag (name text PRIMARY KEY, ok boolean) ON COMMIT DROP;
CREATE TEMP TABLE cw_ids (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO cw_ids VALUES
  ('u_a', 'e0b00000-0000-4000-8000-0000000000a1'), ('u_b', 'e0b00000-0000-4000-8000-0000000000a2'),
  ('u_c', 'e0b00000-0000-4000-8000-0000000000a3'),
  ('o1', 'e0b00000-0000-4000-8000-0000000000f1'), ('o2', 'e0b00000-0000-4000-8000-0000000000f2'),
  ('m1', 'e0b00000-0000-4000-8000-0000000000b1'), ('m2', 'e0b00000-0000-4000-8000-0000000000b2'),
  ('m3', 'e0b00000-0000-4000-8000-0000000000b3'), ('m4', 'e0b00000-0000-4000-8000-0000000000b4'),
  ('m9', 'e0b00000-0000-4000-8000-0000000000b9'),
  ('s1', 'e0b00000-0000-4000-8000-0000000000c1'), ('s2', 'e0b00000-0000-4000-8000-0000000000c2'),
  ('s4a', 'e0b00000-0000-4000-8000-0000000000c4'), ('s4b', 'e0b00000-0000-4000-8000-0000000000c5'),
  ('q0', 'e0b00000-0000-4000-8000-0000000000d0'), ('q1', 'e0b00000-0000-4000-8000-0000000000d1'),
  ('q2', 'e0b00000-0000-4000-8000-0000000000d2'), ('q3', 'e0b00000-0000-4000-8000-0000000000d3'),
  ('st0m', 'e0b00000-0000-4000-8000-0000000000e0'), ('st1m', 'e0b00000-0000-4000-8000-0000000000e1'),
  ('st1i', 'e0b00000-0000-4000-8000-0000000000e2'), ('st2m', 'e0b00000-0000-4000-8000-0000000000e3'),
  ('st2i', 'e0b00000-0000-4000-8000-0000000000e4'), ('st3m', 'e0b00000-0000-4000-8000-0000000000e5');

CREATE FUNCTION pg_temp.cw_id(p_name text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM cw_ids WHERE name = p_name $$;

-- Contexte d'appel : utilisateur connecté (p_uid, rôle du jeton authenticated),
-- sans jeton (NULL, p_role NULL) ou clé de service (NULL, 'service_role').
CREATE FUNCTION pg_temp.cw_as(p_uid uuid, p_role text DEFAULT NULL) RETURNS void
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

CREATE FUNCTION pg_temp.cw_eq(p_label text, p_got anyelement, p_want anyelement) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_got IS NOT DISTINCT FROM p_want THEN ''
              ELSE format('[%s : %s, attendu %s] ', p_label, coalesce(p_got::text, 'NULL'), coalesce(p_want::text, 'NULL')) END
$$;

-- Mode de la garde, redéfini dans la transaction (annulé au ROLLBACK).
CREATE FUNCTION pg_temp.cw_mode(p_mode text) RETURNS void
LANGUAGE plpgsql AS $cw$
BEGIN
  EXECUTE format($f$CREATE OR REPLACE FUNCTION public.jcs_stage_write_mode()
    RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $m$ SELECT %L::text $m$ $f$, p_mode);
END $cw$;

-- Ligne candidat écrite sans jeton (montage), quel que soit le contexte en cours.
CREATE FUNCTION pg_temp.cw_row(p_proj uuid, p_cand text, p_status text, p_ps text DEFAULT NULL,
                               p_by uuid DEFAULT NULL, p_job text DEFAULT NULL, p_url text DEFAULT NULL,
                               p_org uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v  uuid;
  c1 text := coalesce(current_setting('request.jwt.claims', true), '');
  c2 text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  c3 text := coalesce(current_setting('request.jwt.claim.role', true), '');
BEGIN
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage, linkedin_profile_url)
  SELECT p_cand, coalesce(p_job, 'project:' || p.id), p.id, coalesce(p_org, p.organization_id),
         coalesce(p_by, p.created_by), p_status, p_ps, p_url
    FROM public.sourcing_projects p WHERE p.id = p_proj
  RETURNING id INTO v;
  PERFORM set_config('request.jwt.claims', c1, true);
  PERFORM set_config('request.jwt.claim.sub', c2, true);
  PERFORM set_config('request.jwt.claim.role', c3, true);
  RETURN v;
END $$;

-- Écrit une colonne du modèle en passant les déclencheurs (dater dans le passé).
CREATE FUNCTION pg_temp.cw_force(p_id uuid, p_col text, p_val timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('konekt.stage_write', '*', true);
  EXECUTE format('UPDATE public.job_candidate_status SET %I = $1 WHERE id = $2', p_col) USING p_val, p_id;
  PERFORM set_config('konekt.stage_write', '', true);
END $$;

-- Requête qui rend un jsonb, ou l'erreur (état, indice, message).
CREATE FUNCTION pg_temp.cw_try(p_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v jsonb;
  s text; h text; m text;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE, h = PG_EXCEPTION_HINT, m = MESSAGE_TEXT;
  RETURN jsonb_build_object('error', s, 'hint', h, 'message', m);
END $$;

CREATE FUNCTION pg_temp.cw_cand(p_ids text[], p_slug text DEFAULT NULL, p_url text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('ids', to_jsonb(coalesce(p_ids, '{}'::text[])),
                                              'slug', p_slug, 'profile_url', p_url))
$$;

CREATE FUNCTION pg_temp.cw_st(p_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT j.general_stage || '/' || coalesce(j.decision_source, '-') FROM public.job_candidate_status j WHERE j.id = p_id
$$;

CREATE FUNCTION pg_temp.cw_ct(p_id uuid) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT ctid::text FROM public.job_candidate_status WHERE id = p_id $$;

-- Appels HTTP de l'audit en file d'attente de pg_net (NULL si pg_net manque).
-- Les clés d'appel posées au bloc B visent cette adresse, jamais servie.
CREATE FUNCTION pg_temp.cw_http() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  IF to_regclass('net.http_request_queue') IS NULL THEN
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT count(*) FROM net.http_request_queue WHERE url LIKE ''http://127.0.0.1:9/cw-audit/%''' INTO n;
  RETURN n;
END $$;


-- ===== Montage, puis S (structure) et D (droits) =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b'); u_c uuid := pg_temp.cw_id('u_c');
  o1 uuid := pg_temp.cw_id('o1'); o2 uuid := pg_temp.cw_id('o2');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m3 uuid := pg_temp.cw_id('m3');
  m4 uuid := pg_temp.cw_id('m4'); m9 uuid := pg_temp.cw_id('m9');
  sig_sets text := 'public.set_candidate_stages(uuid[], text, text, uuid, uuid, text, text[])';
  sig_server text[] := ARRAY[
    'public.enrollment_mission_id(uuid)',
    'public.candidate_enrollment_ids(uuid, text, jsonb)',
    'public.resolve_conversation_mission(uuid, text, text, jsonb, uuid[])',
    'public.candidate_mission_sends(uuid, uuid, jsonb)',
    'public.apply_mission_candidate_stage(uuid, uuid, jsonb, text, text, uuid, text, text[], uuid, uuid)',
    'public.touch_mission_conversation(uuid, uuid, text, text[], text, text, text, uuid, uuid, text, text, timestamptz, text)',
    'public.record_candidate_outbound(uuid, text, jsonb, text, uuid, text, text, uuid, uuid, boolean, text)',
    'public.record_candidate_inbound(uuid, text, jsonb, text, uuid[], boolean, timestamptz)',
    'public.record_own_message(uuid, text, text, text, jsonb)',
    'public.record_reply_summary(uuid, text, text, jsonb, text)',
    'public.resolve_meeting_mission(uuid, jsonb)',
    'public.record_candidate_meeting(uuid, uuid, jsonb)'];
  sig_help text[] := ARRAY['public.linkedin_url_slug(text)', 'public.candidate_ref_ids(jsonb)',
                           'public.candidate_ref_slug(jsonb)'];
  sig_trg text[] := ARRAY['public.jcs_stage_write_guard()', 'public.mission_conversations_same_org()',
                          'public.mission_conversations_gdpr_erase()'];
  v_mode text;
  v_ok boolean;
  got text;
  n integer;
  failures text := '';
BEGIN
  -- Le mode posé par la migration, lu avant toute redéfinition par l'audit (S8).
  BEGIN
    v_mode := public.jcs_stage_write_mode();
  EXCEPTION WHEN OTHERS THEN
    v_mode := 'illisible : ' || SQLERRM;
  END;

  -- ===== Jeu de données (sans jeton) =====
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@writers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@writers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'c@writers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Writers Org 1', 'writers-org-1', u_a), (o2, 'Writers Org 2', 'writers-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur de création.
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner' OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (o1, u_b, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (u_a, o1), (u_b, o1), (u_c, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by)
  VALUES (m1, 'Mission M1', o1, u_a), (m2, 'Mission M2', o1, u_a), (m3, 'Mission M3', o1, u_a),
         (m4, 'Mission M4', o1, u_a), (m9, 'Mission M9', o2, u_c);
  INSERT INTO public.mission_process_steps (id, project_id, organization_id, step_order, name)
  VALUES (pg_temp.cw_id('s1'), m3, o1, 1, 'Entretien RH'), (pg_temp.cw_id('s2'), m3, o1, 2, 'Entretien client'),
         (pg_temp.cw_id('s4a'), m4, o1, 1, 'Etape A'), (pg_temp.cw_id('s4b'), m4, o1, 2, 'Etape B');
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_a, 'acc_a', u_a), (o1, u_b, 'acc_b', u_b);
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, project_id, is_active)
  VALUES (pg_temp.cw_id('q0'), 'Séquence sans mission', o1, u_a, NULL, true),
         (pg_temp.cw_id('q1'), 'Séquence M1', o1, u_a, m1, true),
         (pg_temp.cw_id('q2'), 'Séquence M2', o1, u_a, m2, true),
         (pg_temp.cw_id('q3'), 'Séquence M2 bis', o1, u_a, m2, true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES (pg_temp.cw_id('st0m'), pg_temp.cw_id('q0'), o1, 1, 'message', 'Bonjour'),
         (pg_temp.cw_id('st1m'), pg_temp.cw_id('q1'), o1, 1, 'message', 'Bonjour'),
         (pg_temp.cw_id('st1i'), pg_temp.cw_id('q1'), o1, 2, 'connection_request', 'Note'),
         (pg_temp.cw_id('st2m'), pg_temp.cw_id('q2'), o1, 1, 'message', 'Bonjour'),
         (pg_temp.cw_id('st2i'), pg_temp.cw_id('q2'), o1, 2, 'connection_request', 'Note'),
         (pg_temp.cw_id('st3m'), pg_temp.cw_id('q3'), o1, 1, 'message', 'Bonjour');

  -- ===== S. Structure =====
  -- S1. Colonnes de mission_conversations (nom:type, ! pour NOT NULL).
  SELECT string_agg(column_name || ':' || udt_name || CASE WHEN is_nullable = 'NO' THEN '!' ELSE '' END, ','
                    ORDER BY column_name) INTO got
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mission_conversations';
  failures := failures || pg_temp.cw_eq('S1 colonnes', got,
    'account_id:text!,candidate_id:text!,candidate_ids:_text!,candidate_slug:text,chat_id:text,'
    'created_at:timestamptz!,created_by:uuid,enrollment_id:uuid,first_outbound_at:timestamptz,id:uuid!,'
    'last_inbound_at:timestamptz,last_mission_send_at:timestamptz,last_outbound_at:timestamptz,'
    'last_outbound_message_id:text,last_send_kind:text,organization_id:uuid!,outbound_pending_at:timestamptz,'
    'project_id:uuid!,source:text!,updated_at:timestamptz!');

  -- S2. Unicité, deux CHECK, clés étrangères (organisation et mission CASCADE, inscription SET NULL).
  SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), ' ; ' ORDER BY conname) INTO got
    FROM pg_constraint WHERE conrelid = 'public.mission_conversations'::regclass AND contype = 'u';
  failures := failures || pg_temp.cw_eq('S2 unicité', got,
    'mission_conversations_key=UNIQUE (organization_id, project_id, account_id, candidate_id)');
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.mission_conversations'::regclass AND contype = 'c'
     AND conname IN ('mission_conversations_source_check', 'mission_conversations_send_kind_check');
  failures := failures || pg_temp.cw_eq('S2 CHECK', n, 2);
  SELECT string_agg(a.attname || '>' || c.confrelid::regclass::text || '/' || c.confdeltype::text, ',' ORDER BY a.attname) INTO got
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.conrelid = 'public.mission_conversations'::regclass AND c.contype = 'f';
  failures := failures || pg_temp.cw_eq('S2 clés étrangères', got,
    'enrollment_id>sequence_enrollments/n,organization_id>organizations/c,project_id>sourcing_projects/c');

  -- S3. RLS active sur les deux tables ; une seule policy, en lecture, pour authenticated ; aucune sur le journal.
  SELECT string_agg(relname || '=' || relrowsecurity, ',' ORDER BY relname) INTO got
    FROM pg_class WHERE oid IN ('public.mission_conversations'::regclass, 'public.jcs_direct_write_log'::regclass);
  failures := failures || pg_temp.cw_eq('S3 RLS', got, 'jcs_direct_write_log=true,mission_conversations=true');
  SELECT string_agg(p.polname || '/' || p.polcmd::text || '/' || array_to_string(ARRAY(
           SELECT r::regrole::text FROM unnest(p.polroles) r ORDER BY 1), '+'), ',') INTO got
    FROM pg_policy p WHERE p.polrelid = 'public.mission_conversations'::regclass;
  failures := failures || pg_temp.cw_eq('S3 policies', got, 'mission_conversations_org_select/r/authenticated');
  SELECT count(*) INTO n FROM pg_policy WHERE polrelid = 'public.jcs_direct_write_log'::regclass;
  failures := failures || pg_temp.cw_eq('S3 policies du journal', n, 0);

  -- S4. Droits sur les tables : anon rien ; authenticated SELECT seul sur les liens, rien sur le journal.
  SELECT string_agg(r.rol || ' ' || t.tbl || ' ' || p.priv || '=' || has_table_privilege(r.rol, t.tbl, p.priv), ', ')
    INTO got
    FROM unnest(ARRAY['anon', 'authenticated']) r(rol)
    CROSS JOIN unnest(ARRAY['public.mission_conversations', 'public.jcs_direct_write_log']) t(tbl)
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv)
   WHERE has_table_privilege(r.rol, t.tbl, p.priv)
         IS DISTINCT FROM (r.rol = 'authenticated' AND t.tbl = 'public.mission_conversations' AND p.priv = 'SELECT');
  failures := failures || pg_temp.cw_eq('S4 droits sur les tables', got, NULL::text);
  IF has_sequence_privilege('anon', 'public.jcs_direct_write_log_id_seq', 'USAGE')
     OR has_sequence_privilege('authenticated', 'public.jcs_direct_write_log_id_seq', 'USAGE') THEN
    failures := failures || '[S4 séquence du journal ouverte à anon ou authenticated] ';
  END IF;

  -- S5. stage_write_guard : BEFORE, ROW, INSERT et UPDATE OF (4 colonnes), pas DELETE, activé,
  --     trié en C après stage_sync_from_legacy et avant update_job_candidate_status_updated_at.
  SELECT string_agg(format('%s/%s/%s', t.tgtype, t.tgenabled::text,
           (SELECT string_agg(a.attname, '+' ORDER BY a.attname) FROM unnest(t.tgattr::int2[]) k
              JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k)), ',') INTO got
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.job_candidate_status'::regclass AND t.tgname = 'stage_write_guard'
     AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 16 = 16 AND t.tgtype & 8 = 0
     AND t.tgname COLLATE "C" > 'stage_sync_from_legacy' COLLATE "C"
     AND t.tgname COLLATE "C" < 'update_job_candidate_status_updated_at' COLLATE "C";
  failures := failures || pg_temp.cw_eq('S5 garde', got, '23/O/organization_id+pipeline_stage+project_id+status');
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE t.tgrelid = 'public.mission_conversations'::regclass AND t.tgname = 'mission_conversations_same_org'
     AND t.tgtype & 1 = 1 AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 16 = 16 AND t.tgenabled = 'O';
  failures := failures || pg_temp.cw_eq('S5 déclencheur d''organisation des liens', n, 1);
  -- AFTER UPDATE OF tracking_data, ROW, activé, avec sa condition sur le marqueur.
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE t.tgrelid = 'public.sequence_enrollments'::regclass AND t.tgname = 'mission_conversations_gdpr_erase'
     AND t.tgtype = 17 AND t.tgenabled = 'O' AND t.tgqual IS NOT NULL
     AND (SELECT string_agg(a.attname, '+') FROM unnest(t.tgattr::int2[]) k
            JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = k) = 'tracking_data';
  failures := failures || pg_temp.cw_eq('S5 déclencheur d''effacement des liens', n, 1);

  -- S6. Index des lignes d'un candidat dans une organisation.
  SELECT pg_get_indexdef('public.idx_jcs_org_candidate'::regclass) INTO got;
  failures := failures || pg_temp.cw_eq('S6 idx_jcs_org_candidate', got,
    'CREATE INDEX idx_jcs_org_candidate ON public.job_candidate_status USING btree (organization_id, candidate_id)');

  -- S7. inmail_queue.project_id : uuid, une seule clé étrangère, ON DELETE SET NULL.
  SELECT string_agg(c.confrelid::regclass::text || '/' || c.confdeltype::text, ',') INTO got
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.inmail_queue'::regclass AND c.contype = 'f' AND a.attname = 'project_id';
  failures := failures || pg_temp.cw_eq('S7 inmail_queue.project_id', got, 'sourcing_projects/n');
  SELECT udt_name INTO got FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'inmail_queue' AND column_name = 'project_id';
  failures := failures || pg_temp.cw_eq('S7 type', got, 'uuid');

  -- S8. Mode de la garde : observe (0b-1) ou refuse (0b-5).
  IF v_mode IS NULL OR v_mode NOT IN ('observe', 'refuse') THEN
    failures := failures || format('[S8 mode de la garde : %s] ', coalesce(v_mode, 'NULL'));
  END IF;

  -- ===== D. Droits des fonctions (catalogues seulement) =====
  -- D1. set_candidate_stages : authenticated et service_role, ni anon ni PUBLIC ; SECURITY INVOKER.
  SELECT string_agg(x, '; ') INTO got FROM (
    SELECT 'anon' AS x WHERE has_function_privilege('anon', sig_sets, 'EXECUTE')
    UNION ALL SELECT 'refusée à ' || r FROM unnest(ARRAY['authenticated', 'service_role']) r
     WHERE NOT has_function_privilege(r, sig_sets, 'EXECUTE')
    UNION ALL SELECT 'PUBLIC' FROM pg_proc p WHERE p.oid = to_regprocedure(sig_sets)
      AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
    UNION ALL SELECT 'SECURITY DEFINER' FROM pg_proc p WHERE p.oid = to_regprocedure(sig_sets) AND p.prosecdef
  ) f;
  failures := failures || pg_temp.cw_eq('D1 set_candidate_stages', got, NULL::text);

  -- D2. Les douze fonctions serveur : service_role seul ; SECURITY INVOKER.
  SELECT string_agg(s.sig || ' ' || f.why, '; ') INTO got
    FROM unnest(sig_server) s(sig)
    CROSS JOIN LATERAL (
      SELECT 'absente' AS why WHERE to_regprocedure(s.sig) IS NULL
      UNION ALL SELECT 'exécutable par ' || r FROM unnest(ARRAY['anon', 'authenticated']) r
       WHERE to_regprocedure(s.sig) IS NOT NULL AND has_function_privilege(r, s.sig, 'EXECUTE')
      UNION ALL SELECT 'refusée à service_role'
       WHERE to_regprocedure(s.sig) IS NOT NULL AND NOT has_function_privilege('service_role', s.sig, 'EXECUTE')
      UNION ALL SELECT 'PUBLIC' FROM pg_proc p WHERE p.oid = to_regprocedure(s.sig)
        AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
      UNION ALL SELECT 'SECURITY DEFINER' FROM pg_proc p WHERE p.oid = to_regprocedure(s.sig) AND p.prosecdef
    ) f;
  failures := failures || pg_temp.cw_eq('D2 fonctions serveur', got, NULL::text);

  -- D3. Aides pures : ni anon ni PUBLIC ; authenticated et service_role.
  SELECT string_agg(s.sig || ' ' || f.why, '; ') INTO got
    FROM unnest(sig_help) s(sig)
    CROSS JOIN LATERAL (
      SELECT 'exécutable par anon' AS why WHERE has_function_privilege('anon', s.sig, 'EXECUTE')
      UNION ALL SELECT 'refusée à ' || r FROM unnest(ARRAY['authenticated', 'service_role']) r
       WHERE NOT has_function_privilege(r, s.sig, 'EXECUTE')
    ) f;
  failures := failures || pg_temp.cw_eq('D3 aides', got, NULL::text);

  -- D4. Mode, garde et déclencheur des liens : ni PUBLIC, ni anon, ni authenticated ;
  --     la garde et le déclencheur sont SECURITY DEFINER (journal fermé, contrôle d'organisation).
  SELECT string_agg(s.sig || ' ' || f.why, '; ') INTO got
    FROM unnest(sig_trg || ARRAY['public.jcs_stage_write_mode()']) s(sig)
    CROSS JOIN LATERAL (
      SELECT 'exécutable par ' || r AS why FROM unnest(ARRAY['anon', 'authenticated']) r
       WHERE has_function_privilege(r, s.sig, 'EXECUTE')
      UNION ALL SELECT 'PUBLIC' FROM pg_proc p WHERE p.oid = to_regprocedure(s.sig)
        AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
      UNION ALL SELECT 'SECURITY INVOKER' FROM pg_proc p WHERE p.oid = to_regprocedure(s.sig)
        AND s.sig <> 'public.jcs_stage_write_mode()' AND NOT p.prosecdef
    ) f;
  failures := failures || pg_temp.cw_eq('D4 garde', got, NULL::text);

  -- Droits exigés par les appels sous SET ROLE (jamais d'appel refusé).
  v_ok := has_function_privilege('authenticated', sig_sets, 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.set_candidate_stage(uuid, text, text, uuid, uuid, text)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.replace_process_steps(uuid, jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.candidate_stage_from_legacy(text, text, uuid)', 'EXECUTE')
      AND has_table_privilege('authenticated', 'public.job_candidate_status', 'SELECT')
      AND has_table_privilege('authenticated', 'public.job_candidate_status', 'INSERT')
      AND has_table_privilege('authenticated', 'public.job_candidate_status', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.mission_process_steps', 'UPDATE');
  INSERT INTO cw_flag VALUES ('auth', v_ok);
  IF NOT v_ok THEN
    failures := failures || '[droits de authenticated incomplets : blocs navigateur (W, G) non joués] ';
  END IF;
  -- D5. Tables lues et écrites par les fonctions serveur sous la clé de service.
  SELECT string_agg(t.tbl || ' ' || t.priv, ', ') INTO got
    FROM (VALUES ('public.mission_conversations', 'SELECT'), ('public.mission_conversations', 'INSERT'),
                 ('public.mission_conversations', 'UPDATE'), ('public.job_candidate_status', 'SELECT'),
                 ('public.job_candidate_status', 'INSERT'), ('public.job_candidate_status', 'UPDATE'),
                 ('public.sequence_enrollments', 'SELECT'), ('public.outreach_sequences', 'SELECT'),
                 ('public.sequence_step_executions', 'SELECT'), ('public.sequence_steps', 'SELECT'),
                 ('public.inmail_queue', 'SELECT'), ('public.sourcing_projects', 'SELECT'),
                 ('public.mission_process_steps', 'SELECT'), ('public.mission_process_steps', 'UPDATE')) t(tbl, priv)
   WHERE NOT has_table_privilege('service_role', t.tbl, t.priv);
  failures := failures || pg_temp.cw_eq('D5 droits de service_role', got, NULL::text);
  v_ok := got IS NULL AND has_function_privilege('service_role', 'public.set_candidate_stage(uuid, text, text, uuid, uuid, text)', 'EXECUTE')
          AND has_function_privilege('service_role', sig_sets, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM unnest(sig_server) s(sig)
                           WHERE NOT has_function_privilege('service_role', s.sig, 'EXECUTE'));
  INSERT INTO cw_flag VALUES ('svc', v_ok);

  INSERT INTO cw_fail SELECT 'S D', failures WHERE failures <> '';
END $$;

-- ===== W. set_candidate_stages (navigateur puis serveur), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m9 uuid := pg_temp.cw_id('m9');
  w1 uuid; w2 uuid; w3 uuid; w9 uuid;
  ct9 text;
  v jsonb;
  e jsonb;
  got text;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  w1 := pg_temp.cw_row(m1, 'W-1', 'discovered');
  w2 := pg_temp.cw_row(m1, 'W-2', 'shortlisted');
  w3 := pg_temp.cw_row(m1, 'W-3', 'discovered');
  w9 := pg_temp.cw_row(m9, 'W-9', 'discovered');
  ct9 := pg_temp.cw_ct(w9);

  IF (SELECT ok FROM cw_flag WHERE name = 'auth') THEN
    PERFORM pg_temp.cw_as(u_a);
    SET LOCAL ROLE authenticated;
    -- W1. Étapes de départ : À trier seulement ; doublon et NULL ignorés ; ligne de O2 introuvable.
    v := public.set_candidate_stages(ARRAY[w1, w2, w9, w1, NULL], 'contacted', 'user', NULL, NULL, NULL, ARRAY['to_sort']);
    RESET ROLE;
    SELECT string_agg(CASE x->>'id' WHEN w1::text THEN 'w1' WHEN w2::text THEN 'w2' WHEN w9::text THEN 'w9' ELSE '?' END
                      || '=' || (x->>'result') || '/' || coalesce(x->>'general_stage', x->>'hint', '-'), ' '
                      ORDER BY CASE x->>'id' WHEN w1::text THEN 1 WHEN w2::text THEN 2 ELSE 3 END) INTO got
      FROM jsonb_array_elements(v) x;
    failures := failures || pg_temp.cw_eq('W1 résultats', got,
      'w1=updated/contacted w2=skipped/retained w9=error/STAGE_ROW_NOT_FOUND');
    SELECT x->>'code' INTO got FROM jsonb_array_elements(v) x WHERE x->>'id' = w9::text;
    failures := failures || pg_temp.cw_eq('W1 code de la ligne de O2', got, 'P0002')
                         || pg_temp.cw_eq('W1 ligne de O1', pg_temp.cw_st(w1), 'contacted/user')
                         || pg_temp.cw_eq('W1 ligne ignorée', pg_temp.cw_st(w2), 'retained/user')
                         || pg_temp.cw_eq('W1 ligne de O2 réécrite', pg_temp.cw_ct(w9), ct9);

    -- W2. Sans étape de départ : deux lignes écartées.
    PERFORM pg_temp.cw_as(u_a);
    SET LOCAL ROLE authenticated;
    v := public.set_candidate_stages(ARRAY[w2, w3], 'rejected', 'user');
    RESET ROLE;
    SELECT string_agg(x->>'result', ',') INTO got FROM jsonb_array_elements(v) x;
    failures := failures || pg_temp.cw_eq('W2', got, 'updated,updated')
                         || pg_temp.cw_eq('W2 lignes', pg_temp.cw_st(w2) || ' ' || pg_temp.cw_st(w3), 'rejected/user rejected/user');

    -- W3. Origine réservée au serveur : refus rendu par ligne, sans exception.
    PERFORM pg_temp.cw_as(u_a);
    SET LOCAL ROLE authenticated;
    v := public.set_candidate_stages(ARRAY[w1], 'replied', 'system');
    RESET ROLE;
    SELECT (x->>'result') || '/' || (x->>'hint') INTO got FROM jsonb_array_elements(v) x;
    failures := failures || pg_temp.cw_eq('W3 origine system', got, 'error/STAGE_SOURCE_FORBIDDEN');

    -- W4. Plafond : 201 lignes refusées en entier.
    PERFORM pg_temp.cw_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      v := public.set_candidate_stages(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)), 'to_sort', 'user');
      got := 'accepté';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS got = PG_EXCEPTION_HINT;
    END;
    RESET ROLE;
    failures := failures || pg_temp.cw_eq('W4 201 lignes', got, 'STAGE_BATCH_TOO_LARGE');
    PERFORM pg_temp.cw_as(NULL);
  END IF;

  -- W5. Serveur : l'organisation donnée filtre la ligne (O2 vue de O1 : introuvable).
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  v := public.set_candidate_stages(ARRAY[w9], 'contacted', 'system', o1);
  SELECT (x->>'result') || '/' || (x->>'code') INTO got FROM jsonb_array_elements(v) x;
  failures := failures || pg_temp.cw_eq('W5 serveur, autre organisation', got, 'error/P0002')
                       || pg_temp.cw_eq('W5 ligne de O2 réécrite', pg_temp.cw_ct(w9), ct9);
  -- W6. Liste vide : tableau vide.
  failures := failures || pg_temp.cw_eq('W6 liste vide', public.set_candidate_stages('{}'::uuid[], 'contacted', 'system', o1), '[]'::jsonb);
  PERFORM pg_temp.cw_as(NULL);

  -- W7. Statique : seuls les refus métier sont rendus par ligne.
  SELECT pg_get_functiondef('public.set_candidate_stages(uuid[], text, text, uuid, uuid, text, text[])'::regprocedure) INTO got;
  IF position('EXCEPTION WHEN invalid_parameter_value OR no_data_found THEN' IN got) = 0
     OR got ~* 'WHEN\s+OTHERS' THEN
    failures := failures || '[W7 set_candidate_stages capture d''autres erreurs que 22023 et P0002] ';
  END IF;

  INSERT INTO cw_fail SELECT 'W', failures WHERE failures <> '';
END $$;

-- ===== A. apply_mission_candidate_stage (clé de service), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m9 uuid := pg_temp.cw_id('m9');
  d1 uuid; d2 uuid; oa uuid; ob uuid; sa uuid;
  ct text;
  v jsonb;
  rw public.job_candidate_status%ROWTYPE;
  got text;
  n integer;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  PERFORM pg_temp.cw_as(NULL, 'service_role');

  -- A1. Aucune ligne : création À trier (forme project:), puis Retenu ; second appel sans création.
  v := public.apply_mission_candidate_stage(o1, m1,
         pg_temp.cw_cand(ARRAY['A-new', 'A-new-2'], NULL, 'https://www.linkedin.com/in/alice-a/')
           || '{"name":"Alice A","headline":"Juriste"}'::jsonb,
         'retained', 'user', NULL, NULL, NULL, u_a);
  SELECT * INTO rw FROM public.job_candidate_status WHERE project_id = m1 AND candidate_id = 'A-new';
  failures := failures || pg_temp.cw_eq('A1', (v->>'created') || '/' || (v->'rows'->0->>'result') || '/' || rw.job_id || '/'
                                         || rw.created_by || '/' || rw.general_stage || '/' || rw.candidate_name || '/'
                                         || rw.linkedin_profile_url,
                                         'true/updated/project:' || m1 || '/' || u_a || '/retained/Alice A/https://www.linkedin.com/in/alice-a/');
  ct := pg_temp.cw_ct(rw.id);
  v := public.apply_mission_candidate_stage(o1, m1, pg_temp.cw_cand(ARRAY['A-new']), 'retained', 'user',
                                            NULL, NULL, NULL, u_a);
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE project_id = m1 AND candidate_id = 'A-new';
  failures := failures || pg_temp.cw_eq('A1 second appel', (v->>'created') || '/' || (v->'rows'->0->>'result') || '/' || n
                                         || '/' || (pg_temp.cw_ct(rw.id) = ct), 'false/unchanged/1/true');

  -- A2. Mission d'une autre organisation, organisation absente, candidat sans identifiant.
  failures := failures
    || pg_temp.cw_eq('A2 mission de O2', pg_temp.cw_try(format(
         'SELECT public.apply_mission_candidate_stage(%L, %L, %L::jsonb, ''retained'', ''user'')',
         o1, m9, pg_temp.cw_cand(ARRAY['A-x'])))->>'hint', 'STAGE_MISSION_NOT_FOUND')
    || pg_temp.cw_eq('A2 sans organisation', pg_temp.cw_try(format(
         'SELECT public.apply_mission_candidate_stage(NULL, %L, %L::jsonb, ''retained'', ''user'')',
         m1, pg_temp.cw_cand(ARRAY['A-x'])))->>'hint', 'STAGE_MISSION_REQUIRED')
    || pg_temp.cw_eq('A2 sans identifiant', pg_temp.cw_try(format(
         'SELECT public.apply_mission_candidate_stage(%L, %L, ''{}''::jsonb, ''retained'', ''user'')',
         o1, m1))->>'hint', 'STAGE_CANDIDATE_REQUIRED');

  -- A3. Deux doublons (project:X et X, deux auteurs) : tous deux avancés.
  d1 := pg_temp.cw_row(m2, 'A-dup', 'discovered', NULL, u_a);
  d2 := pg_temp.cw_row(m2, 'A-dup', 'scored', NULL, u_b, m2::text);
  v := public.apply_mission_candidate_stage(o1, m2, pg_temp.cw_cand(ARRAY['A-dup']), 'contacted', 'system');
  SELECT string_agg(x->>'result', ',') INTO got FROM jsonb_array_elements(v->'rows') x;
  failures := failures || pg_temp.cw_eq('A3', got || ' ' || pg_temp.cw_st(d1) || ' ' || pg_temp.cw_st(d2),
                                        'updated,updated contacted/system contacted/system');

  -- A4. Seules les lignes d'un auteur (p_only_created_by).
  oa := pg_temp.cw_row(m2, 'A-own', 'discovered', NULL, u_a);
  ob := pg_temp.cw_row(m2, 'A-own', 'discovered', NULL, u_b, m2::text);
  ct := pg_temp.cw_ct(oa);
  v := public.apply_mission_candidate_stage(o1, m2, pg_temp.cw_cand(ARRAY['A-own']), 'retained', 'user',
                                            p_only_created_by => u_b);
  failures := failures || pg_temp.cw_eq('A4', jsonb_array_length(v->'rows') || ' ' || pg_temp.cw_st(ob) || ' '
                                        || (pg_temp.cw_ct(oa) = ct), '1 retained/user true');

  -- A5. Étapes de départ : la ligne à trier passe, la ligne retenue rend skipped.
  v := public.apply_mission_candidate_stage(o1, m2, pg_temp.cw_cand(ARRAY['A-own']), 'rejected', 'user',
                                            NULL, NULL, ARRAY['to_sort']);
  SELECT string_agg(x->>'result', ',' ORDER BY x->>'result') INTO got FROM jsonb_array_elements(v->'rows') x;
  failures := failures || pg_temp.cw_eq('A5', got || ' ' || pg_temp.cw_st(oa) || ' ' || pg_temp.cw_st(ob),
                                        'skipped,updated rejected/user retained/user');

  -- A6. Rapprochement par le slug, puis par l'adresse du profil.
  sa := pg_temp.cw_row(m1, 'A-autre-id', 'discovered', NULL, NULL, NULL, 'https://www.linkedin.com/in/Anne-Slug/?trk=x');
  v := public.apply_mission_candidate_stage(o1, m1, '{"slug":"anne-slug"}'::jsonb, 'retained', 'user');
  failures := failures || pg_temp.cw_eq('A6 slug', (v->'rows'->0->>'result') || ' ' || pg_temp.cw_st(sa), 'updated retained/user');
  v := public.apply_mission_candidate_stage(o1, m1, '{"profile_url":"https://linkedin.com/in/anne-slug"}'::jsonb,
                                            'contacted', 'system');
  failures := failures || pg_temp.cw_eq('A6 adresse', (v->'rows'->0->>'result') || ' ' || pg_temp.cw_st(sa), 'updated contacted/system');
  -- A6 bis. Slug sans ligne et avec créateur : aucune création (identifiant obligatoire).
  v := public.apply_mission_candidate_stage(o1, m1, '{"slug":"personne-inconnue"}'::jsonb, 'contacted', 'system',
                                            NULL, NULL, NULL, u_a);
  failures := failures || pg_temp.cw_eq('A6 bis', (v->>'created') || '/' || (v->'rows')::text, 'false/[]');

  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO cw_fail SELECT 'A', failures WHERE failures <> '';
END $$;

-- ===== O. Envoi (record_candidate_outbound), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m9 uuid := pg_temp.cw_id('m9');
  e5 uuid := 'e0b00000-0000-4000-8000-000000000105';
  x uuid;
  ct text;
  v jsonb; v2 jsonb;
  lk public.mission_conversations%ROWTYPE;
  rw public.job_candidate_status%ROWTYPE;
  got text;
  n integer;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  -- Inscription de O-5 dans la séquence de M2 (sans jeton).
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, current_step_order)
  VALUES (e5, pg_temp.cw_id('q2'), 'acc_a', 'O-5', o1, u_a, 'active', 1);

  -- Premier envoi sous SET ROLE service_role (droits contrôlés au bloc D), les autres en postgres.
  IF (SELECT ok FROM cw_flag WHERE name = 'svc') THEN
    PERFORM pg_temp.cw_as(NULL, 'service_role');
    SET LOCAL ROLE service_role;
    v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-1a","O-1b"],"slug":"o-un"}'::jsonb, 'manual', m1,
                                          'chat-o1', 'msg-o1', NULL, u_a);
    RESET ROLE;
  ELSE
    failures := failures || '[O droits de service_role incomplets : premier envoi joué en postgres] ';
    PERFORM pg_temp.cw_as(NULL, 'service_role');
    v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-1a","O-1b"],"slug":"o-un"}'::jsonb, 'manual', m1,
                                          'chat-o1', 'msg-o1', NULL, u_a);
  END IF;
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  -- O1. Mission explicite : lien et ligne créée « Contacté » (system).
  SELECT * INTO lk FROM public.mission_conversations
   WHERE organization_id = o1 AND project_id = m1 AND account_id = 'acc_a' AND candidate_id = 'O-1a';
  failures := failures || pg_temp.cw_eq('O1 réponse', (v->>'project_id') || '/' || (v->>'via') || '/' || (v->>'link_id'),
                                        m1 || '/explicit/' || lk.id)
    || pg_temp.cw_eq('O1 lien', lk.source || '/' || lk.chat_id || '/' || lk.last_outbound_message_id || '/'
                     || lk.last_send_kind || '/' || (lk.last_mission_send_at = now()) || '/' || (lk.first_outbound_at = now())
                     || '/' || (lk.last_outbound_at = now()) || '/' || array_to_string(lk.candidate_ids, '+') || '/'
                     || lk.candidate_slug || '/' || lk.created_by || '/' || coalesce(lk.outbound_pending_at::text, '-'),
                     'manual/chat-o1/msg-o1/message/true/true/true/O-1b/o-un/' || u_a || '/-');
  SELECT * INTO rw FROM public.job_candidate_status WHERE project_id = m1 AND candidate_id = 'O-1a';
  failures := failures || pg_temp.cw_eq('O1 ligne', rw.job_id || '/' || rw.created_by || '/' || rw.general_stage || '/'
                                        || rw.decision_source || '/' || (rw.contacted_at = now()) || '/' || (v->'rows'->0->>'result'),
                                        'project:' || m1 || '/' || u_a || '/contacted/system/true/updated');
  -- O3. Rejeu : même lien, ligne non réécrite.
  ct := pg_temp.cw_ct(rw.id);
  v2 := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-1a","O-1b"],"slug":"o-un"}'::jsonb, 'manual', m1,
                                         'chat-o1', 'msg-o1', NULL, u_a);
  SELECT count(*) INTO n FROM public.mission_conversations WHERE organization_id = o1 AND candidate_id = 'O-1a';
  failures := failures || pg_temp.cw_eq('O3 rejeu', (v2->>'link_id' = v->>'link_id') || '/' || n || '/'
                                        || (v2->'rows'->0->>'result') || '/' || (v2->'rows'->0->>'changed') || '/'
                                        || (pg_temp.cw_ct(rw.id) = ct), 'true/1/kept/false/true');

  -- O2. Marqueur seul : outbound_pending_at, étape inchangée ; un envoi seulement en cours ne
  --     sert pas à la résolution ; après l'envoi, le marqueur reste posé.
  x := pg_temp.cw_row(m1, 'O-2', 'discovered');
  ct := pg_temp.cw_ct(x);
  v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-2"]}'::jsonb, 'manual', m1, 'chat-o2', NULL, NULL, u_a, true);
  SELECT * INTO lk FROM public.mission_conversations WHERE organization_id = o1 AND candidate_id = 'O-2';
  failures := failures || pg_temp.cw_eq('O2 marqueur', (lk.outbound_pending_at = now()) || '/'
                                        || coalesce(lk.last_mission_send_at::text, '-') || '/' || (v->'rows')::text || '/'
                                        || (pg_temp.cw_ct(x) = ct), 'true/-/[]/true');
  SELECT count(*) INTO n FROM public.resolve_conversation_mission(o1, 'acc_a', 'chat-o2', '{"ids":["O-2"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('O2 envoi en cours ignoré par la résolution', n, 0);
  v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-2"]}'::jsonb, 'manual', m1, 'chat-o2', 'msg-o2', NULL, u_a);
  SELECT * INTO lk FROM public.mission_conversations WHERE organization_id = o1 AND candidate_id = 'O-2';
  failures := failures || pg_temp.cw_eq('O2 après l''envoi', (lk.outbound_pending_at IS NOT NULL) || '/'
                                        || (lk.last_mission_send_at IS NOT NULL) || '/' || pg_temp.cw_st(x),
                                        'true/true/contacted/system');

  -- O4. Ligne écartée : kept.
  x := pg_temp.cw_row(m1, 'O-4', 'dismissed');
  v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-4"]}'::jsonb, 'manual', m1, NULL, NULL, NULL, u_a);
  failures := failures || pg_temp.cw_eq('O4 écartée', (v->'rows'->0->>'result') || ' ' || pg_temp.cw_st(x), 'kept rejected/user');

  -- O5. Par l'inscription : mission de la séquence, lien de l'inscription, type invitation.
  v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-5"]}'::jsonb, 'sequence', NULL, NULL, 'msg-o5', e5, u_a,
                                        false, 'invitation');
  SELECT * INTO lk FROM public.mission_conversations WHERE organization_id = o1 AND candidate_id = 'O-5';
  SELECT * INTO rw FROM public.job_candidate_status WHERE project_id = m2 AND candidate_id = 'O-5';
  failures := failures || pg_temp.cw_eq('O5', (v->>'project_id') || '/' || (v->>'via') || '/' || lk.project_id || '/'
                                        || lk.enrollment_id || '/' || lk.source || '/' || lk.last_send_kind || '/'
                                        || rw.general_stage,
                                        m2 || '/enrollment/' || m2 || '/' || e5 || '/sequence/invitation/contacted');

  -- O6. Mission de O2 : ignorée, puis résolution (ligne contactée de M2).
  x := pg_temp.cw_row(m2, 'O-6', 'messaged');
  v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-6"]}'::jsonb, 'manual', m9, 'chat-o6', NULL, NULL, u_a);
  SELECT count(*) INTO n FROM public.job_candidate_status WHERE candidate_id = 'O-6' AND project_id = m9;
  failures := failures || pg_temp.cw_eq('O6', (v->>'project_id') || '/' || (v->>'via') || '/' || n || '/'
                                        || (SELECT string_agg(source || '@' || (project_id = m2), ',')
                                              FROM public.mission_conversations WHERE candidate_id = 'O-6'),
                                        m2 || '/rows/0/inferred@true');

  -- O7. Sans mission : no_mission, ni lien ni ligne.
  v := public.record_candidate_outbound(o1, 'acc_a', '{"ids":["O-7"]}'::jsonb, 'manual', NULL, 'chat-o7', NULL, NULL, u_a);
  SELECT count(*) INTO n FROM public.mission_conversations WHERE candidate_id = 'O-7';
  failures := failures || pg_temp.cw_eq('O7', (v->>'reason') || '/' || n || '/'
                                        || (SELECT count(*) FROM public.job_candidate_status WHERE candidate_id = 'O-7'),
                                        'no_mission/0/0');

  -- O8. Entrées manquantes, origine inconnue.
  v := public.record_candidate_outbound(o1, '  ', '{"ids":["O-8"]}'::jsonb, 'manual', m1);
  failures := failures || pg_temp.cw_eq('O8 sans compte', v->>'reason', 'missing_input');
  v := public.record_candidate_outbound(o1, 'acc_a', '{"slug":"o-huit"}'::jsonb, 'manual', m1);
  failures := failures || pg_temp.cw_eq('O8 sans identifiant', v->>'reason', 'missing_input');
  failures := failures || pg_temp.cw_eq('O8 origine inconnue', pg_temp.cw_try(format(
      'SELECT public.record_candidate_outbound(%L, ''acc_a'', ''{"ids":["O-9"]}''::jsonb, ''robot'', %L)', o1, m1))->>'hint',
      'LINK_SOURCE_UNKNOWN');

  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO cw_fail SELECT 'O', failures WHERE failures <> '';
END $$;

-- ===== R. Réponse (record_candidate_inbound), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m3 uuid := pg_temp.cw_id('m3');
  m9 uuid := pg_temp.cw_id('m9');
  p jsonb := '{"ids":["ACoP","AEMP"],"slug":"pierre-p"}'::jsonb;
  e_pr uuid := 'e0b00000-0000-4000-8000-000000000201';
  e_np uuid := 'e0b00000-0000-4000-8000-000000000202';
  e_z uuid := 'e0b00000-0000-4000-8000-000000000203';
  r1 uuid; r2 uuid; r3 uuid; r9 uuid; q1 uuid; q2 uuid; rx uuid; pr uuid; np uuid; z1 uuid; z2 uuid; l1 uuid;
  snap text; snap2 text;
  ct text;
  v jsonb;
  lk public.mission_conversations%ROWTYPE;
  rw public.job_candidate_status%ROWTYPE;
  got text;
  n integer;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  PERFORM pg_temp.cw_as(NULL, 'service_role');

  -- Scénario A. P contacté dans M1 (conversation C1) et dans M2 (autre conversation, envoi plus
  -- récent), Retenu dans M3, contacté dans M9 (O2).
  r1 := pg_temp.cw_row(m1, 'ACoP', 'messaged');
  r2 := pg_temp.cw_row(m2, 'AEMP', 'messaged');
  r3 := pg_temp.cw_row(m3, 'ACoP', 'shortlisted');
  r9 := pg_temp.cw_row(m9, 'ACoP', 'messaged');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['ACoP','AEMP'], 'pierre-p', 'C1', 'manual', NULL, u_a,
                                            'outbound', 'mC1', now() - interval '2 days', 'message');
  PERFORM public.touch_mission_conversation(o1, m2, 'acc_a', ARRAY['ACoP'], NULL, 'C2', 'manual', NULL, u_a,
                                            'outbound', 'mC2', now() - interval '1 day', 'message');
  SELECT string_agg(ctid::text, ',' ORDER BY id) INTO snap FROM public.job_candidate_status WHERE id IN (r2, r3, r9);
  -- R1. Par la conversation C1 : M1 seule passe « A répondu ».
  v := public.record_candidate_inbound(o1, 'acc_a', p, 'C1');
  SELECT string_agg(ctid::text, ',' ORDER BY id) INTO snap2 FROM public.job_candidate_status WHERE id IN (r2, r3, r9);
  SELECT * INTO lk FROM public.mission_conversations WHERE organization_id = o1 AND project_id = m1 AND candidate_id = 'ACoP';
  failures := failures || pg_temp.cw_eq('R1', (v->>'project_id') || '/' || (v->>'via') || '/' || (v->'rows'->0->>'result')
                                        || '/' || (v->'contacted_rows'->0->>'result') || '/' || pg_temp.cw_st(r1) || '/'
                                        || (snap2 = snap) || '/' || (lk.last_inbound_at = now()),
                                        m1 || '/chat/updated/kept/replied/system/true/true');
  -- R1 bis. Rejeu : aucune ligne réécrite.
  SELECT string_agg(ctid::text, ',' ORDER BY id) INTO snap FROM public.job_candidate_status WHERE id IN (r1, r2, r3, r9);
  v := public.record_candidate_inbound(o1, 'acc_a', p, 'C1');
  SELECT string_agg(ctid::text, ',' ORDER BY id) INTO snap2 FROM public.job_candidate_status WHERE id IN (r1, r2, r3, r9);
  failures := failures || pg_temp.cw_eq('R1 rejeu', (v->'rows'->0->>'changed') || '/' || (snap2 = snap), 'false/true');
  -- R2. Conversation inconnue : le profil sur ce compte, dernier envoi attribué (M2).
  v := public.record_candidate_inbound(o1, 'acc_a', p, 'C-autre');
  failures := failures || pg_temp.cw_eq('R2 profil', (v->>'project_id') || '/' || (v->>'via') || '/' || pg_temp.cw_st(r2),
                                        m2 || '/profile/replied/system');

  -- R3. Sans lien : rang 4, la ligne contactée la plus récente (M2).
  q1 := pg_temp.cw_row(m1, 'R-q', 'messaged');
  q2 := pg_temp.cw_row(m2, 'R-q', 'messaged');
  PERFORM pg_temp.cw_force(q1, 'contacted_at', now() - interval '5 days');
  PERFORM pg_temp.cw_force(q2, 'contacted_at', now() - interval '1 day');
  ct := pg_temp.cw_ct(q1);
  v := public.record_candidate_inbound(o1, 'acc_b', '{"ids":["R-q"]}'::jsonb, 'chat-rq');
  failures := failures || pg_temp.cw_eq('R3 rang 4', (v->>'project_id') || '/' || (v->>'via') || '/' || pg_temp.cw_st(q2)
                                        || '/' || (pg_temp.cw_ct(q1) = ct), m2 || '/rows/replied/system/true');

  -- R4. Ligne de O1 à « Contacté » portant M9 : no_mission, sans exception.
  rx := pg_temp.cw_row(m9, 'R-x', 'messaged', NULL, u_a, NULL, NULL, o1);
  ct := pg_temp.cw_ct(rx);
  v := pg_temp.cw_try(format('SELECT public.record_candidate_inbound(%L, ''acc_a'', ''{"ids":["R-x"]}''::jsonb)', o1));
  failures := failures || pg_temp.cw_eq('R4 ligne portant M9', coalesce(v->>'error', v->>'reason') || '/' || (pg_temp.cw_ct(rx) = ct),
                                        'no_mission/true');

  -- R5. Preuve d'envoi : Retenu avec une exécution envoyée de l'inscription de M1 :
  --     « Contacté » puis « A répondu ». Sans exécution : not_contacted.
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, current_step_order)
  VALUES (e_pr, pg_temp.cw_id('q1'), 'acc_a', 'R-pr', o1, u_a, 'active', 1),
         (e_np, pg_temp.cw_id('q1'), 'acc_a', 'R-np', o1, u_a, 'active', 0),
         (e_z, pg_temp.cw_id('q1'), 'acc_a', 'R-z', o1, u_a, 'active', 1);
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES (e_pr, pg_temp.cw_id('st1m'), 1, now() - interval '3 days', 'sent', now() - interval '3 days'),
         (e_np, pg_temp.cw_id('st1m'), 1, now() + interval '1 day', 'scheduled', NULL);
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  pr := pg_temp.cw_row(m1, 'R-pr', 'shortlisted');
  np := pg_temp.cw_row(m1, 'R-np', 'shortlisted');
  v := public.record_candidate_inbound(o1, 'acc_a', '{"ids":["R-pr"]}'::jsonb, 'chat-pr');
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = pr;
  failures := failures || pg_temp.cw_eq('R5 preuve d''envoi', (v->>'project_id') || '/' || (v->>'via') || '/'
                                        || (v->'contacted_rows'->0->>'result') || '/' || (v->'rows'->0->>'result') || '/'
                                        || rw.general_stage || '/' || rw.decision_source || '/' || (rw.contacted_at = now())
                                        || '/' || (rw.replied_at = now()),
                                        m1 || '/enrollment/updated/updated/replied/system/true/true');
  ct := pg_temp.cw_ct(np);
  v := public.record_candidate_inbound(o1, 'acc_a', '{"ids":["R-np"]}'::jsonb, 'chat-np');
  failures := failures || pg_temp.cw_eq('R5 sans envoi', (v->'contacted_rows')::text || '/' || (v->'rows'->0->>'result') || '/'
                                        || pg_temp.cw_st(np) || '/' || (pg_temp.cw_ct(np) = ct),
                                        '[]/not_contacted/retained/user/true');

  -- R6. Rang 0 : inscription A sur M1, puis lien manuel M2 plus récent sur le même compte.
  z1 := pg_temp.cw_row(m1, 'R-z', 'messaged');
  z2 := pg_temp.cw_row(m2, 'R-z', 'messaged');
  PERFORM public.touch_mission_conversation(o1, m2, 'acc_a', ARRAY['R-z'], NULL, 'chat-z2', 'manual', NULL, u_a,
                                            'outbound', NULL, now(), 'message');
  ct := pg_temp.cw_ct(z2);
  v := public.record_candidate_inbound(o1, '', '{"ids":["R-z"]}'::jsonb, NULL, ARRAY[e_z], true);
  SELECT count(*) INTO n FROM public.mission_conversations WHERE btrim(account_id) = '';
  failures := failures || pg_temp.cw_eq('R6 rang 0', (v->>'project_id') || '/' || (v->>'via') || '/' || coalesce(v->>'link_id', '-')
                                        || '/' || pg_temp.cw_st(z1) || '/' || (pg_temp.cw_ct(z2) = ct) || '/' || n,
                                        m1 || '/enrollment/-/replied/system/true/0');
  -- Sans p_enrollment_first, le profil sur le compte l'emporte (M2).
  v := public.record_candidate_inbound(o1, 'acc_a', '{"ids":["R-z"]}'::jsonb, NULL, ARRAY[e_z], false);
  failures := failures || pg_temp.cw_eq('R6 sans rang 0', v->>'project_id', m2::text);

  -- R7. Rattrapage : message antérieur au premier contact, rien ; postérieur, A répondu à sa date.
  l1 := pg_temp.cw_row(m1, 'R-late', 'messaged');
  PERFORM pg_temp.cw_force(l1, 'contacted_at', now() - interval '3 days');
  ct := pg_temp.cw_ct(l1);
  v := public.record_candidate_inbound(o1, 'acc_a', '{"ids":["R-late"]}'::jsonb, 'chat-late', NULL, false, now() - interval '5 days');
  SELECT count(*) INTO n FROM public.mission_conversations WHERE candidate_id = 'R-late';
  failures := failures || pg_temp.cw_eq('R7 avant le contact', (v->>'reason') || '/' || (pg_temp.cw_ct(l1) = ct) || '/' || n,
                                        'before_contact/true/0');
  v := public.record_candidate_inbound(o1, 'acc_a', '{"ids":["R-late"]}'::jsonb, 'chat-late', NULL, false, now() - interval '1 day');
  SELECT * INTO lk FROM public.mission_conversations WHERE candidate_id = 'R-late';
  failures := failures || pg_temp.cw_eq('R7 après le contact', (v->'rows'->0->>'result') || '/' || pg_temp.cw_st(l1) || '/'
                                        || (lk.last_inbound_at = now() - interval '1 day') || '/' || lk.chat_id || '/' || lk.source,
                                        'updated/replied/system/true/chat-late/inferred');

  -- R8. Entrées manquantes.
  v := public.record_candidate_inbound(o1, 'acc_a', '{}'::jsonb);
  failures := failures || pg_temp.cw_eq('R8', v->>'reason', 'missing_input');

  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO cw_fail SELECT 'R', failures WHERE failures <> '';
END $$;

-- ===== M. Message propre (record_own_message), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m3 uuid := pg_temp.cw_id('m3');
  e_me uuid := 'e0b00000-0000-4000-8000-000000000301';
  e_mn uuid := 'e0b00000-0000-4000-8000-000000000302';
  xa uuid; xd uuid; xe uuid; f1 uuid; f2 uuid; g3 uuid; h3 uuid; i2 uuid; i3 uuid; j1 uuid; k1 uuid; n3 uuid;
  ct text; ct2 text;
  sent_before timestamptz;
  v jsonb;
  lk public.mission_conversations%ROWTYPE;
  got text;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, current_step_order)
  VALUES (e_me, pg_temp.cw_id('q1'), 'acc_a', 'M-e', o1, u_a, 'active', 2);
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES (e_me, pg_temp.cw_id('st1i'), 2, now() - interval '1 day', 'sent', now() - interval '1 day');
  PERFORM pg_temp.cw_as(NULL, 'service_role');

  -- M1. Identifiant de message déjà enregistré (envoi d'il y a une heure) : écho.
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['M-a'], NULL, 'chat-ma', 'manual', NULL, u_a,
                                            'outbound', 'mid-a', now() - interval '1 hour', 'message');
  xa := pg_temp.cw_row(m1, 'M-a', 'shortlisted');
  ct := pg_temp.cw_ct(xa);
  v := public.record_own_message(o1, 'acc_a', 'chat-ma', 'mid-a', '{}'::jsonb);
  failures := failures || pg_temp.cw_eq('M1 message connu', (v->>'result') || '/' || (pg_temp.cw_ct(xa) = ct), 'konekt_send/true');

  -- M2. Marqueur de moins de 10 minutes : écho.
  PERFORM public.touch_mission_conversation(o1, m2, 'acc_a', ARRAY['M-b'], NULL, NULL, 'manual', NULL, u_a,
                                            'pending', NULL, now(), NULL);
  PERFORM pg_temp.cw_row(m2, 'M-b', 'shortlisted');
  v := public.record_own_message(o1, 'acc_a', 'chat-mb', 'mid-b', '{"ids":["M-b"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('M2 marqueur', v->>'result', 'konekt_send');

  -- M3. Envoi enregistré il y a 2 minutes, autre identifiant de message : écho.
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['M-c'], NULL, 'chat-mc', 'manual', NULL, u_a,
                                            'outbound', 'mid-c', now() - interval '2 minutes', 'message');
  PERFORM pg_temp.cw_row(m1, 'M-c', 'shortlisted');
  v := public.record_own_message(o1, 'acc_a', 'chat-mc', 'mid-autre', '{"ids":["M-c"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('M3 envoi récent', v->>'result', 'konekt_send');

  -- M4. Note d'invitation : par le lien (invitation sans conversation), puis par l'exécution
  --     connection_request sans lien (lien créé). Aucune étape.
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['M-d'], NULL, NULL, 'sequence', NULL, u_a,
                                            'outbound', NULL, now() - interval '1 day', 'invitation');
  xd := pg_temp.cw_row(m1, 'M-d', 'shortlisted');
  ct := pg_temp.cw_ct(xd);
  v := public.record_own_message(o1, 'acc_a', 'chat-md', 'mid-d', '{"ids":["M-d"]}'::jsonb);
  SELECT * INTO lk FROM public.mission_conversations WHERE candidate_id = 'M-d';
  failures := failures || pg_temp.cw_eq('M4 par le lien', (v->>'result') || '/' || lk.chat_id || '/' || (pg_temp.cw_ct(xd) = ct),
                                        'invitation_note/chat-md/true');
  xe := pg_temp.cw_row(m1, 'M-e', 'shortlisted');
  ct := pg_temp.cw_ct(xe);
  v := public.record_own_message(o1, 'acc_a', 'chat-me', 'mid-e', '{"ids":["M-e"]}'::jsonb);
  SELECT * INTO lk FROM public.mission_conversations WHERE candidate_id = 'M-e';
  failures := failures || pg_temp.cw_eq('M4 par l''exécution', (v->>'result') || '/' || (v->>'link_id' = lk.id::text) || '/'
                                        || lk.project_id || '/' || lk.source || '/' || lk.last_send_kind || '/' || lk.chat_id || '/'
                                        || (lk.last_mission_send_at = now() - interval '1 day') || '/' || (pg_temp.cw_ct(xe) = ct),
                                        'invitation_note/true/' || m1 || '/sequence/invitation/chat-me/true/true');

  -- M5. Fil lié à M1, P Retenu dans M2 : M1 seule, M2 inchangée, envoi attribué inchangé ;
  --     la réponse suivante va à M1.
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['M-f'], NULL, 'chat-mf', 'manual', NULL, u_a,
                                            'outbound', 'mid-f0', now() - interval '1 day', 'message');
  f1 := pg_temp.cw_row(m1, 'M-f', 'messaged');
  f2 := pg_temp.cw_row(m2, 'M-f', 'shortlisted');
  ct2 := pg_temp.cw_ct(f2);
  SELECT last_mission_send_at INTO sent_before FROM public.mission_conversations WHERE candidate_id = 'M-f';
  v := public.record_own_message(o1, 'acc_a', 'chat-mf', 'mid-f', '{"ids":["M-f"]}'::jsonb);
  SELECT * INTO lk FROM public.mission_conversations WHERE candidate_id = 'M-f';
  failures := failures || pg_temp.cw_eq('M5 fil lié', (v->>'result') || '/' || (v->>'project_id') || '/' || (pg_temp.cw_ct(f2) = ct2)
                                        || '/' || (lk.last_mission_send_at = sent_before) || '/' || (lk.last_outbound_at = now()),
                                        'linked/' || m1 || '/true/true/true');
  v := public.record_candidate_inbound(o1, 'acc_a', '{"ids":["M-f"]}'::jsonb, 'chat-mf');
  failures := failures || pg_temp.cw_eq('M5 réponse suivante', (v->>'project_id') || '/' || pg_temp.cw_st(f1) || '/'
                                        || pg_temp.cw_st(f2), m1 || '/replied/system/retained/user');

  -- M6. Fil lié à M3, P Retenu dans M3 : M3 « Contacté ».
  PERFORM public.touch_mission_conversation(o1, m3, 'acc_a', ARRAY['M-g'], NULL, 'chat-mg', 'manual', NULL, u_a,
                                            'outbound', 'mid-g0', now() - interval '1 day', 'message');
  g3 := pg_temp.cw_row(m3, 'M-g', 'shortlisted');
  v := public.record_own_message(o1, 'acc_a', 'chat-mg', 'mid-g', '{"ids":["M-g"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('M6', (v->>'result') || '/' || (v->>'project_id') || '/' || pg_temp.cw_st(g3),
                                        'linked/' || m3 || '/contacted/system');

  -- M7. Sans fil : Retenu dans M3 seule, « Contacté » et lien outside ; le message suivant n'est
  --     pas un écho (attribution outside), il suit le fil. Retenu dans deux missions : ambiguous ;
  --     À trier : not_retained.
  h3 := pg_temp.cw_row(m3, 'M-h', 'shortlisted');
  v := public.record_own_message(o1, 'acc_a', 'chat-mh', 'mid-h', '{"ids":["M-h"]}'::jsonb);
  SELECT * INTO lk FROM public.mission_conversations WHERE candidate_id = 'M-h';
  failures := failures || pg_temp.cw_eq('M7 U-I7', (v->>'result') || '/' || (v->>'project_id') || '/' || pg_temp.cw_st(h3) || '/'
                                        || lk.source || '/' || lk.last_send_kind || '/' || lk.chat_id,
                                        'contacted/' || m3 || '/contacted/system/outside/outside/chat-mh');
  v := public.record_own_message(o1, 'acc_a', 'chat-mh', 'mid-h2', '{"ids":["M-h"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('M7 message suivant', v->>'result', 'linked');
  i2 := pg_temp.cw_row(m2, 'M-i', 'shortlisted');
  i3 := pg_temp.cw_row(m3, 'M-i', 'shortlisted');
  ct := pg_temp.cw_ct(i2) || pg_temp.cw_ct(i3);
  v := public.record_own_message(o1, 'acc_a', 'chat-mi', 'mid-i', '{"ids":["M-i"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('M7 deux missions', (v->>'result') || '/' || (v->>'missions') || '/'
                                        || (pg_temp.cw_ct(i2) || pg_temp.cw_ct(i3) = ct), 'ambiguous/2/true');
  j1 := pg_temp.cw_row(m1, 'M-j', 'discovered');
  v := public.record_own_message(o1, 'acc_a', 'chat-mj', 'mid-j', '{"ids":["M-j"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('M7 à trier', (v->>'result') || '/' || pg_temp.cw_st(j1), 'not_retained/to_sort/-');

  -- M8. Candidat retrouvé par la conversation liée (format new_message, sans participant).
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['M-k'], NULL, 'chat-mk', 'manual', NULL, u_a,
                                            'outbound', 'mid-k0', now() - interval '1 day', 'message');
  k1 := pg_temp.cw_row(m1, 'M-k', 'shortlisted');
  v := public.record_own_message(o1, 'acc_a', 'chat-mk', 'mid-k', '{}'::jsonb);
  failures := failures || pg_temp.cw_eq('M8', (v->>'result') || '/' || pg_temp.cw_st(k1), 'linked/contacted/system');

  -- M9. Aucun candidat, aucun compte.
  failures := failures
    || pg_temp.cw_eq('M9 sans candidat', public.record_own_message(o1, 'acc_a', 'chat-inconnu', 'mid-n', '{}'::jsonb)->>'result', 'no_candidate')
    || pg_temp.cw_eq('M9 sans compte', public.record_own_message(o1, '', 'chat-mk', 'mid-n', '{}'::jsonb)->>'result', 'missing_input');

  -- M10. Invitation d'une séquence sans mission (il y a 199 jours), P Retenu dans M3 seule :
  --      aucun lien possible par l'invitation, donc pas de note ; U-I7 au premier message,
  --      puis le fil rattaché. Jamais invitation_note à répétition.
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES ('e0b00000-0000-4000-8000-0000000000e6', pg_temp.cw_id('q0'), o1, 2, 'connection_request', 'Note');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, current_step_order)
  VALUES (e_mn, pg_temp.cw_id('q0'), 'acc_a', 'M-n', o1, u_a, 'active', 2);
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES (e_mn, 'e0b00000-0000-4000-8000-0000000000e6', 2, now() - interval '199 days', 'sent', now() - interval '199 days');
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  n3 := pg_temp.cw_row(m3, 'M-n', 'shortlisted');
  v := public.record_own_message(o1, 'acc_a', 'chat-mn', 'mid-n1', '{"ids":["M-n"]}'::jsonb);
  got := (v->>'result');
  v := public.record_own_message(o1, 'acc_a', 'chat-mn', 'mid-n2', '{"ids":["M-n"]}'::jsonb);
  got := got || '/' || (v->>'result') || '/' || pg_temp.cw_st(n3) || '/'
         || (SELECT count(*) || ':' || coalesce(string_agg(mc.source || ':' || mc.chat_id, ','), '-')
               FROM public.mission_conversations mc WHERE mc.candidate_id = 'M-n');
  failures := failures || pg_temp.cw_eq('M10 invitation sans mission', got,
                                        'contacted/linked/contacted/system/1:outside:chat-mn');

  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO cw_fail SELECT 'M', failures WHERE failures <> '';
END $$;

-- ===== Y. Résumé d'analyse (record_reply_summary), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2');
  y1 uuid; y2 uuid; y3 uuid;
  ct text; ct2 text; ct3 text;
  v jsonb;
  rw public.job_candidate_status%ROWTYPE;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['Y-a'], NULL, 'chat-ya', 'manual', NULL, u_a,
                                            'outbound', NULL, now() - interval '1 day', 'message');
  y1 := pg_temp.cw_row(m1, 'Y-a', 'messaged');
  UPDATE public.job_candidate_status SET recommendation = 'GOOD_MATCH' WHERE id = y1;
  y2 := pg_temp.cw_row(m1, 'Y-a', 'discovered', NULL, u_b, m1::text);
  y3 := pg_temp.cw_row(m2, 'Y-a', 'messaged');
  ct2 := pg_temp.cw_ct(y2);
  ct3 := pg_temp.cw_ct(y3);
  -- Y1. Seule la ligne contactée de la mission résolue ; recommendation intacte.
  v := public.record_reply_summary(o1, 'acc_a', 'chat-ya', '{"ids":["Y-a"]}'::jsonb, '  Intéressée, disponible en janvier  ');
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = y1;
  failures := failures || pg_temp.cw_eq('Y1', (v->>'project_id') || '/' || (v->>'updated') || '/' || rw.reply_summary || '/'
                                        || rw.recommendation || '/' || rw.general_stage || '/' || (pg_temp.cw_ct(y2) = ct2) || '/'
                                        || (pg_temp.cw_ct(y3) = ct3),
                                        m1 || '/1/Intéressée, disponible en janvier/GOOD_MATCH/contacted/true/true');
  -- Y2. Rejeu, résumé vide, candidat sans mission : aucune écriture.
  ct := pg_temp.cw_ct(y1);
  v := public.record_reply_summary(o1, 'acc_a', 'chat-ya', '{"ids":["Y-a"]}'::jsonb, 'Intéressée, disponible en janvier');
  failures := failures || pg_temp.cw_eq('Y2 rejeu', (v->>'updated') || '/' || (pg_temp.cw_ct(y1) = ct), '0/true')
    || pg_temp.cw_eq('Y2 vide', public.record_reply_summary(o1, 'acc_a', 'chat-ya', '{"ids":["Y-a"]}'::jsonb, '   ')->>'updated', '0')
    || pg_temp.cw_eq('Y2 sans mission', public.record_reply_summary(o1, 'acc_a', 'chat-y', '{"ids":["Y-none"]}'::jsonb, 'x')->>'updated', '0');
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO cw_fail SELECT 'Y', failures WHERE failures <> '';
END $$;

-- ===== C. Rendez-vous (resolve_meeting_mission, record_candidate_meeting), garde en refus =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m3 uuid := pg_temp.cw_id('m3');
  m9 uuid := pg_temp.cw_id('m9');
  s1 uuid := pg_temp.cw_id('s1'); s2 uuid := pg_temp.cw_id('s2');
  c1 uuid; c3 uuid; cs2 uuid; crj uuid;
  ct text;
  v jsonb;
  rw public.job_candidate_status%ROWTYPE;
  got text;
  n integer;
  failures text := '';
BEGIN
  PERFORM pg_temp.cw_mode('refuse');
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  -- C1. P suivi dans M1 (lien) et M3 : résolution M1 ; le rendez-vous n'écrit que M1 (sans étape : ITW en cours).
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['C-p'], NULL, 'chat-cp', 'manual', NULL, u_a,
                                            'outbound', NULL, now() - interval '1 day', 'message');
  c1 := pg_temp.cw_row(m1, 'C-p', 'messaged');
  c3 := pg_temp.cw_row(m3, 'C-p', 'messaged');
  ct := pg_temp.cw_ct(c3);
  SELECT string_agg(project_id || '/' || via, ',') INTO got FROM public.resolve_meeting_mission(o1, '{"ids":["C-p"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('C1 résolution', got, m1 || '/profile');
  v := public.record_candidate_meeting(o1, m1, '{"ids":["C-p"]}'::jsonb);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = c1;
  failures := failures || pg_temp.cw_eq('C1 M1', coalesce(v->>'process_step_id', '-') || '/' || rw.general_stage || '/'
                                        || rw.decision_source || '/' || rw.pipeline_stage || '/' || coalesce(rw.process_step_id::text, '-')
                                        || '/' || (pg_temp.cw_ct(c3) = ct),
                                        '-/interviewing/system/ITW en cours/-/true');
  -- C2. M3 : « Contacté » vers En entretien sur la première étape (S1).
  v := public.record_candidate_meeting(o1, m3, '{"ids":["C-p"]}'::jsonb);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = c3;
  failures := failures || pg_temp.cw_eq('C2 M3', (v->>'process_step_id') || '/' || rw.general_stage || '/' || rw.process_step_id
                                        || '/' || rw.pipeline_stage || '/' || rw.decision_source,
                                        s1 || '/interviewing/' || s1 || '/' || s1 || '/system');
  -- C3. Une ligne déjà sur S2 : kept.
  cs2 := pg_temp.cw_row(m3, 'C-s2', 'shortlisted', s2::text);
  v := public.record_candidate_meeting(o1, m3, '{"ids":["C-s2"]}'::jsonb);
  SELECT * INTO rw FROM public.job_candidate_status WHERE id = cs2;
  failures := failures || pg_temp.cw_eq('C3 S2', (v->'rows'->0->>'result') || '/' || rw.process_step_id, 'kept/' || s2);
  -- C4. Repli : suivi (hors écartés) dans une seule mission.
  PERFORM pg_temp.cw_row(m2, 'C-single', 'shortlisted');
  PERFORM pg_temp.cw_row(m1, 'C-single', 'dismissed');
  SELECT string_agg(project_id || '/' || via, ',') INTO got FROM public.resolve_meeting_mission(o1, '{"ids":["C-single"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('C4 une seule mission', got, m2 || '/single_mission');
  -- C5. Deux missions sans lien : aucune.
  PERFORM pg_temp.cw_row(m1, 'C-two', 'shortlisted');
  PERFORM pg_temp.cw_row(m2, 'C-two', 'discovered');
  SELECT count(*) INTO n FROM public.resolve_meeting_mission(o1, '{"ids":["C-two"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('C5 deux missions', n, 0);
  -- C6. Ligne de O1 portant M9 : ignorée ; mission de O2 refusée à l'écriture.
  PERFORM pg_temp.cw_row(m9, 'C-x', 'shortlisted', NULL, u_a, NULL, NULL, o1);
  SELECT count(*) INTO n FROM public.resolve_meeting_mission(o1, '{"ids":["C-x"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('C6 ligne portant M9', n, 0)
    || pg_temp.cw_eq('C6 mission de O2', public.record_candidate_meeting(o1, m9, '{"ids":["C-x"]}'::jsonb)->>'reason', 'no_mission');
  -- C7. Un écarté reste écarté.
  crj := pg_temp.cw_row(m1, 'C-rej', 'dismissed');
  v := public.record_candidate_meeting(o1, m1, '{"ids":["C-rej"]}'::jsonb);
  failures := failures || pg_temp.cw_eq('C7 écarté', (v->'rows'->0->>'result') || '/' || pg_temp.cw_st(crj), 'kept/rejected/user');
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO cw_fail SELECT 'C', failures WHERE failures <> '';
END $$;

-- ===== G. Garde des écritures directes =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2'); m4 uuid := pg_temp.cw_id('m4');
  g1 uuid; g2 uuid; g3 uuid; g4 uuid; gr uuid; gm uuid; gk uuid;
  n0 bigint; n1 bigint;
  lg public.jcs_direct_write_log%ROWTYPE;
  v jsonb;
  st text; hn text;
  got text;
  failures text := '';
BEGIN
  IF NOT (SELECT ok FROM cw_flag WHERE name = 'auth') OR NOT (SELECT ok FROM cw_flag WHERE name = 'svc') THEN
    INSERT INTO cw_fail VALUES ('G', '[G non joué : droits incomplets (voir D)] ');
    RETURN;
  END IF;

  -- ===== Observation =====
  PERFORM pg_temp.cw_mode('observe');
  g1 := pg_temp.cw_row(m1, 'G-1', 'shortlisted');
  g3 := pg_temp.cw_row(m1, 'G-3', 'discovered');
  g4 := pg_temp.cw_row(m4, 'G-4', 'shortlisted', pg_temp.cw_id('s4a')::text);
  SELECT count(*) INTO n0 FROM public.jcs_direct_write_log;
  -- G1. Navigateur, shortlisted vers messaged : permis, une ligne au journal, avec le marqueur de build.
  PERFORM pg_temp.cw_as(u_a);
  PERFORM set_config('request.headers', '{"x-client-info":"supabase-js-web/2.75.1 konekt/abc1234","referer":"http://localhost:8080/missions"}', true);
  PERFORM set_config('request.path', '/rest/v1/job_candidate_status', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.job_candidate_status SET status = 'messaged' WHERE id = g1;
  RESET ROLE;
  SELECT count(*) INTO n1 FROM public.jcs_direct_write_log;
  SELECT * INTO lg FROM public.jcs_direct_write_log ORDER BY id DESC LIMIT 1;
  failures := failures || pg_temp.cw_eq('G1 écriture', pg_temp.cw_st(g1), 'contacted/user')
    || pg_temp.cw_eq('G1 journal', (n1 - n0) || '/' || lg.op || '/' || lg.db_role || '/' || lg.user_id || '/' || lg.row_id || '/'
                     || lg.old_status || '>' || lg.new_status || '/' || lg.old_general_stage || '>' || lg.new_general_stage || '/'
                     || lg.client_info || '/' || lg.request_path || '/' || (lg.referer IS NOT NULL) || '/' || lg.organization_id,
                     '1/UPDATE/authenticated/' || u_a || '/' || g1 || '/shortlisted>messaged/retained>contacted/'
                     || 'supabase-js-web/2.75.1 konekt/abc1234//rest/v1/job_candidate_status/true/' || o1);
  PERFORM set_config('request.headers', '', true);
  PERFORM set_config('request.path', '', true);

  -- G2. Chemins permis, sans ligne au journal : insertion sans statut, note, set_candidate_stage,
  --     changement de mission (couple intact), replace_process_steps.
  PERFORM pg_temp.cw_as(u_a);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by)
  VALUES ('G-2', 'project:' || m1, o1, u_a) RETURNING id INTO g2;
  UPDATE public.job_candidate_status SET status = 'scored', score = 70, recommendation = 'GOOD_MATCH' WHERE id = g2;
  v := public.set_candidate_stage(g2, 'retained', 'user');
  UPDATE public.job_candidate_status SET project_id = m2, job_id = 'project:' || m2 WHERE id = g2;
  PERFORM public.replace_process_steps(m4, '[{"name":"Etape B"},{"name":"Etape A"}]'::jsonb);
  RESET ROLE;
  SELECT count(*) INTO n0 FROM public.jcs_direct_write_log;
  SELECT project_id::text || '/' || general_stage INTO got FROM public.job_candidate_status WHERE id = g2;
  failures := failures || pg_temp.cw_eq('G2 chemins permis', (n0 - n1) || '/' || got || '/'
                                        || ((SELECT process_step_id FROM public.job_candidate_status WHERE id = g4)
                                            = (SELECT id FROM public.mission_process_steps WHERE project_id = m4 AND name = 'Etape A')),
                                        '0/' || m2 || '/retained/true');

  -- G3. Journal indisponible : l'écriture passe quand même, sans ligne au journal.
  ALTER TABLE public.jcs_direct_write_log ADD CONSTRAINT cw_audit_block CHECK (false) NOT VALID;
  PERFORM pg_temp.cw_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.job_candidate_status SET status = 'shortlisted' WHERE id = g3;
  EXCEPTION WHEN OTHERS THEN
    failures := failures || format('[G3 écriture refusée journal indisponible : %s] ', SQLERRM);
  END;
  RESET ROLE;
  ALTER TABLE public.jcs_direct_write_log DROP CONSTRAINT cw_audit_block;
  SELECT count(*) INTO n1 FROM public.jcs_direct_write_log;
  failures := failures || pg_temp.cw_eq('G3 journal indisponible', (n1 - n0) || '/' || pg_temp.cw_st(g3), '0/retained/user');

  -- ===== Refus =====
  PERFORM pg_temp.cw_mode('refuse');
  gr := pg_temp.cw_row(m1, 'G-r', 'shortlisted');
  gm := pg_temp.cw_row(m1, 'G-m', 'messaged', NULL, u_a);
  SELECT count(*) INTO n0 FROM public.jcs_direct_write_log;
  PERFORM pg_temp.cw_as(u_a);
  SET LOCAL ROLE authenticated;
  -- G4. Navigateur : UPDATE du statut refusé.
  BEGIN
    UPDATE public.job_candidate_status SET status = 'messaged' WHERE id = gr;
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, hn = PG_EXCEPTION_HINT;
    got := st || '/' || hn;
  END;
  failures := failures || pg_temp.cw_eq('G4 navigateur, UPDATE', got, '42501/STAGE_DIRECT_WRITE');
  -- G5. Upsert à valeur identique sur une ligne messaged : refusé (le BEFORE INSERT voit la ligne proposée).
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by, status)
    VALUES ('G-m', 'project:' || m1, o1, u_a, 'messaged')
    ON CONFLICT (job_id, candidate_id, created_by) DO UPDATE SET status = EXCLUDED.status;
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, hn = PG_EXCEPTION_HINT;
    got := st || '/' || hn;
  END;
  failures := failures || pg_temp.cw_eq('G5 upsert identique', got, '42501/STAGE_DIRECT_WRITE');
  -- G6. Insertion shortlisted refusée.
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by, status)
    VALUES ('G-ins', 'project:' || m1, o1, u_a, 'shortlisted');
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, hn = PG_EXCEPTION_HINT;
    got := st || '/' || hn;
  END;
  failures := failures || pg_temp.cw_eq('G6 insertion Retenu', got, '42501/STAGE_DIRECT_WRITE');
  -- G7. Chemins permis toujours permis.
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by)
    VALUES ('G-k', 'project:' || m1, o1, u_a) RETURNING id INTO gk;
    UPDATE public.job_candidate_status SET status = 'scored', score = 55 WHERE id = gk;
    v := public.set_candidate_stage(gk, 'contacted', 'user');
    UPDATE public.job_candidate_status SET project_id = m2, job_id = 'project:' || m2 WHERE id = gk;
    PERFORM public.replace_process_steps(m4, '[{"name":"Etape A"},{"name":"Etape B"}]'::jsonb);
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    got := SQLERRM;
  END;
  RESET ROLE;
  failures := failures || pg_temp.cw_eq('G7 chemins permis', got || '/' || pg_temp.cw_st(gk), 'permis/contacted/user');

  -- G8. Clé de service (jeton service_role, en postgres) : refusée.
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  BEGIN
    UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = gr;
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, hn = PG_EXCEPTION_HINT;
    got := st || '/' || hn;
  END;
  failures := failures || pg_temp.cw_eq('G8 jeton service_role', got, '42501/STAGE_DIRECT_WRITE');

  -- G9. SET ROLE sans jeton (le rôle se lit dans le GUC role, la garde étant SECURITY DEFINER) :
  --     authenticated (insertion, la garde passe avant la RLS) et service_role (mise à jour).
  PERFORM pg_temp.cw_as(NULL);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.job_candidate_status (candidate_id, job_id, organization_id, created_by, status)
    VALUES ('G-noj', 'project:' || m1, o1, u_a, 'shortlisted');
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, hn = PG_EXCEPTION_HINT;
    got := st || '/' || coalesce(hn, '-');
  END;
  RESET ROLE;
  failures := failures || pg_temp.cw_eq('G9 SET ROLE authenticated sans jeton', got, '42501/STAGE_DIRECT_WRITE');
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = gr;
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS st = RETURNED_SQLSTATE, hn = PG_EXCEPTION_HINT;
    got := st || '/' || coalesce(hn, '-');
  END;
  RESET ROLE;
  failures := failures || pg_temp.cw_eq('G9 SET ROLE service_role sans jeton', got, '42501/STAGE_DIRECT_WRITE');

  -- G10. postgres sans jeton (migration, psql, cron) : libre ; aucune ligne au journal en refus.
  UPDATE public.job_candidate_status SET status = 'dismissed' WHERE id = gr;
  SELECT count(*) INTO n1 FROM public.jcs_direct_write_log;
  failures := failures || pg_temp.cw_eq('G10 sans jeton', pg_temp.cw_st(gr) || '/' || (n1 - n0), 'rejected/user/0');

  -- G11. Mode off : rien n'est contrôlé ni journalisé.
  PERFORM pg_temp.cw_mode('off');
  PERFORM pg_temp.cw_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.job_candidate_status SET status = 'shortlisted' WHERE id = gm;
    got := 'permis';
  EXCEPTION WHEN OTHERS THEN
    got := SQLERRM;
  END;
  RESET ROLE;
  PERFORM pg_temp.cw_as(NULL);
  SELECT count(*) INTO n0 FROM public.jcs_direct_write_log;
  failures := failures || pg_temp.cw_eq('G11 mode off', got || '/' || pg_temp.cw_st(gm) || '/' || (n0 - n1), 'permis/retained/user/0');

  PERFORM pg_temp.cw_mode('refuse');
  INSERT INTO cw_fail SELECT 'G', failures WHERE failures <> '';
END $$;

-- ===== B. Reprise des liens des inscriptions, puis seconde application =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1');
BEGIN
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, provider_id, profile_url, organization_id,
                                           created_by, status, current_step_order, created_at, replied_at, job_id, tracking_data)
  VALUES
    -- B-1 : message puis invitation envoyés, réponse.
    ('e0b00000-0000-4000-8000-000000000401', pg_temp.cw_id('q2'), 'acc_a', 'B-1', 'B-1p', 'https://www.linkedin.com/in/B-Un/?x=1',
     o1, u_a, 'replied', 2, now() - interval '10 days', now() - interval '2 days', NULL, '{}'::jsonb),
    -- B-2 : aucun envoi.
    ('e0b00000-0000-4000-8000-000000000402', pg_temp.cw_id('q2'), 'acc_b', 'B-2', NULL, NULL,
     o1, u_b, 'active', 0, now() - interval '8 days', NULL, NULL, '{}'::jsonb),
    -- B-3 : effacée (RGPD), exclue.
    ('e0b00000-0000-4000-8000-000000000403', pg_temp.cw_id('q2'), 'acc_a', 'B-3', NULL, NULL,
     o1, u_a, 'stopped', 1, now() - interval '8 days', NULL, NULL, jsonb_build_object('gdpr_erased_at', now())),
    -- B-4 : séquence sans mission, sans job_id : exclue.
    ('e0b00000-0000-4000-8000-000000000404', pg_temp.cw_id('q0'), 'acc_a', 'B-4', NULL, NULL,
     o1, u_a, 'active', 1, now() - interval '8 days', NULL, NULL, '{}'::jsonb),
    -- B-5 : deux inscriptions de même clé (M2, acc_b) ; l'ancienne a envoyé, la récente non.
    ('e0b00000-0000-4000-8000-000000000405', pg_temp.cw_id('q2'), 'acc_b', 'B-5', NULL, NULL,
     o1, u_b, 'completed', 1, now() - interval '20 days', NULL, NULL, '{}'::jsonb),
    ('e0b00000-0000-4000-8000-000000000406', pg_temp.cw_id('q3'), 'acc_b', 'B-5', NULL, NULL,
     o1, u_b, 'active', 0, now() - interval '3 days', NULL, NULL, '{}'::jsonb),
    -- B-7 : mission par job_id (séquence sans mission), annulation BUG-095 comptée comme envoi.
    ('e0b00000-0000-4000-8000-000000000407', pg_temp.cw_id('q0'), 'acc_a', 'B-7', NULL, NULL,
     o1, u_a, 'replied', 1, now() - interval '6 days', NULL, 'project:' || m1, '{}'::jsonb);
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at, skip_reason)
  VALUES ('e0b00000-0000-4000-8000-000000000401', pg_temp.cw_id('st2m'), 1, now() - interval '9 days', 'sent', now() - interval '9 days', NULL),
         ('e0b00000-0000-4000-8000-000000000401', pg_temp.cw_id('st2i'), 2, now() - interval '5 days', 'sent', now() - interval '5 days', NULL),
         ('e0b00000-0000-4000-8000-000000000402', pg_temp.cw_id('st2m'), 1, now() + interval '1 day', 'scheduled', NULL, NULL),
         ('e0b00000-0000-4000-8000-000000000403', pg_temp.cw_id('st2m'), 1, now() - interval '7 days', 'sent', now() - interval '7 days', NULL),
         ('e0b00000-0000-4000-8000-000000000404', pg_temp.cw_id('st0m'), 1, now() - interval '7 days', 'sent', now() - interval '7 days', NULL),
         ('e0b00000-0000-4000-8000-000000000405', pg_temp.cw_id('st2m'), 1, now() - interval '19 days', 'sent', now() - interval '19 days', NULL),
         ('e0b00000-0000-4000-8000-000000000407', pg_temp.cw_id('st0m'), 1, now() - interval '4 days', 'cancelled', now() - interval '4 days',
          'Enrollment became replied during execution');
  -- Clés d'appel de l'indexation (annulées au ROLLBACK) : une écriture de ligne candidat
  -- pendant la migration mettrait un appel en file.
  IF pg_temp.cw_http() IS NOT NULL THEN
    INSERT INTO public.internal_config (key, value)
    VALUES ('supabase_functions_url', 'http://127.0.0.1:9/cw-audit/functions/v1'), ('supabase_anon_key', 'cw-audit')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
END $$;

CREATE TEMP TABLE cw_replay ON COMMIT DROP AS
SELECT 'jcs' AS t, id, ctid::text AS ct FROM public.job_candidate_status
UNION ALL SELECT 'sp', id, ctid::text FROM public.sourcing_projects;
CREATE TEMP TABLE cw_replay_http ON COMMIT DROP AS SELECT pg_temp.cw_http() AS n;
SET LOCAL client_min_messages = warning;
\ir ../migrations/20260928235358_refonte_mission_lot0b_liens_et_ecrivains.sql
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b');
  o1 uuid := pg_temp.cw_id('o1');
  m1 uuid := pg_temp.cw_id('m1'); m2 uuid := pg_temp.cw_id('m2');
  n integer;
  got text;
  failures text := '';
BEGIN
  -- B1. Liens repris : compte, identifiants, slug, dates d'envoi, type, réponse, inscription.
  SELECT string_agg(format('%s=%s/%s/%s/%s/%s/%s/%s/%s/%s/%s/%s/%s', mc.candidate_id,
           CASE mc.project_id WHEN m1 THEN 'M1' WHEN m2 THEN 'M2' ELSE '?' END, mc.account_id,
           coalesce(array_to_string(mc.candidate_ids, '+'), ''), coalesce(mc.candidate_slug, '-'), mc.source,
           coalesce(extract(day FROM now() - mc.first_outbound_at)::text, '-'),
           coalesce(extract(day FROM now() - mc.last_mission_send_at)::text, '-'),
           coalesce(mc.last_send_kind, '-'), coalesce(extract(day FROM now() - mc.last_inbound_at)::text, '-'),
           coalesce(mc.chat_id, '-'), right(mc.enrollment_id::text, 3),
           (mc.created_by = CASE mc.account_id WHEN 'acc_a' THEN u_a ELSE u_b END)::text),
           ' ' ORDER BY mc.candidate_id) INTO got
    FROM public.mission_conversations mc
   WHERE mc.organization_id = o1 AND mc.candidate_id LIKE 'B-%';
  -- candidat=mission/compte/ids/slug/origine/premier envoi/dernier envoi/type/réponse/conversation/inscription/auteur
  failures := failures || pg_temp.cw_eq('B1 liens repris', got,
    'B-1=M2/acc_a/B-1p/b-un/backfill/9/5/invitation/2/-/401/true '
    'B-2=M2/acc_b//-/backfill/-/-/-/-/-/402/true '
    'B-5=M2/acc_b//-/backfill/19/19/message/-/-/406/true '
    'B-7=M1/acc_a//-/backfill/4/4/message/-/-/407/true');
  -- B2. Aucune ligne candidat ni mission réécrite, aucun appel HTTP, dès la première application.
  SELECT count(*) INTO n FROM cw_replay r
   WHERE r.ct IS DISTINCT FROM CASE r.t
           WHEN 'jcs' THEN (SELECT j.ctid::text FROM public.job_candidate_status j WHERE j.id = r.id)
           ELSE (SELECT p.ctid::text FROM public.sourcing_projects p WHERE p.id = r.id) END;
  failures := failures || pg_temp.cw_eq('B2 lignes réécrites par la première application', n, 0)
    || pg_temp.cw_eq('B2 appels HTTP pendant la première application',
                     pg_temp.cw_http() - (SELECT h.n FROM cw_replay_http h), 0);
  INSERT INTO cw_fail SELECT 'B', failures WHERE failures <> '';
END $$;

-- Seconde application : rien ne change (lignes candidat, liens, missions), aucun appel HTTP.
TRUNCATE cw_replay;
INSERT INTO cw_replay
SELECT 'jcs', id, ctid::text FROM public.job_candidate_status
UNION ALL SELECT 'sp', id, ctid::text FROM public.sourcing_projects
UNION ALL SELECT 'mc', id, ctid::text FROM public.mission_conversations;
TRUNCATE cw_replay_http;
INSERT INTO cw_replay_http SELECT pg_temp.cw_http();
SET LOCAL client_min_messages = warning;
\ir ../migrations/20260928235358_refonte_mission_lot0b_liens_et_ecrivains.sql
SET LOCAL client_min_messages = notice;

DO $$
DECLARE
  n integer;
  failures text := '';
  v_http integer;
BEGIN
  SELECT count(*) INTO n FROM cw_replay r
   WHERE r.ct IS DISTINCT FROM CASE r.t
           WHEN 'jcs' THEN (SELECT j.ctid::text FROM public.job_candidate_status j WHERE j.id = r.id)
           WHEN 'mc' THEN (SELECT m.ctid::text FROM public.mission_conversations m WHERE m.id = r.id)
           ELSE (SELECT p.ctid::text FROM public.sourcing_projects p WHERE p.id = r.id) END;
  n := n + abs((SELECT count(*) FROM public.mission_conversations)::int - (SELECT count(*) FROM cw_replay WHERE t = 'mc')::int);
  failures := failures || pg_temp.cw_eq('B3 lignes changées par la seconde application', n, 0)
    || pg_temp.cw_eq('B3 appels HTTP pendant la seconde application',
                     pg_temp.cw_http() - (SELECT h.n FROM cw_replay_http h), 0);
  -- Témoin : une écriture ordinaire d'une ligne candidat met bien un appel en file.
  v_http := pg_temp.cw_http();
  IF v_http IS NOT NULL THEN
    UPDATE public.job_candidate_status SET tags = tags
     WHERE id = (SELECT id FROM public.job_candidate_status WHERE organization_id = pg_temp.cw_id('o1') LIMIT 1);
    failures := failures || pg_temp.cw_eq('B3 témoin d''indexation', pg_temp.cw_http() - v_http, 1);
  END IF;
  INSERT INTO cw_fail SELECT 'B', failures WHERE failures <> '';
END $$;

-- ===== L. Lecture des liens ; E. Effacement RGPD d'une inscription =====
DO $$
DECLARE
  u_a uuid := pg_temp.cw_id('u_a'); u_b uuid := pg_temp.cw_id('u_b'); u_c uuid := pg_temp.cw_id('u_c');
  u_d uuid := 'e0b00000-0000-4000-8000-0000000000a4';
  o1 uuid := pg_temp.cw_id('o1'); o2 uuid := pg_temp.cw_id('o2');
  m1 uuid := pg_temp.cw_id('m1'); m9 uuid := pg_temp.cw_id('m9');
  got text;
  failures text := '';
BEGIN
  -- Montage : u_d collaborateur de O1 ; un lien de u_a, un lien de u_d, un lien de O2 (même candidat que B-5).
  PERFORM pg_temp.cw_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_d, 'd@writers.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (o1, u_d, 'collaborator');
  INSERT INTO public.profiles (user_id, active_organization_id) VALUES (u_d, o1)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['L-a'], NULL, 'chat-la', 'manual', NULL, u_a,
                                            'outbound', 'mid-la', now(), 'message');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_d', ARRAY['L-d'], NULL, 'chat-ld', 'manual', NULL, u_d,
                                            'outbound', 'mid-ld', now(), 'message');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc_a', ARRAY['B-5'], NULL, 'chat-e5', 'manual', NULL, u_a,
                                            'outbound', 'mid-e5', now(), 'message');
  PERFORM public.touch_mission_conversation(o2, m9, 'acc_c', ARRAY['B-5'], NULL, 'chat-e9', 'manual', NULL, u_c,
                                            'outbound', 'mid-e9', now(), 'message');
  PERFORM pg_temp.cw_as(NULL);

  -- L1. Par SELECT seulement (policy) : le collaborateur lit ses liens, le membre ceux de O1, O2 rien de O1.
  IF (SELECT ok FROM cw_flag WHERE name = 'auth')
     AND has_table_privilege('authenticated', 'public.mission_conversations', 'SELECT')
     AND has_function_privilege('authenticated', 'public.is_active_org_collaborator(uuid)', 'EXECUTE')
     AND has_function_privilege('authenticated', 'public.get_user_org_id(uuid)', 'EXECUTE') THEN
    PERFORM pg_temp.cw_as(u_d);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(string_agg(mc.candidate_id, ',' ORDER BY mc.candidate_id), '-') INTO got
      FROM public.mission_conversations mc WHERE mc.candidate_id IN ('L-a', 'L-d');
    RESET ROLE;
    failures := failures || pg_temp.cw_eq('L1 collaborateur', got, 'L-d');
    PERFORM pg_temp.cw_as(u_b);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(string_agg(mc.candidate_id, ',' ORDER BY mc.candidate_id), '-') INTO got
      FROM public.mission_conversations mc WHERE mc.candidate_id IN ('L-a', 'L-d');
    RESET ROLE;
    failures := failures || pg_temp.cw_eq('L1 membre', got, 'L-a,L-d');
    PERFORM pg_temp.cw_as(u_c);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(string_agg(mc.candidate_id, ',' ORDER BY mc.candidate_id), '-') INTO got
      FROM public.mission_conversations mc WHERE mc.candidate_id IN ('L-a', 'L-d');
    RESET ROLE;
    failures := failures || pg_temp.cw_eq('L1 autre organisation', got, '-');
    PERFORM pg_temp.cw_as(NULL);
  ELSE
    failures := failures || '[L1 droits de lecture de authenticated incomplets : non joué] ';
  END IF;

  -- E1. Marqueur posé par la clé de service sur l'ancienne inscription de B-5 (405, le lien
  --     repris porte 406) : liens de B-5 dans O1 supprimés (identifiant), lien de O2 gardé.
  PERFORM pg_temp.cw_as(NULL, 'service_role');
  UPDATE public.sequence_enrollments
     SET tracking_data = coalesce(tracking_data, '{}'::jsonb) || jsonb_build_object('gdpr_erased_at', now())
   WHERE id = 'e0b00000-0000-4000-8000-000000000405';
  SELECT string_agg(CASE mc.organization_id WHEN o1 THEN 'O1' ELSE 'O2' END || ':' || mc.candidate_id, ','
                    ORDER BY mc.organization_id = o2, mc.candidate_id) INTO got
    FROM public.mission_conversations mc WHERE mc.candidate_id LIKE 'B-%';
  failures := failures || pg_temp.cw_eq('E1 effacement par la clé de service', got, 'O1:B-1,O1:B-2,O1:B-7,O2:B-5');

  -- E2. Autre écriture de tracking_data, sans marqueur : rien n'est supprimé.
  UPDATE public.sequence_enrollments SET tracking_data = coalesce(tracking_data, '{}'::jsonb) || '{"cw":1}'::jsonb
   WHERE id = 'e0b00000-0000-4000-8000-000000000402';
  failures := failures || pg_temp.cw_eq('E2 sans marqueur',
    (SELECT count(*) FROM public.mission_conversations WHERE candidate_id = 'B-2')::int, 1);
  PERFORM pg_temp.cw_as(NULL);

  -- E3. Marqueur posé sous le jeton du propriétaire (sans droit d'écriture sur les liens) :
  --     le lien de B-1 (inscription 401) est supprimé, sans erreur.
  IF (SELECT ok FROM cw_flag WHERE name = 'auth')
     AND has_table_privilege('authenticated', 'public.sequence_enrollments', 'UPDATE') THEN
    PERFORM pg_temp.cw_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.sequence_enrollments
         SET tracking_data = coalesce(tracking_data, '{}'::jsonb) || jsonb_build_object('gdpr_erased_at', now())
       WHERE id = 'e0b00000-0000-4000-8000-000000000401';
      got := 'ok';
    EXCEPTION WHEN OTHERS THEN
      got := SQLSTATE || ' ' || SQLERRM;
    END;
    RESET ROLE;
    PERFORM pg_temp.cw_as(NULL);
    failures := failures || pg_temp.cw_eq('E3 effacement sous jeton', got || '/'
      || (SELECT count(*) FROM public.mission_conversations WHERE candidate_id = 'B-1'), 'ok/0');
  ELSE
    failures := failures || '[E3 droits de authenticated incomplets : non joué] ';
  END IF;

  INSERT INTO cw_fail SELECT 'L E', failures WHERE failures <> '';
END $$;

-- ===== Bilan =====
DO $$
DECLARE
  failures text;
BEGIN
  SELECT string_agg(block || ' ' || msg, ' ' ORDER BY block) INTO failures FROM cw_fail;
  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'candidate_stage_writers_audit : %', failures;
  END IF;
  RAISE NOTICE 'candidate_stage_writers_audit : tous les contrôles passés (S1-S8, D1-D5, W1-W7, A1-A6, O1-O8, R1-R8, M1-M10, Y1-Y2, C1-C7, G1-G11, B1-B3, L1, E1-E3)';
END $$;
