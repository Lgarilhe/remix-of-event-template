// @ts-nocheck serve import removed
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Per-request Notion credentials — resolved inside handler, passed to helpers. */
interface NotionCreds { notionApiKey: string; candidatsDatabaseId: string; shortlistDatabaseId: string; }

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchWithTimeout(url, options);
    if (res.status === 429 && attempt < maxRetries) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
      await new Promise(r => setTimeout(r, (retryAfter * 1000) + Math.random() * 500));
      continue;
    }
    if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
      continue;
    }
    return res;
  }
  return fetchWithTimeout(url, options);
}

async function resolveOrgCredentials(orgId: string): Promise<NotionCreds | null> {
  const { data } = await supabase
    .from('organization_integrations')
    .select('notion_api_key, notion_candidats_db_id, notion_shortlist_db_id, notion_connected')
    .eq('organization_id', orgId)
    .single();

  if (!data?.notion_connected || !data.notion_api_key) {
    console.warn('[add-to-shortlist] Notion not configured for org', orgId, '— skipping');
    return null;
  }

  console.log('[add-to-shortlist] Using org-specific Notion credentials');
  return {
    notionApiKey: data.notion_api_key,
    candidatsDatabaseId: data.notion_candidats_db_id || Deno.env.get("NOTION_CANDIDATS_DB_ID")!,
    shortlistDatabaseId: data.notion_shortlist_db_id || Deno.env.get("NOTION_SHORTLIST_DB_ID")!,
  };
}

interface AddToShortlistData {
  // Candidate info
  name: string;
  headline?: string;
  linkedinUrl?: string;
  linkedinId?: string;
  email?: string;
  phone?: string;
  // Enriched profile data
  currentRole?: string;       // Titre du poste actuel
  seniority?: string;         // Junior, Confirmé, Sénior, Lead, Staff, Manager, Directeur
  domains?: string[];         // Domaine d'expertise (multi-select)
  yearsOfExperience?: number; // Nombre d'année d'expérience
  educationLevel?: string;    // Niveau d'étude
  // Job association
  jobId?: string;
  jobTitle?: string;
  clientName?: string;
  clientId?: string;
  // Organization context
  entity?: string;            // Konekt or Skalr
  accompagnement?: string;    // RPO, Succès, Coaching Skalr
  // Pipeline state
  etape?: string;             // Pressenti, Contacté, etc.
  etat?: string;              // Message à envoyer, En attente de réponse, etc.
  // Optional
  source?: string;
  commentaire?: string;       // Commentaires pressenti
}

// ── Notion API helpers ──────────────────────────────────────────────

async function notionQuery(databaseId: string, notionApiKey: string, filter: Record<string, unknown>) {
  const response = await fetchWithRetry(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filter, page_size: 1 }),
  });
  if (!response.ok) {
    console.error('Notion query error:', await response.text());
    return null;
  }
  return response.json();
}

async function createNotionPage(databaseId: string, notionApiKey: string, properties: Record<string, unknown>, children?: unknown[]) {
  const body: Record<string, unknown> = {
    parent: { database_id: databaseId },
    properties,
  };
  if (children?.length) body.children = children;

  const response = await fetchWithRetry('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.text();
    console.error('Notion API error:', error);
    throw new Error(`Failed to create Notion page: ${error}`);
  }
  return response.json();
}

async function updateNotionPage(pageId: string, notionApiKey: string, properties: Record<string, unknown>) {
  const response = await fetchWithRetry(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  });
  if (!response.ok) {
    const error = await response.text();
    console.error('Notion update error:', error);
    // Non-blocking — log but don't throw
  }
  return response.ok;
}

// ── Search helpers ──────────────────────────────────────────────────

async function searchCandidateByLinkedIn(linkedinUrl: string, creds: NotionCreds): Promise<string | null> {
  const data = await notionQuery(creds.candidatsDatabaseId, creds.notionApiKey, {
    property: 'URL Linkedin',
    url: { equals: linkedinUrl },
  });
  return data?.results?.[0]?.id ?? null;
}

async function searchCandidateByName(name: string, creds: NotionCreds): Promise<string | null> {
  const data = await notionQuery(creds.candidatsDatabaseId, creds.notionApiKey, {
    property: 'Nom',
    title: { equals: name },
  });
  return data?.results?.[0]?.id ?? null;
}

async function checkExistingShortlist(candidateId: string, creds: NotionCreds, jobId?: string): Promise<string | null> {
  const filters: unknown[] = [
    { property: 'Candidats', relation: { contains: candidateId } },
  ];
  if (jobId) {
    filters.push({ property: '💼 Postes', relation: { contains: jobId } });
  }
  const data = await notionQuery(creds.shortlistDatabaseId, creds.notionApiKey, { and: filters });
  return data?.results?.[0]?.id ?? null;
}

// ── Seniority mapper ────────────────────────────────────────────────

function computeSeniority(years?: number): string | null {
  if (years == null) return null;
  if (years <= 2) return 'Junior';
  if (years <= 5) return 'Confirmé';
  if (years <= 8) return 'Sénior';
  if (years <= 12) return 'Lead';
  return 'Staff';
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ── Auth: validate JWT and org membership ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseAuth = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data: AddToShortlistData & { organization_id?: string } = await req.json();

    if (data.organization_id) {
      const { data: membership } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', user.id)
        .eq('organization_id', data.organization_id)
        .maybeSingle();
      if (!membership) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!data.organization_id) throw new Error('organization_id est requis');
    const creds = await resolveOrgCredentials(data.organization_id);

    if (!creds) {
      return new Response(
        JSON.stringify({ success: true, skipped_notion: true, reason: 'notion_not_configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    if (!data.name) throw new Error('Name is required');

    console.log('Adding to shortlist:', data.name, 'for job:', data.jobTitle);

    // ── 1. Anti-doublon candidat ─────────────────────────────────
    let candidateId: string | null = null;
    let candidateExisted = false;

    if (data.linkedinUrl) {
      candidateId = await searchCandidateByLinkedIn(data.linkedinUrl, creds);
    }
    if (!candidateId) {
      candidateId = await searchCandidateByName(data.name, creds);
    }

    if (candidateId) {
      candidateExisted = true;
      console.log('Found existing candidate:', candidateId);

      // Update existing candidate with new data if available
      const updates: Record<string, unknown> = {};
      if (data.linkedinUrl) updates['URL Linkedin'] = { url: data.linkedinUrl };
      if (data.email) updates['E-mail'] = { email: data.email };
      if (data.phone) updates['Téléphone'] = { phone_number: data.phone };
      if (data.currentRole) updates['Titre du poste'] = { rich_text: [{ text: { content: data.currentRole } }] };
      if (data.jobId) {
        // Add job relation (append, Notion handles dedup)
        updates['💼 Postes'] = { relation: [{ id: data.jobId }] };
      }
      // Update etape & etat if provided
      if (data.etape) updates['Etape'] = { status: { name: data.etape } };
      if (data.etat) updates['Etat'] = { select: { name: data.etat } };

      if (Object.keys(updates).length > 0) {
        await updateNotionPage(candidateId, creds.notionApiKey, updates);
      }
    }

    // ── 2. Créer le candidat si nécessaire ───────────────────────
    if (!candidateId) {
      const props: Record<string, unknown> = {
        'Nom': { title: [{ text: { content: data.name } }] },
      };

      // Obligatoires
      if (data.entity) {
        props['Entité'] = { select: { name: data.entity } };
      }
      if (data.accompagnement) {
        props['Type d\u2019accompagnement'] = { multi_select: [{ name: data.accompagnement }] };
      }
      if (data.clientId) {
        props['Client'] = { relation: [{ id: data.clientId }] };
      }

      // Optionnels enrichis
      if (data.linkedinUrl) props['URL Linkedin'] = { url: data.linkedinUrl };
      if (data.email) props['E-mail'] = { email: data.email };
      if (data.phone) props['Téléphone'] = { phone_number: data.phone };
      if (data.currentRole) {
        props['Titre du poste'] = { rich_text: [{ text: { content: data.currentRole } }] };
      }

      // Séniorité — use provided or compute from years
      const seniority = data.seniority || computeSeniority(data.yearsOfExperience);
      if (seniority) {
        props['Séniorité'] = { select: { name: seniority } };
      }

      // Domaine d'expertise (multi-select)
      if (data.domains?.length) {
        props['Domaine d\'expertise'] = {
          multi_select: data.domains.map(d => ({ name: d })),
        };
      }

      // Nombre d'années d'expérience
      if (data.yearsOfExperience != null) {
        props['Nombre d\'année d\'expérience'] = { number: data.yearsOfExperience };
      }

      // Niveau d'étude
      if (data.educationLevel) {
        props['Niveau d\'étude'] = { select: { name: data.educationLevel } };
      }

      // Lien source
      if (data.linkedinUrl) {
        props['Lien source'] = { url: data.linkedinUrl };
      }

      // Relation poste
      if (data.jobId) {
        props['💼 Postes'] = { relation: [{ id: data.jobId }] };
      }

      // Etape & Etat
      if (data.etape) props['Etape'] = { status: { name: data.etape } };
      if (data.etat) props['Etat'] = { select: { name: data.etat } };

      console.log('Creating new candidate...');
      const result = await createNotionPage(creds.candidatsDatabaseId, creds.notionApiKey, props);
      candidateId = result.id;
      console.log('Candidate created:', candidateId);
    }

    // ── 3. Anti-doublon shortlist ────────────────────────────────
    const existingShortlistId = await checkExistingShortlist(candidateId!, creds, data.jobId);
    if (existingShortlistId) {
      // Update existing shortlist etape if needed
      if (data.etape) {
        await updateNotionPage(existingShortlistId, creds.notionApiKey, {
          'Etape': { select: { name: data.etape } },
        });
      }
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Candidate already in shortlist — updated',
          candidateId,
          shortlistId: existingShortlistId,
          alreadyExists: true,
          candidateExisted,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // ── 4. Créer la Shortlist ────────────────────────────────────
    // Format: [Nom candidat] X [Titre du poste]
    const shortlistTitle = data.jobTitle
      ? `${data.name} X ${data.jobTitle}`
      : data.name;

    const shortlistProps: Record<string, unknown> = {
      'Nom': { title: [{ text: { content: shortlistTitle } }] },
      'Candidats': { relation: [{ id: candidateId }] },
      'Etape': { select: { name: data.etape || 'Pressenti' } },
    };

    // Entité
    if (data.entity) {
      shortlistProps['Entité'] = { select: { name: data.entity } };
    } else {
      shortlistProps['Entité'] = { select: { name: 'Konekt' } };
    }

    // Type d'accompagnement
    if (data.accompagnement) {
      shortlistProps['Type d\u2019accompagnement'] = { multi_select: [{ name: data.accompagnement }] };
    }

    // Relation poste
    if (data.jobId) {
      shortlistProps['💼 Postes'] = { relation: [{ id: data.jobId }] };
    }

    // Relation client
    if (data.clientId) {
      shortlistProps['Client'] = { relation: [{ id: data.clientId }] };
    }

    // Commentaires pressenti
    if (data.commentaire) {
      shortlistProps['Commentaires pressenti'] = {
        rich_text: [{ text: { content: data.commentaire } }],
      };
    }

    console.log('Creating shortlist entry...');
    const shortlistResult = await createNotionPage(creds.shortlistDatabaseId, creds.notionApiKey, shortlistProps);
    console.log('Shortlist created:', shortlistResult.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Added to shortlist',
        candidateId,
        shortlistId: shortlistResult.id,
        alreadyExists: false,
        candidateExisted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error adding to shortlist:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
