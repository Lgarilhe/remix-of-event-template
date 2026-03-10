
-- Agent conversations table
CREATE TABLE public.agent_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  created_by uuid NOT NULL,
  job_id text,
  job_title text,
  project_id uuid REFERENCES public.sourcing_projects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'calibrating',
  search_config jsonb DEFAULT '{}'::jsonb,
  results_summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Agent messages table
CREATE TABLE public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for agent_conversations
CREATE POLICY "Users can view their org conversations"
  ON public.agent_conversations FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "Users can create conversations"
  ON public.agent_conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update their org conversations"
  ON public.agent_conversations FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- RLS policies for agent_messages
CREATE POLICY "Users can view messages in their org conversations"
  ON public.agent_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
    AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));

CREATE POLICY "Users can insert messages in their org conversations"
  ON public.agent_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.agent_conversations ac
    WHERE ac.id = conversation_id
    AND ac.organization_id = public.get_user_org_id(auth.uid())
  ));

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;

-- Updated_at trigger for conversations
CREATE TRIGGER update_agent_conversations_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for fast queries
CREATE INDEX idx_agent_conversations_org ON public.agent_conversations(organization_id, created_at DESC);
CREATE INDEX idx_agent_messages_conv ON public.agent_messages(conversation_id, created_at ASC);
