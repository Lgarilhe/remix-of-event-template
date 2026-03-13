import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1';

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
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new HttpError(401, 'Missing authorization header');
    }

    const body = await req.json();
    const { action, organization_id: requestedOrgId, ...params } = body ?? {};

    if (typeof action !== 'string' || !action.trim()) {
      throw new HttpError(400, 'Action requise');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      throw new HttpError(401, 'Unauthorized');
    }

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

    const { data: membership } = await adminClient
      .from('organization_members')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      throw new HttpError(403, 'Forbidden');
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
        // List all connected accounts
        const response = await fetchWithTimeout(`${baseUrl}/accounts`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();
        // Filter only LinkedIn accounts and extract subscription info
        const linkedinAccounts = await Promise.all((data.items || [])
          .filter((acc: { type: string }) => acc.type === 'LINKEDIN')
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

      case 'hosted_auth_link': {
        // Generate a hosted auth link for white-label LinkedIn connection
        const { success_redirect_url, failure_redirect_url, notify_url, org_name } = params;

        const hostedBody: Record<string, unknown> = {
          type: 'create',
          providers: ['LINKEDIN'],
          api_url: `https://${dsn}`,
          expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString().replace(/(\.\d{3})\d*Z/, '$1Z'),
          bypass_success_screen: false,
          disabled_options: ['proxy', 'autoproxy', 'sync_limit', 'language'],
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
        // Unfortunately, LinkedIn doesn't expose contracts via standard Voyager API
        // We'll try to get account details which may contain contract info
        const { account_id } = params;
        
        if (!account_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'Account ID requis' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get full account details which may contain contract information
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

        // Extract any contract/seat information from connection_params
        const connectionParams = accountData.connection_params || {};
        const imParams = connectionParams.im || {};
        const premiumFeatures = imParams.premiumFeatures || [];
        
        // Check for recruiter seats/contracts in the raw data
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

        // The Unipile API doesn't currently expose multiple Recruiter contracts
        // This would need to be requested from Unipile support as a feature
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
            // Contracts would go here if supported
            contracts: [],
          }),
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
