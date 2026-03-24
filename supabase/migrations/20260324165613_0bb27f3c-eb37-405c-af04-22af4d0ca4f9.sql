CREATE POLICY "Anyone can read public recruiter profiles"
ON public.profiles
FOR SELECT
USING (
  public_slug IS NOT NULL 
  AND recruiter_bio IS NOT NULL
);