import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY");
const CANDIDATS_DATABASE_ID = "2787e1816fb4812b8ebddfcb3ab95510";
const SHORTLIST_DATABASE_ID = "2787e1816fb4811986a7e6075bc63a23";

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

async function notionQuery(databaseId: string, filter: Record<string, unknown>) {
  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
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

async function createNotionPage(databaseId: string, properties: Record<string, unknown>, children?: unknown[]) {
  const body: Record<string, unknown> = {
    parent: { database_id: databaseId },
    properties,
  };
  if (children?.length) body.children = children;

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
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

async function updateNotionPage(pageId: string, properties: Record<string, unknown>) {
  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
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

async function searchCandidateByLinkedIn(linkedinUrl: string): Promise<string | null> {
  const data = await notionQuery(CANDIDATS_DATABASE_ID, {
    property: 'URL Linkedin',
    url: { equals: linkedinUrl },
  });
  return data?.results?.[0]?.id ?? null;
}

async function searchCandidateByName(name: string): Promise<string | null> {
  const data = await notionQuery(CANDIDATS_DATABASE_ID, {
    property: 'Nom',
    title: { equals: name },
  });
  return data?.results?.[0]?.id ?? null;
}

async function checkExistingShortlist(candidateId: string, jobId?: string): Promise<string | null> {
  const filters: unknown[] = [
    { property: 'Candidats', relation: { contains: candidateId } },
  ];
  if (jobId) {
    filters.push({ property: '💼 Postes', relation: { contains: jobId } });
  }
  const data = await notionQuery(SHORTLIST_DATABASE_ID, { and: filters });
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY is not configured');

    const data: AddToShortlistData = await req.json();
    if (!data.name) throw new Error('Name is required');

    console.log('Adding to shortlist:', data.name, 'for job:', data.jobTitle);

    // ── 1. Anti-doublon candidat ─────────────────────────────────
    let candidateId: string | null = null;
    let candidateExisted = false;

    if (data.linkedinUrl) {
      candidateId = await searchCandidateByLinkedIn(data.linkedinUrl);
    }
    if (!candidateId) {
      candidateId = await searchCandidateByName(data.name);
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
        await updateNotionPage(candidateId, updates);
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
      const result = await createNotionPage(CANDIDATS_DATABASE_ID, props);
      candidateId = result.id;
      console.log('Candidate created:', candidateId);
    }

    // ── 3. Anti-doublon shortlist ────────────────────────────────
    const existingShortlistId = await checkExistingShortlist(candidateId!, data.jobId);
    if (existingShortlistId) {
      // Update existing shortlist etape if needed
      if (data.etape) {
        await updateNotionPage(existingShortlistId, {
          'Etape': { status: { name: data.etape } },
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
      'Etape': { status: { name: data.etape || 'Pressenti' } },
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
    const shortlistResult = await createNotionPage(SHORTLIST_DATABASE_ID, shortlistProps);
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
