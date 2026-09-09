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
  ADD COLUMN IF NOT EXISTS provider_credits_read_at timestamptz;

COMMENT ON COLUMN public.base_konekt_usage.provider_credits_remaining IS
  'Solde de crédits restant chez le fournisseur juste après cette opération (en-tête x-credits-remaining). L''écart entre deux lignes successives donne le coût réel d''un aperçu ou d''une fiche, sans supposer de tarif.';

-- created_at ne date pas le même événement selon la ligne : une opération prise
-- sur le forfait voit sa ligne posée par la réservation AVANT l'appel
-- fournisseur, une opération facturée après. Ordonner la mesure sur created_at
-- attribuerait donc un écart à la mauvaise ligne dès que deux opérations se
-- chevauchent. D'où un horodatage propre au relevé.
COMMENT ON COLUMN public.base_konekt_usage.provider_credits_read_at IS
  'Instant du relevé du solde, distinct de created_at qui date la création de la ligne (avant l''appel pour une opération prise sur le forfait). Sert d''ordre de référence à base_konekt_provider_cost.';

-- L'ancienne signature à quatre arguments est retirée au profit d'une seule
-- fonction dont le cinquième paramètre a une valeur par défaut. Une fonction
-- edge non encore redéployée, qui appelle à quatre arguments, continue donc de
-- résoudre. L'ordre inverse (fonction edge d'abord) est traité côté appelant :
-- coresignal-search n'envoie le cinquième argument que s'il porte une valeur, et
-- rejoue l'appel à quatre arguments si la base ne connaît pas encore la
-- signature.
DROP FUNCTION IF EXISTS public.record_base_konekt_usage(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.record_base_konekt_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_action text,
  p_credits integer,
  p_provider_credits_remaining integer DEFAULT NULL
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
     provider_credits_remaining, provider_credits_read_at)
  VALUES (
    p_organization_id,
    p_user_id,
    p_action,
    false,
    greatest(coalesce(p_credits, 0), 0),
    p_provider_credits_remaining,
    CASE WHEN p_provider_credits_remaining IS NULL THEN NULL ELSE now() END
  )
  RETURNING id INTO v_usage_id;

  RETURN v_usage_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_base_konekt_usage(uuid, uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_base_konekt_usage(uuid, uuid, text, integer, integer) TO service_role;

-- Relevé du solde sur une ligne déjà posée : c'est le cas d'une opération prise
-- sur le forfait, dont la réservation a créé la ligne avant l'appel. Passer par
-- une fonction plutôt que par un UPDATE direct garde toutes les écritures de la
-- table derrière la même porte.
CREATE OR REPLACE FUNCTION public.stamp_base_konekt_provider_credits(
  p_usage_id uuid,
  p_provider_credits_remaining integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_usage_id IS NULL OR p_provider_credits_remaining IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.base_konekt_usage
  SET provider_credits_remaining = p_provider_credits_remaining,
      provider_credits_read_at = now()
  WHERE id = p_usage_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stamp_base_konekt_provider_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_base_konekt_provider_credits(uuid, integer) TO service_role;

-- Lecture de la mesure : coût réel d'une opération, dérivé de l'écart de solde
-- entre deux relevés successifs.
--
-- Trois précautions, toutes dans le même sens : une case vide vaut mieux qu'un
-- chiffre faux, puisque toute la question est de trancher entre deux crédits par
-- aperçu et vingt.
--
--   1. L'ordre est celui du relevé, pas celui de la ligne (cf. commentaire de
--      provider_credits_read_at).
--   2. Les lignes sans relevé restent dans la fenêtre et cassent la chaîne. Si
--      elles en étaient retirées avant le lag, un appel dont le solde manque
--      verrait sa consommation reportée sur l'opération suivante, qui
--      paraîtrait deux fois plus chère.
--   3. La clé du fournisseur est partagée par défaut entre les organisations
--      (repli sur le secret d'environnement, cf. resolveCoresignalCredentials) :
--      le solde lu appartient à un pool commun. Un écart n'a donc de sens que si
--      l'opération qui précède immédiatement, toutes organisations confondues,
--      vient de la même organisation.
--
-- Un écart négatif signale un rechargement du compte entre les deux appels : ce
-- n'est pas une consommation, la case reste vide.
DROP VIEW IF EXISTS public.base_konekt_provider_cost;

-- security_invoker : la vue applique la RLS de l'appelant. Seul le service role
-- y a droit aujourd'hui, mais un élargissement futur du GRANT ne contournera pas
-- la politique de lecture de base_konekt_usage.
CREATE VIEW public.base_konekt_provider_cost
WITH (security_invoker = true) AS
WITH ordonne AS (
  SELECT
    u.organization_id,
    u.action,
    u.created_at,
    u.provider_credits_read_at,
    u.provider_credits_remaining,
    lag(u.provider_credits_remaining) OVER (
      ORDER BY coalesce(u.provider_credits_read_at, u.created_at), u.id
    ) AS solde_precedent,
    lag(u.organization_id) OVER (
      ORDER BY coalesce(u.provider_credits_read_at, u.created_at), u.id
    ) AS org_precedente
  FROM public.base_konekt_usage u
)
SELECT
  o.organization_id,
  o.action,
  o.provider_credits_read_at,
  o.provider_credits_remaining,
  CASE
    WHEN o.org_precedente IS DISTINCT FROM o.organization_id THEN NULL
    WHEN o.solde_precedent IS NULL THEN NULL
    WHEN o.solde_precedent - o.provider_credits_remaining < 0 THEN NULL
    ELSE o.solde_precedent - o.provider_credits_remaining
  END AS provider_credits_consumed
FROM ordonne o
WHERE o.provider_credits_remaining IS NOT NULL;

COMMENT ON VIEW public.base_konekt_provider_cost IS
  'Consommation de crédits fournisseur par opération, mesurée sur l''écart de solde entre deux relevés successifs de la même organisation. Une opération couvre tous les appels HTTP qu''elle a déclenchés. Sert à trancher le coût réel d''un aperçu et d''une fiche complète.';

REVOKE ALL ON public.base_konekt_provider_cost FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.base_konekt_provider_cost TO service_role;
