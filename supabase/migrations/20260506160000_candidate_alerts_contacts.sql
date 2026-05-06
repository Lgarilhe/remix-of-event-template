-- ════════════════════════════════════════════════════════════════════
-- candidate_alert_dismissals + candidate_contacts
-- ════════════════════════════════════════════════════════════════════
-- Deux features liées au hub candidat dans le pipeline :
--
-- 1) ALERT DISMISSALS :
--    Le tableau "À traiter" en haut de l'Aperçu détecte des signaux
--    (stagnation, données manquantes, message non répondu, etc.).
--    L'user peut cliquer "✓ Traité" pour faire disparaître une alerte
--    qu'il a gérée. Persistance par (org, candidat, alert_key) → ne
--    revient plus dans la liste, même après refresh ou re-ouverture.
--
-- 2) MANUAL CONTACTS :
--    L'user peut saisir manuellement email + phone d'un candidat
--    quand l'enrichissement automatique n'a pas trouvé. 1 row par
--    (org, candidat). Stocké séparément de linkedin_profile_data
--    (qui est un snapshot LinkedIn read-only) et de job_candidate_status
--    (per-job, alors que les contacts sont per-candidate).
--
-- Multi-tenant : les 2 tables ont organization_id + RLS via is_org_member.
-- ════════════════════════════════════════════════════════════════════

-- ─── 1. Alert dismissals ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.candidate_alert_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  alert_key text NOT NULL,                      -- 'stagnation' | 'unanswered_reply' | 'missing_email' | 'missing_phone' | 'missing_cv' | 'no_score' | 'invite_unaccepted'
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  dismissed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT candidate_alert_dismissals_unique
    UNIQUE (organization_id, candidate_id, alert_key)
);

CREATE INDEX IF NOT EXISTS idx_candidate_alert_dismissals_lookup
  ON public.candidate_alert_dismissals (organization_id, candidate_id);

ALTER TABLE public.candidate_alert_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate_alert_dismissals_select_org_members"
  ON public.candidate_alert_dismissals FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "candidate_alert_dismissals_insert_org_members"
  ON public.candidate_alert_dismissals FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
    AND dismissed_by = auth.uid()
  );

CREATE POLICY "candidate_alert_dismissals_delete_org_members"
  ON public.candidate_alert_dismissals FOR DELETE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

GRANT SELECT, INSERT, DELETE ON public.candidate_alert_dismissals TO authenticated;

COMMENT ON TABLE public.candidate_alert_dismissals IS
  'Alertes du hub candidat (Aperçu) que l''user a marquées "Traité". 1 row = 1 alerte dismissée pour 1 candidat dans 1 org.';


-- ─── 2. Manual contacts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.candidate_contacts (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  email text,
  phone text,
  notes text,                                   -- "Email pro / Téléphone perso / etc."
  source text NOT NULL DEFAULT 'manual',        -- 'manual' | 'enriched_pdl' | 'enriched_apollo' | 'enriched_dropcontact' (futur)
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (organization_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_candidate_contacts_org
  ON public.candidate_contacts (organization_id);

ALTER TABLE public.candidate_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate_contacts_select_org_members"
  ON public.candidate_contacts FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "candidate_contacts_insert_org_members"
  ON public.candidate_contacts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

CREATE POLICY "candidate_contacts_update_org_members"
  ON public.candidate_contacts FOR UPDATE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id))
  WITH CHECK (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "candidate_contacts_delete_org_members"
  ON public.candidate_contacts FOR DELETE TO authenticated
  USING (public.is_org_member(auth.uid(), organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidate_contacts TO authenticated;

COMMENT ON TABLE public.candidate_contacts IS
  'Contacts manuels (email/phone) saisis par le recruteur ou récupérés via enrichissement. 1 row par (org, candidat) — partagé entre toutes les missions du candidat dans l''org.';

-- Trigger : auto-update updated_at sur UPDATE
CREATE OR REPLACE FUNCTION public.candidate_contacts_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_candidate_contacts_updated_at ON public.candidate_contacts;
CREATE TRIGGER trg_candidate_contacts_updated_at
  BEFORE UPDATE ON public.candidate_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.candidate_contacts_set_updated_at();
