const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('UNIPILE_API_KEY');
    const dsn = Deno.env.get('UNIPILE_DSN');

    if (!apiKey || !dsn) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unipile not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { action, ...params } = await req.json();

    const baseUrl = `https://${dsn}/api/v1`;

    switch (action) {
      case 'list': {
        // List all connected accounts
        const response = await fetch(`${baseUrl}/accounts`, {
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        const data = await response.json();
        // Filter only LinkedIn accounts with OK or CREDENTIALS status
        const linkedinAccounts = (data.items || [])
          .filter((acc: { type: string }) => acc.type === 'LINKEDIN')
          .map((acc: { id: string; name: string; sources: Array<{ status: string }> }) => ({
            id: acc.id,
            name: acc.name,
            identifier: acc.name,
            status: acc.sources?.[0]?.status || 'UNKNOWN',
          }));
        
        return new Response(
          JSON.stringify({ success: true, accounts: linkedinAccounts }),
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

        const response = await fetch(`${baseUrl}/accounts`, {
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

        const response = await fetch(`${baseUrl}/accounts`, {
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

        const response = await fetch(`${baseUrl}/accounts/checkpoint`, {
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

        const response = await fetch(`${baseUrl}/accounts/${account_id}`, {
          method: 'DELETE',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          const data = await response.json();
          return new Response(
            JSON.stringify({ success: false, error: data.message || 'Erreur de déconnexion' }),
            { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
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
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Erreur interne' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
