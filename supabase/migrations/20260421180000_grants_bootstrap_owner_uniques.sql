-- ============================================================================
-- Fix: "permission denied for table organizations" during onboarding
-- ============================================================================
-- Cause: lors de l'import du schéma depuis Lovable, les GRANTs sur les tables
-- public.* n'ont pas été transférés à la role `authenticated`. Les policies RLS
-- ne sont appliquées que si la role a déjà un GRANT sur la table.
--
-- Fix: accorder les privilèges standard Supabase (SELECT/INSERT/UPDATE/DELETE)
-- à `authenticated` sur toutes les tables public, idem pour les séquences et
-- les fonctions. Les policies RLS existantes continuent de filtrer les rows.
-- ============================================================================

-- 1. Grants sur toutes les tables existantes du schema public
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
-- service_role est utilisé par les edge functions via SB_SECRET_KEY (nouveau
-- système Supabase API keys ES256 / sb_secret_xxx). Sans ces GRANTs, les
-- fonctions admin retournent "permission denied" malgré la clé service_role.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- 2. Grants sur les séquences (pour les colonnes serial/bigserial)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 3. Grants sur les fonctions (pour RPC + triggers SECURITY INVOKER)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 4. Default privileges pour toutes les futures tables/séquences/fonctions
-- (évite de devoir refaire ce fix après chaque migration)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 5. Grant usage sur le schema lui-même (standard Supabase)
GRANT USAGE ON SCHEMA public TO authenticated, anon, service_role;

-- 6. Bootstrap owner — catch-22 dans enforce_role_hierarchy
-- Problème : le trigger handle_new_organization insère le créateur comme 'owner' dans
-- organization_members. Mais enforce_role_hierarchy (BEFORE INSERT) refuse d'assigner
-- le role 'owner' à quelqu'un qui n'est pas déjà owner de l'org. Comme l'org vient
-- d'être créée, aucun owner n'existe → l'insert échoue avec "Only owners can assign the owner role".
-- Fix : laisser passer le cas bootstrap (NEW.role = 'owner' ET aucun membre n'existe encore
-- pour cette org ET le user inséré est bien le created_by de l'org).
CREATE OR REPLACE FUNCTION public.enforce_role_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
  is_bootstrap boolean;
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Bootstrap : premier owner de l'org = le user qui vient de la créer.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = NEW.organization_id
  )
  AND EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = NEW.organization_id AND created_by = NEW.user_id
  )
  INTO is_bootstrap;

  IF is_bootstrap THEN
    RETURN NEW;
  END IF;

  caller_role := public.get_org_role(auth.uid(), NEW.organization_id);

  IF NEW.role = 'owner' AND caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can assign the owner role';
  END IF;

  RETURN NEW;
END;
$$;

-- 7. Contraintes UNIQUE manquantes (batch)
-- Le schema importé depuis Lovable a perdu toutes les UNIQUE constraints — sans elles,
-- les upserts client + triggers ON CONFLICT échouent avec "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification".
--
-- On ajoute chaque contrainte dans un DO block pour rester idempotent : si elle existe
-- déjà (autre nom possible), on skip. Si les colonnes existent mais pas la contrainte,
-- on l'ajoute. Les doublons existants seraient un blocker, mais sur une base fraîche
-- les tables sont vides.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name, cols FROM (VALUES
      ('ai_credit_balances'::text, ARRAY['organization_id']::text[]),
      ('organization_subscriptions'::text, ARRAY['organization_id']::text[]),
      ('profiles'::text, ARRAY['user_id']::text[]),
      ('connector_instances'::text, ARRAY['organization_id','connector_id']::text[]),
      ('chat_categories'::text, ARRAY['chat_id','created_by']::text[]),
      ('job_candidate_status'::text, ARRAY['job_id','candidate_id','created_by']::text[]),
      ('member_email_accounts'::text, ARRAY['organization_id','email_account_id']::text[]),
      ('member_linkedin_accounts'::text, ARRAY['organization_id','user_id']::text[]),
      ('member_quotas'::text, ARRAY['organization_id','user_id']::text[]),
      ('message_analysis_cache'::text, ARRAY['chat_id','account_id']::text[])
    ) AS t(table_name, cols)
  LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=r.table_name
    ) THEN
      RAISE NOTICE 'Skip % (table missing)', r.table_name;
      CONTINUE;
    END IF;

    -- Skip if one of the cols is missing
    IF EXISTS (
      SELECT unnest(r.cols) AS c
      EXCEPT
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=r.table_name
    ) THEN
      RAISE NOTICE 'Skip % (column missing in %)', r.table_name, r.cols;
      CONTINUE;
    END IF;

    -- Predictable constraint name
    DECLARE
      cons_name text := r.table_name || '_' || array_to_string(r.cols, '_') || '_unique';
    BEGIN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.table_name, cons_name);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (%s)',
        r.table_name,
        cons_name,
        array_to_string(array(SELECT quote_ident(c) FROM unnest(r.cols) c), ', ')
      );
      RAISE NOTICE 'Added/replaced UNIQUE on %(%)', r.table_name, array_to_string(r.cols, ',');
    EXCEPTION WHEN duplicate_table THEN
      -- contrainte identique existe déjà sous un autre nom → ignorer
      RAISE NOTICE 'UNIQUE already exists on %(%) under another name — skipped', r.table_name, array_to_string(r.cols, ',');
    END;
  END LOOP;
END $$;

-- 8. members_select — autoriser le créateur à voir sa propre org
-- La policy originale ne permettait le SELECT que si is_org_member → mais lors d'un
-- `INSERT ... RETURNING *` via supabase-js, le RETURNING check évaluait is_org_member
-- sur un snapshot où le trigger AFTER n'était pas encore visible (timing race PostgREST).
-- Résultat : "new row violates row-level security policy" sur la toute première org
-- créée par un user. Fix : accepter AUSSI created_by = auth.uid().
DROP POLICY IF EXISTS members_select ON public.organizations;
CREATE POLICY members_select ON public.organizations
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_org_member(auth.uid(), id)
  );

-- 9. Vérification post-fix
DO $$
DECLARE
  can_insert_orgs boolean;
  can_insert_members boolean;
  can_update_profiles boolean;
BEGIN
  SELECT has_table_privilege('authenticated', 'public.organizations', 'INSERT') INTO can_insert_orgs;
  SELECT has_table_privilege('authenticated', 'public.organization_members', 'INSERT') INTO can_insert_members;
  SELECT has_table_privilege('authenticated', 'public.profiles', 'UPDATE') INTO can_update_profiles;

  IF NOT (can_insert_orgs AND can_insert_members AND can_update_profiles) THEN
    RAISE EXCEPTION 'Fix failed: authenticated still missing privileges (orgs=%, members=%, profiles=%)',
      can_insert_orgs, can_insert_members, can_update_profiles;
  END IF;

  RAISE NOTICE 'Fix applied successfully. authenticated can now INSERT on organizations, organization_members, and UPDATE profiles.';
END $$;
