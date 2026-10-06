-- =====================================================================
-- member_quotas en libre-service — lot 1 des Paramètres (réparation 7).
-- À exécuter DANS UNE TRANSACTION puis ROLLBACK, sur une base locale
-- reconstruite (jamais en prod) :
--   BEGIN; \i supabase/tests/member_quotas_self_service.sql; ROLLBACK;
-- Vérifie le chemin d'écriture de l'écran « Plages & limites de sécurité » :
-- l'upsert du front (INSERT … ON CONFLICT (organization_id, user_id) DO UPDATE,
-- colonnes envoyées seulement) suivi de la relecture de la ligne écrite
-- (.select().single(), soit RETURNING sous RLS), le déclencheur
-- member_quotas_self_service_guard et la borne haute de la contrainte.
-- Les contrôles sont accumulés ; une exception finale liste ceux en échec.
-- Utilisateurs et organisation synthétiques (ids fixes).
-- =====================================================================
DO $$
DECLARE
  u_o uuid := '71111111-1111-4111-8111-111111111111';
  u_m uuid := '72222222-2222-4222-8222-222222222222';
  org uuid := '7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  r public.member_quotas%ROWTYPE;
  failures text := '';
  claims_m text := json_build_object('sub', u_m, 'role', 'authenticated', 'email', 'm@quotas.test')::text;
  claims_o text := json_build_object('sub', u_o, 'role', 'authenticated', 'email', 'o@quotas.test')::text;
BEGIN
  -- Jeu de données : un propriétaire, un membre, une organisation active pour les deux.
  INSERT INTO auth.users (id, email, aud, role, instance_id, raw_user_meta_data)
  VALUES (u_o, 'o@quotas.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb),
         (u_m, 'm@quotas.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', '{}'::jsonb);
  INSERT INTO public.organizations (id, name, slug, created_by)
  VALUES (org, 'Quotas Org', 'quotas-org', u_o);
  -- Le propriétaire est rattaché par le déclencheur on_organization_created.
  -- Sans auth.uid(), enforce_role_hierarchy laisse passer le rôle member.
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (org, u_m, 'member');
  IF coalesce(public.get_org_role(u_o, org), '') <> 'owner' THEN
    RAISE EXCEPTION 'montage : le créateur n''est pas propriétaire de l''organisation';
  END IF;
  INSERT INTO public.profiles (user_id, active_organization_id)
  VALUES (u_o, org), (u_m, org)
  ON CONFLICT (user_id) DO UPDATE SET active_organization_id = EXCLUDED.active_organization_id;

  -- ===== Contexte : membre =====
  PERFORM set_config('request.jwt.claims', claims_m, true);
  PERFORM set_config('request.jwt.claim.sub', u_m::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 1. Premier enregistrement (INSERT) : horaires relus, plafond forcé à 80.
  BEGIN
    INSERT INTO public.member_quotas (organization_id, user_id, business_hours_start, business_hours_end, timezone, updated_at)
    VALUES (org, u_m, 9, 17, 'Europe/Paris', now())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id, user_id = EXCLUDED.user_id,
      business_hours_start = EXCLUDED.business_hours_start, business_hours_end = EXCLUDED.business_hours_end,
      timezone = EXCLUDED.timezone, updated_at = EXCLUDED.updated_at
    RETURNING * INTO r;
    IF r.business_hours_start IS DISTINCT FROM 9 OR r.business_hours_end IS DISTINCT FROM 17 OR r.max_actions_per_day IS DISTINCT FROM 80 THEN
      failures := failures || format('[1. insertion membre : %s-%s, plafond %s] ', r.business_hours_start, r.business_hours_end, r.max_actions_per_day);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[1. insertion membre : %s] ', SQLERRM);
  END;

  -- 2. Second enregistrement (ON CONFLICT DO UPDATE) : nouvelles heures relues,
  --    plafond inchangé (le SET ne couvre que les colonnes envoyées).
  BEGIN
    INSERT INTO public.member_quotas (organization_id, user_id, business_hours_start, business_hours_end, timezone, updated_at)
    VALUES (org, u_m, 10, 16, 'Europe/London', now())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id, user_id = EXCLUDED.user_id,
      business_hours_start = EXCLUDED.business_hours_start, business_hours_end = EXCLUDED.business_hours_end,
      timezone = EXCLUDED.timezone, updated_at = EXCLUDED.updated_at
    RETURNING * INTO r;
    IF r.business_hours_start IS DISTINCT FROM 10 OR r.business_hours_end IS DISTINCT FROM 16
       OR r.timezone IS DISTINCT FROM 'Europe/London' OR r.max_actions_per_day IS DISTINCT FROM 80 THEN
      failures := failures || format('[2. mise à jour membre : %s-%s %s, plafond %s] ', r.business_hours_start, r.business_hours_end, r.timezone, r.max_actions_per_day);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[2. mise à jour membre : %s] ', SQLERRM);
  END;

  -- 3. Un membre ne modifie pas son plafond.
  BEGIN
    UPDATE public.member_quotas SET max_actions_per_day = 200 WHERE user_id = u_m AND organization_id = org;
    failures := failures || '[3. le membre a modifié son plafond] ';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[3. plafond membre : %s] ', SQLERRM);
  END;

  -- ===== Contexte : propriétaire =====
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', claims_o, true);
  PERFORM set_config('request.jwt.claim.sub', u_o::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  -- 4. Le propriétaire enregistre son propre plafond par l'upsert du front : relu tel quel.
  BEGIN
    INSERT INTO public.member_quotas (organization_id, user_id, business_hours_start, business_hours_end, timezone, max_actions_per_day, updated_at)
    VALUES (org, u_o, 8, 19, 'Europe/Paris', 120, now())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id, user_id = EXCLUDED.user_id,
      business_hours_start = EXCLUDED.business_hours_start, business_hours_end = EXCLUDED.business_hours_end,
      timezone = EXCLUDED.timezone, max_actions_per_day = EXCLUDED.max_actions_per_day, updated_at = EXCLUDED.updated_at
    RETURNING * INTO r;
    IF r.max_actions_per_day IS DISTINCT FROM 120 THEN
      failures := failures || format('[4. plafond propriétaire relu : %s] ', r.max_actions_per_day);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[4. upsert propriétaire : %s] ', SQLERRM);
  END;

  -- 5. Borne haute partagée (MAX_ACTIONS_PER_DAY_MAX = 500) : 500 passe.
  BEGIN
    UPDATE public.member_quotas SET max_actions_per_day = 500
    WHERE user_id = u_m AND organization_id = org
    RETURNING * INTO r;
    IF r.max_actions_per_day IS DISTINCT FROM 500 THEN
      failures := failures || format('[5. plafond 500 : %s] ', r.max_actions_per_day);
    END IF;
  EXCEPTION WHEN OTHERS THEN failures := failures || format('[5. plafond 500 : %s] ', SQLERRM);
  END;

  -- 6. 501 est refusé par la contrainte member_quotas_max_actions_range.
  BEGIN
    UPDATE public.member_quotas SET max_actions_per_day = 501 WHERE user_id = u_m AND organization_id = org;
    failures := failures || '[6. plafond 501 accepté] ';
  EXCEPTION WHEN check_violation THEN NULL;
  WHEN OTHERS THEN failures := failures || format('[6. plafond 501 : %s] ', SQLERRM);
  END;

  RESET ROLE;

  IF failures <> '' THEN
    RAISE EXCEPTION 'member_quotas_self_service : %', failures;
  END IF;
  RAISE NOTICE 'member_quotas_self_service : 6 contrôles OK';
END $$;
