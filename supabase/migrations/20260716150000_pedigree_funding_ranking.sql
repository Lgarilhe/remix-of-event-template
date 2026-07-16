-- Critère de classement réel pour la surcouche « A levé » : date de la
-- dernière levée (les boîtes qui viennent de lever recrutent activement)
-- + effectif estimé (plus de candidats par slot d'injection).
-- Avant : l'ordre « top 100 » retombait sur l'alphabétique (tier identique
-- au sein d'un même stade). Rempli par refresh-pedigree-by-funding-stage.
-- Déjà appliqué à chaud en prod le 2026-07-16 — idempotent.
ALTER TABLE pedigree_company_directory
  ADD COLUMN IF NOT EXISTS latest_funding_date date,
  ADD COLUMN IF NOT EXISTS headcount integer,
  -- Croissance d'effectifs 6 mois : SEUL signal de dynamique présent dans
  -- les résultats de recherche du fournisseur (date de levée et effectif
  -- absolu sont réservés à l'enrichissement payant). C'est le critère de
  -- classement du « top » : boîte qui grossit = boîte qui recrute.
  ADD COLUMN IF NOT EXISTS headcount_growth_6m real;
