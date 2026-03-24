-- =============================================================================
-- Migration: Security fixes for organization/team system
-- Date: 2026-03-24
-- 
-- Fixes 4 critical security vulnerabilities:
--   1. get_user_org_id() returns active_organization_id without membership check
--   2. No validation when user updates active_organization_id on profiles
--   3. Admins can insert/promote members with role = 'owner'
--   4. Last owner of an organization can be removed or demoted
-- =============================================================================

-- =============================================================================
-- FIX 1: get_user_org_id() — JOIN with organization_members to verify membership
-- 
-- BEFORE: The function blindly returned profiles.active_organization_id.
-- Any authenticated user could SET active_organization_id to any org UUID
-- and bypass all RLS policies using get_user_org_id().
--
-- AFTER: Returns active_organization_id ONLY if the user is a confirmed member
-- of that organization. Returns NULL otherwise, effectively blocking access.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.active_organization_id
  FROM public.profiles p
  INNER JOIN public.organization_members om
    ON om.organization_id = p.active_organization_id
    AND om.user_id = p.user_id
  WHERE p.user_id = _user_id
  LIMIT 1
$$;


-- =============================================================================
-- FIX 2: Trigger to block unauthorized active_organization_id updates
-- 
-- Even with Fix 1 hardening the read path, we also need to prevent writes:
-- a malicious user could still UPDATE profiles SET active_organization_id = X.
-- This trigger intercepts that UPDATE and auto-corrects the value if the user
-- is not a member of the target org (falls back to any org they ARE a member
-- of, or NULL).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_active_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.active_organization_id IS DISTINCT FROM OLD.active_organization_id
     AND NEW.active_organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE user_id = NEW.user_id
        AND organization_id = NEW.active_organization_id
    ) THEN
      -- Auto-fix: reset to an org the user IS a member of, or NULL
      NEW.active_organization_id := (
        SELECT organization_id FROM public.organization_members
        WHERE user_id = NEW.user_id
        LIMIT 1
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_active_org_trigger ON public.profiles;
CREATE TRIGGER validate_active_org_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_active_org();


-- =============================================================================
-- FIX 3: Enforce role hierarchy — prevent admins from assigning/self-promoting
-- to 'owner'
-- 
-- The INSERT RLS policy on organization_members allows admins to add members,
-- but does not constrain the role value. An admin could INSERT a row with
-- role = 'owner', effectively escalating their own privileges or granting
-- owner access to someone else. This trigger ensures only owners can assign
-- the 'owner' role, on both INSERT and UPDATE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_role_hierarchy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role text;
BEGIN
  -- Service role bypass (triggers, edge functions)
  IF current_setting('request.jwt.claim.role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Get caller's role in this org
  caller_role := public.get_org_role(auth.uid(), NEW.organization_id);

  -- Only owner can assign owner role
  IF NEW.role = 'owner' AND caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can assign the owner role';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_role_insert ON public.organization_members;
CREATE TRIGGER enforce_role_insert
  BEFORE INSERT ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_hierarchy();

-- Also enforce on UPDATE (prevent admin from promoting themselves)
DROP TRIGGER IF EXISTS enforce_role_update ON public.organization_members;
CREATE TRIGGER enforce_role_update
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_hierarchy();


-- =============================================================================
-- FIX 4: Prevent removal or demotion of the last owner
-- 
-- Without this safeguard, the last owner of an org could be:
-- (a) Deleted from organization_members → org becomes orphaned with no admin
-- (b) Demoted to admin/member via UPDATE → same result
-- Both triggers check if there is at least one OTHER owner before allowing
-- the operation.
-- =============================================================================

-- 4a: Prevent DELETE of the last owner
CREATE OR REPLACE FUNCTION public.prevent_last_owner_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = OLD.organization_id
        AND role = 'owner'
        AND id != OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot remove the last owner of an organization';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_last_owner ON public.organization_members;
CREATE TRIGGER prevent_last_owner
  BEFORE DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_owner_removal();

-- 4b: Prevent demotion of the last owner via UPDATE
CREATE OR REPLACE FUNCTION public.prevent_last_owner_demotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'owner' AND NEW.role != 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.organization_members
      WHERE organization_id = OLD.organization_id
        AND role = 'owner'
        AND id != OLD.id
    ) THEN
      RAISE EXCEPTION 'Cannot demote the last owner of an organization';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_last_owner_demotion ON public.organization_members;
CREATE TRIGGER prevent_last_owner_demotion
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_owner_demotion();
