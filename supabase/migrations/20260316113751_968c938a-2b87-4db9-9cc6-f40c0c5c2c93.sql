
ALTER TABLE public.member_linkedin_accounts
  ADD COLUMN IF NOT EXISTS proxy_mode text,
  ADD COLUMN IF NOT EXISTS proxy_host text,
  ADD COLUMN IF NOT EXISTS proxy_port integer,
  ADD COLUMN IF NOT EXISTS proxy_protocol text,
  ADD COLUMN IF NOT EXISTS proxy_last_error text,
  ADD COLUMN IF NOT EXISTS proxy_is_active boolean DEFAULT false;
