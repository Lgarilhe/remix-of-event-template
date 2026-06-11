
-- Table cache des scores candidat×job
CREATE TABLE IF NOT EXISTS match_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id text NOT NULL,
  job_id text NOT NULL,
  score integer NOT NULL DEFAULT 0,
  confidence integer NOT NULL DEFAULT 0,
  scoring_result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT unique_candidate_job UNIQUE (candidate_id, job_id)
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_match_scores_candidate ON match_scores(candidate_id);
CREATE INDEX idx_match_scores_job ON match_scores(job_id);
CREATE INDEX idx_match_scores_created ON match_scores(created_at);

-- RLS
ALTER TABLE match_scores ENABLE ROW LEVEL SECURITY;

-- Service role (Edge Functions) : accès complet
DROP POLICY IF EXISTS "Service role full access" ON match_scores;
CREATE POLICY "Service role full access" ON match_scores
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Authenticated users : lecture seule
DROP POLICY IF EXISTS "Authenticated users can read scores" ON match_scores;
CREATE POLICY "Authenticated users can read scores" ON match_scores
  FOR SELECT USING (auth.role() = 'authenticated');
