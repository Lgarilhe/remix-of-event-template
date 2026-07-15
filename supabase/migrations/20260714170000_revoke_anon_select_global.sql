-- ====================================================================
-- SECURITY FIX (audit équipe/rôles 2026-07-14, risque #3 élevé)
--
-- 20260421180000_grants_bootstrap_owner_uniques.sql a posé :
--   GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;            (l.15)
--   ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO anon;    (l.38)
-- → le rôle anon (clé publishable, sans session) a un SELECT de base
-- sur TOUTES les tables présentes et futures. Toute policy permissive
-- (sans clause TO) ou tout oubli d'ENABLE ROW LEVEL SECURITY devient
-- une exposition publique immédiate (amplificateur de la fuite
-- mission_invitations corrigée par 20260714120000).
--
-- Inventaire exhaustif des flux anonymes réels (2026-07-14) :
--   /r/:slug (RecruiterPublicProfile)  → SELECT direct sur profiles  ← SEUL besoin
--   /portal/:token (CandidatePortal)   → rpc get_portal_by_token (SECURITY DEFINER)
--   /client/:token (ClientPortalV2)    → edge function client-portal-data (service_role)
--   /unsubscribe                       → edge functions
--   / (landing)                        → INSERT contact_submissions (grant INSERT, non touché)
--   /marketplace (hunt)                → derrière ProtectedRoute = authenticated
--
-- On révoque donc le SELECT anon global et on ne re-grante que les
-- colonnes publiques de profiles (grant par colonnes : un `select *`
-- anon échoue, les colonnes sensibles restent inaccessibles — règle
-- aussi le risque « policy filtre les lignes, pas les colonnes »).
--
-- authenticated conserve son propre grant (20260421180000 l.14) :
-- aucun impact sur l'app connectée.
--
-- Idempotente, rejouable.
-- ====================================================================

-- 1. Révocation globale : tables existantes + futures
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;

-- 2. Re-grant minimal : colonnes publiques du profil recruteur
-- (exactement celles lues par RecruiterPublicProfile + public_slug pour
-- le filtre WHERE). Le filtrage des lignes reste assuré par la policy
-- "Anyone can read public recruiter profiles"
-- (public_slug IS NOT NULL AND recruiter_bio IS NOT NULL).
GRANT SELECT (
  public_slug,
  display_name,
  recruiter_bio,
  recruiter_headline,
  linkedin_url,
  linkedin_skills,
  years_experience,
  job_title,
  specializations,
  rating,
  placements_count,
  avg_time_to_fill_days,
  first_round_rate,
  mid_round_rate,
  intro_video_url,
  testimonials
) ON public.profiles TO anon;

-- 3. Missions hunt publiées : la policy était sans clause TO (= public),
-- mais l'unique consommateur (/marketplace) est derrière ProtectedRoute.
-- On documente l'intention réelle : authenticated uniquement.
DROP POLICY IF EXISTS "Public can view published hunt missions" ON public.sourcing_projects;
DROP POLICY IF EXISTS "Authenticated can view published hunt missions" ON public.sourcing_projects;
CREATE POLICY "Authenticated can view published hunt missions"
  ON public.sourcing_projects FOR SELECT TO authenticated
  USING (hunt_mode = true AND hunt_status = 'published');
