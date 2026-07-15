-- ============================================
-- Migration: increment_sequence_analytics — incrément atomique des compteurs
-- ============================================
--
-- PROBLÈME (audit 2026-07, Delivery M5 / Engine L5) : les compteurs de
-- sequence_analytics étaient alimentés soit par un upsert PostgREST
-- (`ON CONFLICT DO UPDATE SET replies_received = 1` → le compteur est REMIS
-- à 1 à partir du 2e événement du jour), soit par un read-then-write non
-- atomique (perte d'incréments en concurrence webhook/cron). Toutes les
-- stats de séquence étaient fausses dès plus d'un événement par jour.
--
-- SOLUTION : une RPC qui fait un vrai INSERT ... ON CONFLICT DO UPDATE
-- SET x = x + n, avec allowlist de colonnes (pas de SQL dynamique injectable).
--
-- SECURITY DEFINER : appelée uniquement par les edge functions (service role) ;
-- EXECUTE révoqué pour anon/authenticated par cohérence avec les autres
-- fonctions sensibles (20260610120000).
--
-- DÉCOUVERTE AGGRAVANTE (vérifiée en prod le 2026-07-15) : la contrainte
-- UNIQUE(sequence_id, date) déclarée par 20260128180401 n'existe PAS sur la
-- table de prod (schéma réimporté sans elle lors de la migration Lovable →
-- Supabase). Conséquence : les upserts PostgREST `onConflict: sequence_id,date`
-- échouaient en 42P10 — les analytics webhook n'étaient jamais écrites du
-- tout. On (re)pose la contrainte ici, avec dédoublonnage préalable par
-- sécurité (agrégation des compteurs).
--
-- Idempotente — réexécutable sans danger.
-- ============================================

-- ─── 0a. Dédoublonnage préalable (aucun doublon en prod au moment d'écrire
--         ceci, mais on agrège par sécurité pour rendre la migration sûre) ───
WITH dupes AS (
  SELECT sequence_id, date,
         min(id::text)::uuid AS keep_id,
         sum(invites_sent) AS s_invites_sent,
         sum(invites_accepted) AS s_invites_accepted,
         sum(messages_sent) AS s_messages_sent,
         sum(replies_received) AS s_replies_received,
         sum(profile_visits) AS s_profile_visits,
         count(*) AS n
  FROM public.sequence_analytics
  GROUP BY sequence_id, date
  HAVING count(*) > 1
)
UPDATE public.sequence_analytics a
SET invites_sent = d.s_invites_sent,
    invites_accepted = d.s_invites_accepted,
    messages_sent = d.s_messages_sent,
    replies_received = d.s_replies_received,
    profile_visits = d.s_profile_visits
FROM dupes d
WHERE a.id = d.keep_id;

DELETE FROM public.sequence_analytics a
USING (
  SELECT sequence_id, date, min(id::text)::uuid AS keep_id
  FROM public.sequence_analytics
  GROUP BY sequence_id, date
  HAVING count(*) > 1
) d
WHERE a.sequence_id = d.sequence_id AND a.date = d.date AND a.id <> d.keep_id;

-- ─── 0b. (Re)poser la contrainte UNIQUE requise par ON CONFLICT ─────────────
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sequence_analytics'::regclass
      AND conname = 'sequence_analytics_sequence_id_date_key'
  ) THEN
    ALTER TABLE public.sequence_analytics
      ADD CONSTRAINT sequence_analytics_sequence_id_date_key UNIQUE (sequence_id, date);
  END IF;
END;
$do$;

CREATE OR REPLACE FUNCTION public.increment_sequence_analytics(
  p_sequence_id uuid,
  p_field text,
  p_increment integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_field NOT IN ('invites_sent', 'invites_accepted', 'messages_sent', 'replies_received', 'profile_visits') THEN
    RAISE EXCEPTION 'increment_sequence_analytics: unknown field %', p_field;
  END IF;
  IF p_sequence_id IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'INSERT INTO public.sequence_analytics (sequence_id, date, %I) VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (sequence_id, date) DO UPDATE SET %I = sequence_analytics.%I + $2',
    p_field, p_field, p_field
  ) USING p_sequence_id, GREATEST(p_increment, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_sequence_analytics(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_sequence_analytics(uuid, text, integer) TO service_role;
