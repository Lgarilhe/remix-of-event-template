
-- 1. Add organization_id to sequence_analytics for direct RLS filtering
ALTER TABLE public.sequence_analytics 
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- 2. Backfill from outreach_sequences
UPDATE public.sequence_analytics sa
SET organization_id = os.organization_id
FROM public.outreach_sequences os
WHERE os.id = sa.sequence_id
  AND sa.organization_id IS NULL;

-- 3. Fix sequence_steps: replace permissive policy
DROP POLICY IF EXISTS "Anyone can view sequence steps" ON public.sequence_steps;

CREATE POLICY "Organization members can view sequence steps"
ON public.sequence_steps
FOR SELECT TO authenticated
USING (organization_id = get_user_org_id(auth.uid()));

-- 4. Fix sequence_analytics: replace permissive policy
DROP POLICY IF EXISTS "Anyone can view sequence analytics" ON public.sequence_analytics;

CREATE POLICY "Organization members can view sequence analytics"
ON public.sequence_analytics
FOR SELECT TO authenticated
USING (organization_id = get_user_org_id(auth.uid()));
