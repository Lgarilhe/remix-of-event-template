-- ════════════════════════════════════════════════════════════════════════
-- Seed fixtures V4 — varied event_names pour montrer les différents rounds
-- (1er entretien, 2e tour, Final, etc.) + format mix
-- ════════════════════════════════════════════════════════════════════════
--
-- Met à jour les fixtures existantes pour donner des event_names
-- recognizable par le regex inferRound() dans useCalendarEvents :
-- - "Qualif initiale" / "1er entretien" → round 1
-- - "2e tour" / "Second round" → round 2
-- - "3e tour" → round 3
-- - "Final round" / "Dernier tour" → final
--
-- ════════════════════════════════════════════════════════════════════════

UPDATE qualification_sessions
SET event_name = CASE
  WHEN candidate_name LIKE '%' || (SELECT split_part(string_agg(candidate_name, '|') FILTER (WHERE notes LIKE '%[FIXTURE]%' AND event_start_at IS NOT NULL), '|', 1) FROM qualification_sessions) || '%'
    THEN '1er entretien · ' || COALESCE(client_name, '?')
  ELSE event_name
END
WHERE notes LIKE '%[FIXTURE]%';

-- Plus simple : update les 5 events un par un par leur position chronologique
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY event_start_at) AS rn
  FROM qualification_sessions
  WHERE notes LIKE '%[FIXTURE]%'
)
UPDATE qualification_sessions q
SET event_name = (
  CASE o.rn
    WHEN 1 THEN '1er entretien'
    WHEN 2 THEN '2e tour client'
    WHEN 3 THEN 'Qualif initiale'
    WHEN 4 THEN 'Café découverte'
    WHEN 5 THEN 'Final round'
    ELSE q.event_name
  END
)
FROM ordered o
WHERE q.id = o.id;

-- Vérification
SELECT
  to_char(event_start_at, 'DD/MM HH24:MI') AS date,
  event_name,
  candidate_name,
  client_name,
  CASE
    WHEN event_location LIKE '%meet.google%' THEN 'Visio (Meet)'
    WHEN event_location LIKE '%zoom%' THEN 'Visio (Zoom)'
    WHEN event_location LIKE 'Bureau%' THEN 'Présentiel'
    ELSE event_location
  END AS format
FROM qualification_sessions
WHERE notes LIKE '%[FIXTURE]%'
ORDER BY event_start_at;
