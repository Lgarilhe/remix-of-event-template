-- =====================================================================
-- Lot P, étape P-0b : garder les adresses de photo fraîches.
--
-- Les adresses de photo LinkedIn portent leur échéance dans le paramètre
-- `e=` (secondes Unix) et expirent au bout de quelques semaines. Une
-- recherche qui retrouve une personne déjà connue a sous la main une adresse
-- fraîche ; sans cette étape, elle n'était pas écrite (l'insertion ignore les
-- lignes existantes), et le visage du Pipeline revenait aux initiales.
--
-- refresh_candidate_pictures remplace l'adresse (petite et grande) dans
-- linkedin_profile_data des lignes de l'appelant, côté base, sans rien relire
-- ni réécrire d'autre du profil (fusion jsonb). Écrire le profil entier
-- depuis le navigateur perdrait les champs qu'une autre page y a ajoutés.
--
-- Règles tenues par candidate_picture_should_replace :
--   * la nouvelle adresse est en https sur licdn.com, 2 048 caractères au plus,
--     sans espace, et pas échue dans moins d'un jour ;
--   * l'adresse enregistrée manque, ou échoit dans moins de 3 jours ;
--   * la nouvelle échoit après l'ancienne (ou l'une des deux n'a pas d'échéance).
-- Une ligne dont l'adresse enregistrée est encore bonne n'est donc jamais
-- touchée : pas de mise à jour inutile (elle passerait par updated_at et par
-- l'ingestion pg_net).
--
-- Une ligne remplacée voit updated_at avancer (déclencheur
-- update_job_candidate_status_updated_at, inchangé) : c'est voulu.
-- claim_candidate_photos (20261005121536, copie privée des photos) relance une
-- copie « expirée », « en échec » ou « ignorée » quand updated_at de la ligne
-- dépasse son dernier contrôle, puis compare l'empreinte de l'adresse ; sans
-- cette avance, une adresse rafraîchie ne serait jamais recopiée. Coût connu :
-- « Dernière action » du /pipeline, « Mis à jour » du portail client et l'horloge
-- d'inactivité de rgpd_purge_candidate_rows avancent pour une ligne dont seule la
-- photo a changé. Le contrat est verrouillé par l'audit (contrôle B13).
--
-- Une ligne sans profil enregistré (linkedin_profile_data nul ou non objet)
-- n'est jamais touchée : un profil réduit à une photo la rendrait éligible à
-- la notation de fond (process-agent-tasks exige ce champ non nul) pour un
-- profil vide.
--
-- SECURITY INVOKER : la RLS de l'appelant dit quelles lignes il modifie ; le
-- filtre created_by = auth.uid() rend la portée explicite (ses propres
-- lignes, comme la lecture du hook useJobCandidateStatus). Aucune fonction
-- SECURITY DEFINER : l'audit rls_and_definer_audit.sql reste inchangé.
--
-- Rejoue sur base vide : ne dépend d'aucun objet hérité ; la table
-- job_candidate_status est lue par ses colonnes de base.
-- =====================================================================

-- 1. Échéance d'une adresse (paramètre e=), nulle si l'adresse n'en porte pas.
CREATE OR REPLACE FUNCTION public.candidate_picture_expiry(p_url text)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT to_timestamp((regexp_match(coalesce(p_url, ''), '[?&]e=([0-9]{1,10})(?:&|$)'))[1]::bigint)
$$;

-- 2. Adresse manquante, ou échue dans moins de p_margin. Sans échéance lisible :
--    jugée bonne (rien ne dit qu'elle expire, on ne la remplace pas).
CREATE OR REPLACE FUNCTION public.candidate_picture_is_stale(
  p_url text,
  p_margin interval DEFAULT interval '3 days')
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT p_url IS NULL
      OR p_url = ''
      OR coalesce(public.candidate_picture_expiry(p_url) < now() + p_margin, false)
$$;

-- 3. La règle de remplacement, une seule fois, pour la fonction et pour l'audit.
CREATE OR REPLACE FUNCTION public.candidate_picture_should_replace(p_new text, p_stored text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    p_new ~ '^https://([a-z0-9-]+\.)*licdn\.com/[^[:space:]]*$'
    AND length(p_new) <= 2048
    AND coalesce(public.candidate_picture_expiry(p_new) > now() + interval '1 day', true)
    AND public.candidate_picture_is_stale(p_stored)
    AND (public.candidate_picture_expiry(p_new) IS NULL
         OR public.candidate_picture_expiry(p_stored) IS NULL
         OR public.candidate_picture_expiry(p_new) > public.candidate_picture_expiry(p_stored)),
    false)
$$;

-- 4. Rafraîchissement par lot.
--    p_job_ids : les formes du job_id de la mission ("project:<uuid>" et "<uuid>"),
--                4 au plus.
--    p_items   : [{ "candidate_id": "...", "picture": "...", "picture_large": "..." }],
--                200 au plus (HINT PICTURE_BATCH_TOO_LARGE).
--    Rend le nombre de lignes modifiées.
CREATE OR REPLACE FUNCTION public.refresh_candidate_pictures(p_job_ids text[], p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'refresh_candidate_pictures : appel sans session'
      USING ERRCODE = '28000', HINT = 'PICTURE_AUTH_REQUIRED';
  END IF;
  IF p_job_ids IS NULL OR cardinality(p_job_ids) = 0 OR cardinality(p_job_ids) > 4 THEN
    RAISE EXCEPTION 'refresh_candidate_pictures : p_job_ids invalide'
      USING ERRCODE = '22023', HINT = 'PICTURE_JOBS_INVALID';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'refresh_candidate_pictures : p_items doit être un tableau'
      USING ERRCODE = '22023', HINT = 'PICTURE_ITEMS_INVALID';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'refresh_candidate_pictures : 200 profils au plus par appel'
      USING ERRCODE = '22023', HINT = 'PICTURE_BATCH_TOO_LARGE';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RETURN 0;
  END IF;

  -- Un candidat présent plusieurs fois : la première occurrence l'emporte.
  WITH items AS (
    SELECT DISTINCT ON (i.v->>'candidate_id')
           i.v->>'candidate_id'                  AS candidate_id,
           nullif(i.v->>'picture', '')           AS picture,
           nullif(i.v->>'picture_large', '')     AS picture_large
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS i(v, ord)
     WHERE jsonb_typeof(i.v) = 'object'
       AND coalesce(i.v->>'candidate_id', '') <> ''
     ORDER BY i.v->>'candidate_id', i.ord
  ),
  chosen AS (
    SELECT j.id,
           CASE WHEN public.candidate_picture_should_replace(
                       it.picture, j.linkedin_profile_data->>'profile_picture_url')
                THEN it.picture END AS picture,
           CASE WHEN public.candidate_picture_should_replace(
                       it.picture_large, j.linkedin_profile_data->>'profile_picture_url_large')
                THEN it.picture_large END AS picture_large
      FROM public.job_candidate_status j
      JOIN items it ON it.candidate_id = j.candidate_id
     WHERE j.job_id = ANY (p_job_ids)
       AND j.created_by = v_uid
       AND jsonb_typeof(j.linkedin_profile_data) = 'object'
  )
  UPDATE public.job_candidate_status j
     SET linkedin_profile_data = j.linkedin_profile_data
           || CASE WHEN c.picture IS NOT NULL
                   THEN jsonb_build_object('profile_picture_url', c.picture)
                   ELSE '{}'::jsonb END
           || CASE WHEN c.picture_large IS NOT NULL
                   THEN jsonb_build_object('profile_picture_url_large', c.picture_large)
                   ELSE '{}'::jsonb END
    FROM chosen c
   WHERE j.id = c.id
     AND (c.picture IS NOT NULL OR c.picture_large IS NOT NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 5. Droits : l'appelant est une personne connectée, jamais anon.
REVOKE ALL ON FUNCTION public.candidate_picture_expiry(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.candidate_picture_is_stale(text, interval) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.candidate_picture_should_replace(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refresh_candidate_pictures(text[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.candidate_picture_expiry(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.candidate_picture_is_stale(text, interval) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.candidate_picture_should_replace(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_candidate_pictures(text[], jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
