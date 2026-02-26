-- Add calendly_link to sourcing_projects
ALTER TABLE public.sourcing_projects
ADD COLUMN calendly_link text NULL;