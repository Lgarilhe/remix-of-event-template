-- =====================================================================
-- Paramètres, lot 1 : écritures sur l'organisation, logos, e-mails des
-- membres.
--
--   1. organizations : la seule policy d'UPDATE réservait l'écriture au
--      propriétaire (prod : owners_update, MIGRATION_CLEAN.sql ; base neuve :
--      « Owners can update their organizations », 20260306140155). Un
--      administrateur voyait des écrans d'édition et PostgREST lui répondait
--      « succès » sans ligne modifiée. La policy s'ouvre au propriétaire et
--      aux administrateurs ; un trigger de garde limite l'administrateur au
--      nom, au logo, au site (qui fournit le logo par défaut) et aux consignes
--      IA. Tout le reste (type, permissions agence, modèle par défaut, fiche
--      d'onboarding…) reste au propriétaire. Le passage en indépendant est
--      refusé tant qu'il reste un autre membre ou une invitation valide.
--      Les refus portent un HINT stable, traduit par le front :
--      ORG_OWNER_ONLY, ORG_FREELANCE_NOT_SOLO, ORG_IMMUTABLE.
--   2. Bucket org-logos : créé par 20260316235208 sur une base neuve, absent
--      de la prod (MIGRATION_CLEAN.sql ne touche pas au stockage) : « Changer
--      le logo » échouait pour tout le monde. Les trois policies de mars
--      ouvraient l'envoi à tout membre de l'espace actif et le listing au
--      public, sans UPDATE. Elles sont remplacées par quatre policies
--      réservées au propriétaire et aux administrateurs de l'organisation du
--      premier dossier ({organization_id}/logo-{uuid}.{ext}).
--   3. get_org_member_emails(org) : profiles n'a pas de colonne email, qui
--      vit dans auth.users, illisible par authenticated. La fonction renvoie
--      l'e-mail des membres de l'organisation, pour ses seuls membres
--      internes (owner, admin, member).
--
-- Les deux noms de la policy d'UPDATE d'origine sont retirés : une policy
-- permissive héritée s'additionnerait à la nouvelle (CLAUDE.md, règle 7).
-- Idempotente, rejouable, sur base neuve comme sur la production.
-- =====================================================================

-- ─── 1. organizations : UPDATE propriétaire ou administrateur ───
DROP POLICY IF EXISTS "Owners can update their organizations" ON public.organizations;
DROP POLICY IF EXISTS owners_update ON public.organizations;
DROP POLICY IF EXISTS admins_update ON public.organizations;
CREATE POLICY admins_update ON public.organizations
  FOR UPDATE TO authenticated
  USING (public.get_org_role(auth.uid(), id) IN ('owner', 'admin'))
  WITH CHECK (public.get_org_role(auth.uid(), id) IN ('owner', 'admin'));

-- Garde par colonne. Il passe avant update_organizations_updated_at (ordre
-- alphabétique des triggers BEFORE) ; updated_at est de toute façon en liste
-- blanche.
CREATE OR REPLACE FUNCTION public.organizations_update_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Liste blanche de l'administrateur. Une colonne ajoutée plus tard reste
  -- réservée au propriétaire tant qu'elle n'est pas ajoutée ici.
  c_admin_columns constant text[] := ARRAY['name', 'logo_url', 'website', 'ai_context', 'updated_at'];
BEGIN
  -- Service role, migrations, crons : pas de restriction.
  IF auth.uid() IS NULL OR coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- members_select s'appuie sur created_by : immuable pour tout client.
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'L''identifiant et le créateur d''une organisation ne sont pas modifiables'
      USING ERRCODE = '42501', HINT = 'ORG_IMMUTABLE';
  END IF;

  IF public.get_org_role(auth.uid(), OLD.id) IS DISTINCT FROM 'owner'
     AND (to_jsonb(NEW) - c_admin_columns) IS DISTINCT FROM (to_jsonb(OLD) - c_admin_columns) THEN
    RAISE EXCEPTION 'Seul le propriétaire peut modifier ce réglage de l''organisation'
      USING ERRCODE = '42501', HINT = 'ORG_OWNER_ONLY';
  END IF;

  -- Invitation en attente : même définition que useQuotaGate et
  -- send-team-invitation (pending et non expirée).
  IF NEW.org_type = 'freelance' AND OLD.org_type IS DISTINCT FROM 'freelance' AND (
       EXISTS (SELECT 1 FROM public.organization_members m
               WHERE m.organization_id = OLD.id AND m.user_id IS DISTINCT FROM auth.uid())
    OR EXISTS (SELECT 1 FROM public.organization_invitations i
               WHERE i.organization_id = OLD.id AND i.status = 'pending' AND i.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'Une organisation indépendante ne compte qu''un membre : retirez les autres membres et annulez les invitations en attente'
      USING ERRCODE = 'P0001', HINT = 'ORG_FREELANCE_NOT_SOLO';
  END IF;

  RETURN NEW;
END;
$$;

-- Fonction de trigger : aucun appel client (le déclenchement ne demande pas EXECUTE).
REVOKE EXECUTE ON FUNCTION public.organizations_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_update_guard ON public.organizations;
CREATE TRIGGER organizations_update_guard
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.organizations_update_guard();

-- ─── 2. Bucket org-logos, écriture propriétaire ou administrateur ───
-- Créé s'il manque, bornes réalignées s'il existe : 2 Mo et quatre formats,
-- les mêmes que le contrôle de OrgLogoEditor. Pas de SVG, qui peut porter du
-- script.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('org-logos', 'org-logos', true, 2097152,
        ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policies de mars (base neuve seulement ; sans effet en prod).
DROP POLICY IF EXISTS "Org members can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Org logos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Org admins can delete logos" ON storage.objects;

-- Le rôle est lu dans organization_members, et non plus dans
-- profiles.active_organization_id : un administrateur sans profil, ou dont
-- l'espace actif est un autre, peut envoyer le logo. Le premier dossier est
-- comparé en texte : un cast ::uuid lèverait sur un chemin quelconque.
-- La lecture publique passe par l'URL publique du bucket, qui ignore la RLS :
-- aucune policy SELECT n'est ouverte au public (plus de listing du bucket).
-- Par l'API de stockage, un envoi demande SELECT et INSERT (plus UPDATE pour
-- un remplacement) ; une suppression, SELECT et DELETE.
DROP POLICY IF EXISTS org_logos_admins_select ON storage.objects;
CREATE POLICY org_logos_admins_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT m.organization_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS org_logos_admins_insert ON storage.objects;
CREATE POLICY org_logos_admins_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT m.organization_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS org_logos_admins_update ON storage.objects;
CREATE POLICY org_logos_admins_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT m.organization_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT m.organization_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS org_logos_admins_delete ON storage.objects;
CREATE POLICY org_logos_admins_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT m.organization_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid() AND m.role IN ('owner', 'admin')
    )
  );

-- ─── 3. E-mail des membres d'une organisation ───
-- Membre interne (owner, admin, member) de l'organisation demandée : e-mails
-- de ses membres. Collaborateur externe ou non-membre : ensemble vide, sans
-- erreur (rien ne fuit, pas même l'existence de l'organisation). Sous
-- service_role, auth.uid() est nul : EXECUTE lui est retiré, comme à anon.
CREATE OR REPLACE FUNCTION public.get_org_member_emails(p_organization_id uuid)
RETURNS TABLE (user_id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.user_id, u.email::text
  FROM public.organization_members AS om
  JOIN auth.users AS u ON u.id = om.user_id
  WHERE om.organization_id = p_organization_id
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS me
      WHERE me.organization_id = p_organization_id
        AND me.user_id = (SELECT auth.uid())
        AND me.role IN ('owner', 'admin', 'member')
    )
  ORDER BY om.created_at;
$$;

REVOKE ALL ON FUNCTION public.get_org_member_emails(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_org_member_emails(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_org_member_emails(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.get_org_member_emails(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_org_member_emails(uuid) IS
  'E-mail (auth.users) des membres d''une organisation, pour l''écran Équipe et les sélecteurs de membres. Réservé aux membres internes (owner, admin, member) de cette organisation ; collaborateur externe ou non-membre : aucun résultat. Exécutable par authenticated uniquement.';

-- ─── 4. Contrôle : une seule policy d'UPDATE sur organizations (règle 7) ───
-- Une policy d'UPDATE inconnue en prod ferait échouer le db push : voulu, elle
-- s'additionnerait à admins_update et annulerait la garde de rôle.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'organizations' AND cmd IN ('UPDATE', 'ALL');
  IF n <> 1 THEN
    RAISE EXCEPTION 'organizations : % policies d''UPDATE (attendu : 1, admins_update)', n;
  END IF;
END $$;

-- Recharge du cache de schéma PostgREST (nouvelle RPC).
NOTIFY pgrst, 'reload schema';
