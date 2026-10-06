-- ============================================================================
-- Migration : secrets d'intégration write-only (audit F4-integration-secrets)
-- Fichier : supabase/migrations/20260906085151_integration_secrets_write_only.sql
--
-- Contexte : organization_integrations stocke les clés API saisies par le client
-- (notion/calendly/airtable/aircall) ET les clés provisionnées par Konekt
-- (unipile_*, coresignal_*, apollo/pdl/anthropic). Le bootstrap 20260421180000
-- a granté SELECT/INSERT/UPDATE/DELETE à authenticated (+ SELECT à anon) : tout
-- owner/admin lisait les 10 colonnes secrètes via PostgREST (select=*).
--
-- Fix :
--   1. REVOKE ALL sur la table pour anon/authenticated (service_role inchangé →
--      edge functions non impactées, elles lisent toutes en service_role).
--   2. Vue organization_integrations_public : colonnes non secrètes + suffixe
--      masqué (••••XXXX) des 4 clés CLIENT uniquement. Les clés Konekt ne sont
--      jamais exposées, même masquées. Vue « definer » (propriétaire postgres,
--      security_barrier) avec prédicat owner/admin intégré : security_invoker
--      est impossible puisque l'invocateur n'a plus SELECT sur la table.
--   3. RPC SECURITY DEFINER, réservées owner/admin (get_org_role) :
--      - set_integration_secret(org, field, value) : 4 champs client autorisés
--      - update_integration_settings(org, jsonb) : champs non secrets autorisés
--      Les flags pilotés par Konekt (unipile_connected, coresignal_enabled) ne
--      sont pas modifiables par le client.
--
-- Idempotente, rejouable. Ne touche pas aux policies RLS existantes
-- (org_admins_all / service_role_all restent en défense en profondeur).
-- ============================================================================

-- ─── 1. Plus aucun privilège direct des rôles clients sur la table ───────────
REVOKE ALL PRIVILEGES ON TABLE public.organization_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.organization_integrations TO service_role;

-- ─── 2. Helper de masquage ───────────────────────────────────────────────────
-- NULL/vide → NULL (aucune clé) ; clé courte → '••••' seul (ne jamais révéler
-- une clé entière) ; sinon '••••' + 4 derniers caractères.
CREATE OR REPLACE FUNCTION public.mask_integration_secret(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR btrim(p_value) = '' THEN NULL
    WHEN length(p_value) >= 12 THEN '••••' || right(p_value, 4)
    ELSE '••••'
  END
$$;

REVOKE EXECUTE ON FUNCTION public.mask_integration_secret(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mask_integration_secret(text) TO authenticated, service_role;

-- ─── 3. Vue de lecture publique ──────────────────────────────────────────────
-- DROP + CREATE (et non CREATE OR REPLACE) pour rester rejouable si la liste
-- des colonnes évolue. security_barrier : le prédicat owner/admin est évalué
-- avant toute fonction fournie par l'appelant.
DROP VIEW IF EXISTS public.organization_integrations_public;
CREATE VIEW public.organization_integrations_public
WITH (security_barrier = true) AS
SELECT
  oi.id,
  oi.organization_id,
  oi.notion_postes_db_id,
  oi.notion_candidats_db_id,
  oi.notion_shortlist_db_id,
  oi.notion_connected,
  oi.calendly_connected,
  oi.unipile_connected,
  oi.airtable_base_id,
  oi.airtable_base_id_2,
  oi.airtable_connected,
  oi.aircall_api_id,
  oi.aircall_connected,
  oi.coresignal_enabled,
  oi.created_at,
  oi.updated_at,
  -- Suffixes masqués : clés saisies par le CLIENT uniquement.
  -- Volontairement absents : unipile_api_key, unipile_dsn, coresignal_api_key,
  -- apollo_api_key, pdl_api_key, anthropic_api_key (clés Konekt).
  public.mask_integration_secret(oi.notion_api_key)    AS notion_api_key_hint,
  public.mask_integration_secret(oi.calendly_api_key)  AS calendly_api_key_hint,
  public.mask_integration_secret(oi.airtable_api_key)  AS airtable_api_key_hint,
  public.mask_integration_secret(oi.aircall_api_token) AS aircall_api_token_hint
FROM public.organization_integrations oi
WHERE auth.uid() IS NOT NULL
  AND public.get_org_role(auth.uid(), oi.organization_id) IN ('owner', 'admin');

COMMENT ON VIEW public.organization_integrations_public IS
  'Projection sans secret de organization_integrations (owner/admin de l''org). Les clés client n''apparaissent que sous forme de suffixe masqué ; les clés Konekt n''apparaissent jamais.';

-- Les default privileges du bootstrap donnent aussi INSERT/UPDATE/DELETE à
-- authenticated sur toute nouvelle vue (« TABLES » couvre les vues) : une vue
-- definer auto-updatable contournerait alors la RLS et les allowlists des RPC.
REVOKE ALL PRIVILEGES ON TABLE public.organization_integrations_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organization_integrations_public TO authenticated, service_role;

-- ─── 4. RPC : écriture d'un secret client ────────────────────────────────────
-- p_value NULL ou vide → efface la clé (primitive pour un futur « Retirer la
-- clé » ; le hook front n'appelle jamais la RPC avec une valeur vide).
CREATE OR REPLACE FUNCTION public.set_integration_secret(
  p_organization_id uuid,
  p_field text,
  p_value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL
     OR coalesce(public.get_org_role(v_uid, p_organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;
  -- Allowlist stricte : uniquement les clés saisies par le client.
  IF p_field IS NULL OR p_field NOT IN (
    'notion_api_key', 'calendly_api_key', 'airtable_api_key', 'aircall_api_token'
  ) THEN
    RAISE EXCEPTION 'Champ non autorisé' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organization_integrations (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  EXECUTE format(
    'UPDATE public.organization_integrations SET %I = $1 WHERE organization_id = $2',
    p_field
  ) USING v_value, p_organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_integration_secret(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_integration_secret(uuid, text, text) TO authenticated, service_role;

-- ─── 5. RPC : écriture des champs non secrets ────────────────────────────────
-- Seules les clés présentes dans p_updates sont modifiées. Clé inconnue → erreur
-- (jamais de secret ni de flag Konekt par ce chemin).
CREATE OR REPLACE FUNCTION public.update_integration_settings(
  p_organization_id uuid,
  p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_allowed text[] := ARRAY[
    'notion_postes_db_id', 'notion_candidats_db_id', 'notion_shortlist_db_id', 'notion_connected',
    'calendly_connected',
    'airtable_base_id', 'airtable_base_id_2', 'airtable_connected',
    'aircall_api_id', 'aircall_connected'
  ];
  v_bad     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF p_organization_id IS NULL
     OR coalesce(public.get_org_role(v_uid, p_organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs de l''organisation' USING ERRCODE = '42501';
  END IF;
  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'Paramètres invalides' USING ERRCODE = '22023';
  END IF;

  SELECT k INTO v_bad
  FROM jsonb_object_keys(p_updates) AS k
  WHERE k <> ALL (v_allowed)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Champ non autorisé : %', v_bad USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organization_integrations (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_integrations SET
    notion_postes_db_id    = CASE WHEN p_updates ? 'notion_postes_db_id'    THEN nullif(btrim(p_updates->>'notion_postes_db_id'), '')    ELSE notion_postes_db_id    END,
    notion_candidats_db_id = CASE WHEN p_updates ? 'notion_candidats_db_id' THEN nullif(btrim(p_updates->>'notion_candidats_db_id'), '') ELSE notion_candidats_db_id END,
    notion_shortlist_db_id = CASE WHEN p_updates ? 'notion_shortlist_db_id' THEN nullif(btrim(p_updates->>'notion_shortlist_db_id'), '') ELSE notion_shortlist_db_id END,
    notion_connected       = CASE WHEN p_updates ? 'notion_connected'       THEN coalesce((p_updates->>'notion_connected')::boolean, false)   ELSE notion_connected       END,
    calendly_connected     = CASE WHEN p_updates ? 'calendly_connected'     THEN coalesce((p_updates->>'calendly_connected')::boolean, false) ELSE calendly_connected     END,
    airtable_base_id       = CASE WHEN p_updates ? 'airtable_base_id'       THEN nullif(btrim(p_updates->>'airtable_base_id'), '')       ELSE airtable_base_id       END,
    airtable_base_id_2     = CASE WHEN p_updates ? 'airtable_base_id_2'     THEN nullif(btrim(p_updates->>'airtable_base_id_2'), '')     ELSE airtable_base_id_2     END,
    airtable_connected     = CASE WHEN p_updates ? 'airtable_connected'     THEN coalesce((p_updates->>'airtable_connected')::boolean, false) ELSE airtable_connected     END,
    aircall_api_id         = CASE WHEN p_updates ? 'aircall_api_id'         THEN nullif(btrim(p_updates->>'aircall_api_id'), '')         ELSE aircall_api_id         END,
    aircall_connected      = CASE WHEN p_updates ? 'aircall_connected'      THEN coalesce((p_updates->>'aircall_connected')::boolean, false)  ELSE aircall_connected      END
  WHERE organization_id = p_organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_integration_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_integration_settings(uuid, jsonb) TO authenticated, service_role;

-- ─── 6. Rappel : get_org_integration() (SELECT *) reste révoquée pour les rôles
-- clients (20260610120000 + 20260610140000). Re-affirmé ici pour le rejeu.
DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_org_integration'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', rec.sig);
  END LOOP;
END $$;

-- Recharge du cache de schéma PostgREST (nouvelle vue + RPC)
NOTIFY pgrst, 'reload schema';
