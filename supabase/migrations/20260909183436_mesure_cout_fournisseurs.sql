-- Mesure du coût fournisseur : refermer l'angle mort du suivi de marge.
--
-- Constat de l'audit tarifaire du 2026-09-09 : les actions qui appellent un
-- fournisseur externe enregistrent un coût de zéro. calculateUSDCost part des
-- jetons, et ces actions n'en consomment aucun. Quatre actions sont concernées
-- (enrich_contact_email, enrich_contact_phone, coresignal_preview,
-- coresignal_collect ; web_search porte déjà son coût réel). Vérifié en
-- production : 44 crédits de fiches complètes, 29 d'aperçus et 10 de mobile,
-- tous à 0,0000 $.
--
-- Cette migration traite la moitié Base Konekt, où c'est la QUANTITÉ qui
-- manque. Le catalogue suppose deux crédits fournisseur par recherche ; la
-- documentation publique du point multi-source en annonce vingt. Personne n'a
-- mesuré, et les seuls appels de production datent du 8 juillet, hors de toute
-- fenêtre de journaux. La réponse HTTP porte pourtant le solde restant à chaque
-- appel : il suffit de l'écrire. base_konekt_usage garde désormais ce solde et
-- l'instant du relevé, et l'écart entre deux lignes donne la consommation
-- réelle, sans rien supposer du contrat.
--
-- La moitié enrichissement est traitée côté fonction edge : la quantité y est
-- déjà connue (le fournisseur renvoie les crédits débités à chaque demande),
-- seul le prix unitaire manquait.
--
-- Idempotente, rejouable.

ALTER TABLE public.base_konekt_usage
  ADD COLUMN IF NOT EXISTS provider_credits_remaining integer,
  ADD COLUMN IF NOT EXISTS provider_credits_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_calls jsonb;

COMMENT ON COLUMN public.base_konekt_usage.provider_credits_remaining IS
  'Solde de crédits restant chez le fournisseur après le dernier appel de cette opération (en-tête x-credits-remaining).';

-- created_at ne date pas le même événement selon la ligne : une opération prise
-- sur le forfait voit sa ligne posée par la réservation AVANT l'appel
-- fournisseur, une opération facturée après. D'où un horodatage propre au
-- relevé.
COMMENT ON COLUMN public.base_konekt_usage.provider_credits_read_at IS
  'Instant du relevé du solde, distinct de created_at qui date la création de la ligne (avant l''appel pour une opération prise sur le forfait).';

-- La mesure qui compte. Une opération enchaîne un à dix appels au fournisseur,
-- tous séquentiels dans la même invocation : le solde relevé après chacun donne
-- le coût de chacun par simple soustraction, à l'intérieur d'une seule ligne.
-- Aucune concurrence, aucune ligne manquante, aucun ordre à reconstituer ne
-- peut la fausser, contrairement à une mesure dérivée d'une ligne à l'autre.
-- Un premier aperçu d'une recherche appelle le bloc d'identifiants puis
-- l'aperçu proprement dit : cette ligne-là donne à elle seule le prix des deux.
COMMENT ON COLUMN public.base_konekt_usage.provider_calls IS
  'Appels fournisseur de cette opération, dans l''ordre : [{"endpoint": "...", "remaining": 9998}]. L''écart entre deux éléments successifs donne le coût du second appel, sans rien dériver d''une autre ligne.';

-- L'ancienne signature à quatre arguments est retirée au profit d'une seule
-- fonction dont les arguments de mesure ont une valeur par défaut. Une fonction
-- edge non encore redéployée, qui appelle à quatre arguments, continue donc de
-- résoudre. L'ordre inverse (fonction edge d'abord) est traité côté appelant :
-- coresignal-search n'envoie les arguments de mesure que s'ils portent une
-- valeur, et rejoue l'appel à quatre arguments si la base ne connaît pas encore
-- la signature.
DROP FUNCTION IF EXISTS public.record_base_konekt_usage(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.record_base_konekt_usage(uuid, uuid, text, integer, integer);

CREATE OR REPLACE FUNCTION public.record_base_konekt_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_credits integer,
  p_provider_credits_remaining integer DEFAULT NULL,
  p_provider_calls jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usage_id uuid;
BEGIN
  IF coalesce(p_action, '') NOT IN ('preview', 'search', 'collect') THEN
    RAISE EXCEPTION 'Action inconnue';
  END IF;

  INSERT INTO public.base_konekt_usage
    (organization_id, user_id, action, included, credits,
     provider_credits_remaining, provider_credits_read_at, provider_calls)
  VALUES (
    p_organization_id,
    p_user_id,
    p_action,
    false,
    greatest(coalesce(p_credits, 0), 0),
    p_provider_credits_remaining,
    -- Le relevé est daté dès qu'un appel a eu lieu, même si l'en-tête de solde
    -- manquait : sans quoi la ligne se rangerait à l'instant de sa création et
    -- la chaîne se casserait au mauvais endroit.
    CASE WHEN p_provider_credits_remaining IS NULL AND p_provider_calls IS NULL
      THEN NULL ELSE now() END,
    p_provider_calls
  )
  RETURNING id INTO v_usage_id;

  RETURN v_usage_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_base_konekt_usage(uuid, uuid, text, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_base_konekt_usage(uuid, uuid, text, integer, integer, jsonb) TO service_role;

-- Relevé sur une ligne déjà posée : c'est le cas d'une opération prise sur le
-- forfait, dont la réservation a créé la ligne avant l'appel. Passer par une
-- fonction plutôt que par un UPDATE direct garde toutes les écritures de la
-- table derrière la même porte.
DROP FUNCTION IF EXISTS public.stamp_base_konekt_provider_credits(uuid, integer);

CREATE OR REPLACE FUNCTION public.stamp_base_konekt_provider_credits(
  p_usage_id uuid,
  p_provider_credits_remaining integer,
  p_provider_calls jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_usage_id IS NULL THEN
    RETURN;
  END IF;
  IF p_provider_credits_remaining IS NULL AND p_provider_calls IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.base_konekt_usage
  SET provider_credits_remaining = coalesce(p_provider_credits_remaining, provider_credits_remaining),
      provider_calls = coalesce(p_provider_calls, provider_calls),
      provider_credits_read_at = now()
  WHERE id = p_usage_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stamp_base_konekt_provider_credits(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_base_konekt_provider_credits(uuid, integer, jsonb) TO service_role;

-- Rendre au forfait l'unité réservée sans effacer la trace d'un appel déjà
-- facturé. La version d'origine supprimait la ligne (20260907053655) : une
-- recherche qui ne rend rien, ou un appel en erreur après un premier appel
-- réussi, faisait donc disparaître des crédits bien consommés, et la mesure
-- suivante les absorbait en silence. Le décompte du forfait ne compte que
-- included = true : dé-marquer rend l'unité aussi sûrement que supprimer.
-- La suppression ne reste justifiée que pour une réservation qui n'a déclenché
-- aucun appel, donc sans relevé ni trace d'appel.
CREATE OR REPLACE FUNCTION public.release_base_konekt_usage(p_usage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.base_konekt_usage
  SET included = false, credits = 0
  WHERE id = p_usage_id
    AND included = true
    AND (provider_credits_read_at IS NOT NULL OR provider_calls IS NOT NULL);

  DELETE FROM public.base_konekt_usage
  WHERE id = p_usage_id
    AND included = true
    AND provider_credits_read_at IS NULL
    AND provider_calls IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_base_konekt_usage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_base_konekt_usage(uuid) TO service_role;

-- ─── Lectures ───

-- La mesure sûre : le coût de chaque appel d'une opération, lu à l'intérieur
-- d'une seule ligne. Les appels d'une opération sont séquentiels dans la même
-- invocation, donc l'écart entre deux relevés successifs est le coût du second,
-- sans rien dériver d'une autre ligne. Rien de ce qui suit ne dépend de l'ordre
-- des lignes, des lignes manquantes ni de la concurrence.
DROP VIEW IF EXISTS public.base_konekt_call_cost;

CREATE VIEW public.base_konekt_call_cost
WITH (security_invoker = true) AS
SELECT
  u.organization_id,
  u.action,
  u.provider_credits_read_at,
  appel.ord AS call_index,
  appel.valeur ->> 'endpoint' AS endpoint,
  (appel.valeur ->> 'remaining')::integer AS provider_credits_remaining,
  (precedent.valeur ->> 'remaining')::integer
    - (appel.valeur ->> 'remaining')::integer AS provider_credits_consumed
FROM public.base_konekt_usage u
CROSS JOIN LATERAL jsonb_array_elements(u.provider_calls) WITH ORDINALITY AS appel(valeur, ord)
LEFT JOIN LATERAL jsonb_array_elements(u.provider_calls) WITH ORDINALITY AS precedent(valeur, ord)
  ON precedent.ord = appel.ord - 1
WHERE jsonb_typeof(u.provider_calls) = 'array';

COMMENT ON VIEW public.base_konekt_call_cost IS
  'Coût de chaque appel fournisseur, lu à l''intérieur d''une même opération. Les appels d''une opération étant séquentiels, l''écart entre deux relevés successifs est le coût du second appel. Mesure sûre : elle ne dérive rien d''une autre ligne, donc ni la concurrence ni une ligne manquante ne peuvent la fausser. Le premier appel d''une opération n''a pas de prédécesseur et reste sans coût.';

REVOKE ALL ON public.base_konekt_call_cost FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.base_konekt_call_cost TO service_role;

-- La mesure indicative : le coût d'une opération entière, dérivé de l'écart de
-- solde d'une ligne à l'autre. Elle répond à une question que la précédente ne
-- couvre pas, le coût d'une opération qui n'a fait qu'un seul appel, mais elle
-- repose sur des hypothèses que la production ne garantit pas toujours.
--
-- Précautions, toutes dans le même sens, une case vide plutôt qu'un chiffre
-- faux :
--
--   1. L'ordre est celui du relevé, pas de la création de la ligne.
--   2. Une ligne sans relevé reste dans la fenêtre et casse la chaîne.
--   3. La clé du fournisseur étant partagée par défaut entre organisations
--      (resolveCoresignalCredentials), un écart ne compte que si l'opération
--      précédente, toutes organisations confondues, vient de la même
--      organisation.
--   4. La référence est le plus bas solde connu depuis le dernier rechargement,
--      pas le solde précédent : après une salve revenue dans le désordre, seul
--      le plus bas dit la vérité.
--
-- Reste ce qu'aucune dérivation ne peut redresser : une opération encore en vol
-- quand une autre se termine. Le scoring en fabrique à chaque lot,
-- useLinkedInScoring.hydrateAllChunked lançant quatre fiches à la fois, et la
-- première réponse revenue porte alors le décrément des quatre. D'où la colonne
-- mesure_isolee, vraie seulement si aucune autre opération n'a relevé de solde
-- dans la minute qui précède ni dans celle qui suit, et si la référence est bien
-- l'opération précédente. Une minute borne la durée d'une opération, puisqu'une
-- fonction edge est coupée à soixante secondes. Une ligne isolée des deux côtés
-- ne peut pas avoir croisé une opération en vol ; les autres sont à lire comme
-- des indices.
DROP VIEW IF EXISTS public.base_konekt_provider_cost;

CREATE VIEW public.base_konekt_provider_cost
WITH (security_invoker = true) AS
WITH toutes AS (
  SELECT
    u.id,
    u.organization_id,
    u.action,
    u.provider_credits_remaining,
    u.provider_calls,
    coalesce(u.provider_credits_read_at, u.created_at) AS releve,
    lag(u.provider_credits_remaining) OVER w AS solde_precedent,
    lag(u.organization_id) OVER w AS org_precedente,
    lag(coalesce(u.provider_credits_read_at, u.created_at)) OVER w AS releve_precedent,
    lead(coalesce(u.provider_credits_read_at, u.created_at)) OVER w AS releve_suivant
  FROM public.base_konekt_usage u
  WINDOW w AS (ORDER BY coalesce(u.provider_credits_read_at, u.created_at), u.id)
),
-- Découpage aux seuls rechargements du compte. Un solde qui remonte après plus
-- d'une minute est un rechargement ; plus rapproché, c'est une réponse arrivée
-- dans le désordre, sauf si la remontée dépasse ce qu'une poignée d'appels
-- simultanés peut expliquer, auquel cas c'est encore un rechargement. Sans
-- cette seconde branche, un rechargement pris dans une salve figerait la
-- référence et viderait la colonne pour toujours.
sessions AS (
  SELECT
    t.*,
    sum(CASE
      WHEN t.solde_precedent IS NOT NULL
        AND t.provider_credits_remaining > t.solde_precedent
        AND (t.releve - t.releve_precedent > interval '60 seconds'
          OR t.provider_credits_remaining - t.solde_precedent > 1000) THEN 1
      ELSE 0
    END) OVER (ORDER BY t.releve, t.id) AS session
  FROM toutes t
  WHERE t.provider_credits_remaining IS NOT NULL
),
reference AS (
  SELECT
    s.*,
    min(s.provider_credits_remaining) OVER (
      PARTITION BY s.session ORDER BY s.releve, s.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS solde_reference
  FROM sessions s
)
SELECT
  r.organization_id,
  r.action,
  r.releve AS provider_credits_read_at,
  r.provider_credits_remaining,
  r.provider_calls,
  CASE
    WHEN r.org_precedente IS DISTINCT FROM r.organization_id THEN NULL
    WHEN r.solde_precedent IS NULL THEN NULL
    WHEN r.solde_reference IS NULL THEN NULL
    WHEN r.solde_reference - r.provider_credits_remaining < 0 THEN NULL
    ELSE r.solde_reference - r.provider_credits_remaining
  END AS provider_credits_consumed,
  CASE
    WHEN r.org_precedente IS DISTINCT FROM r.organization_id THEN NULL
    WHEN r.solde_precedent IS NULL THEN NULL
    ELSE extract(epoch FROM (r.releve - r.releve_precedent))
  END AS seconds_since_previous,
  extract(epoch FROM (r.releve_suivant - r.releve)) AS seconds_until_next,
  -- Vraie seulement si rien d'autre n'a relevé de solde dans la minute avant ni
  -- dans la minute après. L'encadrement des deux côtés est ce qui exclut une
  -- opération encore en vol : une seule borne laisserait passer la première
  -- réponse d'une salve, qui porte le décompte de toute la salve et dont
  -- l'écart avec l'activité d'avant est pourtant grand.
  (r.org_precedente IS NOT DISTINCT FROM r.organization_id
    AND r.solde_precedent IS NOT NULL
    AND r.releve - r.releve_precedent > interval '60 seconds'
    AND (r.releve_suivant IS NULL OR r.releve_suivant - r.releve > interval '60 seconds')
  ) AS mesure_isolee
FROM reference r;

COMMENT ON VIEW public.base_konekt_provider_cost IS
  'Coût d''une opération entière, dérivé de l''écart de solde d''une ligne à l''autre. Mesure indicative : ne retenir que les lignes où mesure_isolee est vraie, seules à exclure une opération encore en vol. Pour une mesure qui ne dépend d''aucune hypothèse, préférer base_konekt_call_cost.';

REVOKE ALL ON public.base_konekt_provider_cost FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.base_konekt_provider_cost TO service_role;
