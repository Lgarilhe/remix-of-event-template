-- Index mission lookups and project FK cascades without scanning every agent.
CREATE INDEX IF NOT EXISTS sourcing_agents_project
  ON public.sourcing_agents USING btree (project_id);

-- Cover the composite FK for cascades and organization/mission/actor scope checks.
CREATE INDEX IF NOT EXISTS sourcing_agent_candidates_agent_scope
  ON public.sourcing_agent_candidates USING btree (agent_id, organization_id, project_id, created_by);
