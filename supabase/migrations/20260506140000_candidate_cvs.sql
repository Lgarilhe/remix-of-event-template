-- ════════════════════════════════════════════════════════════════════
-- Candidate CVs : table + Storage bucket + RLS
-- ════════════════════════════════════════════════════════════════════
-- Permet d'attacher un (ou plusieurs) CV PDF à un candidat dans le
-- pipeline. Le CV est stocké dans Supabase Storage (bucket privé) et
-- référencé dans `candidate_cvs`. Multi-CV par candidat avec un seul
-- "primaire" actif (celui affiché par défaut dans la modale).
--
-- Sécurité : multi-tenant via organization_id. Tous les CVs sont
-- ISOLÉS par organisation — un user ne peut voir/upload/delete les
-- CVs que pour les candidats de son org. RLS sur la table ET sur les
-- objets storage.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Table candidate_cvs ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.candidate_cvs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id text NOT NULL,                    -- LinkedIn provider_id (cohérent avec job_candidate_status.candidate_id)
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,             -- chemin dans le bucket : "{org_id}/{candidate_id}/{cv_uuid}.pdf"
  file_name text NOT NULL,                       -- nom d'origine ("camille_dubois_cv_2026.pdf")
  file_size_bytes integer,                       -- pour affichage UI ("2.4 MB")
  content_type text NOT NULL DEFAULT 'application/pdf',
  is_primary boolean NOT NULL DEFAULT false,     -- CV affiché par défaut dans la modale
  notes text,                                    -- annotation libre du recruteur ("v3 envoyée par Sarah")
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- Garantit un seul primaire par (org, candidat) → si on flag un nouveau
-- comme primary, l'ancien doit être unflag d'abord (côté app ou trigger).
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_cvs_one_primary
  ON public.candidate_cvs (organization_id, candidate_id)
  WHERE is_primary = true;

-- Index principal pour les lookups par candidat
CREATE INDEX IF NOT EXISTS idx_candidate_cvs_lookup
  ON public.candidate_cvs (organization_id, candidate_id, uploaded_at DESC);

-- Trigger : si un nouveau CV est inséré comme primaire, désactiver les
-- autres primaires pour le même candidat dans la même org. Évite à
-- l'app cliente de gérer manuellement la transaction.
CREATE OR REPLACE FUNCTION public.candidate_cvs_enforce_single_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.candidate_cvs
    SET is_primary = false
    WHERE candidate_id = NEW.candidate_id
      AND organization_id = NEW.organization_id
      AND id <> NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_cvs_single_primary ON public.candidate_cvs;
CREATE TRIGGER trg_candidate_cvs_single_primary
  AFTER INSERT OR UPDATE OF is_primary ON public.candidate_cvs
  FOR EACH ROW
  WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION public.candidate_cvs_enforce_single_primary();

-- RLS : org membership only
ALTER TABLE public.candidate_cvs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate_cvs_select_org_members"
  ON public.candidate_cvs FOR SELECT
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "candidate_cvs_insert_org_members"
  ON public.candidate_cvs FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
    AND uploaded_by = auth.uid()
  );

CREATE POLICY "candidate_cvs_update_org_members"
  ON public.candidate_cvs FOR UPDATE
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "candidate_cvs_delete_org_members"
  ON public.candidate_cvs FOR DELETE
  TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_cvs TO authenticated;


-- ─── 2. Storage bucket "candidate-cvs" ─────────────────────────────
-- Privé : pas d'accès public, signed URLs uniquement (TTL 5 min).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'candidate-cvs',
  'candidate-cvs',
  false,                              -- private
  10485760,                           -- 10 MB max
  ARRAY['application/pdf']            -- PDF only
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ─── 3. RLS sur les objets du bucket ───────────────────────────────
-- Path : "{org_id}/{candidate_id}/{cv_uuid}.pdf"
-- → (storage.foldername(name))[1] = org_id (utilisé pour l'isolation
--    multi-tenant via is_org_member).

CREATE POLICY "candidate_cvs_storage_select_org_members"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'candidate-cvs'
    AND public.is_org_member(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "candidate_cvs_storage_insert_org_members"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'candidate-cvs'
    AND public.is_org_member(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "candidate_cvs_storage_update_org_members"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'candidate-cvs'
    AND public.is_org_member(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

CREATE POLICY "candidate_cvs_storage_delete_org_members"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'candidate-cvs'
    AND public.is_org_member(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );


-- ─── 4. Comment / docs ─────────────────────────────────────────────
COMMENT ON TABLE public.candidate_cvs IS
  'CVs PDF attachés aux candidats du pipeline. Storage : bucket candidate-cvs privé, RLS via organization_id. Path {org_id}/{candidate_id}/{cv_uuid}.pdf. Multi-CV avec un seul is_primary true par (org,candidat).';
