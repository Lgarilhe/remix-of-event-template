-- =====================================================================
-- Refonte mission, lot 3 : la carte « Maintenant », signaux par mission.
-- Conception : docs/refonte-mission/conception.md (4.2, 4.3, 5.3, 13).
--   1. is_go_recommendation(text) : « recommandé », une seule définition
--      pour les deux vocabulaires de la colonne recommendation.
--   2. job_details_is_described(jsonb) : poste décrit ou vide (même règle
--      que canScoreProfiles, src/components/missions/v3/cadrage/cadrageModel.ts).
--   3. get_mission_attention(uuid[], integer, integer, integer) : ce que la
--      carte lit en plus des effectifs de get_mission_stage_counts (réponses
--      sans suite sur le compte de l'appelant et sur celui des collègues,
--      entretiens sans nouvelles, profils notés à trier, poste décrit).
-- Fonction nouvelle, pas une extension de get_mission_stage_counts : celle-ci
-- est sur le chemin d'écriture (recompute_mission_stats), alors que cette
-- lecture dépend de la personne connectée (auth.uid()).
-- Aucune table, aucune policy, aucun SECURITY DEFINER. Rejouable sur une
-- base vide : tout ce qui est lu existe depuis les lots 0a, 0b et 0c.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. « Recommandé » : go (navigateur) ou STRONG_MATCH, GOOD_MATCH (serveur,
--    score-profile-job). Un texte libre de l'ancienne analyse n'en est pas un.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_go_recommendation(r text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT lower(btrim(coalesce(r, ''))) IN ('go', 'strong_match', 'good_match')
$$;
REVOKE ALL ON FUNCTION public.is_go_recommendation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_go_recommendation(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Poste décrit : au moins une compétence indispensable ou souhaitée non
--    vide, ou missions et contexte (joints par deux sauts de ligne) d'au moins
--    30 caractères. Tolérante à un JSON abîmé : tout ce qui n'est pas une
--    liste de chaînes ou une chaîne est ignoré, jamais d'erreur.
--    Alignée sur JavaScript : trim() retire aussi l'espace insécable, les
--    séparateurs Unicode et le BOM (btrim() de Postgres ne retire que
--    l'espace), et length() compte des unités UTF-16 (un émoji vaut 2).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_details_is_described(jd jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  WITH ws AS (
    SELECT '^[\t\n\v\f\r    -     　﻿]+|[\t\n\v\f\r    -     　﻿]+$'::text AS re
  ), d AS (
    SELECT regexp_replace(
             concat_ws(E'\n\n',
               nullif(CASE WHEN jsonb_typeof(jd -> 'mission_description') = 'string'
                           THEN jd ->> 'mission_description' END, ''),
               nullif(CASE WHEN jsonb_typeof(jd -> 'context') = 'string'
                           THEN jd ->> 'context' END, '')),
             ws.re, '', 'g') AS txt
      FROM ws
  )
  SELECT coalesce(
    EXISTS (
      SELECT 1
        FROM ws,
             unnest(ARRAY['skills_must_have', 'skills_should_have']) AS k(key)
       CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(jd -> k.key) = 'array' THEN jd -> k.key ELSE '[]'::jsonb END) AS e(val)
       WHERE jsonb_typeof(e.val) = 'string'
         AND regexp_replace(e.val #>> '{}', ws.re, '', 'g') <> '')
    OR (SELECT char_length(d.txt)
               + char_length(regexp_replace(d.txt, '[^\U00010000-\U0010ffff]', '', 'g')) >= 30
          FROM d),
    false)
$$;
REVOKE ALL ON FUNCTION public.job_details_is_described(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_details_is_described(jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. get_mission_attention : une ligne par mission demandée DE L'ORGANISATION
--    de l'appelant, même sans signal ; une mission d'une autre organisation
--    ou inconnue : aucune ligne (jamais de zéros faux). Sans organisation
--    active (auth.uid() absent) : aucune ligne.
--
--    Réponses sans suite (rang 3) : lien de mission_conversations dont
--    last_inbound_at > coalesce(last_outbound_at, -infini), plus récent que
--    p_reply_days jours (NULL : sans plafond), sur un compte relié à un membre
--    de l'organisation. « À moi » : le compte est celui de l'appelant ; sinon
--    il est chez un collègue. Le lien est rapproché de la ligne candidat par
--    identifiant, alias (candidate_ids) ou nom de profil LinkedIn (slug) ;
--    un lien sans ligne est gardé (candidate_name NULL), jamais caché. Écartés
--    et embauchés exclus (ligne canonique de mission_candidate_rows). Un même
--    candidat sur un même compte ne compte qu'une fois.
--    Collaborateur : la RLS de mission_conversations ne lui rend que ses liens.
--    has_own_account faux : replies_mine vaut 0 et ne veut pas dire « aucune
--    réponse » (l'appelant lit has_own_account d'abord).
--    Entretiens sans nouvelles (rang 6) : lignes canoniques en entretien dont
--    stage_entered_at date de plus de p_interview_days × 24 h (strictement).
--    Profils notés à trier (rang 8) : À trier, ouverts, avec une note.
--    Éléments : au plus p_item_limit (borné à 200), les miens d'abord puis la
--    plus ancienne réponse d'abord ; entretiens du plus ancien au plus récent.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mission_attention(
  p_project_ids uuid[],
  p_item_limit integer DEFAULT 5,
  p_interview_days integer DEFAULT 5,
  p_reply_days integer DEFAULT 30)
RETURNS TABLE (
  project_id uuid,
  has_own_account boolean,
  replies_mine integer,
  replies_mine_oldest_at timestamptz,
  replies_others integer,
  replies_others_oldest_at timestamptz,
  reply_items jsonb,
  interview_waiting integer,
  interview_waiting_oldest_at timestamptz,
  interview_items jsonb,
  to_sort_scored integer,
  to_sort_recommended integer,
  job_described boolean)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH org AS MATERIALIZED (
    SELECT public.get_user_org_id(auth.uid()) AS id
  ), lim AS MATERIALIZED (
    SELECT least(greatest(coalesce(p_item_limit, 5), 0), 200) AS n,
           make_interval(days => greatest(coalesce(p_interview_days, 5), 0)) AS wait,
           CASE WHEN p_reply_days IS NULL THEN '-infinity'::timestamptz
                ELSE now() - make_interval(days => greatest(p_reply_days, 0)) END AS reply_since
  ), m AS MATERIALIZED (
    SELECT sp.id, sp.organization_id, public.job_details_is_described(sp.job_details) AS described
      FROM public.sourcing_projects sp
      JOIN org ON sp.organization_id = org.id
     WHERE sp.id = ANY (p_project_ids)
  ), me AS MATERIALIZED (
    SELECT mla.organization_id
      FROM public.member_linkedin_accounts mla
      JOIN org ON mla.organization_id = org.id
     WHERE mla.user_id = auth.uid()
  ), v AS MATERIALIZED (
    -- Le filtre project_id = ANY(...) descend sous les fenêtres de la vue
    -- (comme get_mission_stage_counts) ; le second, sur m, écarte les missions
    -- d'une autre organisation.
    SELECT c.id, c.organization_id, c.project_id, c.candidate_id, c.candidate_name,
           public.linkedin_url_slug(c.linkedin_profile_url) AS slug,
           c.general_stage, c.process_step_id, c.stage_entered_at, c.is_unopened,
           c.score, c.recommendation, c.reply_summary
      FROM public.mission_candidate_rows c
     WHERE c.project_id = ANY (p_project_ids)
       AND c.project_id IN (SELECT m.id FROM m)
  ), pend AS MATERIALIZED (
    SELECT mc.id AS link_id, mc.project_id, mc.organization_id, mc.account_id, mc.chat_id,
           mc.candidate_id, mc.candidate_ids, mc.candidate_slug, mc.last_inbound_at,
           (mla.user_id = auth.uid()) AS is_mine,
           mla.linkedin_account_name AS owner_label
      FROM m
      JOIN public.mission_conversations mc
        ON mc.project_id = m.id AND mc.organization_id = m.organization_id
      JOIN public.member_linkedin_accounts mla
        ON mla.organization_id = mc.organization_id AND mla.linkedin_account_id = mc.account_id
     WHERE mc.last_inbound_at IS NOT NULL
       AND mc.last_inbound_at > coalesce(mc.last_outbound_at, '-infinity'::timestamptz)
       AND mc.last_inbound_at > (SELECT lim.reply_since FROM lim)
  ), keyed AS MATERIALIZED (
    -- Rapprochement d'un lien et de sa ligne candidat par tri, non par jointure :
    -- les CTE n'ont pas de statistiques, le planificateur les croit à une ligne
    -- et choisit une boucle imbriquée, donc lignes x liens en attente sur toute
    -- la liste des missions. Chaque clé (identifiant, alias, slug) range d'abord
    -- les lignes, puis les liens ; first_value rend à chaque lien la meilleure
    -- ligne de sa clé (la plus récente dans son étape, puis l'identifiant).
    SELECT 'A' AS pass, v.project_id, v.organization_id, v.candidate_id AS key, 0 AS side, 0 AS prio,
           NULL::uuid AS link_id, v.id, v.candidate_id, v.candidate_name,
           v.general_stage, v.reply_summary, v.stage_entered_at
      FROM v
    UNION ALL
    SELECT 'S', v.project_id, v.organization_id, v.slug, 0, 0,
           NULL::uuid, v.id, v.candidate_id, v.candidate_name,
           v.general_stage, v.reply_summary, v.stage_entered_at
      FROM v
     WHERE v.slug IS NOT NULL
    UNION ALL
    SELECT 'A', p.project_id, p.organization_id, p.candidate_id, 1, 1,
           p.link_id, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz
      FROM pend p
    UNION ALL
    SELECT 'A', p.project_id, p.organization_id, a.cid, 1, 2,
           p.link_id, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz
      FROM pend p
     CROSS JOIN LATERAL unnest(p.candidate_ids) AS a(cid)
    UNION ALL
    SELECT 'S', p.project_id, p.organization_id, p.candidate_slug, 1, 3,
           p.link_id, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz
      FROM pend p
     WHERE p.candidate_slug IS NOT NULL
  ), cand AS MATERIALIZED (
    SELECT t.link_id, t.prio, t.m_id AS id, t.m_candidate_id AS candidate_id, t.m_name AS candidate_name,
           t.m_stage AS general_stage, t.m_summary AS reply_summary, t.m_entered AS stage_entered_at
      FROM (SELECT kk.link_id, kk.prio, kk.side,
                   first_value(kk.id) OVER w AS m_id,
                   first_value(kk.candidate_id) OVER w AS m_candidate_id,
                   first_value(kk.candidate_name) OVER w AS m_name,
                   first_value(kk.general_stage) OVER w AS m_stage,
                   first_value(kk.reply_summary) OVER w AS m_summary,
                   first_value(kk.stage_entered_at) OVER w AS m_entered
              FROM keyed kk
            WINDOW w AS (PARTITION BY kk.pass, kk.project_id, kk.organization_id, kk.key
                         ORDER BY kk.side, kk.stage_entered_at DESC NULLS LAST, kk.id)) t
     WHERE t.side = 1 AND t.m_id IS NOT NULL
  ), best AS MATERIALIZED (
    SELECT DISTINCT ON (cand.link_id) cand.*
      FROM cand
     ORDER BY cand.link_id, cand.prio
  ), k AS MATERIALIZED (
    SELECT p.*, x.id AS row_id, x.candidate_id AS row_candidate_id, x.candidate_name,
           x.general_stage, x.reply_summary
      FROM pend p
      LEFT JOIN best x ON x.link_id = p.link_id
     WHERE coalesce(x.general_stage, '') NOT IN ('rejected', 'hired')
  ), kd AS MATERIALIZED (
    SELECT DISTINCT ON (k.project_id, k.account_id, coalesce(k.row_id::text, 'lien:' || k.link_id::text))
           k.*
      FROM k
     ORDER BY k.project_id, k.account_id, coalesce(k.row_id::text, 'lien:' || k.link_id::text),
              k.last_inbound_at, k.link_id
  ), rp AS (
    SELECT kd.project_id,
           (count(*) FILTER (WHERE kd.is_mine))::integer AS mine,
           min(kd.last_inbound_at) FILTER (WHERE kd.is_mine) AS mine_oldest,
           (count(*) FILTER (WHERE NOT kd.is_mine))::integer AS others,
           min(kd.last_inbound_at) FILTER (WHERE NOT kd.is_mine) AS others_oldest
      FROM kd
     GROUP BY kd.project_id
  ), ri AS (
    SELECT t.project_id,
           jsonb_agg(jsonb_build_object(
             'link_id', t.link_id, 'row_id', t.row_id,
             'candidate_id', coalesce(t.row_candidate_id, t.candidate_id),
             'candidate_name', t.candidate_name, 'stage', t.general_stage,
             'chat_id', t.chat_id, 'reply_at', t.last_inbound_at,
             'is_mine', t.is_mine, 'owner_label', t.owner_label,
             'reply_summary', t.reply_summary) ORDER BY t.rk) AS items
      FROM (SELECT kd.*,
                   row_number() OVER (PARTITION BY kd.project_id
                                      ORDER BY kd.is_mine DESC, kd.last_inbound_at, kd.link_id) AS rk
              FROM kd) t
     WHERE t.rk <= (SELECT lim.n FROM lim)
     GROUP BY t.project_id
  ), iw AS (
    SELECT t.project_id,
           (count(*))::integer AS n,
           min(t.stage_entered_at) AS oldest,
           jsonb_agg(jsonb_build_object(
             'row_id', t.id, 'candidate_id', t.candidate_id, 'candidate_name', t.candidate_name,
             'process_step_id', t.process_step_id, 'stage_entered_at', t.stage_entered_at)
             ORDER BY t.rk) FILTER (WHERE t.rk <= (SELECT lim.n FROM lim)) AS items
      FROM (SELECT v.*,
                   row_number() OVER (PARTITION BY v.project_id ORDER BY v.stage_entered_at, v.id) AS rk
              FROM v
             WHERE v.general_stage = 'interviewing'
               AND v.stage_entered_at < now() - (SELECT lim.wait FROM lim)) t
     GROUP BY t.project_id
  ), srt AS (
    SELECT v.project_id,
           (count(*) FILTER (WHERE v.score IS NOT NULL))::integer AS scored,
           (count(*) FILTER (WHERE v.score IS NOT NULL
                               AND public.is_go_recommendation(v.recommendation)))::integer AS reco
      FROM v
     WHERE v.general_stage = 'to_sort' AND NOT v.is_unopened
     GROUP BY v.project_id
  )
  SELECT m.id,
         EXISTS (SELECT 1 FROM me WHERE me.organization_id = m.organization_id),
         coalesce(rp.mine, 0), rp.mine_oldest,
         coalesce(rp.others, 0), rp.others_oldest,
         coalesce(ri.items, '[]'::jsonb),
         coalesce(iw.n, 0), iw.oldest, coalesce(iw.items, '[]'::jsonb),
         coalesce(srt.scored, 0), coalesce(srt.reco, 0),
         m.described
    FROM m
    LEFT JOIN rp ON rp.project_id = m.id
    LEFT JOIN ri ON ri.project_id = m.id
    LEFT JOIN iw ON iw.project_id = m.id
    LEFT JOIN srt ON srt.project_id = m.id
$$;
-- Jamais anon, jamais service_role : la fonction lit auth.uid() (sans jeton,
-- une clé de service verrait toutes les réponses comme celles d'un collègue).
REVOKE ALL ON FUNCTION public.get_mission_attention(uuid[], integer, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mission_attention(uuid[], integer, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.get_mission_attention(uuid[], integer, integer, integer) IS
  'Lot 3 : signaux par mission pour la carte Maintenant (réponses sans suite sur le compte de l''appelant et chez les collègues, entretiens sans nouvelles, profils notés à trier, poste décrit). SECURITY INVOKER, missions de l''organisation de l''appelant seulement, authenticated seulement.';

NOTIFY pgrst, 'reload schema';
