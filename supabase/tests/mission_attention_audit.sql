-- =====================================================================
-- Refonte mission, lot 3 : get_mission_attention, is_go_recommendation et
-- job_details_is_described (carte « Maintenant », signaux par mission).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/mission_attention_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/mission_attention_audit.sql -c 'ROLLBACK;')
-- Vérifie la migration *_refonte_mission_lot3_attention.sql :
--  * S : structure et droits (colonnes, SECURITY INVOKER, EXECUTE de
--        get_mission_attention à authenticated seulement, aides fermées à
--        anon, aucune fonction SECURITY DEFINER nouvelle) ;
--  * F : is_go_recommendation et job_details_is_described sur une table de
--        cas (rognage et longueur alignés sur JavaScript, JSON abîmé) ;
--  * R : réponses sans suite (rang 3) : entrant postérieur au sortant,
--        sortant Konekt ou message propre postérieur, dates égales, compte
--        d'un collègue, compte sans membre, écartés et embauchés exclus,
--        rapprochement par identifiant, alias et slug, lien sans ligne,
--        doublons, ancienneté, ordre et plafond des éléments, effacement
--        RGPD, collaborateur (ses liens seulement), compte sans liaison,
--        autre organisation, compte relié à deux organisations ;
--  * I : entretiens sans nouvelles (rang 6), seuil strict, ordre, éléments ;
--  * T : profils notés à trier (rang 8) et recommandés ;
--  * J : poste décrit (rang 11) par mission ;
--  * P : le filtre project_id descend sous les fenêtres de la vue ; volume (6 missions
--        x 3000 lignes, 3600 réponses en attente) lu sous un seuil de durée.
-- Aucune fonction n'est appelée sous SET ROLE authenticated sans que son
-- droit ait été vérifié par has_function_privilege (plantage de l'image
-- locale sur un refus, voir CLAUDE.md) ; anon n'appelle rien : son refus réel
-- est contrôlé par l'API dans .github/workflows/e2e.yml.
-- Procédés : dates relatives à now() (constant dans la transaction, donc
-- les bornes strictes sont exactes) ; étape datée sous le drapeau
-- konekt.stage_write = '*' ; garde des écritures directes coupée dans la
-- transaction (le montage écrit l'ancien couple en direct) ; cache de
-- get_user_org_id (réglage app.user_org.*) inutile ici : aucun membre n'est
-- retiré.
-- O1 : u_a propriétaire (compte acc-a), u_b membre (acc-b), u_k collaborateur
-- (acc-k), u_n membre sans compte, u_m membre (acc-y). O2 : u_c propriétaire
-- (acc-c), u_d membre (acc-y, état hérité d'un compte relié à deux
-- organisations). Missions : M1 réponses, M3 entretiens, M5 collaborateur,
-- M6 à trier, M7 deux organisations, M8 postes, M9 (O2).
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- =====================================================================
SET LOCAL lock_timeout = '30s';

DO $ma_mode$
BEGIN
  IF to_regprocedure('public.jcs_stage_write_mode()') IS NOT NULL THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION public.jcs_stage_write_mode()
      RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $m$ SELECT 'off'::text $m$ $f$;
  END IF;
END
$ma_mode$;

CREATE TEMP TABLE ma_ids (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO ma_ids VALUES
  ('u_a', 'e3a00000-0000-4000-8000-0000000000a1'), ('u_b', 'e3a00000-0000-4000-8000-0000000000a2'),
  ('u_k', 'e3a00000-0000-4000-8000-0000000000a3'), ('u_n', 'e3a00000-0000-4000-8000-0000000000a4'),
  ('u_m', 'e3a00000-0000-4000-8000-0000000000a5'), ('u_c', 'e3a00000-0000-4000-8000-0000000000a6'),
  ('u_d', 'e3a00000-0000-4000-8000-0000000000a7'),
  ('o1', 'e3a00000-0000-4000-8000-0000000000f1'), ('o2', 'e3a00000-0000-4000-8000-0000000000f2'),
  ('m1', 'e3a00000-0000-4000-8000-0000000000b1'), ('m3', 'e3a00000-0000-4000-8000-0000000000b3'),
  ('m5', 'e3a00000-0000-4000-8000-0000000000b5'), ('m6', 'e3a00000-0000-4000-8000-0000000000b6'),
  ('m7', 'e3a00000-0000-4000-8000-0000000000b7'), ('m8', 'e3a00000-0000-4000-8000-0000000000b8'),
  ('m9', 'e3a00000-0000-4000-8000-0000000000b9'),
  ('s3', 'e3a00000-0000-4000-8000-0000000000c3'),
  ('q1', 'e3a00000-0000-4000-8000-0000000000d1'), ('e1', 'e3a00000-0000-4000-8000-0000000000e1'),
  ('v1', 'e3a00000-0000-4000-8000-000000000011'), ('v2', 'e3a00000-0000-4000-8000-000000000012'),
  ('v3', 'e3a00000-0000-4000-8000-000000000013'), ('v4', 'e3a00000-0000-4000-8000-000000000014'),
  ('v5', 'e3a00000-0000-4000-8000-000000000015'), ('v6', 'e3a00000-0000-4000-8000-000000000016');

CREATE FUNCTION pg_temp.ma_id(p_name text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM ma_ids WHERE name = p_name $$;

-- Contexte d'appel : utilisateur connecté (rôle du jeton authenticated) ou
-- serveur sans jeton (NULL).
CREATE FUNCTION pg_temp.ma_as(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NOT NULL THEN json_build_object('sub', p_uid, 'role', 'authenticated')::text ELSE '' END, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid IS NOT NULL THEN 'authenticated' ELSE '' END, true);
END $$;

CREATE FUNCTION pg_temp.ma_eq(p_label text, p_got anyelement, p_want anyelement) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_got IS NOT DISTINCT FROM p_want THEN ''
              ELSE format('[%s : %s, attendu %s] ', p_label, coalesce(p_got::text, 'NULL'), coalesce(p_want::text, 'NULL')) END
$$;

-- Ligne candidat écrite sans jeton. Le couple (status, pipeline_stage) donne
-- l'étape (candidate_stage_from_legacy). Le nom est celui du candidat.
CREATE FUNCTION pg_temp.ma_row(p_proj uuid, p_cand text, p_status text, p_ps text DEFAULT NULL,
                               p_score numeric DEFAULT NULL, p_reco text DEFAULT NULL,
                               p_url text DEFAULT NULL, p_name text DEFAULT NULL, p_by uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v  uuid;
  c1 text := coalesce(current_setting('request.jwt.claims', true), '');
  c2 text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  c3 text := coalesce(current_setting('request.jwt.claim.role', true), '');
BEGIN
  PERFORM pg_temp.ma_as(NULL);
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, pipeline_stage, score, recommendation,
     candidate_name, linkedin_profile_url)
  SELECT p_cand, 'project:' || p.id, p.id, p.organization_id, coalesce(p_by, p.created_by), p_status, p_ps, p_score, p_reco,
         coalesce(p_name, p_cand), p_url
    FROM public.sourcing_projects p WHERE p.id = p_proj
  RETURNING id INTO v;
  PERFORM set_config('request.jwt.claims', c1, true);
  PERFORM set_config('request.jwt.claim.sub', c2, true);
  PERFORM set_config('request.jwt.claim.role', c3, true);
  RETURN v;
END $$;

-- Date d'entrée dans l'étape (passe les déclencheurs).
CREATE FUNCTION pg_temp.ma_age(p_id uuid, p_at timestamptz) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('konekt.stage_write', '*', true);
  UPDATE public.job_candidate_status SET stage_entered_at = p_at WHERE id = p_id;
  PERFORM set_config('konekt.stage_write', '', true);
END $$;

-- Lien de conversation écrit directement (dates exactes). Écriture serveur :
-- la table n'a aucune policy d'écriture, la ligne est montée en postgres.
CREATE FUNCTION pg_temp.ma_link(p_proj uuid, p_account text, p_cand text, p_in timestamptz, p_out timestamptz,
                                p_by uuid DEFAULT NULL, p_ids text[] DEFAULT '{}', p_slug text DEFAULT NULL,
                                p_chat text DEFAULT NULL, p_enr uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
  INSERT INTO public.mission_conversations
    (organization_id, project_id, account_id, candidate_id, candidate_ids, candidate_slug, chat_id, source,
     enrollment_id, created_by, last_inbound_at, last_outbound_at)
  SELECT p.organization_id, p.id, p_account, p_cand, p_ids, p_slug, p_chat, 'manual', p_enr, p_by, p_in, p_out
    FROM public.sourcing_projects p WHERE p.id = p_proj
  RETURNING id INTO v;
  RETURN v;
END $$;

-- Lecture d'un champ d'une mission dans le résultat (tableau jsonb de lignes).
CREATE FUNCTION pg_temp.ma_get(p_res jsonb, p_proj uuid, p_field text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT e ->> p_field FROM jsonb_array_elements(coalesce(p_res, '[]'::jsonb)) e WHERE e ->> 'project_id' = p_proj::text
$$;

-- Identifiants des éléments d'une liste, dans l'ordre rendu.
CREATE FUNCTION pg_temp.ma_ids_of(p_res jsonb, p_proj uuid, p_list text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(string_agg(i ->> 'candidate_id', ',' ORDER BY o), '-')
    FROM jsonb_array_elements(coalesce(p_res, '[]'::jsonb)) e,
         jsonb_array_elements(e -> p_list) WITH ORDINALITY AS t(i, o)
   WHERE e ->> 'project_id' = p_proj::text
$$;

-- Un élément d'une liste, par identifiant de candidat : un champ.
CREATE FUNCTION pg_temp.ma_item(p_res jsonb, p_proj uuid, p_list text, p_cand text, p_field text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT i ->> p_field
    FROM jsonb_array_elements(coalesce(p_res, '[]'::jsonb)) e, jsonb_array_elements(e -> p_list) i
   WHERE e ->> 'project_id' = p_proj::text AND i ->> 'candidate_id' = p_cand
$$;

CREATE FUNCTION pg_temp.ma_n(p_res jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(jsonb_array_length(p_res), 0) $$;


DO $$
DECLARE
  u_a uuid := pg_temp.ma_id('u_a'); u_b uuid := pg_temp.ma_id('u_b'); u_k uuid := pg_temp.ma_id('u_k');
  u_n uuid := pg_temp.ma_id('u_n'); u_m uuid := pg_temp.ma_id('u_m');
  u_c uuid := pg_temp.ma_id('u_c'); u_d uuid := pg_temp.ma_id('u_d');
  o1 uuid := pg_temp.ma_id('o1'); o2 uuid := pg_temp.ma_id('o2');
  m1 uuid := pg_temp.ma_id('m1'); m3 uuid := pg_temp.ma_id('m3'); m5 uuid := pg_temp.ma_id('m5');
  m6 uuid := pg_temp.ma_id('m6'); m7 uuid := pg_temp.ma_id('m7'); m8 uuid := pg_temp.ma_id('m8');
  m9 uuid := pg_temp.ma_id('m9'); s3 uuid := pg_temp.ma_id('s3');
  q1 uuid := pg_temp.ma_id('q1'); e1 uuid := pg_temp.ma_id('e1');
  sig_att text := 'public.get_mission_attention(uuid[], integer, integer, integer)';
  sig_go text := 'public.is_go_recommendation(text)';
  sig_jd text := 'public.job_details_is_described(jsonb)';
  res jsonb;
  res2 jsonb;
  x uuid;
  x2 uuid;
  got text;
  want text;
  n integer;
  rec record;
  line text;
  v_seen_window boolean := false;
  v_pushed boolean := false;
  vids uuid[];
  t0 timestamptz;
  t1 timestamptz;
  failures text := '';
BEGIN
  -- ===== Montage (sans jeton) =====
  PERFORM pg_temp.ma_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  SELECT i.id, i.name || '@attention.test', 'authenticated', 'authenticated',
         '00000000-0000-0000-0000-000000000000', '{}'::jsonb
    FROM ma_ids i WHERE i.name LIKE 'u\_%';
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (o1, 'Attention Org 1', 'attention-org-1', u_a), (o2, 'Attention Org 2', 'attention-org-2', u_c);
  -- Les propriétaires sont rattachés par le déclencheur de création.
  IF coalesce(public.get_org_role(u_a, o1), '') <> 'owner' OR coalesce(public.get_org_role(u_c, o2), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : un créateur n''est pas propriétaire de son organisation';
  END IF;
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (o1, u_b, 'member'), (o1, u_k, 'collaborator'), (o1, u_n, 'member'), (o1, u_m, 'member'),
         (o2, u_d, 'member');
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_a, o1), (u_b, o1), (u_k, o1), (u_n, o1), (u_m, o1), (u_c, o2), (u_d, o2)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by, job_details)
  VALUES (m1, 'Mission M1', o1, u_a, '{"skills_must_have":["Python"]}'::jsonb),
         (m3, 'Mission M3', o1, u_a, NULL), (m5, 'Mission M5', o1, u_a, NULL),
         (m6, 'Mission M6', o1, u_a, NULL), (m7, 'Mission M7', o1, u_a, NULL),
         (m8, 'Mission M8', o1, u_a, '{}'::jsonb), (m9, 'Mission M9', o2, u_c, NULL);
  INSERT INTO public.mission_process_steps (id, project_id, organization_id, step_order, name)
  VALUES (s3, m3, o1, 1, 'Entretien M3');
  -- Un compte relié à deux organisations n'existe plus que dans l'état hérité :
  -- le déclencheur de garde est coupé le temps du montage (annulé au ROLLBACK).
  ALTER TABLE public.member_linkedin_accounts DISABLE TRIGGER member_linkedin_accounts_no_cross_tenant;
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (o1, u_a, 'acc-a', u_a), (o1, u_b, 'acc-b', u_a), (o1, u_k, 'acc-k', u_a), (o1, u_m, 'acc-y', u_a),
         (o2, u_c, 'acc-c', u_c), (o2, u_d, 'acc-y', u_c);
  ALTER TABLE public.member_linkedin_accounts ENABLE TRIGGER member_linkedin_accounts_no_cross_tenant;
  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, project_id, is_active)
  VALUES (q1, 'Séquence M1', o1, u_a, m1, true);

  -- ===== S. Structure et droits (catalogues) =====
  -- S1. Colonnes de get_mission_attention, dans l'ordre.
  SELECT pg_get_function_result(to_regprocedure(sig_att)) INTO got;
  failures := failures || pg_temp.ma_eq('S1 colonnes', got,
    'TABLE(project_id uuid, has_own_account boolean, replies_mine integer, replies_mine_oldest_at timestamp with time zone, '
    || 'replies_others integer, replies_others_oldest_at timestamp with time zone, reply_items jsonb, interview_waiting integer, '
    || 'interview_waiting_oldest_at timestamp with time zone, interview_items jsonb, to_sort_scored integer, '
    || 'to_sort_recommended integer, job_described boolean)');
  -- S2. Paramètres et valeurs par défaut.
  SELECT pg_get_function_arguments(to_regprocedure(sig_att)) INTO got;
  failures := failures || pg_temp.ma_eq('S2 paramètres', got,
    'p_project_ids uuid[], p_item_limit integer DEFAULT 5, p_interview_days integer DEFAULT 5, p_reply_days integer DEFAULT 30');
  -- S3. SECURITY INVOKER et STABLE (get_mission_attention), IMMUTABLE (les aides) ; aucun SECURITY DEFINER.
  SELECT string_agg(p.proname || ':' || p.prosecdef::text || ':' || p.provolatile::text, ',' ORDER BY p.proname) INTO got
    FROM pg_proc p
   WHERE p.oid IN (to_regprocedure(sig_att), to_regprocedure(sig_go), to_regprocedure(sig_jd));
  failures := failures || pg_temp.ma_eq('S3 invoker, volatilité', got,
    'get_mission_attention:false:s,is_go_recommendation:false:i,job_details_is_described:false:i');
  -- S4. Droits : get_mission_attention à authenticated seulement (ni PUBLIC, ni anon, ni service_role) ;
  --     les aides ni à PUBLIC ni à anon (authenticated les appelle depuis la fonction invoker).
  SELECT string_agg(f.sig || ':' || r.rol || '=' || has_function_privilege(r.rol, f.sig, 'EXECUTE'), ' ' ORDER BY f.sig, r.rol) INTO got
    FROM (VALUES (sig_att), (sig_go), (sig_jd)) f(sig)
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rol);
  want := sig_att || ':anon=false ' || sig_att || ':authenticated=true ' || sig_att || ':service_role=false '
       || sig_go || ':anon=false ' || sig_go || ':authenticated=true ' || sig_go || ':service_role=true '
       || sig_jd || ':anon=false ' || sig_jd || ':authenticated=true ' || sig_jd || ':service_role=true';
  failures := failures || pg_temp.ma_eq('S4 droits', got, want);
  SELECT count(*) INTO n
    FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid IN (to_regprocedure(sig_att), to_regprocedure(sig_go), to_regprocedure(sig_jd))
     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  failures := failures || pg_temp.ma_eq('S4 EXECUTE à PUBLIC', n, 0);

  -- ===== F. Aides : table de cas =====
  -- F1. is_go_recommendation : go, STRONG_MATCH, GOOD_MATCH (casse et espaces ignorés) ; le reste non.
  SELECT string_agg(c.v || '=' || public.is_go_recommendation(c.v), ' ' ORDER BY c.o) INTO got
    FROM (VALUES (1, 'go'), (2, 'GO'), (3, ' Go '), (4, 'STRONG_MATCH'), (5, 'good_match'), (6, 'GOOD_MATCH'),
                 (7, 'maybe'), (8, 'skip'), (9, 'POSSIBLE_MATCH'), (10, 'WEAK_MATCH'), (11, 'NO_MATCH'),
                 (12, 'Le candidat est intéressé'), (13, ''), (14, 'go go')) c(o, v);
  failures := failures || pg_temp.ma_eq('F1 recommandations', got,
    'go=true GO=true  Go =true STRONG_MATCH=true good_match=true GOOD_MATCH=true maybe=false skip=false POSSIBLE_MATCH=false '
    || 'WEAK_MATCH=false NO_MATCH=false Le candidat est intéressé=false =false go go=false');
  failures := failures || pg_temp.ma_eq('F1 NULL', public.is_go_recommendation(NULL), false);

  -- F2. job_details_is_described : mêmes cas que le module TypeScript (canScoreProfiles).
  --     Rognage JavaScript : espace insécable, séparateurs, BOM ; longueur en unités UTF-16 (un émoji vaut 2).
  SELECT string_agg(c.label || '=' || public.job_details_is_described(c.jd), ' ' ORDER BY c.o) INTO got
    FROM (VALUES
      (1, 'vide', '{}'::jsonb),
      (2, 'null', NULL::jsonb),
      (3, 'competence', '{"skills_must_have":["Python"]}'::jsonb),
      (4, 'souhaitee', '{"skills_should_have":["SQL"]}'::jsonb),
      (5, 'competences-blanches', '{"skills_must_have":["", "   "],"skills_should_have":[" "]}'::jsonb),
      (6, 'insecable', jsonb_build_object('skills_must_have', jsonb_build_array(E' '))),
      (7, 'bom-et-separateurs', jsonb_build_object('skills_must_have', jsonb_build_array(E'﻿ 　'))),
      (8, 'competence-entouree', jsonb_build_object('skills_must_have', jsonb_build_array(E' Rust '))),
      (9, 'description-30', jsonb_build_object('mission_description', repeat('a', 30))),
      (10, 'description-29', jsonb_build_object('mission_description', repeat('a', 29))),
      (11, 'description-29-espaces', jsonb_build_object('mission_description', repeat('a', 29) || '   ')),
      (12, 'description-29-sauts', jsonb_build_object('mission_description', E'\n\n' || repeat('a', 29))),
      (13, 'saut-de-ligne-seuls', jsonb_build_object('mission_description', repeat(E'\n', 40))),
      (14, 'insecables-seuls', jsonb_build_object('context', repeat(E' ', 40))),
      (15, 'mission-plus-contexte', jsonb_build_object('mission_description', repeat('a', 15), 'context', repeat('b', 13))),
      (16, 'mission-plus-contexte-28', jsonb_build_object('mission_description', repeat('a', 14), 'context', repeat('b', 13))),
      (17, 'emoji-15', jsonb_build_object('mission_description', repeat(E'\U0001F600', 15))),
      (18, 'emoji-14', jsonb_build_object('mission_description', repeat(E'\U0001F600', 14))),
      (19, 'accents-30', jsonb_build_object('mission_description', repeat('é', 30))),
      (20, 'competence-apres-blancs', '{"skills_must_have":[" ", "x"]}'::jsonb)
    ) c(o, label, jd);
  failures := failures || pg_temp.ma_eq('F2 poste décrit', got,
    'vide=false null=false competence=true souhaitee=true competences-blanches=false insecable=false bom-et-separateurs=false '
    || 'competence-entouree=true description-30=true description-29=false description-29-espaces=false '
    || 'description-29-sauts=false saut-de-ligne-seuls=false insecables-seuls=false mission-plus-contexte=true '
    || 'mission-plus-contexte-28=false emoji-15=true emoji-14=false accents-30=true competence-apres-blancs=true');

  -- F3. JSON abîmé : jamais d'erreur, tout ce qui n'est pas une liste de chaînes ou une chaîne est ignoré
  --     (tolérance voulue, sans parité avec JavaScript, qui épelle une chaîne en caractères).
  SELECT string_agg(c.label || '=' || public.job_details_is_described(c.jd), ' ' ORDER BY c.o) INTO got
    FROM (VALUES
      (1, 'competences-pas-liste', '{"skills_must_have":"abc","skills_should_have":{"a":"b"}}'::jsonb),
      (2, 'competences-non-chaines', '{"skills_must_have":[1,null,true,{"a":1},["x"]]}'::jsonb),
      (3, 'description-non-chaine', '{"mission_description":5,"context":["abcdefghijklmnopqrstuvwxyz0123456789"]}'::jsonb),
      (4, 'tableau', '[1,2]'::jsonb),
      (5, 'chaine', '"abc"'::jsonb),
      (6, 'nombre', '42'::jsonb),
      (7, 'booleen', 'true'::jsonb)
    ) c(o, label, jd);
  failures := failures || pg_temp.ma_eq('F3 JSON abîmé', got,
    'competences-pas-liste=false competences-non-chaines=false description-non-chaine=false tableau=false chaine=false '
    || 'nombre=false booleen=false');

  -- ===== R. Réponses sans suite (M1, appelant u_a) =====
  -- Lignes candidat (identifiant = nom) et liens de conversation.
  -- Du plus ancien au plus récent (entrant) : R-nolink -9 j, R-ts -8 j, R-alias -7 j, R-slug -6 j,
  -- R-dup -5 j, R-p1 -3 j, R-p2 -2 j (miens) ; R-c1 -20 j (collègue).
  -- R1, R5 : entrant postérieur au sortant, entrant sans sortant.
  PERFORM pg_temp.ma_row(m1, 'R-p1', 'shortlisted');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-p1', now() - interval '3 days', NULL, u_a, '{}', NULL, 'chat-p1');
  PERFORM pg_temp.ma_row(m1, 'R-p2', 'messaged');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-p2', now() - interval '2 days', now() - interval '4 days', u_a, '{}', NULL, 'chat-p2');
  -- R9 : à trier (notée) gardé ; écarté et embauché exclus.
  PERFORM pg_temp.ma_row(m1, 'R-ts', 'scored', NULL, 70, 'go');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-ts', now() - interval '8 days', NULL, u_a);
  PERFORM pg_temp.ma_row(m1, 'R-rej', 'dismissed');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-rej', now() - interval '1 day', NULL, u_a);
  PERFORM pg_temp.ma_row(m1, 'R-hir', 'shortlisted', 'hired');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-hir', now() - interval '1 day', NULL, u_a);
  -- R14 : un lien sans ligne de mission est gardé, nom NULL.
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-nolink', now() - interval '9 days', NULL, u_a, '{}', NULL, 'chat-nolink');
  -- R17 : rapprochement par alias (candidate_ids) et par slug de l'URL du profil.
  PERFORM pg_temp.ma_row(m1, 'R-alias-row', 'shortlisted', NULL, NULL, NULL, NULL, 'Alias Personne');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'AL-link', now() - interval '7 days', NULL, u_a, ARRAY['R-alias-row']);
  PERFORM pg_temp.ma_row(m1, 'R-slug-row', 'shortlisted', NULL, NULL, NULL, 'https://www.linkedin.com/in/jean-slug/?x=1', 'Jean Slug');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'SL-link', now() - interval '6 days', NULL, u_a, '{}', 'jean-slug');
  -- R13 : doublons de ligne candidat (une ligne canonique) et deux liens du même
  --       candidat sur le même compte (un seul élément).
  PERFORM pg_temp.ma_row(m1, 'R-dup', 'shortlisted');
  PERFORM pg_temp.ma_row(m1, 'R-dup', 'discovered', p_by => u_b);
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-dup', now() - interval '5 days', NULL, u_a);
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-dup-bis', now() - interval '4 days', NULL, u_a, ARRAY['R-dup']);
  -- R6 : compte d'un collègue (acc-b), plus ancien que les miens.
  PERFORM pg_temp.ma_row(m1, 'R-c1', 'messaged');
  PERFORM pg_temp.ma_link(m1, 'acc-b', 'R-c1', now() - interval '20 days', NULL, u_b, '{}', NULL, 'chat-c1');
  -- Compte relié à aucun membre : ni à moi ni à un collègue.
  PERFORM pg_temp.ma_row(m1, 'R-x1', 'shortlisted');
  PERFORM pg_temp.ma_link(m1, 'acc-x', 'R-x1', now() - interval '2 days', NULL, u_a);
  -- R16 : entrant de 40 jours (au-delà de 30 jours).
  PERFORM pg_temp.ma_row(m1, 'R-old', 'messaged');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-old', now() - interval '40 days', NULL, u_a);
  -- R2, R3, R4 : par les vrais écrivains. Le sortant Konekt (touch_mission_conversation, événement outbound)
  --    et le message propre (record_own_message, règle 3) font avancer last_outbound_at ; dates égales : pas de réponse.
  PERFORM pg_temp.ma_row(m1, 'R-out', 'messaged');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc-a', ARRAY['R-out'], NULL, 'chat-out', 'manual', NULL, u_a,
                                            'inbound', NULL, now() - interval '5 days', NULL);
  PERFORM public.touch_mission_conversation(o1, m1, 'acc-a', ARRAY['R-out'], NULL, 'chat-out', 'manual', NULL, u_a,
                                            'outbound', 'mid-out', now() - interval '1 day', 'message');
  PERFORM pg_temp.ma_row(m1, 'R-own', 'messaged');
  PERFORM public.touch_mission_conversation(o1, m1, 'acc-a', ARRAY['R-own'], NULL, 'chat-own', 'manual', NULL, u_a,
                                            'inbound', NULL, now() - interval '5 days', NULL);
  PERFORM pg_temp.ma_row(m1, 'R-eq', 'messaged');
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-eq', now() - interval '3 days', now() - interval '3 days', u_a);
  -- R10 : effacement RGPD par le déclencheur (marqueur posé sur l'inscription du candidat).
  PERFORM pg_temp.ma_row(m1, 'R-gdpr', 'messaged');
  INSERT INTO public.sequence_enrollments (id, sequence_id, account_id, profile_id, organization_id, created_by, status, current_step_order)
  VALUES (e1, q1, 'acc-a', 'R-gdpr', o1, u_a, 'active', 1);
  PERFORM pg_temp.ma_link(m1, 'acc-a', 'R-gdpr', now() - interval '2 days', NULL, u_a, '{}', NULL, 'chat-gdpr', e1);

  -- R-own : message propre depuis le compte, conversation déjà rattachée (chat-own).
  PERFORM pg_temp.ma_as(NULL);
  PERFORM public.record_own_message(o1, 'acc-a', 'chat-own', 'mid-own', '{"ids":["R-own"]}'::jsonb);
  -- R-gdpr : marqueur d'effacement sur l'inscription (le lien existe avant, plus après).
  SELECT count(*) INTO n FROM public.mission_conversations WHERE candidate_id = 'R-gdpr';
  failures := failures || pg_temp.ma_eq('R10 montage, lien présent avant l''effacement', n, 1);
  UPDATE public.sequence_enrollments
     SET tracking_data = coalesce(tracking_data, '{}'::jsonb) || jsonb_build_object('gdpr_erased_at', now())
   WHERE id = e1;
  SELECT count(*) INTO n FROM public.mission_conversations WHERE candidate_id = 'R-gdpr';
  failures := failures || pg_temp.ma_eq('R10 montage, lien effacé par le déclencheur', n, 0);

  -- Appel par u_a (propriétaire, compte acc-a).
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1], 20) a;
    SELECT jsonb_agg(to_jsonb(a)) INTO res2 FROM public.get_mission_attention(ARRAY[m1], 5) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    -- Miens : R-nolink, R-ts, R-alias-row (alias), R-slug-row (slug), R-dup (deux liens, une ligne), R-p1, R-p2 = 7.
    failures := failures
      || pg_temp.ma_eq('R1 une ligne par mission', pg_temp.ma_n(res), 1)
      || pg_temp.ma_eq('R1 has_own_account', pg_temp.ma_get(res, m1, 'has_own_account'), 'true')
      || pg_temp.ma_eq('R1 replies_mine', pg_temp.ma_get(res, m1, 'replies_mine'), '7')
      || pg_temp.ma_eq('R6 replies_others (un collègue, compte sans membre exclu)', pg_temp.ma_get(res, m1, 'replies_others'), '1')
      || pg_temp.ma_eq('R1 plus ancienne réponse à moi',
           (pg_temp.ma_get(res, m1, 'replies_mine_oldest_at')::timestamptz = now() - interval '9 days'), true)
      || pg_temp.ma_eq('R6 plus ancienne réponse d''un collègue',
           (pg_temp.ma_get(res, m1, 'replies_others_oldest_at')::timestamptz = now() - interval '20 days'), true)
      -- Ordre : les miens d'abord, du plus ancien au plus récent, puis les collègues.
      || pg_temp.ma_eq('R19 ordre des éléments', pg_temp.ma_ids_of(res, m1, 'reply_items'),
           'R-nolink,R-ts,R-alias-row,R-slug-row,R-dup,R-p1,R-p2,R-c1')
      || pg_temp.ma_eq('R19 plafond de 5 éléments, compteurs entiers', pg_temp.ma_ids_of(res2, m1, 'reply_items'),
           'R-nolink,R-ts,R-alias-row,R-slug-row,R-dup')
      || pg_temp.ma_eq('R19 compteur avec plafond', pg_temp.ma_get(res2, m1, 'replies_mine'), '7')
      -- R1, R5 : entrant postérieur ou sans sortant ; R2, R3, R4 : non.
      || pg_temp.ma_eq('R1 entrant postérieur au sortant', pg_temp.ma_item(res, m1, 'reply_items', 'R-p2', 'is_mine'), 'true')
      || pg_temp.ma_eq('R5 entrant sans sortant', pg_temp.ma_item(res, m1, 'reply_items', 'R-p1', 'is_mine'), 'true')
      || pg_temp.ma_eq('R2 sortant Konekt postérieur', pg_temp.ma_item(res, m1, 'reply_items', 'R-out', 'is_mine'), NULL::text)
      || pg_temp.ma_eq('R3 message propre postérieur', pg_temp.ma_item(res, m1, 'reply_items', 'R-own', 'is_mine'), NULL::text)
      || pg_temp.ma_eq('R4 dates égales', pg_temp.ma_item(res, m1, 'reply_items', 'R-eq', 'is_mine'), NULL::text)
      -- R9 : à trier gardé, écarté et embauché exclus.
      || pg_temp.ma_eq('R9 à trier gardé', pg_temp.ma_item(res, m1, 'reply_items', 'R-ts', 'stage'), 'to_sort')
      || pg_temp.ma_eq('R9 retenu gardé', pg_temp.ma_item(res, m1, 'reply_items', 'R-p1', 'stage'), 'retained')
      || pg_temp.ma_eq('R9 contacté gardé', pg_temp.ma_item(res, m1, 'reply_items', 'R-p2', 'stage'), 'contacted')
      || pg_temp.ma_eq('R9 écarté exclu', pg_temp.ma_item(res, m1, 'reply_items', 'R-rej', 'stage'), NULL::text)
      || pg_temp.ma_eq('R9 embauché exclu', pg_temp.ma_item(res, m1, 'reply_items', 'R-hir', 'stage'), NULL::text)
      -- R14 : lien sans ligne, gardé, nom et ligne NULL, conversation rendue.
      || pg_temp.ma_eq('R14 lien sans ligne : présent', pg_temp.ma_item(res, m1, 'reply_items', 'R-nolink', 'is_mine'), 'true')
      || pg_temp.ma_eq('R14 lien sans ligne : row_id', pg_temp.ma_item(res, m1, 'reply_items', 'R-nolink', 'row_id'), NULL::text)
      || pg_temp.ma_eq('R14 lien sans ligne : nom', pg_temp.ma_item(res, m1, 'reply_items', 'R-nolink', 'candidate_name'), NULL::text)
      || pg_temp.ma_eq('R14 lien sans ligne : chat', pg_temp.ma_item(res, m1, 'reply_items', 'R-nolink', 'chat_id'), 'chat-nolink')
      -- R17 : alias et slug rapprochés de la ligne (identifiant de la ligne, nom de la ligne).
      || pg_temp.ma_eq('R17 alias : nom', pg_temp.ma_item(res, m1, 'reply_items', 'R-alias-row', 'candidate_name'), 'Alias Personne')
      || pg_temp.ma_eq('R17 slug : nom', pg_temp.ma_item(res, m1, 'reply_items', 'R-slug-row', 'candidate_name'), 'Jean Slug')
      || pg_temp.ma_eq('R17 identifiant d''un lien non rapproché', pg_temp.ma_item(res, m1, 'reply_items', 'AL-link', 'is_mine'), NULL::text)
      || pg_temp.ma_eq('R17 la ligne a un identifiant', (pg_temp.ma_item(res, m1, 'reply_items', 'R-alias-row', 'row_id') IS NOT NULL), true)
      -- R13 : un seul élément pour R-dup (deux lignes candidat, deux liens du même compte).
      || pg_temp.ma_eq('R13 doublons : un élément', (SELECT count(*)::integer
           FROM jsonb_array_elements(res -> 0 -> 'reply_items') i WHERE i ->> 'candidate_id' = 'R-dup'), 1)
      -- R6 : le collègue, avec le nom de son compte ; non à moi.
      || pg_temp.ma_eq('R6 collègue : is_mine', pg_temp.ma_item(res, m1, 'reply_items', 'R-c1', 'is_mine'), 'false')
      || pg_temp.ma_eq('R6 collègue : chat', pg_temp.ma_item(res, m1, 'reply_items', 'R-c1', 'chat_id'), 'chat-c1')
      || pg_temp.ma_eq('R18 compte sans membre : absent', pg_temp.ma_item(res, m1, 'reply_items', 'R-x1', 'is_mine'), NULL::text)
      -- R16 : plafond d'ancienneté de 30 jours par défaut.
      || pg_temp.ma_eq('R16 réponse de 40 jours : absente', pg_temp.ma_item(res, m1, 'reply_items', 'R-old', 'is_mine'), NULL::text);
  ELSE
    failures := failures || '[R authenticated n''exécute pas get_mission_attention] ';
  END IF;

  -- R16 suite : sans plafond (NULL) et avec 60 jours, la réponse de 40 jours remonte ; avec 7 jours, seules les récentes.
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1], 20, 5, NULL) a;
    SELECT jsonb_agg(to_jsonb(a)) INTO res2 FROM public.get_mission_attention(ARRAY[m1], 20, 5, 7) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R16 sans plafond', pg_temp.ma_get(res, m1, 'replies_mine'), '8')
      || pg_temp.ma_eq('R16 sans plafond : ordre', pg_temp.ma_ids_of(res, m1, 'reply_items'),
           'R-old,R-nolink,R-ts,R-alias-row,R-slug-row,R-dup,R-p1,R-p2,R-c1')
      -- Borne stricte : la réponse de 7 jours exactement (R-alias-row) n'y est plus.
      || pg_temp.ma_eq('R16 plafond de 7 jours : miens', pg_temp.ma_get(res2, m1, 'replies_mine'), '4')
      || pg_temp.ma_eq('R16 plafond de 7 jours : collègues', pg_temp.ma_get(res2, m1, 'replies_others'), '0')
      || pg_temp.ma_eq('R16 plafond de 7 jours : éléments', pg_temp.ma_ids_of(res2, m1, 'reply_items'), 'R-slug-row,R-dup,R-p1,R-p2');
  END IF;

  -- R20. Plafond des éléments : 0 donne des compteurs sans élément ; un plafond démesuré est ramené à 200.
  INSERT INTO public.mission_conversations (organization_id, project_id, account_id, candidate_id, source, created_by,
                                            last_inbound_at)
  SELECT o1, m6, 'acc-a', 'bulk-' || g, 'manual', u_a, now() - interval '1 hour' - g * interval '1 second'
    FROM generate_series(1, 205) g;
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m6], 0) a;
    SELECT jsonb_agg(to_jsonb(a)) INTO res2 FROM public.get_mission_attention(ARRAY[m6], 100000) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R20 plafond 0 : compteur', pg_temp.ma_get(res, m6, 'replies_mine'), '205')
      || pg_temp.ma_eq('R20 plafond 0 : éléments', jsonb_array_length(res -> 0 -> 'reply_items'), 0)
      || pg_temp.ma_eq('R20 plafond démesuré : compteur entier', pg_temp.ma_get(res2, m6, 'replies_mine'), '205')
      || pg_temp.ma_eq('R20 plafond démesuré : 200 éléments', jsonb_array_length(res2 -> 0 -> 'reply_items'), 200);
  END IF;
  DELETE FROM public.mission_conversations WHERE project_id = m6;

  -- Appel par u_b (membre, compte acc-b) : il voit ses réponses (R-c1) et celles de u_a chez un collègue.
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_b);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1], 20) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R6 membre : à moi', pg_temp.ma_get(res, m1, 'replies_mine'), '1')
      || pg_temp.ma_eq('R6 membre : chez un collègue', pg_temp.ma_get(res, m1, 'replies_others'), '7')
      || pg_temp.ma_eq('R6 membre : ordre', pg_temp.ma_ids_of(res, m1, 'reply_items'),
           'R-c1,R-nolink,R-ts,R-alias-row,R-slug-row,R-dup,R-p1,R-p2');
  END IF;

  -- R11 : u_n, membre sans compte relié : has_own_account faux, replies_mine 0 (pas « aucune réponse »).
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_n);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1], 20) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R11 sans compte : has_own_account', pg_temp.ma_get(res, m1, 'has_own_account'), 'false')
      || pg_temp.ma_eq('R11 sans compte : replies_mine', pg_temp.ma_get(res, m1, 'replies_mine'), '0')
      || pg_temp.ma_eq('R11 sans compte : replies_mine_oldest_at', pg_temp.ma_get(res, m1, 'replies_mine_oldest_at'), NULL::text)
      || pg_temp.ma_eq('R11 sans compte : replies_others', pg_temp.ma_get(res, m1, 'replies_others'), '8');
  END IF;

  -- R7 : collaborateur. M5 : un lien de u_a (acc-a), un lien de u_k créé par lui, un lien de u_k sans auteur.
  --      La RLS de mission_conversations ne rend au collaborateur que les liens dont il est l'auteur.
  PERFORM pg_temp.ma_link(m5, 'acc-a', 'K-a', now() - interval '2 days', NULL, u_a);
  PERFORM pg_temp.ma_link(m5, 'acc-k', 'K-k', now() - interval '2 days', NULL, u_k);
  PERFORM pg_temp.ma_link(m5, 'acc-k', 'K-k0', now() - interval '2 days', NULL, NULL);
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_k);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m5], 20) a;
    SELECT count(*) INTO n FROM public.sourcing_projects WHERE id = m5;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    IF n = 0 THEN
      failures := failures || '[R7 la mission M5 est invisible pour le collaborateur : contrôle impossible] ';
    ELSE
      failures := failures
        || pg_temp.ma_eq('R7 collaborateur : à moi', pg_temp.ma_get(res, m5, 'replies_mine'), '1')
        || pg_temp.ma_eq('R7 collaborateur : chez un collègue (liens des autres invisibles)', pg_temp.ma_get(res, m5, 'replies_others'), '0')
        || pg_temp.ma_eq('R7 collaborateur : éléments', pg_temp.ma_ids_of(res, m5, 'reply_items'), 'K-k')
        || pg_temp.ma_eq('R7 collaborateur : has_own_account', pg_temp.ma_get(res, m5, 'has_own_account'), 'true');
    END IF;
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m5], 20) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R7 propriétaire : à moi', pg_temp.ma_get(res, m5, 'replies_mine'), '1')
      || pg_temp.ma_eq('R7 propriétaire : chez un collègue', pg_temp.ma_get(res, m5, 'replies_others'), '2');
  END IF;

  -- R8, R12 : autre organisation. u_a demande M1 et M9 : une seule ligne (M1). u_c demande M1 et M9 : M9 seule.
  --           Mission inconnue : aucune ligne. Zéros faux jamais rendus.
  PERFORM pg_temp.ma_link(m9, 'acc-c', 'O2-1', now() - interval '2 days', NULL, u_c);
  -- u_a est aussi dans l'équipe de M9 : la policy d'équipe de sourcing_projects lui rend la mission de O2.
  -- La fonction ne la rend pas pour autant (comme get_mission_stage_counts) : pas de zéros faux.
  INSERT INTO public.mission_team (project_id, user_id, role) VALUES (m9, u_a, 'freelance');
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO n FROM public.sourcing_projects WHERE id = m9;
    failures := failures || pg_temp.ma_eq('R12 montage : M9 visible de u_a par l''équipe de mission', n, 1);
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1, m9, gen_random_uuid()], 5) a;
    SELECT jsonb_agg(to_jsonb(a)) INTO res2 FROM public.get_mission_attention(ARRAY[m9], 5) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R12 u_a demande M1 et M9 : une ligne', pg_temp.ma_n(res), 1)
      || pg_temp.ma_eq('R12 la ligne est M1', pg_temp.ma_get(res, m1, 'has_own_account'), 'true')
      || pg_temp.ma_eq('R12 M9 absente (pas de zéros faux)', pg_temp.ma_get(res, m9, 'has_own_account'), NULL::text)
      || pg_temp.ma_eq('R12 u_a demande M9 seule : aucune ligne', pg_temp.ma_n(res2), 0);
    PERFORM pg_temp.ma_as(u_c);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1, m9], 5) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R8 u_c demande M1 et M9 : une ligne', pg_temp.ma_n(res), 1)
      || pg_temp.ma_eq('R8 la ligne est M9 : à moi', pg_temp.ma_get(res, m9, 'replies_mine'), '1')
      || pg_temp.ma_eq('R8 rien de O1 : M1 absente', pg_temp.ma_get(res, m1, 'replies_mine'), NULL::text)
      || pg_temp.ma_eq('R8 rien de O1 : éléments', pg_temp.ma_ids_of(res, m9, 'reply_items'), 'O2-1');
  END IF;

  -- R15 : un compte relié à deux organisations (état hérité). M7 (O1) et M9 (O2) ont chacune un lien sur acc-y.
  PERFORM pg_temp.ma_link(m7, 'acc-y', 'Y-1', now() - interval '2 days', NULL, u_m);
  PERFORM pg_temp.ma_link(m9, 'acc-y', 'Y-2', now() - interval '2 days', NULL, u_d);
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_m);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m7, m9], 5) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(u_d);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res2 FROM public.get_mission_attention(ARRAY[m7, m9], 5) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('R15 u_m (O1) : M7 seule', pg_temp.ma_n(res), 1)
      || pg_temp.ma_eq('R15 u_m : ses liens de O1', pg_temp.ma_ids_of(res, m7, 'reply_items'), 'Y-1')
      || pg_temp.ma_eq('R15 u_d (O2) : M9 seule', pg_temp.ma_n(res2), 1)
      || pg_temp.ma_eq('R15 u_d : ses liens de O2 (pas ceux de O1, pas O2-1 de u_c)', pg_temp.ma_ids_of(res2, m9, 'reply_items'), 'Y-2,O2-1')
      || pg_temp.ma_eq('R15 u_d : à moi', pg_temp.ma_get(res2, m9, 'replies_mine'), '1')
      || pg_temp.ma_eq('R15 u_d : chez un collègue', pg_temp.ma_get(res2, m9, 'replies_others'), '1');
  END IF;

  -- R19 : sans jeton (serveur) : aucune ligne, jamais les réponses vues comme celles d'un collègue.
  PERFORM pg_temp.ma_as(NULL);
  SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1, m9], 5) a;
  failures := failures || pg_temp.ma_eq('R19 sans jeton : aucune ligne', pg_temp.ma_n(res), 0);

  -- ===== I. Entretiens sans nouvelles (M3, étape S3), seuil de 5 jours =====
  x := pg_temp.ma_row(m3, 'I-oldest', 'shortlisted', s3::text);
  PERFORM pg_temp.ma_age(x, now() - interval '30 days');
  x := pg_temp.ma_row(m3, 'I-6d', 'shortlisted', 'ITW en cours');
  PERFORM pg_temp.ma_age(x, now() - interval '6 days');
  x := pg_temp.ma_row(m3, 'I-5d1s', 'shortlisted', 'ITW en cours');
  PERFORM pg_temp.ma_age(x, now() - interval '5 days' - interval '1 second');
  x := pg_temp.ma_row(m3, 'I-5d', 'shortlisted', 'ITW en cours');
  PERFORM pg_temp.ma_age(x, now() - interval '5 days');
  x := pg_temp.ma_row(m3, 'I-1d', 'shortlisted', 'ITW en cours');
  PERFORM pg_temp.ma_age(x, now() - interval '1 day');
  x := pg_temp.ma_row(m3, 'I-rep', 'replied');
  PERFORM pg_temp.ma_age(x, now() - interval '30 days');
  x := pg_temp.ma_row(m3, 'I-rej', 'dismissed');
  PERFORM pg_temp.ma_age(x, now() - interval '30 days');
  -- Doublon : la ligne canonique est celle en entretien (étape la plus avancée), comptée une fois.
  x := pg_temp.ma_row(m3, 'I-dup', 'shortlisted', 'ITW en cours');
  PERFORM pg_temp.ma_age(x, now() - interval '10 days');
  x2 := pg_temp.ma_row(m3, 'I-dup', 'discovered', p_by => u_b);
  PERFORM pg_temp.ma_age(x2, now() - interval '40 days');
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m3], 2) a;
    SELECT jsonb_agg(to_jsonb(a)) INTO res2 FROM public.get_mission_attention(ARRAY[m3], 10, 2) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('I1 en attente (30 j, 10 j, 6 j, 5 j + 1 s ; ni 5 j exactement ni 1 j)', pg_temp.ma_get(res, m3, 'interview_waiting'), '4')
      || pg_temp.ma_eq('I1 le plus ancien',
           (pg_temp.ma_get(res, m3, 'interview_waiting_oldest_at')::timestamptz = now() - interval '30 days'), true)
      || pg_temp.ma_eq('I2 ordre et plafond de 2', pg_temp.ma_ids_of(res, m3, 'interview_items'), 'I-oldest,I-dup')
      || pg_temp.ma_eq('I2 étape d''entretien', pg_temp.ma_item(res, m3, 'interview_items', 'I-oldest', 'process_step_id'), s3::text)
      || pg_temp.ma_eq('I2 sans étape', pg_temp.ma_item(res, m3, 'interview_items', 'I-dup', 'process_step_id'), NULL::text)
      || pg_temp.ma_eq('I2 date d''entrée', (pg_temp.ma_item(res, m3, 'interview_items', 'I-dup', 'stage_entered_at')::timestamptz
                                            = now() - interval '10 days'), true)
      || pg_temp.ma_eq('I2 nom', pg_temp.ma_item(res, m3, 'interview_items', 'I-dup', 'candidate_name'), 'I-dup')
      || pg_temp.ma_eq('I2 identifiant de la ligne', (pg_temp.ma_item(res, m3, 'interview_items', 'I-dup', 'row_id') IS NOT NULL), true)
      || pg_temp.ma_eq('I3 seuil de 2 jours : tous sauf 1 j', pg_temp.ma_get(res2, m3, 'interview_waiting'), '5')
      || pg_temp.ma_eq('I3 seuil de 2 jours : ordre', pg_temp.ma_ids_of(res2, m3, 'interview_items'),
           'I-oldest,I-dup,I-6d,I-5d1s,I-5d')
      || pg_temp.ma_eq('I4 mission sans entretien : zéro et liste vide', pg_temp.ma_get(res, m3, 'replies_mine'), '0');
    -- I5 : mission sans aucun entretien (M8).
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m8]) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('I5 mission sans entretien', pg_temp.ma_get(res, m8, 'interview_waiting') || '/'
           || coalesce(pg_temp.ma_get(res, m8, 'interview_waiting_oldest_at'), '-') || '/'
           || pg_temp.ma_ids_of(res, m8, 'interview_items'), '0/-/-');
  END IF;

  -- ===== T. Profils notés à trier (M6) =====
  PERFORM pg_temp.ma_row(m6, 'S-go', 'scored', NULL, 80, 'go');
  PERFORM pg_temp.ma_row(m6, 'S-strong', 'scored', NULL, 90, 'STRONG_MATCH');
  PERFORM pg_temp.ma_row(m6, 'S-good', 'scored', NULL, 70, 'GOOD_MATCH');
  PERFORM pg_temp.ma_row(m6, 'S-GO-maj', 'scored', NULL, 75, ' GO ');
  PERFORM pg_temp.ma_row(m6, 'S-maybe', 'scored', NULL, 50, 'maybe');
  PERFORM pg_temp.ma_row(m6, 'S-weak', 'scored', NULL, 30, 'WEAK_MATCH');
  PERFORM pg_temp.ma_row(m6, 'S-free', 'scored', NULL, 60, 'Le candidat est intéressé');
  PERFORM pg_temp.ma_row(m6, 'S-null', 'scored', NULL, 40, NULL);
  PERFORM pg_temp.ma_row(m6, 'S-unopened', 'discovered');                       -- jamais ouvert : exclu
  PERFORM pg_temp.ma_row(m6, 'S-new', 'new');                                   -- À trier, ouvert, sans note : exclu
  PERFORM pg_temp.ma_row(m6, 'S-ret', 'shortlisted', NULL, 85, 'go');           -- retenu noté : exclu
  PERFORM pg_temp.ma_row(m6, 'S-rej', 'dismissed', NULL, 85, 'go');             -- écarté noté : exclu
  PERFORM pg_temp.ma_row(m6, 'S-dup', 'scored', NULL, 70, 'GOOD_MATCH');        -- doublon : la note du groupe, compté une fois
  PERFORM pg_temp.ma_row(m6, 'S-dup', 'discovered', p_by => u_b);
  -- Noté dans une autre mission de l'organisation : ne compte pas ici.
  PERFORM pg_temp.ma_row(m8, 'S-ailleurs', 'scored', NULL, 80, 'go');
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m6, m8]) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('T1 notés à trier', pg_temp.ma_get(res, m6, 'to_sort_scored'), '9')
      || pg_temp.ma_eq('T1 dont recommandés (go, STRONG_MATCH, GOOD_MATCH, GO, doublon GOOD_MATCH)',
           pg_temp.ma_get(res, m6, 'to_sort_recommended'), '5')
      || pg_temp.ma_eq('T2 autre mission', pg_temp.ma_get(res, m8, 'to_sort_scored') || '/' || pg_temp.ma_get(res, m8, 'to_sort_recommended'), '1/1');
  END IF;

  -- ===== J. Poste décrit (rang 11) par mission =====
  UPDATE public.sourcing_projects SET job_details = '{"skills_must_have":["", "  "],"context":"court"}'::jsonb WHERE id = m3;
  UPDATE public.sourcing_projects SET job_details = jsonb_build_object('mission_description', repeat('a', 30)) WHERE id = m5;
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(ARRAY[m1, m3, m5, m6, m8]) a;
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('J1 poste décrit (une compétence)', pg_temp.ma_get(res, m1, 'job_described'), 'true')
      || pg_temp.ma_eq('J2 poste vide (compétences blanches, contexte court)', pg_temp.ma_get(res, m3, 'job_described'), 'false')
      || pg_temp.ma_eq('J3 poste décrit (description de 30 caractères)', pg_temp.ma_get(res, m5, 'job_described'), 'true')
      || pg_temp.ma_eq('J4 poste sans détails (NULL)', pg_temp.ma_get(res, m6, 'job_described'), 'false')
      || pg_temp.ma_eq('J5 poste {}', pg_temp.ma_get(res, m8, 'job_described'), 'false')
      || pg_temp.ma_eq('J6 cinq lignes pour cinq missions', pg_temp.ma_n(res), 5);
  END IF;

  -- ===== P. Plan : le filtre project_id descend sous les fenêtres de la vue =====
  -- Même requête que le CTE v de la fonction (tableau en paramètre, filtre sur les missions de l'appelant).
  FOR line IN EXECUTE format(
    'EXPLAIN SELECT c.id FROM public.mission_candidate_rows c WHERE c.project_id = ANY (%L::uuid[]) '
    || 'AND c.project_id IN (SELECT sp.id FROM public.sourcing_projects sp WHERE sp.organization_id = %L)',
    ARRAY[m1, m3], o1)
  LOOP
    IF line LIKE '%WindowAgg%' THEN
      v_seen_window := true;
    ELSIF v_seen_window AND line LIKE '%project_id = ANY%' THEN
      v_pushed := true;
    END IF;
  END LOOP;
  failures := failures || pg_temp.ma_eq('P1 le filtre project_id = ANY descend sous les fenêtres', v_seen_window AND v_pushed, true);
  -- P2. La fonction écrit bien ce filtre (une fonction SQL avec SET n'est pas aplatie : son plan interne
  --     n'apparaît pas dans l'EXPLAIN d'un appel, le contrôle P1 porte sur la même requête).
  SELECT p.prosrc LIKE '%WHERE c.project_id = ANY (p_project_ids)%' INTO v_pushed
    FROM pg_proc p WHERE p.oid = to_regprocedure(sig_att);
  failures := failures || pg_temp.ma_eq('P2 la fonction filtre la vue par project_id = ANY(p_project_ids)', v_pushed, true);

  -- P3. Volume : 6 missions x 3000 lignes, 600 réponses en attente par mission, rapprochées par identifiant,
  --     alias et slug. Le coût doit suivre les lignes et les liens, pas leur produit : un balayage des lignes
  --     par lien (boucle imbriquée sur un CTE que le planificateur croit à une ligne) dépasse ici plusieurs
  --     secondes, la lecture par tri en prend moins d'une. Seuil large pour une machine de CI chargée.
  INSERT INTO public.sourcing_projects (id, name, organization_id, created_by, job_details)
  SELECT pg_temp.ma_id('v' || i), 'Volume ' || i, o1, u_a, '{"skills_must_have":["x"]}'::jsonb
    FROM generate_series(1, 6) i;
  INSERT INTO public.job_candidate_status
    (candidate_id, job_id, project_id, organization_id, created_by, status, candidate_name, linkedin_profile_url)
  SELECT 'vc' || g, 'project:' || p.id, p.id, p.organization_id, p.created_by, 'new', 'Volume ' || g,
         'https://www.linkedin.com/in/volume-' || g
    FROM public.sourcing_projects p, generate_series(1, 3000) g
   WHERE p.name LIKE 'Volume %' AND p.organization_id = o1;
  INSERT INTO public.mission_conversations
    (organization_id, project_id, account_id, candidate_id, candidate_ids, candidate_slug, chat_id, source,
     created_by, last_inbound_at, last_outbound_at)
  SELECT p.organization_id, p.id, 'acc-a',
         CASE g % 3 WHEN 0 THEN 'vc' || g ELSE 'ailleurs' || g END,
         CASE g % 3 WHEN 1 THEN ARRAY['vc' || g] ELSE '{}'::text[] END,
         CASE g % 3 WHEN 2 THEN 'volume-' || g END,
         'volume-chat-' || g, 'manual', p.created_by, now() - interval '1 day', NULL
    FROM public.sourcing_projects p, generate_series(1, 600) g
   WHERE p.name LIKE 'Volume %' AND p.organization_id = o1;
  ANALYZE public.job_candidate_status;
  ANALYZE public.mission_conversations;
  IF has_function_privilege('authenticated', sig_att, 'EXECUTE') THEN
    vids := ARRAY(SELECT pg_temp.ma_id('v' || i) FROM generate_series(1, 6) i);
    PERFORM pg_temp.ma_as(u_a);
    SET LOCAL ROLE authenticated;
    t0 := clock_timestamp();
    SELECT jsonb_agg(to_jsonb(a)) INTO res FROM public.get_mission_attention(vids) a;
    t1 := clock_timestamp();
    RESET ROLE;
    PERFORM pg_temp.ma_as(NULL);
    failures := failures
      || pg_temp.ma_eq('P3 six missions rendues', pg_temp.ma_n(res), 6)
      || pg_temp.ma_eq('P3 600 réponses par mission', pg_temp.ma_get(res, pg_temp.ma_id('v1'), 'replies_mine'), '600')
      || pg_temp.ma_eq('P3 liens rapprochés (nom du candidat, tous modes)',
           (SELECT count(*) FILTER (WHERE i ->> 'candidate_name' IS NOT NULL)
              FROM jsonb_array_elements(res) e, jsonb_array_elements(e -> 'reply_items') i)::integer, 30);
    RAISE NOTICE 'P3 durée : % s', round(extract(epoch FROM t1 - t0)::numeric, 2);
    IF extract(epoch FROM t1 - t0) > 3 THEN
      failures := failures || format('[P3 durée : %s s, seuil 3 s] ', round(extract(epoch FROM t1 - t0)::numeric, 2));
    END IF;
  END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'mission_attention_audit : %', failures;
  END IF;
  RAISE NOTICE 'mission_attention_audit : tous les contrôles passés (S1-S4, F1-F3, R1-R20, I1-I5, T1-T2, J1-J6, P1-P3)';
END $$;
