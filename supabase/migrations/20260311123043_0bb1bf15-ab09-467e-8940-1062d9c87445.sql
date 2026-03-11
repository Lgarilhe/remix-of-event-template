CREATE POLICY "Authenticated users can insert analysis cache"
ON public.message_analysis_cache
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update analysis cache"
ON public.message_analysis_cache
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);