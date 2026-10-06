-- Cleanup : enrollments marqués 'replied' par erreur suite au bug
-- du handler message_received qui interprétait la note d'invitation que
-- NOUS avons envoyée comme une réponse du candidat.
--
-- Définition "faux replied" CANDIDAT : enrollment.status = 'replied' alors
-- qu'AUCUNE étape outbound de type message/inmail/smart_message/email/
-- whatsapp_message n'a jamais été envoyée (status = 'sent'). Seul un
-- connection_request a pu être envoyé.
--
-- ⚠️ Ce n'est qu'un indice : un candidat peut réellement répondre à la note
-- d'invitation elle-même. L'étape 1 liste des candidats à VÉRIFIER, jamais
-- des lignes à réparer en masse. Avant toute réparation, ouvrir la
-- conversation et contrôler QUI a écrit le dernier message.
--
-- Usage :
--   1. Exécuter STEP 1 (diagnostic, lecture seule) pour voir le périmètre.
--   2. Vérifier chaque inscription à la main (expéditeur du message).
--   3. Recopier les seuls ids VÉRIFIÉS dans la liste `verified` des étapes 2
--      et 3, puis exécuter l'étape 2 dans une transaction.
--   4. Reprendre ensuite les candidats depuis l'interface (« Reprendre ») :
--      l'étape 2 les met en pause, elle ne relance rien. L'étape 3 reste
--      facultative.
--
-- Rejouable : chaque étape ne touche que les ids listés, dans l'état attendu.

------------------------------------------------------------------------
-- STEP 1 — Diagnostic (lecture seule)
------------------------------------------------------------------------

-- 1a. Compte par organisation
SELECT e.organization_id, count(*) AS faux_replied_candidats
FROM sequence_enrollments e
WHERE e.status = 'replied'
  AND NOT EXISTS (
    SELECT 1
    FROM sequence_step_executions sse
    JOIN sequence_steps ss ON ss.id = sse.step_id
    WHERE sse.enrollment_id = e.id
      AND sse.status IN ('sent', 'opened', 'clicked', 'replied')
      AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
  )
GROUP BY e.organization_id
ORDER BY 2 DESC;

-- 1b. Détail des inscriptions à vérifier une par une
SELECT
  e.id              AS enrollment_id,
  e.organization_id,
  e.sequence_id,
  e.profile_id,
  e.profile_name,
  e.connection_status,
  e.replied_at,
  e.account_id,
  (
    SELECT array_agg(ss.action_type ORDER BY sse.step_order)
    FROM sequence_step_executions sse
    JOIN sequence_steps ss ON ss.id = sse.step_id
    WHERE sse.enrollment_id = e.id
      AND sse.status IN ('sent', 'opened', 'clicked', 'replied')
  ) AS sent_action_types
FROM sequence_enrollments e
WHERE e.status = 'replied'
  AND NOT EXISTS (
    SELECT 1
    FROM sequence_step_executions sse
    JOIN sequence_steps ss ON ss.id = sse.step_id
    WHERE sse.enrollment_id = e.id
      AND sse.status IN ('sent', 'opened', 'clicked', 'replied')
      AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
  )
ORDER BY e.replied_at DESC;

-- 1c. Lignes du pipeline de la MÊME organisation passées en 'replied'
--     (couple candidat + organisation de chaque inscription candidate)
SELECT
  jcs.id,
  jcs.organization_id,
  jcs.candidate_id,
  jcs.status,
  jcs.pipeline_stage,
  jcs.updated_at
FROM job_candidate_status jcs
JOIN sequence_enrollments e
  ON e.profile_id = jcs.candidate_id
 AND e.organization_id = jcs.organization_id
WHERE jcs.status = 'replied'
  AND e.status = 'replied'
  AND NOT EXISTS (
    SELECT 1
    FROM sequence_step_executions sse
    JOIN sequence_steps ss ON ss.id = sse.step_id
    WHERE sse.enrollment_id = e.id
      AND sse.status IN ('sent', 'opened', 'clicked', 'replied')
      AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
  )
ORDER BY jcs.updated_at DESC;

------------------------------------------------------------------------
-- STEP 2 — Réparation des seuls ids vérifiés (à exécuter après contrôle)
-- Remplacer les ids d'exemple, puis décommenter le bloc BEGIN/COMMIT.
-- Les inscriptions passent en pause ('manual') : aucun message ne part tant
-- que personne ne clique « Reprendre », qui replanifie proprement côté serveur.
------------------------------------------------------------------------

-- BEGIN;
--
-- CREATE TEMP TABLE verified (enrollment_id uuid PRIMARY KEY) ON COMMIT DROP;
-- INSERT INTO verified (enrollment_id) VALUES
--   ('00000000-0000-0000-0000-000000000000');  -- ← ids vérifiés un par un
--
-- -- 2a. Garde-fou : chaque id doit être une inscription encore 'replied'
-- --     sans aucun message envoyé.
-- DO $$
-- DECLARE n_bad int;
-- BEGIN
--   SELECT count(*) INTO n_bad
--   FROM verified v
--   LEFT JOIN sequence_enrollments e ON e.id = v.enrollment_id
--   WHERE e.id IS NULL
--      OR e.status <> 'replied'
--      OR EXISTS (
--        SELECT 1
--        FROM sequence_step_executions sse
--        JOIN sequence_steps ss ON ss.id = sse.step_id
--        WHERE sse.enrollment_id = e.id
--          AND sse.status IN ('sent', 'opened', 'clicked', 'replied')
--          AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
--      );
--   IF n_bad > 0 THEN
--     RAISE EXCEPTION '% id(s) hors périmètre : rien n''est modifié', n_bad;
--   END IF;
-- END $$;
--
-- -- 2b. Pipeline : 'replied' -> 'contacted' pour le seul couple
-- --     (candidat, organisation) de chaque inscription vérifiée.
-- --     (on ne connaît pas le statut antérieur exact ; 'contacted' est
-- --     l'estimation la plus sûre puisqu'une invitation a été envoyée.)
-- UPDATE job_candidate_status jcs
--    SET status = 'contacted',
--        pipeline_stage = CASE WHEN jcs.pipeline_stage = 'Répondu'
--                              THEN 'Contacté'
--                              ELSE jcs.pipeline_stage END,
--        updated_at = now()
--   FROM sequence_enrollments e
--   JOIN verified v ON v.enrollment_id = e.id
--  WHERE jcs.status = 'replied'
--    AND jcs.candidate_id = e.profile_id
--    AND jcs.organization_id = e.organization_id;
--
-- -- 2c. Inscriptions : 'replied' -> en pause, replied_at vidé.
-- UPDATE sequence_enrollments e
--    SET status = 'paused',
--        pause_reason = 'manual',
--        replied_at = NULL,
--        updated_at = now()
--   FROM verified v
--  WHERE e.id = v.enrollment_id
--    AND e.status = 'replied';
--
-- COMMIT;

------------------------------------------------------------------------
-- STEP 3 — (Facultatif) Réarmer l'étape annulée par le faux « Répondu »
-- Préférer « Reprendre » dans l'interface. Sinon : mêmes ids vérifiés, une
-- seule exécution par inscription (l'annulation la plus récente), et
-- seulement si son étape n'est jamais partie. L'inscription reste en pause :
-- c'est « Reprendre » qui garde cette étape et fixe sa date.
------------------------------------------------------------------------

-- BEGIN;
--
-- CREATE TEMP TABLE verified (enrollment_id uuid PRIMARY KEY) ON COMMIT DROP;
-- INSERT INTO verified (enrollment_id) VALUES
--   ('00000000-0000-0000-0000-000000000000');  -- ← mêmes ids qu'à l'étape 2
--
-- WITH latest AS (
--   SELECT DISTINCT ON (sse.enrollment_id) sse.id, sse.enrollment_id, sse.step_id
--   FROM sequence_step_executions sse
--   JOIN verified v ON v.enrollment_id = sse.enrollment_id
--   WHERE sse.status = 'cancelled'
--     AND sse.skip_reason = 'Reply detected via webhook'
--   ORDER BY sse.enrollment_id, sse.updated_at DESC, sse.id DESC
-- )
-- UPDATE sequence_step_executions sse
--    SET status = 'scheduled',
--        skip_reason = NULL,
--        scheduled_at = GREATEST(sse.scheduled_at, now() + interval '1 hour'),
--        updated_at = now()
--   FROM latest l
--   JOIN sequence_enrollments e ON e.id = l.enrollment_id
--  WHERE sse.id = l.id
--    AND e.status = 'paused'
--    AND e.replied_at IS NULL
--    AND NOT EXISTS (
--      SELECT 1 FROM sequence_step_executions done
--      WHERE done.enrollment_id = l.enrollment_id
--        AND done.step_id = l.step_id
--        AND done.status IN ('sent', 'opened', 'clicked', 'replied', 'scheduled', 'sending', 'waiting_event', 'quota_blocked')
--    );
--
-- COMMIT;
