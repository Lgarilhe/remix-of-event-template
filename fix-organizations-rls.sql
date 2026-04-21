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

-- 2. Grants sur les séquences (pour les colonnes serial/bigserial)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- 3. Grants sur les fonctions (pour RPC + triggers SECURITY INVOKER)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;

-- 4. Default privileges pour toutes les futures tables/séquences/fonctions
-- (évite de devoir refaire ce fix après chaque migration)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, anon;

-- 5. Grant usage sur le schema lui-même (standard Supabase)
GRANT USAGE ON SCHEMA public TO authenticated, anon;

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

-- 7. Contrainte UNIQUE manquante sur ai_credit_balances.organization_id
-- La fonction sync_credit_balance_from_subscription fait ON CONFLICT (organization_id)
-- DO UPDATE, mais la contrainte UNIQUE manque → trigger crash en cascade lors de la
-- création d'une org (auto_create_free_subscription → sync_credit_balance_from_subscription).
ALTER TABLE public.ai_credit_balances
  DROP CONSTRAINT IF EXISTS ai_credit_balances_organization_id_unique;
ALTER TABLE public.ai_credit_balances
  ADD CONSTRAINT ai_credit_balances_organization_id_unique UNIQUE (organization_id);

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
