-- Idempotence des webhooks Stripe (achats de packs de crédits).
--
-- credit_purchases.stripe_session_id devient la clé d'unicité. Couplé au pattern
-- insert-first du webhook `stripe-webhook`, un event Stripe rejoué (retry après
-- timeout / redelivery) viole l'unicité (SQLSTATE 23505) et fait sauter le crédit
-- au lieu de le doubler.
--
-- Index PARTIEL (WHERE stripe_session_id IS NOT NULL) : ne contraint que les
-- achats portant réellement une session Stripe, et tolère d'éventuelles lignes
-- historiques sans session. Table vérifiée VIDE au 2026-07-15 → aucun conflit à
-- l'application. Idempotent (IF NOT EXISTS), rejouable.
CREATE UNIQUE INDEX IF NOT EXISTS credit_purchases_stripe_session_id_key
  ON public.credit_purchases (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
