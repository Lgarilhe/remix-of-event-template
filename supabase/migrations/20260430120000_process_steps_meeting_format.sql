-- Migration : ajoute les paramètres de format d'entretien aux étapes de process.
--
-- Permet à chaque étape du process recruteur de définir :
--   - meeting_format : 'video' | 'phone' | 'onsite' (default 'video')
--   - meeting_provider : 'teams' | 'zoom' | 'google_meet' | 'other' (nullable)
--   - meeting_link : URL personnalisée ou template (nullable)
--   - location_address : adresse physique pour les entretiens présentiel (nullable)
--
-- Ces fields conditionnent ensuite les invitations envoyées aux candidats :
-- une étape "video / zoom" enverra automatiquement un lien Zoom dans
-- l'event Calendar du candidat, etc.
--
-- Idempotente — peut être rejouée sans erreur.

ALTER TABLE public.mission_process_steps
  ADD COLUMN IF NOT EXISTS meeting_format text
    CHECK (meeting_format IN ('video', 'phone', 'onsite'))
    DEFAULT 'video';

ALTER TABLE public.mission_process_steps
  ADD COLUMN IF NOT EXISTS meeting_provider text
    CHECK (meeting_provider IS NULL OR meeting_provider IN ('teams', 'zoom', 'google_meet', 'other'));

ALTER TABLE public.mission_process_steps
  ADD COLUMN IF NOT EXISTS meeting_link text;

ALTER TABLE public.mission_process_steps
  ADD COLUMN IF NOT EXISTS location_address text;

-- Comment pour la doc / pgAdmin
COMMENT ON COLUMN public.mission_process_steps.meeting_format IS
  'Format de l''entretien : video (visioconférence), phone (téléphonique) ou onsite (présentiel).';
COMMENT ON COLUMN public.mission_process_steps.meeting_provider IS
  'Provider visio (uniquement quand meeting_format = ''video'') : teams, zoom, google_meet, other.';
COMMENT ON COLUMN public.mission_process_steps.meeting_link IS
  'Lien meeting personnalisé ou template (utilisé quand meeting_provider = ''other'' ou pour un lien fixe).';
COMMENT ON COLUMN public.mission_process_steps.location_address IS
  'Adresse physique de l''entretien (uniquement quand meeting_format = ''onsite'').';
