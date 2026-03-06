
-- 1. Create organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. Create organization_members table
CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- 3. Add active_organization_id to profiles
ALTER TABLE public.profiles ADD COLUMN active_organization_id uuid REFERENCES public.organizations(id);

-- 4. Add organization_id to business tables (nullable for backward compat)
ALTER TABLE public.sourcing_projects ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.search_history ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.job_candidate_status ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.outreach_sequences ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.sequence_steps ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.sequence_enrollments ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.sequence_step_executions ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.saved_filter_presets ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.inmail_queue ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.qualification_sessions ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.candidate_evaluations ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.call_coaching_sessions ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.candidate_portal_tokens ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.chat_categories ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.candidate_notes ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.candidate_reminders ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.nurturing_opportunities ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

-- 5. Security definer function to get user's active org
CREATE OR REPLACE FUNCTION public.get_user_org_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT active_organization_id
  FROM public.profiles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- 6. Security definer function to check org membership
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

-- 7. Function to get user role in org
CREATE OR REPLACE FUNCTION public.get_org_role(_user_id uuid, _org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.organization_members
  WHERE user_id = _user_id AND organization_id = _org_id
  LIMIT 1
$$;

-- 8. Trigger: auto-add creator as owner when org is created
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  
  -- Set as active org if user has none
  UPDATE public.profiles
  SET active_organization_id = NEW.id
  WHERE user_id = NEW.created_by
    AND active_organization_id IS NULL;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_organization_created
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_organization();

-- 9. Updated_at trigger for organizations
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 10. RLS policies for organizations
CREATE POLICY "Members can view their organizations"
  ON public.organizations FOR SELECT
  USING (public.is_org_member(auth.uid(), id));

CREATE POLICY "Authenticated users can create organizations"
  ON public.organizations FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Owners can update their organizations"
  ON public.organizations FOR UPDATE
  USING (public.get_org_role(auth.uid(), id) = 'owner');

CREATE POLICY "Owners can delete their organizations"
  ON public.organizations FOR DELETE
  USING (public.get_org_role(auth.uid(), id) = 'owner');

-- 11. RLS policies for organization_members
CREATE POLICY "Members can view org members"
  ON public.organization_members FOR SELECT
  USING (public.is_org_member(auth.uid(), organization_id));

CREATE POLICY "Owners and admins can add members"
  ON public.organization_members FOR INSERT
  WITH CHECK (public.get_org_role(auth.uid(), organization_id) IN ('owner', 'admin'));

CREATE POLICY "Owners can update member roles"
  ON public.organization_members FOR UPDATE
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');

CREATE POLICY "Owners can remove members"
  ON public.organization_members FOR DELETE
  USING (public.get_org_role(auth.uid(), organization_id) = 'owner');

-- Allow the trigger to insert the first member (owner) via service-level
CREATE POLICY "Service role can manage members"
  ON public.organization_members FOR ALL
  USING (auth.role() = 'service_role');
