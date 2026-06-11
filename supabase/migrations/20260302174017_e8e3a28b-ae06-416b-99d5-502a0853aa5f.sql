
-- 1. Activer pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Table candidate_profiles avec embeddings
CREATE TABLE IF NOT EXISTS candidate_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id text NOT NULL UNIQUE,
  name text,
  headline text,
  skills text[],
  summary text,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_candidate_profiles_candidate_id ON candidate_profiles(candidate_id);
CREATE INDEX idx_candidate_profiles_embedding ON candidate_profiles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE candidate_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON candidate_profiles;
CREATE POLICY "Service role full access" ON candidate_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read" ON candidate_profiles;
CREATE POLICY "Authenticated users can read" ON candidate_profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- 3. Table job_profiles avec embeddings
CREATE TABLE IF NOT EXISTS job_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id text NOT NULL UNIQUE,
  title text,
  skills text[],
  description text,
  requirements text,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_profiles_job_id ON job_profiles(job_id);
CREATE INDEX idx_job_profiles_embedding ON job_profiles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE job_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access" ON job_profiles;
CREATE POLICY "Service role full access" ON job_profiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Authenticated users can read" ON job_profiles;
CREATE POLICY "Authenticated users can read" ON job_profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- 4. Fonction RPC cosine similarity
CREATE OR REPLACE FUNCTION cosine_similarity_match(
  p_candidate_id text, 
  p_job_id text
)
RETURNS float AS $$
  SELECT 1 - (c.embedding <=> j.embedding)
  FROM candidate_profiles c, job_profiles j
  WHERE c.candidate_id = p_candidate_id
  AND j.job_id = p_job_id
  AND c.embedding IS NOT NULL
  AND j.embedding IS NOT NULL
$$ LANGUAGE sql STABLE;
