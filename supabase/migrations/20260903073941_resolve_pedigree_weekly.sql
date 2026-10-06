-- Résolution des IDs LinkedIn de l'annuaire pedigree : hebdomadaire au lieu
-- de mensuelle. Le batch est plafonné à ~200 entrées/run (limite de temps de
-- l'edge function) ; en mensuel, les nouvelles sociétés financées ajoutées par
-- le cron refresh (le 1er à 3h) pouvaient rester inutilisables des semaines
-- pour la surcouche « A levé » (IDs slug non résolus → rejetés).
-- Déjà appliqué à chaud en prod le 2026-07-16 — idempotent.
-- Fichier renommé le 2026-09-03 : sa version initiale 20260716130000 était en
-- doublon avec harden_member_email_account_writes (DET-001), ce qui bloquait
-- `supabase db push`. Le rejeu est sans effet (cron.alter_job sur le même horaire).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'resolve-pedigree-directory-monthly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := v_jobid, schedule := '0 4 * * 1');
  END IF;
END $$;
