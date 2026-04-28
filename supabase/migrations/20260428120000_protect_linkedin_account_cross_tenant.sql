-- Migration : protection cross-tenant sur member_linkedin_accounts
--
-- Bug observé en audit sécurité 2026-04-28 :
--   La fonction linkAccount côté frontend faisait un UPSERT direct dans
--   member_linkedin_accounts sans vérifier qu'un linkedin_account_id n'était
--   pas déjà mappé à une AUTRE organisation. Risque : un user d'org A
--   pouvait claim le LinkedIn d'un user d'org B (cas critique quand toutes
--   les orgs Konekt partagent une seule clé Unipile globale).
--
-- Fix défensif : trigger BEFORE INSERT/UPDATE qui REJETTE si le
-- linkedin_account_id est déjà mappé à une autre organization_id.
-- L'application devra alors gérer le cas (toast d'erreur, etc.).

CREATE OR REPLACE FUNCTION public.prevent_linkedin_account_cross_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_org_id uuid;
  v_existing_user_id uuid;
BEGIN
  -- Skip si pas de linkedin_account_id (NULL accepted edge case)
  IF NEW.linkedin_account_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cherche si cet account_id est déjà mappé à une AUTRE org
  SELECT organization_id, user_id
  INTO v_existing_org_id, v_existing_user_id
  FROM public.member_linkedin_accounts
  WHERE linkedin_account_id = NEW.linkedin_account_id
    AND organization_id != NEW.organization_id
  LIMIT 1;

  IF v_existing_org_id IS NOT NULL THEN
    RAISE EXCEPTION 'CROSS_TENANT_VIOLATION: linkedin_account_id % is already mapped to another organization (%)',
      NEW.linkedin_account_id, v_existing_org_id
      USING ERRCODE = '42501', -- insufficient_privilege
            HINT = 'Ce compte LinkedIn est déjà associé à une autre organisation Konekt. Si vous pensez que c''est une erreur, contactez le support.';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop l'ancien trigger s'il existe (idempotent)
DROP TRIGGER IF EXISTS member_linkedin_accounts_no_cross_tenant ON public.member_linkedin_accounts;

CREATE TRIGGER member_linkedin_accounts_no_cross_tenant
  BEFORE INSERT OR UPDATE OF linkedin_account_id, organization_id
  ON public.member_linkedin_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_linkedin_account_cross_tenant();

COMMENT ON FUNCTION public.prevent_linkedin_account_cross_tenant IS
  'Empêche un linkedin_account_id d''être mappé simultanément à plusieurs organizations Konekt. Sécurité cross-tenant pour multi-tenant Unipile.';

COMMENT ON TRIGGER member_linkedin_accounts_no_cross_tenant ON public.member_linkedin_accounts IS
  'Garde-fou cross-tenant : refuse INSERT/UPDATE si linkedin_account_id est déjà dans une autre org.';
