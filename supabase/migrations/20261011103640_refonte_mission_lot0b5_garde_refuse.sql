-- =====================================================================
-- Refonte mission, lot 0b-5 : la garde stage_write_guard passe de
-- l'observation au refus.
--
-- Fenêtre d'observation close : jcs_direct_write_log est resté à 0 ligne
-- depuis la pose de la garde (lot 0b-1, 28/09/2026) jusqu'au 11/10/2026, y
-- compris les 5 jours ouvrés qui suivent le déploiement des lots 0c-3 et
-- 0c-4 (04/10/2026), qui avaient changé les gestes du navigateur. Le
-- déclencheur était actif en prod à la lecture (tgenabled = O).
--
-- Effet : jcs_stage_write_mode() rend 'refuse'. Une écriture directe de
-- l'étape d'un candidat (jeton authenticated, service_role ou anon, ou SET
-- ROLE) qui change l'étape dérivée est refusée : erreur 42501, HINT
-- STAGE_DIRECT_WRITE. Les passages sans trace de la garde ne changent pas
-- (set_candidate_stage(s), apply_mission_candidate_stage, undo_candidate_stages,
-- insertion À trier, écriture qui laisse l'étape intacte, changement de
-- mission au couple intact, replace_process_steps, contextes sans jeton :
-- migration, psql, cron).
--
-- Seule la fonction de mode est redéfinie, avec la signature, les attributs
-- et les droits de 0b-1. La garde, le journal et le déclencheur ne changent
-- pas. Aucune ligne de job_candidate_status n'est écrite.
-- Rejouable (seconde application sans effet). Rejoue sur une base vide :
-- la fonction de mode est créée par 20260928235358, qui ne la rétrograde
-- jamais une fois le refus posé.
--
-- Arrêt d'urgence (refus qui bloque un écrivain légitime) :
--   1. Neutre et immédiat, sans fichier :
--        ALTER TABLE public.job_candidate_status DISABLE TRIGGER stage_write_guard;
--   2. Le jour même, un fichier de migration qui remet le mode voulu
--      (CREATE OR REPLACE FUNCTION public.jcs_stage_write_mode() rendant
--      'observe' ou 'off', droits et commentaire comme ci-dessous) ET
--      réactive le déclencheur :
--        ALTER TABLE public.job_candidate_status ENABLE TRIGGER stage_write_guard;
--      (règle 1 de CLAUDE.md : aucune modification de la base sans fichier ;
--      un db push ne réactive pas un déclencheur désactivé à la main).
--   3. Corriger l'écrivain fautif pour qu'il passe par set_candidate_stage,
--      puis reposer 'refuse' par un nouveau fichier. Le journal n'enregistre
--      plus rien en refus : l'écrivain se lit dans l'erreur (DETAIL) et dans
--      les journaux de l'API.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.jcs_stage_write_mode()
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $m$ SELECT 'refuse'::text $m$;

REVOKE ALL ON FUNCTION public.jcs_stage_write_mode() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.jcs_stage_write_mode() IS
  'Lot 0b : mode de la garde stage_write_guard (off, observe, refuse). Refus depuis le lot 0b-5 (11/10/2026). Arrêt d''urgence : DISABLE TRIGGER stage_write_guard, puis un fichier de migration (voir 20261011103640).';
