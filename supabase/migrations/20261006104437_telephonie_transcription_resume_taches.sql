-- ======================================================================
-- Téléphonie : transcription d'un appel, résumé et tâches proposées.
--
-- Une fois l'appel terminé, Aircall (module « AI Assist ») prépare une
-- transcription. La fonction phone-call-insights la récupère, la garde, en
-- tire un résumé et des propositions de tâches avec l'IA Konekt. Deux tables,
-- toutes deux filles de phone_calls (un appel effacé les emporte) :
--
--   1. phone_call_insights : une ligne par appel. Transcription (liste de
--      répliques), résumé, état du traitement. Lue par les membres de
--      l'organisation, écrite par la clé de service seulement.
--   2. phone_call_task_suggestions : les tâches que l'IA propose après lecture
--      de l'appel. La personne les accepte ou les ignore : c'est la seule
--      écriture permise au navigateur, limitée à l'état (proposée vers
--      acceptée ou ignorée, jamais l'inverse), au lien vers la tâche créée et à
--      l'horodatage. Le titre et le motif restent ceux de l'IA.
--
-- La tâche créée par « Créer la tâche » est une ligne de candidate_reminders,
-- écrite par le navigateur comme pour toute tâche (policies existantes).
--
-- Rejouable sur une base vide (règle 6 des migrations) : phone_calls vient de
-- la migration 20261005172938, organizations et get_user_org_id d'avant.
-- ======================================================================

-- ---------------------------------------------------------------------
-- 1. phone_call_insights
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_call_insights (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_call_id      uuid NOT NULL REFERENCES public.phone_calls(id) ON DELETE CASCADE,
  -- pending : ligne créée, rien d'obtenu ; transcribed : transcription gardée,
  -- pas de résumé ; ready : traitement terminé (résumé, ou appel trop court) ;
  -- unavailable : Aircall n'a pas de transcription (module absent, appel non
  -- enregistré ou pas prête) ; failed : erreur technique, à relancer.
  status             text NOT NULL DEFAULT 'pending',
  -- Répliques : [{ "speaker": "agent" | "contact", "text": "...", "start": 12.5 }]
  transcript         jsonb,
  language           text,
  summary            text,
  -- Raison courte d'un état sans résumé : too_short, credits, no_credentials,
  -- unavailable, format, llm, aircall_error. Jamais de texte de la conversation.
  error_code         text,
  -- Début de la dernière génération du résumé : verrou doux contre deux
  -- traitements simultanés du même appel (événement Aircall rejoué).
  summary_started_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_call_insights_call_key UNIQUE (phone_call_id),
  CONSTRAINT phone_call_insights_status_check
    CHECK (status IN ('pending', 'transcribed', 'ready', 'unavailable', 'failed')),
  CONSTRAINT phone_call_insights_transcript_check
    CHECK (transcript IS NULL OR jsonb_typeof(transcript) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_phone_call_insights_org
  ON public.phone_call_insights (organization_id);

ALTER TABLE public.phone_call_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phone_call_insights_org_select ON public.phone_call_insights;
CREATE POLICY phone_call_insights_org_select ON public.phone_call_insights
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
-- Privilèges par défaut du schéma retirés : lecture seule pour authenticated.
REVOKE ALL ON public.phone_call_insights FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.phone_call_insights TO authenticated;
GRANT ALL ON public.phone_call_insights TO service_role;

-- ---------------------------------------------------------------------
-- 2. phone_call_task_suggestions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_call_task_suggestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_call_id   uuid NOT NULL REFERENCES public.phone_calls(id) ON DELETE CASCADE,
  title           text NOT NULL,
  -- Pourquoi l'IA la propose : une phrase tirée de l'appel.
  reason          text,
  -- Échéance proposée, en jours à partir de la création de la tâche.
  due_in_days     integer NOT NULL DEFAULT 2,
  state           text NOT NULL DEFAULT 'proposed',
  -- Tâche créée quand la suggestion est acceptée (candidate_reminders).
  reminder_id     uuid REFERENCES public.candidate_reminders(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CONSTRAINT phone_call_task_suggestions_title_check CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT phone_call_task_suggestions_due_check CHECK (due_in_days BETWEEN 0 AND 60),
  CONSTRAINT phone_call_task_suggestions_state_check CHECK (state IN ('proposed', 'accepted', 'dismissed'))
);
CREATE INDEX IF NOT EXISTS idx_phone_call_task_suggestions_call
  ON public.phone_call_task_suggestions (phone_call_id);
CREATE INDEX IF NOT EXISTS idx_phone_call_task_suggestions_org_state
  ON public.phone_call_task_suggestions (organization_id, state);

ALTER TABLE public.phone_call_task_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS phone_call_task_suggestions_org_select ON public.phone_call_task_suggestions;
CREATE POLICY phone_call_task_suggestions_org_select ON public.phone_call_task_suggestions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
-- Une suggestion proposée devient acceptée ou ignorée, une seule fois :
-- USING ne laisse modifier que les lignes encore proposées, WITH CHECK refuse
-- de les laisser proposées ou de changer d'organisation.
DROP POLICY IF EXISTS phone_call_task_suggestions_org_resolve ON public.phone_call_task_suggestions;
CREATE POLICY phone_call_task_suggestions_org_resolve ON public.phone_call_task_suggestions
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND state = 'proposed')
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND state IN ('accepted', 'dismissed'));
REVOKE ALL ON public.phone_call_task_suggestions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.phone_call_task_suggestions TO authenticated;
-- Trois colonnes seulement : le titre, le motif et l'échéance restent ceux de l'IA.
GRANT UPDATE (state, reminder_id, resolved_at) ON public.phone_call_task_suggestions TO authenticated;
GRANT ALL ON public.phone_call_task_suggestions TO service_role;
