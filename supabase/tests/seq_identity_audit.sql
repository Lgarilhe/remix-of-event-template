-- =====================================================================
-- Module séquences, lot « identity » des tests de bout en bout (2026-09-27).
-- Identité du candidat en base : contrainte UNIQUE(sequence_id, profile_id)
-- et rapprochement exact de la fonction d'anti-doublon
-- find_recent_org_contacts (D3, SEQ-046, SEQ-128).
--
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK :
--   BEGIN; \i supabase/tests/seq_identity_audit.sql; ROLLBACK;
--   (ou psql -c 'BEGIN;' -f supabase/tests/seq_identity_audit.sql -c 'ROLLBACK;')
--
-- Chaque bloc accumule ses contrôles dans seq_identity_results ; le dernier
-- bloc lève une seule exception listant les contrôles en échec, préfixés par
-- la clé du comportement testé. Aucun ALTER TABLE.
-- =====================================================================
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '120s';

CREATE TEMP TABLE seq_identity_results (
  behaviour text NOT NULL,
  checks int NOT NULL,
  failures text NOT NULL
) ON COMMIT DROP;

-- Contexte d'appel : utilisateur connecté (p_uid) ou chemin serveur (NULL).
-- Vide aussi le cache transactionnel de get_user_org_id des utilisateurs du jeu.
CREATE FUNCTION pg_temp.seqid_as(p_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  u uuid;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN p_uid IS NULL THEN '' ELSE 'authenticated' END, true);
  FOREACH u IN ARRAY ARRAY[
    '1d000000-0000-4000-8000-00000000000a', '1d000000-0000-4000-8000-00000000000b',
    '1d000000-0000-4000-8000-00000000000c']::uuid[]
  LOOP
    PERFORM set_config('app.user_org.u_' || replace(u::text, '-', '_'), '', true);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Jeu de données commun (chemin serveur)
--   u_a propriétaire de A, u_m membre de A, u_b propriétaire de B.
--   seq_s et seq_s2 dans A, seq_b dans B. Aucun compte LinkedIn relié : les
--   inscriptions portent un account_id libre (pas de contrôle de propriétaire).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := '1d000000-0000-4000-8000-00000000000a';
  u_m uuid := '1d000000-0000-4000-8000-00000000000b';
  u_b uuid := '1d000000-0000-4000-8000-00000000000c';
  org_a uuid := '1da00000-0000-4000-8000-000000000001';
  org_b uuid := '1db00000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_temp.seqid_as(NULL);
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'seqid-a@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_m, 'seqid-m@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'seqid-b@audit.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, org_type, created_by)
  VALUES (org_a, 'SeqId Org A', 'seqid-org-a', 'agency', u_a),
         (org_b, 'SeqId Org B', 'seqid-org-b', 'agency', u_b);
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org_a, u_m, 'member');
  UPDATE public.profiles SET active_organization_id = org_a WHERE user_id IN (u_a, u_m);
  UPDATE public.profiles SET active_organization_id = org_b WHERE user_id = u_b;

  INSERT INTO public.outreach_sequences (id, name, organization_id, created_by, is_active)
  VALUES ('1da20000-0000-4000-8000-000000000001', 'SeqId S', org_a, u_a, true),
         ('1da20000-0000-4000-8000-000000000002', 'SeqId S2', org_a, u_a, true),
         ('1db20000-0000-4000-8000-000000000001', 'SeqId B', org_b, u_b, true);
END $$;

-- ---------------------------------------------------------------------
-- db-unique-meme-profile-id
-- Une seconde inscription du même profile_id dans la même séquence est
-- refusée par UNIQUE(sequence_id, profile_id) : 23505 en insertion directe,
-- ligne ignorée en upsert ON CONFLICT DO NOTHING (chemin serveur et membre
-- connecté, comme l'upsert ignoreDuplicates du navigateur). Le même
-- profile_id reste possible dans une autre séquence.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_m uuid := '1d000000-0000-4000-8000-00000000000b';
  u_a uuid := '1d000000-0000-4000-8000-00000000000a';
  org_a uuid := '1da00000-0000-4000-8000-000000000001';
  seq_s uuid := '1da20000-0000-4000-8000-000000000001';
  seq_s2 uuid := '1da20000-0000-4000-8000-000000000002';
  v_id uuid;
  v_constraint text;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqid_as(NULL);
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (seq_s, 'seqid-acc-1', 'ACoSEQIDUNIQ1', org_a, u_a, 'active');

  -- Insertion directe identique : unique_violation sur la bonne contrainte.
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_s, 'seqid-acc-2', 'ACoSEQIDUNIQ1', org_a, u_a, 'active');
    f := f || '[seconde inscription du même profile_id acceptée en insertion directe] ';
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint IS DISTINCT FROM 'sequence_enrollments_sequence_id_profile_id_key' THEN
        f := f || format('[refus sur la contrainte %s au lieu de sequence_enrollments_sequence_id_profile_id_key] ', v_constraint);
      END IF;
    WHEN OTHERS THEN f := f || format('[insertion directe : %s (%s)] ', SQLERRM, SQLSTATE);
  END;

  -- Upsert ON CONFLICT DO NOTHING : aucune ligne renvoyée.
  c := c + 1;
  BEGIN
    WITH ins AS (
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
      VALUES (seq_s, 'seqid-acc-3', 'ACoSEQIDUNIQ1', org_a, u_a, 'active')
      ON CONFLICT (sequence_id, profile_id) DO NOTHING
      RETURNING id
    ) SELECT count(*) INTO n FROM ins;
    IF n <> 0 THEN f := f || format('[upsert ON CONFLICT DO NOTHING : %s ligne(s) créée(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[upsert serveur : %s] ', SQLERRM);
  END;

  -- Membre connecté (RLS) : même refus, même upsert silencieux.
  PERFORM pg_temp.seqid_as(u_m);
  SET LOCAL ROLE authenticated;
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_s, 'seqid-acc-4', 'ACoSEQIDUNIQ1', org_a, u_m, 'active');
    f := f || '[membre : seconde inscription du même profile_id acceptée] ';
  EXCEPTION
    WHEN unique_violation THEN NULL;
    WHEN OTHERS THEN f := f || format('[membre, insertion directe : %s (%s)] ', SQLERRM, SQLSTATE);
  END;
  c := c + 1;
  BEGIN
    WITH ins AS (
      INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
      VALUES (seq_s, 'seqid-acc-5', 'ACoSEQIDUNIQ1', org_a, u_m, 'active')
      ON CONFLICT (sequence_id, profile_id) DO NOTHING
      RETURNING id
    ) SELECT count(*) INTO n FROM ins;
    IF n <> 0 THEN f := f || format('[membre, upsert ON CONFLICT DO NOTHING : %s ligne(s) créée(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[membre, upsert : %s] ', SQLERRM);
  END;
  RESET ROLE;
  PERFORM pg_temp.seqid_as(NULL);

  -- Une seule ligne pour ce candidat dans la séquence.
  c := c + 1;
  SELECT count(*) INTO n FROM public.sequence_enrollments WHERE sequence_id = seq_s AND profile_id = 'ACoSEQIDUNIQ1';
  IF n <> 1 THEN f := f || format('[%s inscriptions du même profile_id dans la séquence au lieu d''une] ', n); END IF;

  -- La contrainte porte sur la séquence : le même profil s'inscrit dans une autre.
  c := c + 1;
  BEGIN
    INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
    VALUES (seq_s2, 'seqid-acc-1', 'ACoSEQIDUNIQ1', org_a, u_a, 'active')
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN f := f || '[autre séquence : inscription non créée] '; END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[autre séquence refusée : %s] ', SQLERRM);
  END;

  INSERT INTO seq_identity_results VALUES ('db-unique-meme-profile-id', c, f);
END $$;

-- ---------------------------------------------------------------------
-- rpc-rapprochement-provider-resolved (D3, SEQ-046, SEQ-128)
-- find_recent_org_contacts renvoie une inscription de l'organisation dès que
-- la valeur fournie égale exactement son profile_id, son provider_id ou son
-- resolved_profile_id ; comparaison sensible à la casse, jamais une autre
-- organisation.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u_a uuid := '1d000000-0000-4000-8000-00000000000a';
  u_m uuid := '1d000000-0000-4000-8000-00000000000b';
  u_b uuid := '1d000000-0000-4000-8000-00000000000c';
  org_a uuid := '1da00000-0000-4000-8000-000000000001';
  org_b uuid := '1db00000-0000-4000-8000-000000000001';
  seq_s uuid := '1da20000-0000-4000-8000-000000000001';
  seq_s2 uuid := '1da20000-0000-4000-8000-000000000002';
  seq_b uuid := '1db20000-0000-4000-8000-000000000001';
  v_since timestamptz := now() - interval '90 days';
  v_profile text;
  v_status text;
  n int;
  f text := '';
  c int := 0;
BEGIN
  PERFORM pg_temp.seqid_as(NULL);
  -- E1 : identifiant Recruiter, identifiant classique en provider_id (active).
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, provider_id, organization_id, created_by, status)
  VALUES (seq_s, 'seqid-acc-1', 'AEMSEQIDR1', 'ACoSEQIDR1', org_a, u_a, 'active');
  -- E2 : identifiant classique résolu plus tard (resolved_profile_id), en pause.
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, resolved_profile_id, organization_id, created_by, status, pause_reason)
  VALUES (seq_s2, 'seqid-acc-1', 'AEMSEQIDR2', 'ACoSEQIDR2', org_a, u_a, 'paused', 'manual');
  -- Organisation B : le même candidat que E1, sous son identifiant classique.
  INSERT INTO public.sequence_enrollments (sequence_id, account_id, profile_id, organization_id, created_by, status)
  VALUES (seq_b, 'seqid-acc-b', 'ACoSEQIDR1', org_b, u_b, 'active');

  PERFORM pg_temp.seqid_as(u_m);
  SET LOCAL ROLE authenticated;

  -- Par provider_id.
  c := c + 1;
  BEGIN
    SELECT count(*), max(r.profile_id), max(r.status) INTO n, v_profile, v_status
    FROM public.find_recent_org_contacts(org_a, ARRAY['ACoSEQIDR1'], ARRAY[]::text[], v_since) r;
    IF n <> 1 OR v_profile IS DISTINCT FROM 'AEMSEQIDR1' THEN
      f := f || format('[provider_id : %s ligne(s), profile_id %s au lieu de E1 seule] ', n, v_profile);
    END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[provider_id : %s] ', SQLERRM);
  END;

  -- Par resolved_profile_id (inscription en pause).
  c := c + 1;
  BEGIN
    SELECT count(*), max(r.profile_id), max(r.status) INTO n, v_profile, v_status
    FROM public.find_recent_org_contacts(org_a, ARRAY['ACoSEQIDR2'], ARRAY[]::text[], v_since) r;
    IF n <> 1 OR v_profile IS DISTINCT FROM 'AEMSEQIDR2' OR v_status IS DISTINCT FROM 'paused' THEN
      f := f || format('[resolved_profile_id : %s ligne(s), profile_id %s, statut %s au lieu de E2 en pause] ', n, v_profile, v_status);
    END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[resolved_profile_id : %s] ', SQLERRM);
  END;

  -- Par profile_id.
  c := c + 1;
  BEGIN
    SELECT count(*) INTO n
    FROM public.find_recent_org_contacts(org_a, ARRAY['AEMSEQIDR1'], ARRAY[]::text[], v_since) r
    WHERE r.provider_id = 'ACoSEQIDR1';
    IF n <> 1 THEN f := f || format('[profile_id : %s ligne(s) au lieu d''une] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[profile_id : %s] ', SQLERRM);
  END;

  -- Comparaison exacte : casse différente ou préfixe = rien.
  c := c + 1;
  BEGIN
    SELECT count(*) INTO n
    FROM public.find_recent_org_contacts(org_a, ARRAY['acoseqidr1', 'ACOSEQIDR2', 'ACoSEQIDR'], ARRAY[]::text[], v_since);
    IF n <> 0 THEN f := f || format('[comparaison non exacte : %s ligne(s) pour une casse ou un préfixe] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[casse : %s] ', SQLERRM);
  END;

  -- Les deux valeurs d'un coup : les deux inscriptions, aucune de B.
  c := c + 1;
  BEGIN
    SELECT count(*) INTO n
    FROM public.find_recent_org_contacts(org_a, ARRAY['ACoSEQIDR1', 'ACoSEQIDR2'], ARRAY[]::text[], v_since) r
    WHERE r.sequence_id IN (seq_s, seq_s2);
    IF n <> 2 THEN f := f || format('[deux valeurs : %s inscription(s) de A au lieu de 2] ', n); END IF;
    SELECT count(*) INTO n
    FROM public.find_recent_org_contacts(org_a, ARRAY['ACoSEQIDR1', 'ACoSEQIDR2'], ARRAY[]::text[], v_since) r
    WHERE r.sequence_id = seq_b;
    IF n <> 0 THEN f := f || '[l''inscription de l''organisation B est renvoyée à A] '; END IF;
  EXCEPTION WHEN OTHERS THEN f := f || format('[deux valeurs : %s] ', SQLERRM);
  END;

  RESET ROLE;
  PERFORM pg_temp.seqid_as(NULL);
  INSERT INTO seq_identity_results VALUES ('rpc-rapprochement-provider-resolved', c, f);
END $$;

-- ---------------------------------------------------------------------
-- Bilan : une exception unique liste les contrôles en échec.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
  total int := 0;
  msg text := '';
BEGIN
  FOR r IN SELECT * FROM seq_identity_results ORDER BY behaviour LOOP
    total := total + r.checks;
    IF r.failures <> '' THEN msg := msg || format(E'\n  %s : %s', r.behaviour, r.failures); END IF;
  END LOOP;
  IF msg <> '' THEN
    RAISE EXCEPTION 'seq_identity_audit : contrôles en échec (% au total) :%', total, msg;
  END IF;
  RAISE NOTICE 'seq_identity_audit : % contrôles, tous passent', total;
END $$;
