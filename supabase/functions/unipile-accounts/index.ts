import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';
import { requireAuth } from "../_shared/require-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Timeout wrapper for all external fetch calls (Unipile, Anthropic, Notion)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Resolve Unipile credentials for a specific organization only.
 * No global fallback to avoid cross-tenant data leaks.
 */
async function resolveUnipileCredentials(organizationId: string): Promise<{ apiKey: string; dsn: string } | null> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data } = await sb
      .from('organization_integrations')
      .select('unipile_api_key, unipile_dsn, unipile_connected')
      .eq('organization_id', organizationId)
      .single();

    if (data?.unipile_connected && data?.unipile_api_key && data?.unipile_dsn) {
      const rawDsn = data.unipile_dsn;
      const dsn = rawDsn.startsWith('http') ? rawDsn.replace(/^https?:\/\//, '') : rawDsn;
      console.log(`[unipile-accounts] Using org-specific credentials for org ${organizationId}`);
      return { apiKey: data.unipile_api_key, dsn };
    }
  } catch (e) {
    console.warn('[unipile-accounts] Failed to resolve org credentials:', e);
  }

  // Unipile is a platform-level integration (one account shared by all orgs).
  // Fall back to env vars for orgs that haven't configured org-specific credentials.
  const envApiKey = Deno.env.get('UNIPILE_API_KEY');
  const envDsn = Deno.env.get('UNIPILE_DSN');
  if (envApiKey && envDsn) {
    const dsn = envDsn.startsWith('http') ? envDsn.replace(/^https?:\/\//, '') : envDsn;
    console.log(`[unipile-accounts] Using platform env var credentials (org ${organizationId} has no org-specific config)`);
    return { apiKey: envApiKey, dsn };
  }

  return null;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ===== AUTH CHECK =====
    let auth;
    try {
      auth = await requireAuth(req, corsHeaders);
    } catch (authResponse) {
      return authResponse as Response;
    }
    if (!auth.userId) throw new HttpError(401, 'User authentication required');

    const body = await req.json();
    const { action, organization_id: requestedOrgId, ...params } = body ?? {};

    if (typeof action !== 'string' || !action.trim()) {
      throw new HttpError(400, 'Action requise');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const user = { id: auth.userId as string };

    let organizationId = typeof requestedOrgId === 'string' ? requestedOrgId : null;

    if (!organizationId) {
      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .select('active_organization_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        throw new HttpError(400, 'Impossible de déterminer l’organisation active');
      }

      organizationId = profile?.active_organization_id ?? null;
    }

    if (!organizationId) {
      throw new HttpError(400, 'Aucune organisation active');
    }

    const keyPrefix = supabaseServiceRoleKey.slice(0, 12);
    const { data: membership, error: membershipError } = await adminClient
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      console.error('[unipile-accounts] Membership check failed', {
        requestedOrgId: organizationId,
        userId: user.id,
        authMethod: auth.method,
        errorMsg: membershipError?.message,
        errorCode: membershipError?.code,
        keyPrefix,
        sbSecretDefined: Boolean(Deno.env.get('SB_SECRET_KEY')),
      });
      throw new HttpError(403, `Forbidden — user=${user.id} org=${organizationId} err=${membershipError?.message ?? 'no row'} keyPrefix=${keyPrefix} sbSecretDefined=${Boolean(Deno.env.get('SB_SECRET_KEY'))}`);
    }

    const credentials = await resolveUnipileCredentials(organizationId);
    if (!credentials) {
      return new Response(
        JSON.stringify({ success: false, error: 'LinkedIn non configuré pour cette organisation' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { apiKey, dsn } = credentials;
    const baseUrl = `https://${dsn}/api/v1`;

    switch (action) {
      case 'list': {
        // Résoudre d'abord les account_ids LinkedIn associés à l'org courante
        // dans member_linkedin_accounts. Sans ce filtre, on renverrait TOUS les
        // comptes Unipile du tenant partagé (fuite cross-tenant quand plusieurs
        // clients utilisent la même Unipile platform key).
        const { data: memberAccounts, error: memberAccountsError } = await adminClient
          .from('member_linkedin_accounts')
          .select('linkedin_account_id')
          .eq('organization_id', organizationId);

        if (memberAccountsError) {
          console.error('[unipile-accounts] Failed to load org account IDs:', memberAccountsError);
        }

        const allowedAccountIds = new Set(
          (memberAccounts ?? [])
            .map((r: any) => r?.linkedin_account_id)
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
        );

        // List all connected accounts from Unipile
        const response = await fetchWithTimeout(`${baseUrl}/accounts`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();
        // Filter only LinkedIn accounts owned by this org
        const linkedinAccounts = await Promise.all((data.items || [])
          .filter((acc: { type: string; id: string }) => acc.type === 'LINKEDIN' && allowedAccountIds.has(acc.id))
          .map(async (acc: { 
            id: string; 
            name: string; 
            connection_params?: {
              im?: {
                premiumFeatures?: string[];
              };
            };
            sources: Array<{ 
              status: string;
            }> 
          }) => {
            // Check for premium features (recruiter, sales_navigator)
            const premiumFeatures = acc.connection_params?.im?.premiumFeatures || [];
            const hasRecruiter = premiumFeatures.some((f: string) => 
              f.toLowerCase().includes('recruiter')
            );
            const hasSalesNavigator = premiumFeatures.some((f: string) => 
              f.toLowerCase().includes('sales') || f.toLowerCase().includes('navigator')
            );
            
            // Get main status from sources
            const sources = acc.sources || [];
            const okSource = sources.find((s: { status: string }) => s.status === 'OK');
            const mainStatus = okSource?.status || sources[0]?.status || 'UNKNOWN';

            // Fetch profile picture via /users/me
            let profilePictureUrl: string | null = null;
            try {
              const profileUrl = `${baseUrl}/users/me?account_id=${acc.id}`;
              console.log(`[accounts] Fetching profile picture from: ${profileUrl}`);
              const profileRes = await fetchWithTimeout(profileUrl, {
                headers: { 'X-API-KEY': apiKey!, 'Accept': 'application/json' },
              });
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                console.log(`[accounts] Profile data keys: ${Object.keys(profileData).join(', ')}`);
                console.log(`[accounts] profile_picture_url: ${profileData.profile_picture_url}`);
                profilePictureUrl = profileData.profile_picture_url || null;
              } else {
                console.warn(`[accounts] Profile fetch failed: ${profileRes.status} ${profileRes.statusText}`);
              }
            } catch (e) {
              console.warn(`[accounts] Failed to fetch profile picture for ${acc.id}:`, e);
            }
            
            return {
              id: acc.id,
              name: acc.name,
              identifier: acc.name,
              status: mainStatus,
              profile_picture_url: profilePictureUrl,
              subscriptions: {
                classic: true,
                recruiter: hasRecruiter,
                sales_navigator: hasSalesNavigator,
              },
            };
          }));
        
        return new Response(
          JSON.stringify({ success: true, accounts: linkedinAccounts }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list_email': {
        // Résoudre d'abord les account_ids Email associés à l'org courante
        // (même logique multi-tenant que pour 'list' ci-dessus).
        const { data: memberEmailAccounts, error: memberEmailAccountsError } = await adminClient
          .from('member_email_accounts')
          .select('email_account_id')
          .eq('organization_id', organizationId);

        if (memberEmailAccountsError) {
          console.error('[unipile-accounts] Failed to load org email account IDs:', memberEmailAccountsError);
        }

        const allowedEmailAccountIds = new Set(
          (memberEmailAccounts ?? [])
            .map((r: any) => r?.email_account_id)
            .filter((id: any): id is string => typeof id === 'string' && id.length > 0),
        );

        // List all connected email accounts (Gmail, Outlook, IMAP)
        const emailResponse = await fetchWithTimeout(`${baseUrl}/accounts`, {
          headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
        });

        const emailData = await emailResponse.json();
        const EMAIL_TYPES = new Set(['GOOGLE', 'OUTLOOK', 'IMAP', 'MAIL', 'GMAIL']);
        const emailAccounts = (emailData.items || [])
          .filter((acc: { type: string; id: string }) => EMAIL_TYPES.has(acc.type?.toUpperCase()) && allowedEmailAccountIds.has(acc.id))
          .map((acc: { id: string; name: string; type: string; sources: Array<{ status: string }>; connection_params?: { mail?: { imap_user?: string; smtp_user?: string } } }) => {
            const sources = acc.sources || [];
            const okSource = sources.find((s: { status: string }) => s.status === 'OK');
            const mainStatus = okSource?.status || sources[0]?.status || 'UNKNOWN';
            // Extract actual email address from connection_params (imap_user or smtp_user)
            const mailParams = acc.connection_params?.mail;
            const emailAddress = mailParams?.imap_user || mailParams?.smtp_user || acc.name;
            return {
              id: acc.id,
              name: acc.name,
              identifier: emailAddress,
              type: acc.type,
              status: mainStatus,
            };
          });

        return new Response(
          JSON.stringify({ success: true, accounts: emailAccounts }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'hosted_auth_link': {
        // Generate a hosted auth link for white-label account connection (LinkedIn, WhatsApp, or Email)
        const { success_redirect_url, failure_redirect_url, notify_url, org_name, providers: requestedProviders } = params;

        // Allow caller to specify provider(s), default to LinkedIn
        const resolvedProviders = Array.isArray(requestedProviders) && requestedProviders.length > 0
          ? requestedProviders
          : ['LINKEDIN'];

        // WhatsApp uses QR code auth — disable credential-based options
        const isWhatsApp = resolvedProviders.includes('WHATSAPP');
        const defaultDisabled = ['proxy', 'autoproxy', 'sync_limit', 'language'];
        const disabledOptions = isWhatsApp
          ? [...defaultDisabled, 'credentials_auth', 'cookie_auth']
          : defaultDisabled;

        const hostedBody: Record<string, unknown> = {
          type: 'create',
          providers: resolvedProviders,
          api_url: `https://${dsn}`,
          expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/(\.\d{3})\d*Z/, '$1Z'),
          bypass_success_screen: false,
          disabled_options: disabledOptions,
        };

        if (success_redirect_url) hostedBody.success_redirect_url = success_redirect_url;
        if (failure_redirect_url) hostedBody.failure_redirect_url = failure_redirect_url;
        if (notify_url) hostedBody.notify_url = notify_url;
        if (org_name) hostedBody.name = org_name;

        console.log('[hosted_auth_link] Generating link with body:', JSON.stringify(hostedBody));

        const response = await fetchWithTimeout(`https://${dsn}/api/v1/hosted/accounts/link`, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(hostedBody),
        });

        const data = await response.json();
        console.log('[hosted_auth_link] Response:', response.status, JSON.stringify(data));

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Erreur de génération du lien' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, url: data.url }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'connect_cookie': {
        // Connect LinkedIn account with cookie (li_at)
        const { access_token, user_agent } = params;
        
        if (!access_token) {
          return new Response(
            JSON.stringify({ success: false, error: 'Cookie li_at requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        console.log('Connecting with cookie, length:', access_token.length);

        const response = await fetchWithTimeout(`${baseUrl}/accounts`, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            provider: 'LINKEDIN',
            access_token,
            user_agent: user_agent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          }),
        });

        const data = await response.json();
        console.log('Unipile response status:', response.status, 'data:', JSON.stringify(data));

        if (!response.ok) {
          // Provide more specific error messages
          let errorMessage = data.message || data.error || 'Erreur de connexion';
          if (response.status === 401) {
            errorMessage = 'Cookie li_at invalide ou expiré. Veuillez récupérer un nouveau cookie.';
          } else if (response.status === 409) {
            errorMessage = 'Ce compte LinkedIn est déjà connecté.';
          }
          return new Response(
            JSON.stringify({ success: false, error: errorMessage }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, ...data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'connect_credentials': {
        // Connect LinkedIn account with username/password
        const { username, password } = params;
        
        if (!username || !password) {
          return new Response(
            JSON.stringify({ success: false, error: 'Email et mot de passe requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fetchWithTimeout(`${baseUrl}/accounts`, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            provider: 'LINKEDIN',
            username,
            password,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Erreur de connexion' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, ...data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'solve_checkpoint': {
        // Solve 2FA/OTP checkpoint
        const { account_id, code } = params;
        
        if (!account_id || !code) {
          return new Response(
            JSON.stringify({ success: false, error: 'Account ID et code requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fetchWithTimeout(`${baseUrl}/accounts/checkpoint`, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            provider: 'LINKEDIN',
            account_id,
            code,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Code invalide' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, ...data }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'disconnect': {
        // Disconnect an account
        const { account_id } = params;
        
        if (!account_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Account ID requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fetchWithTimeout(`${baseUrl}/accounts/${account_id}`, {
          method: 'DELETE',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

      if (!response.ok) {
          const data = await response.json();
          // Always return 200 to avoid Supabase client interpreting upstream errors as function errors
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: data.message || 'Erreur de déconnexion',
              status: response.status,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'inmail_balance': {
        // Get InMail balance for an account
        // https://developer.unipile.com/reference/linkedincontroller_getinmailbalance
        const { account_id } = params;
        
        if (!account_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Account ID requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const response = await fetchWithTimeout(`${baseUrl}/linkedin/inmail_balance?account_id=${account_id}`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();
        console.log('InMail balance response:', response.status, JSON.stringify(data));

        if (!response.ok) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: data.message || data.detail || 'Erreur lors de la récupération du solde InMail',
              status: response.status,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // The API returns: { object: "LinkedinInmailBalance", premium?: number, recruiter?: number, sales_navigator?: number }
        return new Response(
          JSON.stringify({ 
            success: true, 
            balance: {
              premium: data.premium ?? null,
              recruiter: data.recruiter ?? null,
              sales_navigator: data.sales_navigator ?? null,
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list_recruiter_contracts': {
        // List Recruiter contracts available for the account
        const { account_id } = params;
        
        if (!account_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Account ID requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const accountResponse = await fetchWithTimeout(`${baseUrl}/accounts/${account_id}`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (!accountResponse.ok) {
          const errorData = await accountResponse.json();
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Impossible de récupérer les détails du compte',
              details: errorData,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const accountData = await accountResponse.json();
        console.log('Account details:', JSON.stringify(accountData).slice(0, 2000));

        const connectionParams = accountData.connection_params || {};
        const imParams = connectionParams.im || {};
        const premiumFeatures = imParams.premiumFeatures || [];
        
        const recruiterInfo = {
          has_recruiter: premiumFeatures.some((f: string) => 
            f.toLowerCase().includes('recruiter')
          ),
          has_sales_navigator: premiumFeatures.some((f: string) => 
            f.toLowerCase().includes('sales') || f.toLowerCase().includes('navigator')
          ),
          premium_features: premiumFeatures,
          raw_connection_params: connectionParams,
        };

        return new Response(
          JSON.stringify({ 
            success: true, 
            message: 'Multi-contract Recruiter n\'est pas encore supporté par l\'API Unipile. Contactez le support Unipile pour demander cette fonctionnalité.',
            recruiter_info: recruiterInfo,
            account: {
              id: accountData.id,
              name: accountData.name,
              type: accountData.type,
              status: accountData.sources?.[0]?.status || 'UNKNOWN',
            },
            contracts: [],
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update_proxy': {
        // Update proxy configuration for an account via PATCH /api/v1/accounts/{id}
        // Supports 3 modes: country, ip, custom
        const {
          account_id,
          proxy_mode = 'country',
          proxy_country,
          proxy_ip,
          proxy_protocol,
          proxy_host,
          proxy_port,
          proxy_username,
          proxy_password,
        } = params;

        if (!account_id) {
          throw new HttpError(400, 'Account ID requis');
        }

        // Build the PATCH body according to Unipile spec
        let patchBody: Record<string, unknown> = {};
        let dbUpdates: Record<string, unknown> = {
          proxy_updated_at: new Date().toISOString(),
        };

        switch (proxy_mode) {
          case 'country': {
            if (!proxy_country || typeof proxy_country !== 'string' || proxy_country.length !== 2) {
              throw new HttpError(400, 'Le code pays doit être au format ISO 3166-1 alpha-2 (ex: FR, US, DE)');
            }
            const country = proxy_country.toUpperCase();
            patchBody = { country };
            dbUpdates = {
              ...dbUpdates,
              proxy_mode: 'country',
              proxy_country: country,
              proxy_host: null,
              proxy_port: null,
              proxy_protocol: null,
            };
            break;
          }
          case 'ip': {
            const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (!proxy_ip || !ipRegex.test(proxy_ip)) {
              throw new HttpError(400, 'Adresse IP invalide (format IPv4 attendu)');
            }
            patchBody = { ip: proxy_ip };
            dbUpdates = {
              ...dbUpdates,
              proxy_mode: 'ip',
              proxy_country: proxy_ip,
              proxy_host: null,
              proxy_port: null,
              proxy_protocol: null,
            };
            break;
          }
          case 'custom': {
            if (!proxy_host || !proxy_port || !proxy_protocol) {
              throw new HttpError(400, 'Host, port et protocole requis pour le mode custom');
            }
            const proxyObj: Record<string, unknown> = {
              protocol: proxy_protocol,
              host: proxy_host,
              port: Number(proxy_port),
            };
            if (proxy_username) proxyObj.username = proxy_username;
            if (proxy_password) proxyObj.password = proxy_password;
            patchBody = { proxy: proxyObj };
            dbUpdates = {
              ...dbUpdates,
              proxy_mode: 'custom',
              proxy_country: null,
              proxy_host: proxy_host,
              proxy_port: Number(proxy_port),
              proxy_protocol: proxy_protocol,
            };
            break;
          }
          default:
            throw new HttpError(400, 'Mode proxy invalide. Valeurs acceptées : country, ip, custom');
        }

        console.log(`[update_proxy] Patching account ${account_id} (mode: ${proxy_mode}) with body:`, JSON.stringify(patchBody));

        const patchResponse = await fetchWithTimeout(`${baseUrl}/accounts/${account_id}`, {
          method: 'PATCH',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(patchBody),
        });

        const patchData = await patchResponse.json();
        console.log(`[update_proxy] Response ${patchResponse.status}:`, JSON.stringify(patchData));

        if (!patchResponse.ok) {
          const errorMsg = patchData.message || patchData.error || 'Erreur de configuration du proxy';
          // Track error in DB
          await adminClient
            .from('member_linkedin_accounts')
            .update({
              proxy_last_error: errorMsg,
              proxy_is_active: false,
              proxy_updated_at: new Date().toISOString(),
            })
            .eq('linkedin_account_id', account_id)
            .eq('organization_id', organizationId);

          return new Response(
            JSON.stringify({ success: false, error: errorMsg, status: patchResponse.status }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Success: update DB with config + clear error
        await adminClient
          .from('member_linkedin_accounts')
          .update({
            ...dbUpdates,
            proxy_is_active: true,
            proxy_last_error: null,
          })
          .eq('linkedin_account_id', account_id)
          .eq('organization_id', organizationId);

        return new Response(
          JSON.stringify({ 
            success: true, 
            account_id: patchData.account_id || account_id,
            proxy_mode,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add_reaction': {
        const { message_id, reaction } = params;
        if (!message_id || !reaction) {
          throw new HttpError(400, 'message_id et reaction requis');
        }
        console.log(`[add_reaction] Adding "${reaction}" to message ${message_id}`);
        const reactionRes = await fetchWithTimeout(`${baseUrl}/messages/${message_id}/reaction`, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ reaction }),
        });
        const reactionData = await reactionRes.json();
        console.log(`[add_reaction] Response ${reactionRes.status}:`, JSON.stringify(reactionData));
        if (!reactionRes.ok) {
          return new Response(
            JSON.stringify({ success: false, error: reactionData.message || 'Erreur lors de l\'ajout de la réaction' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, ...reactionData }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete_message': {
        const { message_id } = params;
        if (!message_id) {
          throw new HttpError(400, 'message_id requis');
        }
        console.log(`[delete_message] Deleting message ${message_id}`);
        const delMsgRes = await fetchWithTimeout(`${baseUrl}/messages/${message_id}`, {
          method: 'DELETE',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });
        const delMsgData = await delMsgRes.json();
        console.log(`[delete_message] Response ${delMsgRes.status}:`, JSON.stringify(delMsgData));
        if (!delMsgRes.ok) {
          return new Response(
            JSON.stringify({ success: false, error: delMsgData.message || 'Impossible de supprimer le message' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, ...delMsgData }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete_chat': {
        const { chat_id } = params;
        if (!chat_id) {
          throw new HttpError(400, 'chat_id requis');
        }
        console.log(`[delete_chat] Deleting chat ${chat_id}`);
        const delChatRes = await fetchWithTimeout(`${baseUrl}/chats/${chat_id}`, {
          method: 'DELETE',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });
        const delChatData = await delChatRes.json();
        console.log(`[delete_chat] Response ${delChatRes.status}:`, JSON.stringify(delChatData));
        if (!delChatRes.ok) {
          return new Response(
            JSON.stringify({ success: false, error: delChatData.message || 'Impossible de supprimer la conversation' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({ success: true, ...delChatData }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list_invitations_received': {
        const { account_id, limit: invLimit, cursor: invCursor } = params;
        if (!account_id) {
          throw new HttpError(400, 'Account ID requis');
        }
        let invUrl = `${baseUrl}/users/invite/received?account_id=${account_id}&limit=${invLimit || 20}`;
        if (invCursor) invUrl += `&cursor=${invCursor}`;

        console.log(`[list_invitations_received] GET ${invUrl}`);
        const invRes = await fetchWithTimeout(invUrl, {
          headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
        });
        const invData = await invRes.json();
        console.log(`[list_invitations_received] Response ${invRes.status}: ${JSON.stringify(invData).slice(0, 500)}`);

        if (!invRes.ok) {
          return new Response(
            JSON.stringify({ success: false, error: invData.message || 'Erreur lors de la récupération des invitations' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Log inviter object structure for debugging
        if (invData.items?.[0]) {
          console.log(`[list_invitations_received] First item keys: ${JSON.stringify(Object.keys(invData.items[0]))}`);
          if (invData.items[0].inviter) {
            console.log(`[list_invitations_received] Inviter keys: ${JSON.stringify(Object.keys(invData.items[0].inviter))}`);
          }
        }

        const mappedInvitations = (invData.items || []).map((item: any) => {
          const inv = item.inviter || {};
          return {
            id: item.id,
            inviter_name: inv.inviter_name || item.invited_user || 'Inconnu',
            inviter_id: inv.inviter_id || item.invited_user_id || '',
            inviter_public_identifier: inv.inviter_public_identifier || item.invited_user_public_id || '',
            inviter_description: inv.inviter_description || null,
            inviter_picture_url: inv.inviter_profile_picture_url || inv.inviter_picture_url || inv.profile_picture_url || item.invited_user_profile_picture_url || null,
            invitation_text: item.invitation_text || null,
            date: item.date || '',
            parsed_datetime: item.parsed_datetime || null,
            shared_secret: item.specifics?.shared_secret || '',
            provider: item.specifics?.provider || 'LINKEDIN',
          };
        });

        return new Response(
          JSON.stringify({ success: true, invitations: mappedInvitations, cursor: invData.cursor || null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'handle_invitation_received': {
        const { account_id, invitation_id, invitation_action: invAction, action: legacyAction, shared_secret, provider } = params;
        const finalAction = invAction || legacyAction;
        if (!account_id || !invitation_id || !finalAction || !shared_secret) {
          throw new HttpError(400, 'account_id, invitation_id, invitation_action et shared_secret requis');
        }
        if (finalAction !== 'accept' && finalAction !== 'decline') {
          throw new HttpError(400, 'invitation_action doit être "accept" ou "decline"');
        }

        console.log(`[handle_invitation_received] ${finalAction} invitation ${invitation_id}`);
        const handleRes = await fetchWithTimeout(`${baseUrl}/users/invite/received/${invitation_id}`, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            provider: provider || 'LINKEDIN',
            shared_secret,
            account_id,
            action: finalAction,
          }),
        });
        const handleData = await handleRes.json();
        console.log(`[handle_invitation_received] Response ${handleRes.status}:`, JSON.stringify(handleData));

        if (!handleRes.ok) {
          return new Response(
            JSON.stringify({ success: false, error: handleData.message || `Erreur lors du traitement de l'invitation` }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, status: handleData.status || (finalAction === 'accept' ? 'ACCEPTED' : 'DECLINED') }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'bulk_handle_invitations': {
        const { account_id, invitations: bulkInvitations } = params;
        if (!account_id || !Array.isArray(bulkInvitations) || bulkInvitations.length === 0) {
          throw new HttpError(400, 'account_id et invitations[] requis');
        }

        console.log(`[bulk_handle_invitations] Processing ${bulkInvitations.length} invitations`);
        const results: Array<{ invitation_id: string; status: string; error?: string }> = [];

        for (const inv of bulkInvitations) {
          const { invitation_id, shared_secret, action: bulkAction } = inv as { invitation_id: string; shared_secret: string; action: string };
          try {
            const bulkRes = await fetchWithTimeout(`${baseUrl}/users/invite/received/${invitation_id}`, {
              method: 'POST',
              headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                provider: 'LINKEDIN',
                shared_secret,
                account_id,
                action: bulkAction,
              }),
            });
            const bulkData = await bulkRes.json();
            console.log(`[bulk] ${invitation_id}: ${bulkRes.status}`);

            if (bulkRes.status === 429) {
              results.push({ invitation_id, status: 'RATE_LIMITED', error: 'Rate limit atteint' });
              break; // Stop processing
            }

            if (!bulkRes.ok) {
              results.push({ invitation_id, status: 'ERROR', error: bulkData.message || 'Erreur' });
            } else {
              results.push({ invitation_id, status: bulkData.status || (bulkAction === 'accept' ? 'ACCEPTED' : 'DECLINED') });
            }
          } catch (e) {
            results.push({ invitation_id, status: 'ERROR', error: e instanceof Error ? e.message : 'Erreur inconnue' });
          }

          // Anti-detection delay: 1.5s between calls
          if (bulkInvitations.indexOf(inv) < bulkInvitations.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        return new Response(
          JSON.stringify({ success: true, results }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_account_details': {
        // Get full details for an account, including proxy info
        const { account_id } = params;

        if (!account_id) {
          throw new HttpError(400, 'Account ID requis');
        }

        const detailResponse = await fetchWithTimeout(`${baseUrl}/accounts/${account_id}`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (!detailResponse.ok) {
          const errorData = await detailResponse.json();
          return new Response(
            JSON.stringify({ success: false, error: errorData.message || 'Compte introuvable' }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const detailData = await detailResponse.json();

        return new Response(
          JSON.stringify({ 
            success: true,
            account: {
              id: detailData.id,
              name: detailData.name,
              type: detailData.type,
              status: detailData.sources?.[0]?.status || 'UNKNOWN',
              proxy: detailData.proxy || null,
              connection_params: detailData.connection_params || null,
            },
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_attendee_picture': {
        const { attendee_id } = params;
        if (!attendee_id) {
          throw new HttpError(400, 'attendee_id requis');
        }

        try {
          const pictureRes = await fetchWithTimeout(`${baseUrl}/chat_attendees/${attendee_id}/picture`, {
            headers: { 'X-API-KEY': apiKey, 'Accept': 'image/*' },
          }, 10000);

          if (pictureRes.ok) {
            const contentType = pictureRes.headers.get('content-type') || 'image/jpeg';
            const buffer = await pictureRes.arrayBuffer();
            // Limit to ~500KB to avoid overly large base64 payloads
            if (buffer.byteLength > 500_000) {
              return new Response(
                JSON.stringify({ success: false, error: 'Image trop volumineuse' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const dataUrl = `data:${contentType};base64,${base64}`;
            return new Response(
              JSON.stringify({ success: true, data_url: dataUrl }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch (e) {
          console.warn('[get_attendee_picture] Binary fetch failed, trying metadata fallback:', e);
        }

        // Fallback: try metadata endpoint for picture_url
        try {
          const metaRes = await fetchWithTimeout(`${baseUrl}/chat_attendees/${attendee_id}`, {
            headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
          }, 10000);
          if (metaRes.ok) {
            const meta = await metaRes.json();
            if (meta.picture_url) {
              return new Response(
                JSON.stringify({ success: true, picture_url: meta.picture_url }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
          }
        } catch (e) {
          console.warn('[get_attendee_picture] Metadata fallback failed:', e);
        }

        return new Response(
          JSON.stringify({ success: false, error: 'Photo non disponible' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Action non reconnue' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error:', error);
    const status = error instanceof HttpError ? error.status : 500;
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erreur interne' }),
      { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
// trigger deploy 1776789992
