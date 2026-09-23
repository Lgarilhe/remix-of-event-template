-- =====================================================================
-- Audit des écritures sur public.organizations — Paramètres, lot 1.
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, après la migration
-- 20260923095813_parametres_lot1_organisation.sql :
--   BEGIN; \i supabase/tests/org_writes_audit.sql; ROLLBACK;
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Un refus attendu ne passe que sur son code ET son indice (HINT) : un refus
-- de la RLS sans indice n'est pas un refus du trigger de garde.
-- Utilisateurs et organisations synthétiques (ids fixes). Deux utilisateurs
-- seulement : le rôle de u_b dans l'organisation A évolue en cours de test.
-- =====================================================================
DO $$
DECLARE
  u_a uuid := '71111111-1111-4111-8111-111111111111';  -- propriétaire de A et de X
  u_b uuid := '72222222-2222-4222-8222-222222222222';  -- admin, puis membre, puis collaborateur de A
  org_a uuid := '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  org_c uuid := '7ccccccc-cccc-4ccc-8ccc-cccccccccccc';  -- créée en cours de test (onboarding)
  org_x uuid := '7eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';  -- voisine, sans lien avec u_b
  claims_a text := json_build_object('sub', u_a, 'role', 'authenticated', 'email', 'a@orgwrites.test')::text;
  claims_b text := json_build_object('sub', u_b, 'role', 'authenticated', 'email', 'b@orgwrites.test')::text;
  n int;
  v_hint text;
  v_type text;
  v_name text;
  failures text := '';
BEGIN
  -- Jeu de données : A et X appartiennent à u_a (propriétaire posé par
  -- handle_new_organization), u_b est administrateur de A.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_a, 'a@orgwrites.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_b, 'b@orgwrites.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by, org_type)
  VALUES (org_a, 'Org écritures', 'org-writes-audit-a', u_a, 'agency'),
         (org_x, 'Org voisine', 'org-writes-audit-x', u_a, 'agency');
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_b, 'admin');

  -- 1. Une seule policy d'UPDATE (règle 7), et le trigger de garde est posé.
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'organizations' AND cmd IN ('UPDATE', 'ALL');
  IF n <> 1 THEN failures := failures || format('[1 : %s policies d''UPDATE au lieu de 1] ', n); END IF;
  SELECT count(*) INTO n FROM pg_trigger
  WHERE tgrelid = 'public.organizations'::regclass AND tgname = 'organizations_update_guard' AND NOT tgisinternal;
  IF n <> 1 THEN failures := failures || '[1 : trigger organizations_update_guard absent] '; END IF;

  -- ===== u_b administrateur de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 2. Nom, logo, site et consignes IA : 1 ligne.
  BEGIN
    UPDATE public.organizations
       SET name = 'Org renommée', logo_url = 'https://exemple.test/logo.png',
           website = 'https://exemple.test', ai_context = '{"tone": "vous"}'::jsonb
     WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[2 : admin, champs ouverts : %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[2 : admin, champs ouverts : %s] ', SQLERRM);
  END;

  -- 3 à 5. Type, permissions agence, modèle par défaut : refus ORG_OWNER_ONLY.
  BEGIN
    UPDATE public.organizations SET org_type = 'enterprise' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[3 : admin, type sans refus (%s ligne(s))] ', n);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_OWNER_ONLY' THEN failures := failures || format('[3 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[3 : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.organizations SET agency_permissions = '{"only_owners_can_submit": true}'::jsonb WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[4 : admin, permissions agence sans refus (%s ligne(s))] ', n);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_OWNER_ONLY' THEN failures := failures || format('[4 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[4 : %s] ', SQLERRM);
  END;
  BEGIN
    UPDATE public.organizations SET ai_model_default = 'modele-test' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[5 : admin, modèle par défaut sans refus (%s ligne(s))] ', n);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_OWNER_ONLY' THEN failures := failures || format('[5 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[5 : %s] ', SQLERRM);
  END;

  -- 6. Créateur : refus ORG_IMMUTABLE.
  BEGIN
    UPDATE public.organizations SET created_by = u_b WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[6 : admin, créateur sans refus (%s ligne(s))] ', n);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_IMMUTABLE' THEN failures := failures || format('[6 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[6 : %s] ', SQLERRM);
  END;

  -- 7. L'administrateur de A ne modifie pas une autre organisation : 0 ligne, sans erreur.
  BEGIN
    UPDATE public.organizations SET name = 'Intrusion' WHERE id = org_x;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[7 : admin de A modifie X (%s ligne(s))] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[7 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- u_b devient membre simple de A (claims vides : enforce_role_hierarchy
  -- ne bloque que le rôle owner).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'member' WHERE organization_id = org_a AND user_id = u_b;

  -- ===== u_b membre simple de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 8. Membre : 0 ligne, sans erreur (filtré par la RLS).
  BEGIN
    UPDATE public.organizations SET name = 'Membre' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[8 : un membre renomme A (%s ligne(s))] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[8 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_members SET role = 'collaborator' WHERE organization_id = org_a AND user_id = u_b;

  -- ===== u_b collaborateur de A =====
  PERFORM set_config('request.jwt.claims', claims_b, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 9. Collaborateur : 0 ligne, sans erreur.
  BEGIN
    UPDATE public.organizations SET website = 'https://intrus.test' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN failures := failures || format('[9 : un collaborateur modifie A (%s ligne(s))] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[9 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- ===== u_a propriétaire de A (u_b y est encore collaborateur) =====
  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 10. Modèle par défaut et permissions agence : 1 ligne.
  BEGIN
    UPDATE public.organizations
       SET ai_model_default = 'modele-test', agency_permissions = '{"only_owners_can_submit": true}'::jsonb
     WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[10 : propriétaire, réglages : %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[10 : propriétaire, réglages : %s] ', SQLERRM);
  END;

  -- 11. Type : cabinet vers entreprise, 1 ligne.
  BEGIN
    UPDATE public.organizations SET org_type = 'enterprise' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT org_type INTO v_type FROM public.organizations WHERE id = org_a;
    IF n <> 1 OR v_type IS DISTINCT FROM 'enterprise' THEN
      failures := failures || format('[11 : propriétaire, type : %s ligne(s), %s] ', n, v_type);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[11 : propriétaire, type : %s] ', SQLERRM);
  END;

  -- 12. Le créateur reste immuable, même pour le propriétaire.
  BEGIN
    UPDATE public.organizations SET created_by = u_b WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[12 : propriétaire, créateur sans refus (%s ligne(s))] ', n);
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_IMMUTABLE' THEN failures := failures || format('[12 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[12 : %s] ', SQLERRM);
  END;

  -- 13. Indépendant refusé tant qu'il reste un autre membre (collaborateur compris).
  BEGIN
    UPDATE public.organizations SET org_type = 'freelance' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[13 : indépendant sans refus avec un autre membre (%s ligne(s))] ', n);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_FREELANCE_NOT_SOLO' THEN failures := failures || format('[13 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[13 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- u_b quitte A ; une invitation valide reste en attente.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  DELETE FROM public.organization_members WHERE organization_id = org_a AND user_id = u_b;
  INSERT INTO public.organization_invitations (email, invited_by, organization_id, token, role, status, expires_at)
  VALUES ('c@orgwrites.test', u_a, org_a, 'tok-orgwrites-pending', 'member', 'pending', now() + interval '7 days');

  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 14. Indépendant refusé avec une invitation en attente et non expirée.
  BEGIN
    UPDATE public.organizations SET org_type = 'freelance' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    failures := failures || format('[14 : indépendant sans refus avec une invitation valide (%s ligne(s))] ', n);
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    IF v_hint IS DISTINCT FROM 'ORG_FREELANCE_NOT_SOLO' THEN failures := failures || format('[14 : indice %s] ', v_hint); END IF;
  WHEN OTHERS THEN failures := failures || format('[14 : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- L'invitation expire ; une autre, acceptée, ne compte pas non plus.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  UPDATE public.organization_invitations SET expires_at = now() - interval '1 day' WHERE token = 'tok-orgwrites-pending';
  INSERT INTO public.organization_invitations (email, invited_by, organization_id, token, role, status, expires_at)
  VALUES ('d@orgwrites.test', u_a, org_a, 'tok-orgwrites-accepted', 'member', 'accepted', now() + interval '7 days');

  PERFORM set_config('request.jwt.claims', claims_a, true);
  PERFORM set_config('request.jwt.claim.sub', u_a::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  -- 15. Seul, sans invitation valide : indépendant accepté.
  BEGIN
    UPDATE public.organizations SET org_type = 'freelance' WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT org_type INTO v_type FROM public.organizations WHERE id = org_a;
    IF n <> 1 OR v_type IS DISTINCT FROM 'freelance' THEN
      failures := failures || format('[15 : indépendant seul : %s ligne(s), %s] ', n, v_type);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[15 : indépendant seul : %s] ', SQLERRM);
  END;

  -- 16. Onboarding : création en authenticated, puis type et fiche par UPDATE.
  BEGIN
    INSERT INTO public.organizations (id, name, slug, created_by) VALUES (org_c, 'Espace onboarding', 'org-writes-audit-c', u_a);
    UPDATE public.organizations
       SET org_type = 'freelance', team_size = '1', specializations = ARRAY['tech'], freelance_mode = 'solo'
     WHERE id = org_c;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[16 : onboarding : %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[16 : onboarding : %s] ', SQLERRM);
  END;
  RESET ROLE;

  -- u_b redevient membre de A, qui repasse en cabinet (claims vides : auth.uid() nul, garde contournée).
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO public.organization_members (organization_id, user_id, role) VALUES (org_a, u_b, 'member');
  -- 17a. Sans identité (migrations, crons) : garde contournée, réglage propriétaire compris.
  BEGIN
    UPDATE public.organizations SET org_type = 'agency', agency_permissions = '{}'::jsonb WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[17a : sans identité : %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[17a : sans identité : %s] ', SQLERRM);
  END;

  -- 17b. Jeton service_role, même avec un sub : garde contournée (indépendant
  --      accepté avec un autre membre). Le rôle de session, propriétaire des
  --      tables, contourne la RLS : ce contrôle ne vise que le trigger.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_b, 'role', 'service_role')::text, true);
  PERFORM set_config('request.jwt.claim.sub', u_b::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    UPDATE public.organizations SET org_type = 'freelance', ai_model_default = NULL WHERE id = org_a;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN failures := failures || format('[17b : service_role : %s ligne(s)] ', n); END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[17b : service_role : %s] ', SQLERRM);
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);

  -- 18. Rien n'a fui sur l'organisation voisine.
  SELECT name INTO v_name FROM public.organizations WHERE id = org_x;
  IF v_name IS DISTINCT FROM 'Org voisine' THEN failures := failures || format('[18 : X renommée en %s] ', v_name); END IF;

  IF failures <> '' THEN
    RAISE EXCEPTION 'org_writes_audit : contrôles en échec %', failures;
  END IF;
  RAISE NOTICE 'org_writes_audit : 18 contrôles OK';
END $$;
