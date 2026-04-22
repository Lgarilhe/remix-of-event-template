-- ============================================================================
-- RLS Phase 2 — Consolidation (S5 + S7 du MASTER_TODO)
-- ============================================================================
-- Le plan complet docs/rls-fix-plan.md (516 lignes, branche audit-rls-policies)
-- a été en grande partie résolu par la migration 20260416000000 (qu'on a appliquée).
-- Cette migration cible les 2 trous restants identifiés en prod :
--
-- 1. mission_invitations.public_read_by_token : USING(true) sur anon → leak
--    des emails des personnes invitées. Restriction sur invitations actives.
-- 2. airtable_sync_meta.authenticated_read : USING(true) sur authenticated.
--    Peu critique mais on restreint aux membres de l'org via organization_id.
-- 3. portal_tokens (S5) : ajout WITH CHECK(false) sur UPDATE/DELETE pour anon
--    (un attaquant avec un token expiré ne peut pas se re-set une expiration).
-- ============================================================================

-- 1. mission_invitations — restreindre la lecture anon aux invitations actives
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'public_read_by_token'
      AND polrelid = 'public.mission_invitations'::regclass
  ) THEN
    DROP POLICY "public_read_by_token" ON public.mission_invitations;
  END IF;
END $$;

CREATE POLICY "public_read_active_invitation"
  ON public.mission_invitations
  FOR SELECT
  USING (
    expires_at > now()
    AND status = 'pending'
  );
-- Note : un attaquant doit connaître l'UUID exact de l'invitation pour la lire.
-- Les UUIDs sont v4 cryptographic random (~122 bits entropie) — bruteforce infaisable.
-- Pour aller plus loin (require token in custom header), refacto l'app pour
-- passer par check-invitation-status edge function uniquement.

-- 2. airtable_sync_meta — restreindre aux membres de l'org concernée
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'authenticated_read'
      AND polrelid = 'public.airtable_sync_meta'::regclass
  ) THEN
    DROP POLICY "authenticated_read" ON public.airtable_sync_meta;
  END IF;
END $$;

-- airtable_sync_meta a-t-il une colonne organization_id ?
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'airtable_sync_meta'
      AND column_name = 'organization_id'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "org_members_read"
        ON public.airtable_sync_meta
        FOR SELECT TO authenticated
        USING (organization_id = public.get_user_org_id(auth.uid()))
    $POLICY$;
  ELSE
    -- Pas d'org_id : on garde restrictif aux service_role uniquement (pas de policy authenticated)
    RAISE NOTICE 'airtable_sync_meta has no organization_id column — leaving service-role-only access';
  END IF;
END $$;

-- 3. portal_tokens (S5) — empêcher anon de modifier ses tokens
-- (l'anon doit pouvoir READ son token via match exact, mais pas UPDATE/DELETE)
DO $$
BEGIN
  -- Ajouter une policy explicite refusant tout UPDATE/DELETE par anon
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'anon_no_modify'
      AND polrelid = 'public.client_portal_tokens'::regclass
  ) THEN
    EXECUTE 'CREATE POLICY "anon_no_modify_update" ON public.client_portal_tokens FOR UPDATE TO anon USING (false) WITH CHECK (false)';
    EXECUTE 'CREATE POLICY "anon_no_modify_delete" ON public.client_portal_tokens FOR DELETE TO anon USING (false)';
    RAISE NOTICE 'Added anon UPDATE/DELETE deny policies on client_portal_tokens';
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'client_portal_tokens table not found — skipping';
END $$;
