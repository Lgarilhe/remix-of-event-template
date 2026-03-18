-- Clean up redundant policy on message_analysis_cache (now covered by the org-filtered one)
DROP POLICY IF EXISTS "Users can update own cache" ON public.message_analysis_cache;
