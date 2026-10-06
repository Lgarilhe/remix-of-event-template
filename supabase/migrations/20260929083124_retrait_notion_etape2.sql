-- ============================================================================
-- Retrait de Notion, étape 2 (décision 16 du 28/09) : les colonnes et la table
-- de l'ancienne synchronisation Notion par clé API.
-- Fichier : supabase/migrations/20260929083124_retrait_notion_etape2.sql
--
-- L'étape 1 (2026-09-28) a retiré le code ; process-sequences, calendly-webhook
-- et la carte « Notion par clé » des Paramètres suivent dans le même lot que
-- cette migration. Plus rien ne lit ni n'écrit ces colonnes.
--
-- Contenu :
--   1. Vue organization_integrations_public recréée sans les colonnes notion_*
--      (mêmes options, même filtre owner/admin, mêmes droits qu'en
--      20260906085151). Avant le retrait des colonnes : la vue en dépend.
--   2. set_integration_secret et update_integration_settings sans les champs
--      Notion (mêmes signatures, SECURITY DEFINER, search_path et droits). Un
--      champ Notion reçu est refusé comme tout champ inconnu (22023, « Champ
--      non autorisé »).
--   3. Index et colonnes notion_* de job_candidate_status,
--      organization_integrations et qualification_sessions.
--   4. Table notion_api_cache (import Lovable, prod seulement : aucune
--      migration ne la crée), sous garde to_regclass.
--
-- Hors champ, intacte : la connexion Notion de l'assistant
-- (organization_notion_connections, notion_oauth_states,
-- notion_mcp_oauth_clients, claim_notion_token_refresh).
--
-- Rejoue sur une base vide (reconstruction par les migrations) comme sur la
-- prod (MIGRATION_CLEAN.sql puis migrations). Idempotente : une seconde
-- application ne change rien et ne lève aucune erreur.
-- ============================================================================

-- ─── 1. Vue de lecture publique, sans Notion ────────────────────────────────
-- DROP + CREATE : la liste des colonnes change (CREATE OR REPLACE VIEW ne
-- retire pas de colonne).
DROP VIEW IF EXISTS public.organization_integrations_public;
CREATE VIEW public.organization_integrations_public
WITH (security_barrier = true) AS
SELECT
  oi.id,
  oi.organization_id,
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
  public.mask_integration_secret(oi.calendly_api_key)  AS calendly_api_key_hint,
  public.mask_integration_secret(oi.airtable_api_key)  AS airtable_api_key_hint,
  public.mask_integration_secret(oi.aircall_api_token) AS aircall_api_token_hint
FROM public.organization_integrations oi
WHERE auth.uid() IS NOT NULL
  AND public.get_org_role(auth.uid(), oi.organization_id) IN ('owner', 'admin');

COMMENT ON VIEW public.organization_integrations_public IS
  'Projection sans secret de organization_integrations (owner/admin de l''org). Les clés client n''apparaissent que sous forme de suffixe masqué ; les clés Konekt n''apparaissent jamais.';

-- Les default privileges du bootstrap donnent INSERT/UPDATE/DELETE à
-- authenticated sur toute nouvelle vue : même retrait qu'en 20260906085151.
REVOKE ALL PRIVILEGES ON TABLE public.organization_integrations_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.organization_integrations_public TO authenticated, service_role;

-- ─── 2a. RPC : écriture d'un secret client, sans Notion ─────────────────────
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
    'calendly_api_key', 'airtable_api_key', 'aircall_api_token'
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

-- ─── 2b. RPC : écriture des champs non secrets, sans Notion ─────────────────
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

-- ─── 3. Index et colonnes de l'ancienne synchronisation ─────────────────────
DROP INDEX IF EXISTS public.idx_jcs_notion_candidate_id;
DROP INDEX IF EXISTS public.idx_jcs_notion_shortlist_id;

ALTER TABLE public.job_candidate_status
  DROP COLUMN IF EXISTS notion_candidate_id,
  DROP COLUMN IF EXISTS notion_shortlist_id,
  DROP COLUMN IF EXISTS notion_synced_at;

ALTER TABLE public.organization_integrations
  DROP COLUMN IF EXISTS notion_api_key,
  DROP COLUMN IF EXISTS notion_candidats_db_id,
  DROP COLUMN IF EXISTS notion_connected,
  DROP COLUMN IF EXISTS notion_postes_db_id,
  DROP COLUMN IF EXISTS notion_shortlist_db_id;

ALTER TABLE public.qualification_sessions
  DROP COLUMN IF EXISTS notion_candidate_id,
  DROP COLUMN IF EXISTS notion_shortlist_id,
  DROP COLUMN IF EXISTS notion_synced_at;

-- ─── 4. Cache de l'import Lovable (prod seulement) ──────────────────────────
DO $notion_cache$
BEGIN
  IF to_regclass('public.notion_api_cache') IS NOT NULL THEN
    DROP TABLE public.notion_api_cache;
  END IF;
END
$notion_cache$;

-- Recharge du cache de schéma PostgREST (vue et colonnes retirées).
NOTIFY pgrst, 'reload schema';
