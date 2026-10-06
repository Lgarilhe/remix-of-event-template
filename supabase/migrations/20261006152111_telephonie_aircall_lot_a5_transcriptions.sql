-- ======================================================================
-- Téléphonie, lot A5 : transcriptions et analyse des appels.
--
-- Pourquoi. Aircall transcrit les appels (événement transcription.created) mais
-- n'envoie pas le texte : il faut le lire ensuite. Ce lot garde la transcription
-- d'un appel et son analyse (résumé, étiquettes, ce que le correspondant a dit,
-- suites à donner, lien avec la mission), pour qu'un recruteur retrouve ce qui
-- s'est dit sans réécouter.
--
--   1. phone_call_transcripts : le texte d'un appel, découpé par prise de parole.
--      Une ligne par appel. Lue par les membres de l'organisation active (comme
--      l'appel lui-même), jamais écrite par le navigateur.
--   2. phone_call_insights : l'analyse. Une ligne par appel, avec son état
--      (pending, analyzing, done, failed, skipped) : un appel trop court n'est
--      pas analysé, une organisation sans crédit voit l'analyse en attente.
--   3. record_phone_call_transcript : écrit la transcription et met l'analyse en
--      attente. Rejouable (Aircall rejoue un événement non acquitté). Clé de
--      service seulement.
--   4. claim_phone_call_analysis : prend l'analyse d'un appel pour un seul
--      traitement à la fois (deux événements rejoués ne la facturent pas deux
--      fois). Clé de service seulement.
--
-- Les deux tables suivent le sort de l'appel (ON DELETE CASCADE) : l'effacement
-- d'un appel efface sa transcription et son analyse.
--
-- Rejouable sur une base vide (règle 6 des migrations) : seuls phone_calls
-- (lot A1), organizations, sourcing_projects et get_user_org_id sont supposés.
-- ======================================================================

-- ---------------------------------------------------------------------
-- 1. phone_call_transcripts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_call_transcripts (
  call_id         uuid PRIMARY KEY REFERENCES public.phone_calls(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- [{ "who": "agent" | "contact" | "unknown", "start": secondes, "end": secondes, "text": "..." }]
  utterances      jsonb NOT NULL,
  char_count      integer NOT NULL DEFAULT 0,
  language        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_call_transcripts_utterances_check CHECK (jsonb_typeof(utterances) = 'array'),
  CONSTRAINT phone_call_transcripts_chars_check CHECK (char_count >= 0)
);

ALTER TABLE public.phone_call_transcripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phone_call_transcripts_org_select ON public.phone_call_transcripts;
CREATE POLICY phone_call_transcripts_org_select ON public.phone_call_transcripts
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
REVOKE ALL ON public.phone_call_transcripts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.phone_call_transcripts TO authenticated;
GRANT ALL ON public.phone_call_transcripts TO service_role;

-- ---------------------------------------------------------------------
-- 2. phone_call_insights
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_call_insights (
  call_id         uuid PRIMARY KEY REFERENCES public.phone_calls(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending',
  -- Code de la cause d'un échec ou d'un appel ignoré (too_short, insufficient_credits, unreadable, error).
  reason          text,
  summary         text,
  -- Étiquettes d'un vocabulaire fermé (_shared/phone-call-insight.ts), pour filtrer la liste des appels.
  tags            text[] NOT NULL DEFAULT '{}'::text[],
  -- Ce que le correspondant a dit : { availability, salary, location, remote, motivation, other_processes }.
  facts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ "action": "...", "owner": "recruiter" | "contact" | null, "when": "..." | null }]
  next_steps      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Mission dont l'appel parle clairement, parmi celles du candidat rapproché.
  mission_id      uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL,
  mission_fit     text,
  model           text,
  analyzed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_call_insights_status_check
    CHECK (status IN ('pending', 'analyzing', 'done', 'failed', 'skipped')),
  CONSTRAINT phone_call_insights_facts_check CHECK (jsonb_typeof(facts) = 'object'),
  CONSTRAINT phone_call_insights_steps_check CHECK (jsonb_typeof(next_steps) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_phone_call_insights_org_created
  ON public.phone_call_insights (organization_id, created_at DESC);

ALTER TABLE public.phone_call_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phone_call_insights_org_select ON public.phone_call_insights;
CREATE POLICY phone_call_insights_org_select ON public.phone_call_insights
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
REVOKE ALL ON public.phone_call_insights FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.phone_call_insights TO authenticated;
GRANT ALL ON public.phone_call_insights TO service_role;

-- ---------------------------------------------------------------------
-- 3. record_phone_call_transcript
--    Écrit (ou remplace) la transcription d'un appel et met l'analyse en
--    attente. Une analyse déjà faite ou en cours n'est pas relancée : un
--    événement rejoué ne la refacture pas. SECURITY INVOKER : l'organisation
--    est donnée par la fonction serveur, qui l'a retrouvée par le jeton du
--    webhook. Retourne { call_id, status }.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_phone_call_transcript(
  p_organization_id uuid,
  p_provider        text,
  p_external_id     text,
  p_utterances      jsonb,
  p_language        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_call_id uuid;
  v_chars   integer;
  v_status  text;
BEGIN
  IF p_organization_id IS NULL OR coalesce(p_external_id, '') = '' OR p_utterances IS NULL
     OR jsonb_typeof(p_utterances) <> 'array' THEN
    RAISE EXCEPTION 'Transcription incomplète' USING ERRCODE = '22023', HINT = 'PHONE_TRANSCRIPT_INVALID';
  END IF;

  SELECT pc.id INTO v_call_id
    FROM public.phone_calls pc
   WHERE pc.organization_id = p_organization_id
     AND pc.provider = p_provider
     AND pc.external_id = p_external_id;
  IF v_call_id IS NULL THEN
    RAISE EXCEPTION 'Appel introuvable' USING ERRCODE = 'P0002', HINT = 'PHONE_CALL_NOT_FOUND';
  END IF;

  SELECT coalesce(sum(length(coalesce(u->>'text', ''))), 0)::integer
    INTO v_chars
    FROM jsonb_array_elements(p_utterances) AS u;

  INSERT INTO public.phone_call_transcripts AS t (call_id, organization_id, utterances, char_count, language)
  VALUES (v_call_id, p_organization_id, p_utterances, v_chars, nullif(p_language, ''))
  ON CONFLICT (call_id) DO UPDATE SET
    utterances = EXCLUDED.utterances,
    char_count = EXCLUDED.char_count,
    language   = coalesce(EXCLUDED.language, t.language),
    updated_at = now();

  INSERT INTO public.phone_call_insights AS i (call_id, organization_id, status)
  VALUES (v_call_id, p_organization_id, 'pending')
  ON CONFLICT (call_id) DO UPDATE SET
    status     = 'pending',
    reason     = NULL,
    updated_at = now()
  WHERE i.status IN ('failed', 'skipped');

  SELECT i.status INTO v_status FROM public.phone_call_insights i WHERE i.call_id = v_call_id;
  RETURN jsonb_build_object('call_id', v_call_id, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.record_phone_call_transcript(uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_phone_call_transcript(uuid, text, text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------
-- 4. claim_phone_call_analysis
--    Prend l'analyse d'un appel : passe l'état à « analyzing » et rend vrai si
--    l'appelant est seul à la mener. Reprend une analyse restée « analyzing »
--    depuis plus de 5 minutes (traitement interrompu). `p_force` reprend aussi
--    une analyse terminée (« Analyser à nouveau »). Rend faux quand l'appel n'a
--    pas de transcription, ou quand une autre analyse est en cours.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_phone_call_analysis(
  p_organization_id uuid,
  p_call_id         uuid,
  p_force           boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_claimed uuid;
BEGIN
  IF p_organization_id IS NULL OR p_call_id IS NULL THEN
    RAISE EXCEPTION 'Appel incomplet' USING ERRCODE = '22023', HINT = 'PHONE_ANALYSIS_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.phone_call_transcripts t
     WHERE t.call_id = p_call_id AND t.organization_id = p_organization_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.phone_call_insights AS i (call_id, organization_id, status)
  VALUES (p_call_id, p_organization_id, 'analyzing')
  ON CONFLICT (call_id) DO UPDATE SET
    status     = 'analyzing',
    reason     = NULL,
    updated_at = now()
  WHERE i.organization_id = p_organization_id
    AND (
      i.status IN ('pending', 'failed', 'skipped')
      OR (i.status = 'analyzing' AND i.updated_at < now() - interval '5 minutes')
      OR (p_force AND i.status = 'done')
    )
  RETURNING i.call_id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_phone_call_analysis(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_phone_call_analysis(uuid, uuid, boolean) TO service_role;
