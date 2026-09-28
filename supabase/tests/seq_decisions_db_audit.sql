-- =====================================================================
-- Module séquences, décisions produit de la seconde vague (2026-09-28),
-- lot « db » : migration 20260928055804_sequences_decisions_base.sql.
-- docs/audit-2026-09-25-sequences.md, « Décisions produit en attente »,
-- numéros 12, 15, 17, 18, 19, 20, 21.
--
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK :
--   BEGIN; \i supabase/tests/seq_decisions_db_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/seq_decisions_db_audit.sql -c 'ROLLBACK;')
--
-- Chaque bloc accumule ses contrôles dans seq_dec_results ; le dernier bloc
-- lève une seule exception listant les contrôles en échec, préfixés par la
-- clé du comportement testé. Aucun ALTER TABLE.
-- =====================================================================
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

CREATE TEMP TABLE seq_dec_results (
  behaviour text NOT NULL,
  checks int NOT NULL,
  failures text NOT NULL
) ON COMMIT DROP;

-- Contexte d'appel : utilisateur connecté (p_uid) ou chemin serveur (NULL).
-- Vide aussi le cache transactionnel de get_user_org_id des utilisateurs du jeu.
CREATE FUNCTION pg_temp.sdec_as(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  u uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid IS NULL THEN '' ELSE 'authenticated' END, true);
  FOREACH u IN ARRAY ARRAY[
    'dec00000-0000-4000-8000-00000000000a', 'dec00000-0000-4000-8000-00000000000b',
    'dec00000-0000-4000-8000-00000000000c', 'dec00000-0000-4000-8000-00000000000d',
    'dec00000-0000-4000-8000-00000000000e']::uuid[]
  LOOP
    PERFORM set_config('app.user_org.u_' || replace(u::text, '-', '_'), '', true);
  END LOOP;
END $$;

-- Empreinte du registre gdpr_erasures (normalisation déjà faite par l'appelant).
CREATE FUNCTION pg_temp.sdec_hash(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- ---------------------------------------------------------------------
-- Jeu de données commun (chemin serveur)
--   u_a propriétaire de A, u_m membre de A, u_c collaborateur de A,
--   u_d administrateur de A, u_b propriétaire de B.
--   seq_a et seq_a2 (A, créées par u_a), seq_b (B) : deux étapes chacune.
--   Compte 'sdec-acc-owner' relié à u_a, 'sdec-acc-m' relié à u_m.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_m uuid := 'dec00000-0000-4000-8000-00000000000b';
  u_c uuid := 'dec00000-0000-4000-8000-00000000000c';
  u_d uuid := 'dec00000-0000-4000-8000-00000000000d';
  u_b uuid := 'dec00000-0000-4000-8000-00000000000e';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  org_b uuid := 'decb0000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.sdec_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'sdec-a@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_m, 'sdec-m@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_c, 'sdec-c@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_d, 'sdec-d@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'sdec-b@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, org_type, created_by)
  VALUES (org_a, 'SDec Org A', 'sdec-org-a', 'agency', u_a),
         (org_b, 'SDec Org B', 'sdec-org-b', 'agency', u_b);
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_m, 'member'), (org_a, u_c, 'collaborator'), (org_a, u_d, 'admin');
  UPDATE public.profiles SET active_organization_id = org_a WHERE user_id IN (u_a, u_m, u_c, u_d);
  UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = u_b;

  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES ('deca2000-0000-4000-8000-000000000001', 'SDec A', org_a, u_a, true),
         ('deca2000-0000-4000-8000-000000000002', 'SDec A2', org_a, u_a, true),
         ('decb2000-0000-4000-8000-000000000001', 'SDec B', org_b, u_b, true);
  INSERT INTO public.sequence_steps (id, sequence_id, organization_id, step_order, action_type, message_template)
  VALUES ('deca3000-0000-4000-8000-000000000001', 'deca2000-0000-4000-8000-000000000001', org_a, 1, 'message', 'Bonjour'),
         ('deca3000-0000-4000-8000-000000000002', 'deca2000-0000-4000-8000-000000000001', org_a, 2, 'message', 'Relance'),
         ('deca3000-0000-4000-8000-000000000021', 'deca2000-0000-4000-8000-000000000002', org_a, 1, 'message', 'Bonjour'),
         ('decb3000-0000-4000-8000-000000000001', 'decb2000-0000-4000-8000-000000000001', org_b, 1, 'message', 'Bonjour');
  INSERT INTO public.member_linkedin_accounts (organization_id, user_id, linkedin_account_id, linked_by)
  VALUES (org_a, u_a, 'sdec-acc-owner', u_a), (org_a, u_m, 'sdec-acc-m', u_m);
END $$;

-- ---------------------------------------------------------------------
-- @critical d12-profil-efface-inscription-refusee (décision 12)
-- Une nouvelle inscription d'un profil effacé est refusée (42501, HINT
-- ENROLLMENT_GDPR_ERASED), par l'interface comme par le serveur : empreinte
-- de l'URL ou de l'adresse au registre global, ou marqueur gdpr_erased_at
-- d'une inscription de l'organisation rapprochée par identifiant ou slug.
-- Un marqueur d'une autre organisation, un slug voisin et un marqueur vide
-- ne bloquent pas.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_c uuid := 'dec00000-0000-4000-8000-00000000000c';
  u_b uuid := 'dec00000-0000-4000-8000-00000000000e';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  org_b uuid := 'decb0000-0000-4000-8000-000000000001';
  seq_a uuid := 'deca2000-0000-4000-8000-000000000001';
  seq_a2 uuid := 'deca2000-0000-4000-8000-000000000002';
  seq_b uuid := 'decb2000-0000-4000-8000-000000000001';
  v_label text;
  v_who uuid;
  v_prof text;
  v_url text;
  v_email text;
  v_prov text;
  v_hint text;
  v_n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.sdec_as(NULL);
  INSERT INTO public.gdpr_erasures (linkedin_url_hash, source)
  VALUES (pg_temp.sdec_hash('https://www.linkedin.com/in/sdec-efface-url'), 'audit');
  INSERT INTO public.gdpr_erasures (email_hash, source)
  VALUES (pg_temp.sdec_hash('sdec.efface@audit.test'), 'audit');
  -- Marqueurs de l'organisation A (identifiant, slug), de B, et un marqueur vide.
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status, completed_at, tracking_data)
  VALUES (seq_a2, 'sdec-mail@audit.test', 'ACoSDECMARK1', org_a, u_a, 'stopped', now() - interval '2 days',
          jsonb_build_object('gdpr_erased_at', now() - interval '2 days'));
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, profile_url, organization_id, created_by, status, completed_at, tracking_data)
  VALUES (seq_a2, 'sdec-mail@audit.test', 'ACoSDECMARK2', 'https://www.linkedin.com/in/sdec-slug-efface', org_a, u_a, 'completed',
          now() - interval '200 days', jsonb_build_object('gdpr_erased_at', now() - interval '2 days'));
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status, completed_at, tracking_data)
  VALUES (seq_b, 'sdec-mail-b@audit.test', 'ACoSDECOTHERORG', org_b, u_b, 'stopped', now() - interval '2 days',
          jsonb_build_object('gdpr_erased_at', now() - interval '2 days'));
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status, tracking_data)
  VALUES (seq_a2, 'sdec-mail@audit.test', 'ACoSDECEMPTYMARK', org_a, u_a, 'paused', '{"gdpr_erased_at": null}'::jsonb);

  -- Refus : (libellé, auteur ou NULL pour le serveur, profile_id, URL, adresse, provider_id).
  FOR v_label, v_who, v_prof, v_url, v_email, v_prov IN SELECT * FROM (VALUES
    ('registre URL (propriétaire, URL non normalisée)', u_a, 'ACoSDECNEW1', 'https://www.linkedin.com/in/SDEC-Efface-URL/?utm_source=x', NULL, NULL),
    ('registre URL (serveur)', NULL, 'ACoSDECNEW2', 'https://www.linkedin.com/in/sdec-efface-url', NULL, NULL),
    ('registre adresse (serveur)', NULL, 'ACoSDECNEW3', NULL, '  SDEC.Efface@Audit.Test ', NULL),
    ('marqueur, identifiant classique en provider_id (propriétaire)', u_a, 'AEMSDECMARK1', NULL, NULL, 'ACoSDECMARK1'),
    ('marqueur, même identifiant dans une autre séquence (collaborateur, ligne invisible)', u_c, 'ACoSDECMARK1', NULL, NULL, NULL),
    ('marqueur, même slug (serveur)', NULL, 'ACoSDECNEW4', 'https://linkedin.com/in/SDEC-Slug-Efface/', NULL, NULL)
  ) AS t(a, b, p, u, e, pv) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(v_who);
    IF v_who IS NOT NULL THEN SET LOCAL ROLE authenticated; END IF;
    BEGIN
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, profile_url, email_used, organization_id, created_by, status)
      VALUES (seq_a, 'sdec-mail@audit.test', v_prof, v_prov, v_url, v_email, org_a, COALESCE(v_who, u_a), 'active');
      f := f || format('[DÉFAUT d12 %s : inscription d''un profil effacé acceptée] ', v_label);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'ENROLLMENT_GDPR_ERASED' THEN
        f := f || format('[%s : refus sans le HINT ENROLLMENT_GDPR_ERASED (%s)] ', v_label, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;
  PERFORM pg_temp.sdec_as(NULL);

  -- Réinscription du même profile_id qu'une inscription effacée, en mode
  -- « ignorer les doublons » du navigateur : refus explicite, plus d'écart silencieux.
  c := c + 1;
  PERFORM pg_temp.sdec_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a2, 'sdec-mail@audit.test', 'ACoSDECMARK1', org_a, u_a, 'active')
    ON CONFLICT (sequence_id, profile_id) DO NOTHING;
    f := f || '[DÉFAUT d12 : doublon d''une inscription effacée écarté sans refus] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLLMENT_GDPR_ERASED' THEN f := f || format('[doublon effacé : HINT %s] ', v_hint); END IF;
  WHEN OTHERS THEN f := f || format('[doublon effacé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  -- Témoins acceptés : marqueur d'une autre organisation, slug voisin,
  -- marqueur vide, candidat sans lien.
  FOR v_label, v_prof, v_url IN SELECT * FROM (VALUES
    ('marqueur d''une autre organisation', 'ACoSDECOTHERORG', NULL),
    ('slug voisin', 'ACoSDECNEW5', 'https://www.linkedin.com/in/sdec-slug-efface-2'),
    ('marqueur vide (null)', 'ACoSDECEMPTYMARK', NULL),
    ('candidat sans lien', 'ACoSDECNEW6', 'https://www.linkedin.com/in/sdec-sans-lien')
  ) AS t(a, p, u) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, profile_url, organization_id, created_by, status)
      VALUES (seq_a, 'sdec-mail@audit.test', v_prof, v_url, org_a, u_a, 'active');
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN f := f || format('[témoin %s : %s ligne] ', v_label, v_n); END IF;
    EXCEPTION WHEN OTHERS THEN f := f || format('[témoin %s refusé : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  PERFORM pg_temp.sdec_as(NULL);
  DELETE FROM public.sequence_enrollments WHERE profile_id LIKE 'ACoSDEC%' OR profile_id LIKE 'AEMSDEC%';
  DELETE FROM public.gdpr_erasures WHERE source = 'audit'
    AND (linkedin_url_hash = pg_temp.sdec_hash('https://www.linkedin.com/in/sdec-efface-url')
         OR email_hash = pg_temp.sdec_hash('sdec.efface@audit.test'));
  INSERT INTO seq_dec_results VALUES ('d12-profil-efface-inscription-refusee', c, f);
END $$;

-- ---------------------------------------------------------------------
-- @critical d21-meme-personne-meme-sequence (décision 21, décision 23)
-- Même personne sous un autre identifiant (identifiant commun ou même slug)
-- dans la même séquence : refus (HINT ENROLLMENT_SAME_PERSON_IN_SEQUENCE) si
-- une inscription est vivante ou close depuis moins de 90 jours, même pour
-- un collaborateur qui ne la voit pas et même dans une insertion groupée ;
-- permis au-delà de 90 jours ou dans une autre séquence. Le même profile_id
-- reste traité par UNIQUE(sequence_id, profile_id) (ON CONFLICT DO NOTHING).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_c uuid := 'dec00000-0000-4000-8000-00000000000c';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  seq_a uuid := 'deca2000-0000-4000-8000-000000000001';
  seq_a2 uuid := 'deca2000-0000-4000-8000-000000000002';
  v_label text;
  v_who uuid;
  v_prof text;
  v_url text;
  v_hint text;
  v_cons text;
  v_n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.sdec_as(NULL);
  -- Inscriptions existantes de seq_a (créées par u_a, invisibles du collaborateur).
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, profile_url, organization_id, created_by, status)
  VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP1', 'ACoSDECDUP1', 'https://www.linkedin.com/in/sdec-dup-un', org_a, u_a, 'active');
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, resolved_profile_id, organization_id, created_by, status, pause_reason)
  VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP2', 'ACoSDECDUP2', org_a, u_a, 'paused', 'manual');
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, organization_id, created_by, status, completed_at)
  VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP3', 'ACoSDECDUP3', org_a, u_a, 'stopped', now() - interval '10 days');
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, organization_id, created_by, status, replied_at)
  VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP4', 'ACoSDECDUP4', org_a, u_a, 'replied', now() - interval '30 days');
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, organization_id, created_by, status, completed_at)
  VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP5', 'ACoSDECDUP5', org_a, u_a, 'completed', now() - interval '120 days');
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, organization_id, created_by, status, replied_at)
  VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP6', 'ACoSDECDUP6', org_a, u_a, 'replied', now() - interval '100 days');

  -- Refus : (libellé, auteur ou NULL pour le serveur, profile_id, URL).
  FOR v_label, v_who, v_prof, v_url IN SELECT * FROM (VALUES
    ('identifiant classique d''une inscription active (propriétaire)', u_a, 'ACoSDECDUP1', NULL),
    ('identifiant classique d''une inscription active (serveur)', NULL, 'ACoSDECDUP1', NULL),
    ('même slug, casse et barre finale différentes (propriétaire)', u_a, 'ACoSDECDUPX', 'https://linkedin.com/in/SDEC-Dup-Un/'),
    ('identifiant résolu d''une inscription en pause (collaborateur)', u_c, 'ACoSDECDUP2', NULL),
    ('arrêtée il y a 10 jours', u_a, 'ACoSDECDUP3', NULL),
    ('répondu il y a 30 jours', NULL, 'ACoSDECDUP4', NULL)
  ) AS t(a, b, p, u) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(v_who);
    IF v_who IS NOT NULL THEN SET LOCAL ROLE authenticated; END IF;
    BEGIN
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, profile_url, organization_id, created_by, status)
      VALUES (seq_a, 'sdec-mail@audit.test', v_prof, v_url, org_a, COALESCE(v_who, u_a), 'active');
      f := f || format('[DÉFAUT d21 %s : même personne inscrite deux fois dans la séquence] ', v_label);
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE' THEN
        f := f || format('[%s : refus sans le HINT ENROLLMENT_SAME_PERSON_IN_SEQUENCE (%s)] ', v_label, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  -- Insertion groupée : deux identifiants de la même personne dans la même requête.
  c := c + 1;
  PERFORM pg_temp.sdec_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, organization_id, created_by, status)
    VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECBATCH', 'ACoSDECBATCH', org_a, u_a, 'active'),
           (seq_a, 'sdec-mail@audit.test', 'ACoSDECBATCH', NULL, org_a, u_a, 'active');
    f := f || '[DÉFAUT d21 : insertion groupée, deux identifiants de la même personne acceptés] ';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLLMENT_SAME_PERSON_IN_SEQUENCE' THEN f := f || format('[insertion groupée : HINT %s] ', v_hint); END IF;
  WHEN OTHERS THEN f := f || format('[insertion groupée : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  -- Même profile_id : la contrainte d'unicité garde la main (ON CONFLICT DO
  -- NOTHING écarte en silence, l'insertion directe lève la violation de la contrainte).
  c := c + 1;
  PERFORM pg_temp.sdec_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    WITH ins AS (
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
      VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP1', org_a, u_a, 'active')
      ON CONFLICT (sequence_id, profile_id) DO NOTHING
      RETURNING id
    ) SELECT count(*) INTO v_n FROM ins;
    IF v_n <> 0 THEN f := f || format('[même profile_id, ON CONFLICT DO NOTHING : %s ligne] ', v_n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[même profile_id, ON CONFLICT DO NOTHING refusé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'sdec-mail@audit.test', 'AEMSDECDUP1', org_a, u_a, 'active');
    f := f || '[même profile_id accepté en insertion directe] ';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons IS DISTINCT FROM 'sequence_enrollments_sequence_id_profile_id_key' THEN
      f := f || format('[même profile_id : refus par %s au lieu de la contrainte d''unicité] ', COALESCE(v_cons, 'le déclencheur'));
    END IF;
  WHEN OTHERS THEN f := f || format('[même profile_id : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  -- Témoins acceptés : close depuis plus de 90 jours (décision 23), autre
  -- séquence, autre personne.
  FOR v_label, v_prof, v_url, v_who IN SELECT * FROM (VALUES
    ('terminée il y a 120 jours', 'ACoSDECDUP5', NULL, 'deca2000-0000-4000-8000-000000000001'::uuid),
    ('répondu il y a 100 jours', 'ACoSDECDUP6', NULL, 'deca2000-0000-4000-8000-000000000001'::uuid),
    ('même personne, autre séquence', 'ACoSDECDUP1', 'https://www.linkedin.com/in/sdec-dup-un', 'deca2000-0000-4000-8000-000000000002'::uuid),
    ('autre personne, slug voisin', 'ACoSDECDUPZ', 'https://www.linkedin.com/in/sdec-dup-un-2', 'deca2000-0000-4000-8000-000000000001'::uuid)
  ) AS t(a, p, u, s) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, profile_url, organization_id, created_by, status)
      VALUES (v_who, 'sdec-mail@audit.test', v_prof, v_url, org_a, u_a, 'active');
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN f := f || format('[témoin %s : %s ligne] ', v_label, v_n); END IF;
    EXCEPTION WHEN OTHERS THEN f := f || format('[témoin %s refusé : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  PERFORM pg_temp.sdec_as(NULL);
  DELETE FROM public.sequence_enrollments WHERE profile_id LIKE 'ACoSDEC%' OR profile_id LIKE 'AEMSDEC%';
  INSERT INTO seq_dec_results VALUES ('d21-meme-personne-meme-sequence', c, f);
END $$;

-- ---------------------------------------------------------------------
-- @critical d20-inscription-serveur-sans-auteur (décision 20)
-- Chemin serveur, created_by NULL, depuis le compte relié d'un membre :
-- refus (HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER), y compris par un changement de
-- compte d'une inscription sans auteur. Témoins : compte sans liaison, auteur
-- remis à NULL par la suppression d'un utilisateur.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_m uuid := 'dec00000-0000-4000-8000-00000000000b';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  seq_a uuid := 'deca2000-0000-4000-8000-000000000001';
  v_acc text;
  v_enr uuid;
  v_hint text;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.sdec_as(NULL);
  FOREACH v_acc IN ARRAY ARRAY['sdec-acc-owner', 'sdec-acc-m'] LOOP
    c := c + 1;
    BEGIN
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
      VALUES (seq_a, v_acc, 'ACoSDECNOAUTH-' || v_acc, org_a, NULL, 'active');
      f := f || format('[DÉFAUT d20 : inscription serveur sans auteur depuis le compte relié %s acceptée] ', v_acc);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN
        f := f || format('[%s : refus sans le HINT ENROLL_ACCOUNT_OF_OTHER_MEMBER (%s)] ', v_acc, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[sans auteur %s : %s (%s)] ', v_acc, SQLERRM, SQLSTATE);
    END;
  END LOOP;

  -- Témoin : compte sans liaison (boîte e-mail), sans auteur.
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECNOAUTH-MAIL', org_a, NULL, 'active')
    RETURNING id INTO v_enr;
  EXCEPTION WHEN OTHERS THEN f := f || format('[témoin sans auteur, compte non relié refusé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Inscription sans auteur passée sur le compte relié d'un membre : refus.
  c := c + 1;
  BEGIN
    UPDATE public.sequence_enrollments SET account_id = 'sdec-acc-m' WHERE id = v_enr;
    f := f || '[DÉFAUT d20 : inscription sans auteur passée sur le compte relié d''un membre] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLL_ACCOUNT_OF_OTHER_MEMBER' THEN f := f || format('[changement de compte sans auteur : HINT %s] ', v_hint); END IF;
  WHEN OTHERS THEN f := f || format('[changement de compte sans auteur : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Témoins : l'auteur sur son propre compte, puis remis à NULL (suppression
  -- de l'utilisateur, clé étrangère ON DELETE SET NULL).
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'sdec-acc-m', 'ACoSDECNOAUTH-OWN', org_a, u_m, 'active')
    RETURNING id INTO v_enr;
    UPDATE public.sequence_enrollments SET created_by = NULL WHERE id = v_enr;
  EXCEPTION WHEN OTHERS THEN f := f || format('[témoin auteur remis à NULL refusé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  DELETE FROM public.sequence_enrollments WHERE profile_id LIKE 'ACoSDECNOAUTH-%';
  INSERT INTO seq_dec_results VALUES ('d20-inscription-serveur-sans-auteur', c, f);
END $$;

-- ---------------------------------------------------------------------
-- @critical d17-reprise-reservee-au-serveur (décision 17)
-- Un utilisateur connecté (propriétaire, membre, collaborateur) ne fait plus
-- passer une inscription en pause, arrêtée, terminée ou répondue à 'active'
-- (HINT ENROLLMENT_RESUME_SERVER_ONLY) ; un candidat effacé garde son refus
-- RGPD. Témoins : mise en pause, autre colonne d'une inscription en pause,
-- insertion en 'active', reprise par le serveur.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_m uuid := 'dec00000-0000-4000-8000-00000000000b';
  u_c uuid := 'dec00000-0000-4000-8000-00000000000c';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  seq_a uuid := 'deca2000-0000-4000-8000-000000000001';
  v_label text;
  v_who uuid;
  v_status text;
  v_reason text;
  v_enr uuid;
  v_hint text;
  v_after text;
  v_n int;
  f text := '';
  c int := 0;
BEGIN
  FOR v_label, v_who, v_status, v_reason IN SELECT * FROM (VALUES
    ('propriétaire, pause manuelle', u_a, 'paused', 'manual'),
    ('propriétaire, arrêtée', u_a, 'stopped', NULL),
    ('propriétaire, terminée', u_a, 'completed', NULL),
    ('propriétaire, a répondu', u_a, 'replied', NULL),
    ('membre, sa pause « séquence désactivée »', u_m, 'paused', 'sequence_inactive'),
    ('collaborateur, sa pause manuelle', u_c, 'paused', 'manual')
  ) AS t(a, b, s, r) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(NULL);
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status, pause_reason)
    VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECRES-' || c, org_a, v_who, v_status, v_reason)
    RETURNING id INTO v_enr;
    PERFORM pg_temp.sdec_as(v_who);
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.sequence_enrollments SET status = 'active', pause_reason = NULL WHERE id = v_enr;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      f := f || format('[DÉFAUT d17 %s : reprise écrite depuis le navigateur (%s ligne)] ', v_label, v_n);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'ENROLLMENT_RESUME_SERVER_ONLY' THEN
        f := f || format('[%s : refus sans le HINT ENROLLMENT_RESUME_SERVER_ONLY (%s)] ', v_label, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
    PERFORM pg_temp.sdec_as(NULL);
    SELECT status INTO v_after FROM public.sequence_enrollments WHERE id = v_enr;
    IF v_after IS DISTINCT FROM v_status THEN
      f := f || format('[DÉFAUT d17 %s : relecture, statut %s au lieu de %s] ', v_label, v_after, v_status);
    END IF;
  END LOOP;

  -- Candidat effacé : le refus RGPD passe avant (20260927231417).
  c := c + 1;
  PERFORM pg_temp.sdec_as(NULL);
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status, completed_at, tracking_data)
  VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECRES-GDPR', org_a, u_a, 'stopped', now(), jsonb_build_object('gdpr_erased_at', now()))
  RETURNING id INTO v_enr;
  PERFORM pg_temp.sdec_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.sequence_enrollments SET status = 'active' WHERE id = v_enr;
    f := f || '[candidat effacé repris depuis le navigateur] ';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ENROLLMENT_GDPR_ERASED' THEN f := f || format('[candidat effacé : HINT %s au lieu de ENROLLMENT_GDPR_ERASED] ', v_hint); END IF;
  WHEN OTHERS THEN f := f || format('[candidat effacé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  -- Témoins navigateur : insertion en 'active', mise en pause, étiquette
  -- d'une inscription en pause, mise à jour complète qui répète 'active'.
  c := c + 1;
  PERFORM pg_temp.sdec_as(u_a);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECRES-OK', org_a, u_a, 'active')
    RETURNING id INTO v_enr;
    UPDATE public.sequence_enrollments SET status = 'active', label = 'interested' WHERE id = v_enr;
    UPDATE public.sequence_enrollments SET status = 'paused', pause_reason = 'manual' WHERE id = v_enr AND status = 'active';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN f := f || format('[témoin mise en pause : %s ligne] ', v_n); END IF;
    UPDATE public.sequence_enrollments SET label = 'not_interested' WHERE id = v_enr;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN f := f || format('[témoin étiquette d''une inscription en pause : %s ligne] ', v_n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[témoins navigateur : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  -- Témoin serveur : la reprise (resume_enrollments) écrit 'active'.
  c := c + 1;
  PERFORM pg_temp.sdec_as(NULL);
  BEGIN
    UPDATE public.sequence_enrollments SET status = 'active', pause_reason = NULL WHERE id = v_enr;
    SELECT status INTO v_after FROM public.sequence_enrollments WHERE id = v_enr;
    IF v_after <> 'active' THEN f := f || format('[témoin reprise serveur : %s] ', v_after); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[témoin reprise serveur refusée : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  DELETE FROM public.sequence_enrollments WHERE profile_id LIKE 'ACoSDECRES-%';
  INSERT INTO seq_dec_results VALUES ('d17-reprise-reservee-au-serveur', c, f);
END $$;

-- ---------------------------------------------------------------------
-- @critical d18-etapes-reservees-au-serveur (décision 18)
-- Utilisateur connecté : une étape annulée ou en échec ne change plus de
-- statut (HINT EXECUTION_REARM_SERVER_ONLY) ; il n'insère que la première
-- étape, programmée et jamais exécutée, d'une inscription active qui n'en a
-- aucune (HINT EXECUTION_INSERT_SERVER_ONLY sinon). Témoins : première étape
-- du navigateur, texte d'une étape programmée, chemin serveur libre.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_c uuid := 'dec00000-0000-4000-8000-00000000000c';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  seq_a uuid := 'deca2000-0000-4000-8000-000000000001';
  st1 uuid := 'deca3000-0000-4000-8000-000000000001';
  st2 uuid := 'deca3000-0000-4000-8000-000000000002';
  v_enr uuid;
  v_enr2 uuid;
  v_enr_c uuid;
  v_exec uuid;
  v_label text;
  v_from text;
  v_to text;
  v_status text;
  v_hint text;
  v_after text;
  v_n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.sdec_as(NULL);
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECEXE-1', org_a, u_a, 'active')
  RETURNING id INTO v_enr;

  -- (a) Réarmement refusé : annulée ou en échec vers programmée, annulée vers envoyée.
  FOR v_label, v_from, v_to IN SELECT * FROM (VALUES
    ('annulée → programmée', 'cancelled', 'scheduled'),
    ('en échec → programmée', 'failed', 'scheduled'),
    ('annulée → envoyée', 'cancelled', 'sent'),
    ('en échec → en attente d''événement', 'failed', 'waiting_event')
  ) AS t(a, b, d) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(NULL);
    DELETE FROM public.sequence_step_executions WHERE enrollment_id = v_enr;
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, skip_reason, error_message)
    VALUES (v_enr, st1, 1, now() + interval '1 day', v_from,
            CASE WHEN v_from = 'cancelled' THEN 'Arrêt manuel' END,
            CASE WHEN v_from = 'failed' THEN 'Erreur du prestataire' END)
    RETURNING id INTO v_exec;
    PERFORM pg_temp.sdec_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE public.sequence_step_executions SET status = v_to, scheduled_at = now() WHERE id = v_exec;
      f := f || format('[DÉFAUT d18 %s : étape réarmée depuis le navigateur] ', v_label);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'EXECUTION_REARM_SERVER_ONLY' THEN
        f := f || format('[%s : refus sans le HINT EXECUTION_REARM_SERVER_ONLY (%s)] ', v_label, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
    PERFORM pg_temp.sdec_as(NULL);
    SELECT status INTO v_after FROM public.sequence_step_executions WHERE id = v_exec;
    IF v_after IS DISTINCT FROM v_from THEN f := f || format('[DÉFAUT d18 %s : relecture, %s] ', v_label, v_after); END IF;
  END LOOP;

  -- (b) Insertions refusées. L'inscription v_enr a déjà une étape annulée.
  --     (libellé, statut, exécutée ?, inscription : 'hist' avec historique,
  --     'paused' en pause sans étape, 'fresh' active sans étape).
  PERFORM pg_temp.sdec_as(NULL);
  INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
  VALUES (v_enr, st1, 1, now() - interval '2 days', 'sent', now() - interval '2 days');
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status, pause_reason)
  VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECEXE-2', org_a, u_a, 'paused', 'manual')
  RETURNING id INTO v_enr2;
  FOR v_label, v_status, v_to, v_from IN SELECT * FROM (VALUES
    ('étape déjà envoyée reprogrammée (inscription avec historique)', 'scheduled', 'non', 'hist'),
    ('étape suivante ajoutée à la main (inscription avec historique)', 'scheduled', 'non', 'hist2'),
    ('première étape insérée déjà envoyée', 'sent', 'oui', 'fresh'),
    ('première étape insérée annulée', 'cancelled', 'non', 'fresh'),
    ('première étape programmée mais marquée exécutée', 'scheduled', 'oui', 'fresh'),
    ('première étape d''une inscription en pause', 'scheduled', 'non', 'paused')
  ) AS t(a, s, x, e) LOOP
    c := c + 1;
    IF v_from = 'fresh' THEN
      PERFORM pg_temp.sdec_as(NULL);
      DELETE FROM public.sequence_enrollments WHERE profile_id = 'ACoSDECEXE-F';
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
      VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECEXE-F', org_a, u_a, 'active')
      RETURNING id INTO v_enr_c;
    END IF;
    PERFORM pg_temp.sdec_as(u_a);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
      VALUES (CASE v_from WHEN 'fresh' THEN v_enr_c WHEN 'paused' THEN v_enr2 ELSE v_enr END,
              CASE WHEN v_from = 'hist2' THEN st2 ELSE st1 END,
              CASE WHEN v_from = 'hist2' THEN 2 ELSE 1 END,
              now() + interval '1 hour', v_status,
              CASE WHEN v_to = 'oui' THEN now() END);
      f := f || format('[DÉFAUT d18 %s : insertion acceptée] ', v_label);
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF v_hint IS DISTINCT FROM 'EXECUTION_INSERT_SERVER_ONLY' THEN
        f := f || format('[%s : refus sans le HINT EXECUTION_INSERT_SERVER_ONLY (%s)] ', v_label, v_hint);
      END IF;
    WHEN OTHERS THEN f := f || format('[%s : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  -- (c) Témoins navigateur : première étape programmée d'une inscription toute
  --     neuve (propriétaire, puis collaborateur sur la sienne), puis son texte.
  FOR v_label, v_n IN SELECT * FROM (VALUES ('propriétaire', 0), ('collaborateur', 1)) AS t(a, b) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(CASE WHEN v_n = 0 THEN u_a ELSE u_c END);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
      VALUES (seq_a, 'sdec-mail@audit.test', 'ACoSDECEXE-OK-' || v_n, org_a, CASE WHEN v_n = 0 THEN u_a ELSE u_c END, 'active')
      RETURNING id INTO v_enr_c;
      INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, variant_assigned, organization_id)
      VALUES (v_enr_c, st1, 1, now() + interval '1 hour', 'scheduled', NULL, org_a)
      RETURNING id INTO v_exec;
      UPDATE public.sequence_step_executions SET final_message = 'Texte revu' WHERE id = v_exec AND status = 'scheduled';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 1 THEN f := f || format('[témoin %s, texte d''une étape programmée : %s ligne] ', v_label, v_n); END IF;
    EXCEPTION WHEN OTHERS THEN f := f || format('[témoin première étape (%s) refusé : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  -- (d) Témoins serveur : réarmement d'une étape annulée et ajout d'une étape.
  c := c + 1;
  PERFORM pg_temp.sdec_as(NULL);
  BEGIN
    DELETE FROM public.sequence_step_executions WHERE enrollment_id = v_enr;
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, skip_reason)
    VALUES (v_enr, st2, 2, now() + interval '1 day', 'cancelled', 'Arrêt manuel')
    RETURNING id INTO v_exec;
    UPDATE public.sequence_step_executions SET status = 'scheduled' WHERE id = v_exec;
    INSERT INTO public.sequence_step_executions (enrollment_id, step_id, step_order, scheduled_at, status, executed_at)
    VALUES (v_enr, st1, 1, now() - interval '1 day', 'sent', now() - interval '1 day');
  EXCEPTION WHEN OTHERS THEN f := f || format('[témoins serveur refusés : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  DELETE FROM public.sequence_enrollments WHERE profile_id LIKE 'ACoSDECEXE-%';
  INSERT INTO seq_dec_results VALUES ('d18-etapes-reservees-au-serveur', c, f);
END $$;

-- ---------------------------------------------------------------------
-- @critical d15-assistant-conversations-par-auteur (décision 15)
-- Conversations et messages de l'assistant : chacun lit les siens ;
-- propriétaire et administrateur lisent toute l'organisation ; une autre
-- organisation ne lit rien. Écriture (message ajouté, conversation modifiée) :
-- l'auteur seul, même pour un administrateur.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  u_m uuid := 'dec00000-0000-4000-8000-00000000000b';
  u_c uuid := 'dec00000-0000-4000-8000-00000000000c';
  u_d uuid := 'dec00000-0000-4000-8000-00000000000d';
  u_b uuid := 'dec00000-0000-4000-8000-00000000000e';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  conv_a uuid := 'deca7000-0000-4000-8000-00000000000a';
  conv_m uuid := 'deca7000-0000-4000-8000-00000000000b';
  conv_c uuid := 'deca7000-0000-4000-8000-00000000000c';
  v_label text;
  v_who uuid;
  v_conv int;
  v_msg int;
  v_exp_conv int;
  v_exp_msg int;
  v_n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.sdec_as(NULL);
  INSERT INTO public.agent_conversations (id, organization_id, created_by, status, title)
  VALUES (conv_a, org_a, u_a, 'active', 'Conversation du propriétaire'),
         (conv_m, org_a, u_m, 'active', 'Conversation du membre'),
         (conv_c, org_a, u_c, 'active', 'Conversation du collaborateur');
  INSERT INTO public.agent_messages (conversation_id, role, content)
  VALUES (conv_a, 'user', 'Résume les inscriptions de ma séquence'),
         (conv_a, 'assistant', 'Camille Martin : a répondu ; Paul Durand : en pause'),
         (conv_m, 'user', 'Bonjour'),
         (conv_c, 'user', 'Bonjour');

  -- Lecture : (libellé, utilisateur, conversations visibles, messages visibles) sur les trois du jeu.
  FOR v_label, v_who, v_exp_conv, v_exp_msg IN SELECT * FROM (VALUES
    ('membre', u_m, 1, 1),
    ('collaborateur', u_c, 1, 1),
    ('administrateur', u_d, 3, 4),
    ('propriétaire', u_a, 3, 4),
    ('autre organisation', u_b, 0, 0)
  ) AS t(a, b, cv, ms) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(v_who);
    SET LOCAL ROLE authenticated;
    BEGIN
      SELECT count(*) INTO v_conv FROM public.agent_conversations WHERE id IN (conv_a, conv_m, conv_c);
      SELECT count(*) INTO v_msg FROM public.agent_messages WHERE conversation_id IN (conv_a, conv_m, conv_c);
      IF v_conv <> v_exp_conv OR v_msg <> v_exp_msg THEN
        f := f || format('[%sd15 %s : %s conversation(s) et %s message(s) lus, attendu %s et %s] ',
          CASE WHEN v_conv > v_exp_conv OR v_msg > v_exp_msg THEN 'DÉFAUT ' ELSE '' END,
          v_label, v_conv, v_msg, v_exp_conv, v_exp_msg);
      END IF;
    EXCEPTION WHEN OTHERS THEN f := f || format('[lecture %s : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  -- Écriture sur la conversation d'un autre : refusée au membre et à l'administrateur.
  FOR v_label, v_who IN SELECT * FROM (VALUES ('membre', u_m), ('administrateur', u_d)) AS t(a, b) LOOP
    c := c + 1;
    PERFORM pg_temp.sdec_as(v_who);
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.agent_messages (conversation_id, role, content) VALUES (conv_a, 'user', 'Message glissé');
      f := f || format('[DÉFAUT d15 %s : message ajouté à la conversation du propriétaire] ', v_label);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN f := f || format('[%s, message chez un autre : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    BEGIN
      UPDATE public.agent_conversations SET title = 'Renommée' WHERE id = conv_a;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> 0 THEN f := f || format('[DÉFAUT d15 %s : conversation du propriétaire modifiée] ', v_label); END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN f := f || format('[%s, conversation d''un autre : %s (%s)] ', v_label, SQLERRM, SQLSTATE);
    END;
    RESET ROLE;
  END LOOP;

  -- Témoins : le membre écrit dans sa conversation et la retire (archivage).
  c := c + 1;
  PERFORM pg_temp.sdec_as(u_m);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.agent_messages (conversation_id, role, content) VALUES (conv_m, 'user', 'Suite');
    UPDATE public.agent_conversations SET archived_at = now() WHERE id = conv_m AND created_by = u_m;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN f := f || format('[témoin archivage de sa conversation : %s ligne] ', v_n); END IF;
    INSERT INTO public.agent_conversations (organization_id, created_by, status) VALUES (org_a, u_m, 'calibrating');
  EXCEPTION WHEN OTHERS THEN f := f || format('[témoins écriture du membre : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  PERFORM pg_temp.sdec_as(NULL);
  DELETE FROM public.agent_conversations WHERE organization_id = org_a;
  INSERT INTO seq_dec_results VALUES ('d15-assistant-conversations-par-auteur', c, f);
END $$;

-- ---------------------------------------------------------------------
-- @critical d19-droits-inutiles-retires (décision 19)
-- Tables du module (onze, compteurs des plafonds LinkedIn compris) : anon
-- n'a plus aucun droit ; authenticated n'a plus TRUNCATE, REFERENCES ni
-- TRIGGER, ni les écritures sans policy. Les droits utilisés par l'interface
-- restent (témoins).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := 'dec00000-0000-4000-8000-00000000000a';
  org_a uuid := 'deca0000-0000-4000-8000-000000000001';
  t text;
  p text;
  crud_tables text[] := ARRAY['outreach_sequences', 'sequence_steps', 'sequence_enrollments',
                              'sequence_step_executions', 'sequence_templates', 'sequence_snippets'];
  all_tables text[] := ARRAY['outreach_sequences', 'sequence_steps', 'sequence_enrollments',
                             'sequence_step_executions', 'sequence_templates', 'sequence_snippets',
                             'sequence_analytics', 'inmail_queue', 'sequence_email_tracking',
                             'sequence_processing_lock', 'linkedin_action_log'];
  f text := '';
  c int := 0;
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      c := c + 1;
      IF has_table_privilege('anon', 'public.' || t, p) THEN
        f := f || format('[DÉFAUT d19 : anon a %s sur %s] ', p, t);
      END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      c := c + 1;
      IF has_table_privilege('authenticated', 'public.' || t, p) THEN
        f := f || format('[DÉFAUT d19 : authenticated a %s sur %s] ', p, t);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['sequence_analytics', 'sequence_email_tracking', 'sequence_processing_lock',
                           'linkedin_action_log'] LOOP
    FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      c := c + 1;
      IF has_table_privilege('authenticated', 'public.' || t, p) THEN
        f := f || format('[DÉFAUT d19 : authenticated a %s sur %s (aucune policy)] ', p, t);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['UPDATE', 'DELETE'] LOOP
    c := c + 1;
    IF has_table_privilege('authenticated', 'public.inmail_queue', p) THEN
      f := f || format('[DÉFAUT d19 : authenticated a %s sur inmail_queue] ', p);
    END IF;
  END LOOP;

  -- Témoins : droits dont l'interface a besoin.
  FOREACH t IN ARRAY crud_tables LOOP
    FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      c := c + 1;
      IF NOT has_table_privilege('authenticated', 'public.' || t, p) THEN
        f := f || format('[régression : authenticated n''a plus %s sur %s] ', p, t);
      END IF;
    END LOOP;
  END LOOP;
  c := c + 1;
  IF NOT (has_table_privilege('authenticated', 'public.inmail_queue', 'SELECT')
          AND has_table_privilege('authenticated', 'public.inmail_queue', 'INSERT')
          AND has_table_privilege('authenticated', 'public.sequence_analytics', 'SELECT')) THEN
    f := f || '[régression : lecture de la file InMail ou des statistiques, ou suivi d''envoi, retirés] ';
  END IF;

  -- Comportement : les compteurs des plafonds LinkedIn restent lisibles par
  -- get_linkedin_quota_status ; TRUNCATE refusé à un utilisateur connecté,
  -- compteurs compris (TRUNCATE ignore la RLS) ; le suivi d'un message déjà
  -- parti s'écrit toujours.
  INSERT INTO public.linkedin_action_log (organization_id, user_id, account_id, action_type, source)
  VALUES (org_a, u_a, 'sdec-acc-owner', 'message', 'sequence');
  PERFORM pg_temp.sdec_as(u_a);
  SET LOCAL ROLE authenticated;
  c := c + 1;
  BEGIN
    IF coalesce((public.get_linkedin_quota_status('sdec-acc-owner') -> 'today' ->> 'visible_actions')::int, 0) < 1 THEN
      f := f || '[régression : get_linkedin_quota_status ne compte plus les actions du jour] ';
    END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[régression : get_linkedin_quota_status refusé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  FOREACH t IN ARRAY ARRAY['sequence_analytics', 'linkedin_action_log'] LOOP
    c := c + 1;
    BEGIN
      EXECUTE format('TRUNCATE public.%I', t);
      f := f || format('[DÉFAUT d19 : TRUNCATE de %s accepté pour un utilisateur connecté] ', t);
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    WHEN OTHERS THEN f := f || format('[TRUNCATE %s : %s (%s)] ', t, SQLERRM, SQLSTATE);
    END;
  END LOOP;
  c := c + 1;
  BEGIN
    INSERT INTO public.inmail_queue (account_id, recipient_profile_id, subject, message, status, sent_at, organization_id, created_by)
    VALUES ('sdec-acc-owner', 'ACoSDECINMAIL', 'Objet', 'Bonjour', 'sent', now(), org_a, u_a);
  EXCEPTION WHEN OTHERS THEN f := f || format('[régression : suivi d''un message envoyé refusé : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  RESET ROLE;

  INSERT INTO seq_dec_results VALUES ('d19-droits-inutiles-retires', c, f);
END $$;

-- ---------------------------------------------------------------------
-- Bilan
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_failed text;
  v_total int;
  v_blocks int;
BEGIN
  SELECT string_agg(format('%s : %s', behaviour, failures), E'\n' ORDER BY behaviour)
    INTO v_failed FROM seq_dec_results WHERE failures <> '';
  SELECT sum(checks), count(*) INTO v_total, v_blocks FROM seq_dec_results;
  IF v_blocks <> 7 THEN
    RAISE EXCEPTION 'seq_decisions_db_audit : % bloc(s) exécuté(s) sur 7', v_blocks;
  END IF;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'seq_decisions_db_audit : contrôles en échec\n%', v_failed;
  END IF;
  RAISE NOTICE 'seq_decisions_db_audit : % contrôles OK (% comportements)', v_total, v_blocks;
END $$;
