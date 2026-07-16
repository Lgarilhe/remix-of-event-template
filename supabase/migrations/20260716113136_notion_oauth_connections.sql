-- Personal Notion MCP OAuth connections for the in-app copilot.
--
-- Every member authorizes their own Notion identity. A grant is never shared
-- across members of the Konekt organization. All OAuth secrets are encrypted
-- with AES-GCM before they reach PostgreSQL and all three tables are service-
-- role only.

CREATE TABLE public.notion_mcp_oauth_clients (
  provider text PRIMARY KEY,
  client_id text NOT NULL,
  client_secret_ciphertext text,
  client_secret_nonce text,
  secret_key_version smallint NOT NULL DEFAULT 1,
  authorization_endpoint text NOT NULL,
  token_endpoint text NOT NULL,
  registration_endpoint text,
  revocation_endpoint text,
  resource text NOT NULL DEFAULT 'https://mcp.notion.com/mcp',
  requested_scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notion_oauth_client_secret_pair CHECK (
    (client_secret_ciphertext IS NULL) = (client_secret_nonce IS NULL)
  )
);

CREATE TABLE public.organization_notion_connections (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  oauth_provider text NOT NULL DEFAULT 'notion'
    REFERENCES public.notion_mcp_oauth_clients(provider) ON DELETE RESTRICT,
  connected boolean NOT NULL DEFAULT false,
  needs_reauthorization boolean NOT NULL DEFAULT false,

  -- Access + refresh tokens are encrypted together so a rotation is persisted
  -- atomically. grant_id and refresh_lease_id fence stale refresh workers.
  token_ciphertext text,
  token_nonce text,
  token_key_version smallint NOT NULL DEFAULT 1,
  token_type text,
  expires_at timestamptz,
  grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
  refresh_lease_id uuid,
  refresh_locked_until timestamptz,

  notion_user_id text,
  workspace_id text,
  email_domain text,
  connected_at timestamptz,
  last_refresh_at timestamptz,
  last_used_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT notion_token_cipher_pair CHECK ((token_ciphertext IS NULL) = (token_nonce IS NULL)),
  CONSTRAINT notion_connected_requires_encrypted_token CHECK (
    connected = false OR (token_ciphertext IS NOT NULL AND token_nonce IS NOT NULL)
  )
);

CREATE INDEX organization_notion_connections_user_idx
  ON public.organization_notion_connections (user_id);

CREATE TABLE public.notion_oauth_states (
  state_hash text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  return_to text NOT NULL,
  redirect_uri text NOT NULL,
  code_verifier_ciphertext text NOT NULL,
  code_verifier_nonce text NOT NULL,
  verifier_key_version smallint NOT NULL DEFAULT 1,
  oauth_provider text NOT NULL
    REFERENCES public.notion_mcp_oauth_clients(provider) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notion_oauth_state_hash_format CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT notion_oauth_state_short_lived CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '15 minutes'
  )
);

CREATE INDEX notion_oauth_states_expiry_idx ON public.notion_oauth_states (expires_at);

ALTER TABLE public.notion_mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_notion_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notion_oauth_states ENABLE ROW LEVEL SECURITY;

-- Defense in depth: frontend roles cannot read ciphertext, metadata or PKCE
-- state even if a permissive RLS policy is accidentally added later.
REVOKE ALL ON public.notion_mcp_oauth_clients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_notion_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notion_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notion_mcp_oauth_clients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_notion_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notion_oauth_states TO service_role;

CREATE TRIGGER update_notion_mcp_oauth_clients_updated_at
  BEFORE UPDATE ON public.notion_mcp_oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_org_notion_connections_updated_at
  BEFORE UPDATE ON public.organization_notion_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.organization_notion_connections IS
  'Per-user, AES-GCM-encrypted OAuth grants for the official Notion MCP used by the copilot.';
COMMENT ON TABLE public.notion_mcp_oauth_clients IS
  'Singleton durable DCR client for Notion MCP; optional secret is encrypted.';
COMMENT ON TABLE public.notion_oauth_states IS
  'Single-use OAuth state with AES-GCM-encrypted PKCE verifier; service-role only.';

-- Claim a short refresh lease atomically. Notion rotates refresh tokens and
-- warns that replay can revoke the whole grant, so only one worker may rotate
-- a given member grant at a time. grant_id + lease_id provide fencing against
-- a concurrent reconnect or disconnect.
CREATE OR REPLACE FUNCTION public.claim_notion_token_refresh(
  p_organization_id uuid,
  p_user_id uuid,
  p_lease_id uuid
)
RETURNS SETOF public.organization_notion_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.organization_notion_connections AS c
  SET refresh_lease_id = p_lease_id,
      refresh_locked_until = now() + interval '90 seconds'
  WHERE c.organization_id = p_organization_id
    AND c.user_id = p_user_id
    AND c.connected = true
    AND c.token_ciphertext IS NOT NULL
    AND (c.refresh_locked_until IS NULL OR c.refresh_locked_until < now())
  RETURNING c.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notion_token_refresh(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notion_token_refresh(uuid, uuid, uuid)
  TO service_role;
