
-- Allow anon read access to sequence tables (edge functions already handle auth)
DROP POLICY "Users can view their own sequences" ON public.outreach_sequences;
CREATE POLICY "Anyone can view sequences" ON public.outreach_sequences FOR SELECT USING (true);

DROP POLICY "Users can view steps of their sequences" ON public.sequence_steps;
CREATE POLICY "Anyone can view sequence steps" ON public.sequence_steps FOR SELECT USING (true);

DROP POLICY "Users can view their enrollments" ON public.sequence_enrollments;
CREATE POLICY "Anyone can view sequence enrollments" ON public.sequence_enrollments FOR SELECT USING (true);

DROP POLICY "Users can view their step executions" ON public.sequence_step_executions;
CREATE POLICY "Anyone can view step executions" ON public.sequence_step_executions FOR SELECT USING (true);

DROP POLICY "Users can view their sequence analytics" ON public.sequence_analytics;
CREATE POLICY "Anyone can view sequence analytics" ON public.sequence_analytics FOR SELECT USING (true);
