
-- Allow creators to see their own org (needed for INSERT...RETURNING)
CREATE POLICY "Creators can view their organizations"
  ON public.organizations FOR SELECT
  USING (auth.uid() = created_by);
