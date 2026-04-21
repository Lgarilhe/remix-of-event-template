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

-- 6. Vérification post-fix
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
