-- Design simplifié, lot P : copie privée des photos des candidats.
--
-- Les visages des candidats viennent du lien de photo LinkedIn enregistré dans
-- job_candidate_status.linkedin_profile_data (profile_picture_url, sinon
-- profile_picture_url_large). LinkedIn signe ces liens et les fait expirer :
-- sans copie, les visages redeviennent des initiales. Décision du propriétaire
-- (docs/design/06-simplicite.md) : Konekt garde une petite copie privée,
-- supprimée avec le candidat.
--
-- 1. Bucket privé candidate-photos : {organization_id}/{empreinte du candidat}.{ext},
--    200 ko au plus, JPEG, PNG ou WebP. Lecture (signature) par les membres de
--    l'organisation du dossier ; écriture et suppression par la clé de service
--    seulement (tâche capture-candidate-photos, effacement RGPD).
-- 2. Table candidate_photos : une ligne par (organisation, candidat), son état et
--    le chemin de la copie. Lecture par les membres de l'organisation.
-- 3. claim_candidate_photos : réclame les candidats dont la photo reste à copier.
-- 4. list_candidate_photo_orphans : copies de candidats sortis du pipeline de
--    l'organisation (supprimés à la main ou par la purge), à supprimer.
-- 5. Tâche planifiée toutes les deux minutes (pg_cron, ignorée sans pg_cron).
--
-- Rejouable, sur base neuve comme en production.

-- ─── 1. Bucket privé ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('candidate-photos', 'candidate-photos', false, 204800,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Le premier dossier est comparé en texte, comme org-logos : un cast ::uuid
-- lèverait sur un chemin quelconque. Aucune policy d'écriture : seule la clé de
-- service, qui ignore la RLS, écrit et supprime.
DROP POLICY IF EXISTS candidate_photos_bucket_members_select ON storage.objects;
CREATE POLICY candidate_photos_bucket_members_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'candidate-photos'
    AND (storage.foldername(name))[1] IN (
      SELECT m.organization_id::text FROM public.organization_members m
      WHERE m.user_id = auth.uid()
    )
  );

-- ─── 2. Table candidate_photos ──────────────────────────────────────────────
-- status :
--   pending  réclamée par la tâche, copie en cours ;
--   stored   copie enregistrée (storage_path) ;
--   expired  lien refusé par LinkedIn (403, 404, 410), repris si le lien change ;
--   failed   autre échec, trois essais à une heure d'écart, repris si le lien change ;
--   skipped  lien refusé avant téléchargement (hôte, taille, format), repris si le lien change ;
--   erased   candidat effacé (RGPD) : plus jamais copié, la ligne reste comme marqueur.
CREATE TABLE IF NOT EXISTS public.candidate_photos (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id text NOT NULL CHECK (char_length(candidate_id) BETWEEN 1 AND 512),
  status text NOT NULL CHECK (status IN ('pending', 'stored', 'expired', 'failed', 'skipped', 'erased')),
  storage_path text,
  source_url_hash text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  captured_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, candidate_id),
  CONSTRAINT candidate_photos_path_iff_stored CHECK ((status = 'stored') = (storage_path IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS candidate_photos_candidate_idx ON public.candidate_photos (candidate_id);

ALTER TABLE public.candidate_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidate_photos_members_select ON public.candidate_photos;
CREATE POLICY candidate_photos_members_select ON public.candidate_photos
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT m.organization_id FROM public.organization_members m
      WHERE m.user_id = auth.uid()
    )
  );

-- Rien pour anon, lecture seule pour authenticated (la RLS borne les lignes),
-- tout pour la clé de service.
REVOKE ALL ON public.candidate_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.candidate_photos TO authenticated;
GRANT ALL ON public.candidate_photos TO service_role;

COMMENT ON TABLE public.candidate_photos IS
  'Lot P : copie privée de la photo LinkedIn d''un candidat, par organisation (bucket candidate-photos). Écrite par capture-candidate-photos et l''effacement RGPD, jamais par le navigateur.';

-- ─── 3. Candidats dont la photo reste à copier ─────────────────────────────
-- Un candidat par (organisation, candidate_id), avec le lien de sa ligne la plus
-- récente. Le profil LinkedIn (linkedin_profile_data, souvent plusieurs ko) n'est
-- lu que pour les candidats examinés, quatre fois la limite au plus par passage :
-- jamais vus ; « pending » abandonné depuis 15 minutes ; « failed » de moins de
-- trois essais, une heure après le dernier ; « expired », « failed » ou
-- « skipped » dont la ligne a changé depuis le dernier examen. Jamais « stored »
-- ni « erased ».
-- Chaque candidat examiné est écrit : réclamé (« pending », jusqu'à la limite),
-- sans lien http (« skipped », no_url), ou lien inchangé (seul checked_at avance :
-- il n'est plus relu avant le prochain changement de sa ligne). Un lien changé
-- remet les essais à zéro. Le verrou consultatif évite que deux exécutions
-- réclament les mêmes lignes.
CREATE OR REPLACE FUNCTION public.claim_candidate_photos(p_limit integer DEFAULT 25)
RETURNS TABLE (organization_id uuid, candidate_id text, picture_url text, linkedin_profile_url text, attempts integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('public.claim_candidate_photos')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH latest AS (
    -- Colonnes légères seulement : aucun profil lu ici.
    SELECT DISTINCT ON (j.organization_id, j.candidate_id)
           j.id AS row_id,
           j.organization_id AS org_id,
           j.candidate_id AS cand_id,
           j.updated_at AS row_updated_at
      FROM public.job_candidate_status j
     WHERE j.organization_id IS NOT NULL
       AND j.candidate_id IS NOT NULL
       AND char_length(j.candidate_id) BETWEEN 1 AND 512
     ORDER BY j.organization_id, j.candidate_id, j.updated_at DESC NULLS LAST, j.id
  ), examined AS MATERIALIZED (
    SELECT l.row_id, l.org_id, l.cand_id,
           p.status AS old_status,
           p.source_url_hash AS old_hash,
           (p.candidate_id IS NULL
             OR (p.status = 'pending' AND p.checked_at < now() - interval '15 minutes')
             OR (p.status = 'failed' AND p.attempts < 3 AND p.checked_at < now() - interval '1 hour')) AS due
      FROM latest l
      LEFT JOIN public.candidate_photos p
        ON p.organization_id = l.org_id AND p.candidate_id = l.cand_id
     WHERE p.candidate_id IS NULL
        OR (p.status = 'pending' AND p.checked_at < now() - interval '15 minutes')
        OR (p.status = 'failed' AND p.attempts < 3 AND p.checked_at < now() - interval '1 hour')
        OR (p.status IN ('expired', 'failed', 'skipped') AND l.row_updated_at > p.checked_at)
     ORDER BY (p.candidate_id IS NULL) DESC, l.org_id, l.cand_id
     LIMIT v_limit * 4
  ), read AS (
    SELECT e.*, x.url, x.url_hash, j.linkedin_profile_url AS profile_url,
           (x.url_hash IS NOT NULL AND (e.due OR e.old_hash IS DISTINCT FROM x.url_hash)) AS claimable
      FROM examined e
      JOIN public.job_candidate_status j ON j.id = e.row_id
      CROSS JOIN LATERAL (
        SELECT u.url,
               CASE WHEN u.url LIKE 'http%' THEN encode(sha256(convert_to(u.url, 'UTF8')), 'hex') END AS url_hash
          FROM (SELECT COALESCE(NULLIF(j.linkedin_profile_data->>'profile_picture_url', ''),
                                NULLIF(j.linkedin_profile_data->>'profile_picture_url_large', '')) AS url) u
      ) x
  ), decided AS (
    SELECT r.*,
           CASE
             WHEN r.claimable THEN 'pending'
             WHEN r.url_hash IS NULL THEN 'skipped'
             ELSE r.old_status
           END AS next_status
      FROM (
        SELECT rd.*, row_number() OVER (PARTITION BY rd.claimable ORDER BY rd.org_id, rd.cand_id) AS claim_rank
          FROM read rd
      ) r
     -- Au-delà de la limite, un candidat à réclamer n'est pas écrit : il sera
     -- examiné de nouveau au passage suivant.
     WHERE NOT r.claimable OR r.claim_rank <= v_limit
  ), written AS (
    INSERT INTO public.candidate_photos AS c
           (organization_id, candidate_id, status, source_url_hash, attempts, last_error, checked_at)
    SELECT d.org_id, d.cand_id, d.next_status, d.url_hash, 0,
           CASE WHEN d.url_hash IS NULL THEN 'no_url' END, now()
      FROM decided d
    ON CONFLICT ON CONSTRAINT candidate_photos_pkey DO UPDATE
      SET status = EXCLUDED.status,
          checked_at = now(),
          attempts = CASE WHEN c.source_url_hash IS DISTINCT FROM EXCLUDED.source_url_hash THEN 0 ELSE c.attempts END,
          source_url_hash = EXCLUDED.source_url_hash,
          last_error = coalesce(EXCLUDED.last_error, c.last_error)
      WHERE c.status IN ('pending', 'expired', 'failed', 'skipped')
    RETURNING c.organization_id, c.candidate_id, c.status, c.attempts
  )
  SELECT d.org_id, d.cand_id, d.url, d.profile_url, w.attempts
    FROM decided d
    JOIN written w ON w.organization_id = d.org_id AND w.candidate_id = d.cand_id
   WHERE w.status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_candidate_photos(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_candidate_photos(integer) TO service_role;

-- ─── 4. Copies de candidats sortis du pipeline de l'organisation ───────────
-- Plus aucune ligne job_candidate_status pour (organisation, candidat) : la ligne
-- a été supprimée à la main ou par la purge RGPD. La tâche supprime le fichier
-- puis la ligne. « pending » (copie en cours) et « erased » (marqueur) restent.
CREATE OR REPLACE FUNCTION public.list_candidate_photo_orphans(p_limit integer DEFAULT 50)
RETURNS TABLE (organization_id uuid, candidate_id text, storage_path text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT p.organization_id, p.candidate_id, p.storage_path
    FROM public.candidate_photos p
   WHERE p.status NOT IN ('pending', 'erased')
     AND NOT EXISTS (
       SELECT 1 FROM public.job_candidate_status j
        WHERE j.organization_id = p.organization_id
          AND j.candidate_id = p.candidate_id
     )
   ORDER BY p.checked_at
   LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.list_candidate_photo_orphans(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_candidate_photo_orphans(integer) TO service_role;

-- ─── 5. Tâche planifiée ─────────────────────────────────────────────────────
-- Même forme que invoke_process_agent_tasks : secret partagé et adresse des
-- fonctions lus dans internal_config.
CREATE OR REPLACE FUNCTION public.invoke_capture_candidate_photos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secret text;
  v_url text;
BEGIN
  SELECT value INTO v_secret FROM internal_config WHERE key = 'process_sequences_secret';
  SELECT value INTO v_url FROM internal_config WHERE key = 'supabase_functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    RAISE WARNING 'Missing internal_config — skipping capture-candidate-photos invocation';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/capture-candidate-photos',
    headers := json_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )::jsonb,
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_capture_candidate_photos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_capture_candidate_photos() TO service_role;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('capture-candidate-photos');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'capture-candidate-photos',
      '*/2 * * * *',
      $cmd$SELECT public.invoke_capture_candidate_photos();$cmd$
    );
  END IF;
END
$cron$;

-- ─── 6. Contrôle final : l'état attendu, sinon la migration échoue ─────────
DO $check$
DECLARE
  n integer;
  pr text;
  fn text;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'candidate_photos';
  IF n <> 1 THEN
    RAISE EXCEPTION 'candidate_photos : % policies (attendu : 1)', n;
  END IF;
  FOREACH pr IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('anon', 'public.candidate_photos', pr) THEN
      RAISE EXCEPTION 'candidate_photos : anon a le droit %', pr;
    END IF;
  END LOOP;
  FOREACH pr IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege('authenticated', 'public.candidate_photos', pr) THEN
      RAISE EXCEPTION 'candidate_photos : authenticated a le droit %', pr;
    END IF;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[
    'public.claim_candidate_photos(integer)',
    'public.list_candidate_photo_orphans(integer)',
    'public.invoke_capture_candidate_photos()'
  ] LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% : exécutable par anon ou authenticated', fn;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'candidate-photos' AND public) THEN
    RAISE EXCEPTION 'candidate-photos : bucket public';
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';
