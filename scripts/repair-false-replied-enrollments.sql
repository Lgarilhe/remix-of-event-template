-- Cleanup : enrollments marqués 'replied' par erreur suite au bug
-- du handler message_received qui interprétait la note d'invitation que
-- NOUS avons envoyée comme une réponse du candidat.
--
-- Définition "faux replied" : enrollment.status = 'replied' alors
-- qu'AUCUNE étape outbound de type message/inmail/smart_message/email/
-- whatsapp_message n'a jamais été envoyée (status = 'sent'). Seul un
-- connection_request a pu être envoyé — il n'y a donc rien à quoi le
-- candidat aurait pu répondre, sauf à la note d'invite elle-même, ce qui
-- déclenchait précisément le bug.
--
-- Usage :
--   1. Exécuter STEP 1 (diagnostic, read-only) pour voir le périmètre.
--   2. Si le résultat correspond à ce qui est attendu, exécuter STEP 2
--      (réparation) dans une transaction.
--   3. Optionnellement STEP 3 pour relancer les étapes futures.
--
-- Idempotent : peut être rejoué sans effet de bord.

------------------------------------------------------------------------
-- STEP 1 — Diagnostic (read-only)
------------------------------------------------------------------------

-- 1a. Compte global
SELECT count(*) AS faux_replied_count
FROM sequence_enrollments e
WHERE e.status = 'replied'
  AND NOT EXISTS (
    SELECT 1
    FROM sequence_step_executions sse
    JOIN sequence_steps ss ON ss.id = sse.step_id
    WHERE sse.enrollment_id = e.id
      AND sse.status = 'sent'
      AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
  );

-- 1b. Détail des enrollments concernés
SELECT
  e.id              AS enrollment_id,
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
      AND sse.status = 'sent'
  ) AS sent_action_types
FROM sequence_enrollments e
WHERE e.status = 'replied'
  AND NOT EXISTS (
    SELECT 1
    FROM sequence_step_executions sse
    JOIN sequence_steps ss ON ss.id = sse.step_id
    WHERE sse.enrollment_id = e.id
      AND sse.status = 'sent'
      AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
  )
ORDER BY e.replied_at DESC;

-- 1c. Impact sur job_candidate_status (rows qui ont aussi été basculées
-- vers 'replied' / 'Répondu' par le même webhook)
SELECT
  jcs.id,
  jcs.candidate_id,
  jcs.status,
  jcs.pipeline_stage,
  jcs.updated_at
FROM job_candidate_status jcs
WHERE jcs.status = 'replied'
  AND jcs.candidate_id IN (
    SELECT e.profile_id
    FROM sequence_enrollments e
    WHERE e.status = 'replied'
      AND NOT EXISTS (
        SELECT 1
        FROM sequence_step_executions sse
        JOIN sequence_steps ss ON ss.id = sse.step_id
        WHERE sse.enrollment_id = e.id
          AND sse.status = 'sent'
          AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
      )
  )
ORDER BY jcs.updated_at DESC;

------------------------------------------------------------------------
-- STEP 2 — Réparation (à exécuter une fois STEP 1 vérifié)
-- Décommenter le bloc BEGIN/COMMIT pour exécuter.
------------------------------------------------------------------------

-- BEGIN;
--
-- -- 2a. CTE des enrollments à corriger
-- WITH bad AS (
--   SELECT e.id, e.profile_id, e.connection_status
--   FROM sequence_enrollments e
--   WHERE e.status = 'replied'
--     AND NOT EXISTS (
--       SELECT 1
--       FROM sequence_step_executions sse
--       JOIN sequence_steps ss ON ss.id = sse.step_id
--       WHERE sse.enrollment_id = e.id
--         AND sse.status = 'sent'
--         AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
--     )
-- )
-- -- 2b. Repasse les enrollments en 'active', vide replied_at
-- UPDATE sequence_enrollments e
--    SET status = 'active',
--        replied_at = NULL,
--        updated_at = now()
--  FROM bad
-- WHERE e.id = bad.id;
--
-- -- 2c. Repasse job_candidate_status : 'replied' -> 'contacted'
-- --     pipeline_stage : 'Répondu' -> 'Contacté'
-- --     (on ne connaît pas le statut antérieur exact ; 'contacted' est
-- --     l'estimation la plus sûre puisqu'une invitation a été envoyée.)
-- UPDATE job_candidate_status jcs
--    SET status = 'contacted',
--        pipeline_stage = CASE WHEN jcs.pipeline_stage = 'Répondu'
--                              THEN 'Contacté'
--                              ELSE jcs.pipeline_stage END,
--        updated_at = now()
--  WHERE jcs.status = 'replied'
--    AND jcs.candidate_id IN (SELECT profile_id FROM (
--      SELECT e.profile_id
--      FROM sequence_enrollments e
--      WHERE e.status = 'active'  -- déjà repassé en active ci-dessus
--        AND e.replied_at IS NULL
--        AND NOT EXISTS (
--          SELECT 1
--          FROM sequence_step_executions sse
--          JOIN sequence_steps ss ON ss.id = sse.step_id
--          WHERE sse.enrollment_id = e.id
--            AND sse.status = 'sent'
--            AND ss.action_type IN ('message', 'inmail', 'smart_message', 'email', 'whatsapp_message')
--        )
--    ) sub);
--
-- -- 2d. Décrémente l'analytique replies_received (best-effort, on enlève
-- --     1 par enrollment réparé pour la date du faux replied_at)
-- --     ⚠️ Désactivé par défaut car les compteurs analytics historiques
-- --     ne sont pas critiques. Décommenter si tu veux corriger.
-- -- WITH bad_by_day AS (
-- --   SELECT e.sequence_id, date_trunc('day', e.replied_at)::date AS d, count(*) AS n
-- --   FROM sequence_enrollments e
-- --   WHERE e.status = 'replied'
-- --     AND NOT EXISTS (
-- --       SELECT 1 FROM sequence_step_executions sse
-- --       JOIN sequence_steps ss ON ss.id = sse.step_id
-- --       WHERE sse.enrollment_id = e.id
-- --         AND sse.status = 'sent'
-- --         AND ss.action_type IN ('message','inmail','smart_message','email','whatsapp_message')
-- --     )
-- --   GROUP BY 1, 2
-- -- )
-- -- UPDATE sequence_analytics sa
-- --    SET replies_received = GREATEST(0, COALESCE(sa.replies_received, 0) - bad_by_day.n)
-- --   FROM bad_by_day
-- --  WHERE sa.sequence_id = bad_by_day.sequence_id
-- --    AND sa.date = bad_by_day.d;
--
-- COMMIT;

------------------------------------------------------------------------
-- STEP 3 — (Optionnel) Relancer les étapes futures qui ont été annulées
-- par le webhook avec skip_reason = 'Reply detected via webhook'.
-- À n'exécuter QUE si tu veux que les séquences reprennent pour ces
-- candidats. Sinon, ils restent en 'active' mais sans steps planifiés
-- (= dormants, ré-enrôlables manuellement).
------------------------------------------------------------------------

-- BEGIN;
--
-- UPDATE sequence_step_executions sse
--    SET status = 'scheduled',
--        skip_reason = NULL,
--        scheduled_at = GREATEST(sse.scheduled_at, now() + interval '1 hour'),
--        updated_at = now()
--  WHERE sse.status = 'cancelled'
--    AND sse.skip_reason = 'Reply detected via webhook'
--    AND sse.enrollment_id IN (
--      SELECT e.id
--      FROM sequence_enrollments e
--      WHERE e.status = 'active'
--        AND e.replied_at IS NULL
--    );
--
-- COMMIT;
