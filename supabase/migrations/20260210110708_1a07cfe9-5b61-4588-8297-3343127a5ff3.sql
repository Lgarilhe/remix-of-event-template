
-- Allow anon to insert enrollments and step executions (for preview/demo usage)
DROP POLICY IF EXISTS "Users can create their enrollments" ON public.sequence_enrollments;
CREATE POLICY "Anyone can create enrollments" ON public.sequence_enrollments FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update their enrollments" ON public.sequence_enrollments;
CREATE POLICY "Anyone can update enrollments" ON public.sequence_enrollments FOR UPDATE USING (true);

-- Also allow inserting step executions
DROP POLICY IF EXISTS "Users can manage their step executions" ON public.sequence_step_executions;
CREATE POLICY "Anyone can manage step executions" ON public.sequence_step_executions FOR ALL USING (true) WITH CHECK (true);
