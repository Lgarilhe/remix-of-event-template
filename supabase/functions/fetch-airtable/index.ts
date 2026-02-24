import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const RAW_AIRTABLE_API_KEY = Deno.env.get("AIRTABLE_API_KEY");
const AIRTABLE_API_KEY = RAW_AIRTABLE_API_KEY?.trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Base configs
const BASES: Record<string, { baseId: string | undefined; label: string }> = {
  konekt: { baseId: Deno.env.get("AIRTABLE_BASE_ID")?.trim(), label: 'Konekt' },
  prospect: { baseId: Deno.env.get("AIRTABLE_BASE_ID_2")?.trim(), label: 'Konekt prospect' },
};

// Airtable table names per base (both bases share similar French table names)
const TABLE_MAP: Record<string, string> = {
  companies: "Entreprises",
  contacts: "Contacts",
  jobs: "Jobs",
  candidates: "Candidats",
  shortlists: "Shortlists",
  placements: "Placements",
  notes: "Notes",
  appointments: "Rendez-vous",
  tasks: "Tâches",
  shortlists_cumulated: "Shortlists cumulées",
  glossary: "Glossaire tech",
  kpi: "KPI",
};

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime: string;
}

// Fetch all records from an Airtable table (handles pagination)
async function fetchAirtableTable(baseId: string, tableName: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Airtable API error for ${tableName}: ${response.status} - ${error}`);
    }

    const data = await response.json();
    records.push(...(data.records || []));
    offset = data.offset;
  } while (offset);

  return records;
}

function firstLinked(field: unknown): string | null {
  if (Array.isArray(field) && field.length > 0) return String(field[0]);
  return null;
}

function getString(field: unknown): string | null {
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  return null;
}

function getArray(field: unknown): string[] {
  if (Array.isArray(field)) return field.map(String);
  if (typeof field === 'string') return [field];
  return [];
}

function maskValue(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// Transform functions
function transformCompany(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    name: getString(f["Nom de la société"] ?? f["Nom"] ?? f["Name"]) || "Sans nom",
    city: getString(f["Ville"] ?? f["City"]),
    description: getString(f["Présentation activité"] ?? f["Description"]),
    year_founded: getString(f["Année de création"]),
    headcount: getString(f["Effectif global"] ?? f["Effectif"]),
    tech_stack: getArray(f["Stack technique"] ?? f["Stack"] ?? []),
    benefits: getString(f["Avantages proposés"] ?? f["Avantages"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformContact(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    full_name: getString(f["Nom complet"] ?? f["Nom"] ?? f["Name"]),
    email: getString(f["Email professionnel"] ?? f["Email"]),
    title: getString(f["Titre"] ?? f["Title"]),
    contact_type: getString(f["Type"]),
    city: getString(f["Ville"] ?? f["City"]),
    status: getString(f["Statut"] ?? f["Status"]),
    company_airtable_id: firstLinked(f["Entreprises"] ?? f["Entreprise"] ?? f["Company"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformJob(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    title: getString(f["Intitulé du poste"] ?? f["Intitulé"] ?? f["Nom"] ?? f["Name"]),
    status: getString(f["Statut"] ?? f["Status"]),
    contract_type: getString(f["Type de contrat"] ?? f["Contrat"]),
    salary: getString(f["Salaire"] ?? f["Salary"]),
    city: getString(f["Ville"] ?? f["City"]),
    description: getString(f["Description"]),
    criteria: getString(f["Critères"] ?? f["Criteria"]),
    company_airtable_id: firstLinked(f["Entreprises"] ?? f["Entreprise"] ?? f["Company"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformCandidate(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  
  let linkedinUrl = getString(f["LinkedIn"] ?? f["Linkedin"] ?? f["linkedin"] ?? f["URL LinkedIn"] ?? f["Profil LinkedIn"]);
  if (!linkedinUrl) {
    for (const [key, val] of Object.entries(f)) {
      if (key.toLowerCase().includes('linkedin') && typeof val === 'string' && val.includes('linkedin.com')) {
        linkedinUrl = val;
        break;
      }
    }
  }

  const firstName = getString(f["Prénom"] ?? f["First Name"] ?? f["Prenom"]);
  const lastName = getString(f["Nom"] ?? f["Nom de famille"] ?? f["Last Name"]);
  const fullName = getString(f["Nom complet"] ?? f["Name"]) || [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    airtable_id: record.id,
    source_base: sourceBase,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    email: getString(f["Email"] ?? f["E-mail"] ?? f["Mail"]),
    phone: getString(f["Téléphone"] ?? f["Phone"] ?? f["Tel"]),
    linkedin_url: linkedinUrl,
    status: getString(f["Statut"] ?? f["Status"]),
    experience: getString(f["Expérience"] ?? f["Experience"]),
    skills: getArray(f["Compétences"] ?? f["Compétences clés"] ?? f["Skills"] ?? []),
    preferred_contract: getString(f["Contrat préféré"] ?? f["Type contrat"]),
    education_level: getString(f["Niveau d'étude"] ?? f["Formation"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformShortlist(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    status: getString(f["Statut"] ?? f["Status"]),
    date_added: getString(f["Date d'ajout"] ?? f["Date"]),
    salary_proposed: getString(f["Salaire proposé"] ?? f["Salaire"]),
    estimated_fees: getString(f["Honoraires estimés"] ?? f["Honoraires"]),
    candidate_airtable_id: firstLinked(f["Candidats"] ?? f["Candidat"]),
    job_airtable_id: firstLinked(f["Poste"] ?? f["Job"] ?? f["Jobs"]),
    company_airtable_id: firstLinked(f["Entreprises"] ?? f["Entreprise"]),
    contact_airtable_id: firstLinked(f["Contacts"] ?? f["Contact"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformPlacement(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    name: getString(f["Nom"] ?? f["Name"]),
    status: getString(f["Statut"] ?? f["Status"]),
    salary: getString(f["Salaire retenu"] ?? f["Salaire"]),
    start_date: getString(f["Date de démarrage"] ?? f["Date"]),
    contract_type: getString(f["Type de contrat"] ?? f["Contrat"]),
    fees: getString(f["Honoraires"]),
    candidate_airtable_id: firstLinked(f["Candidats"] ?? f["Candidat"]),
    company_airtable_id: firstLinked(f["Entreprises"] ?? f["Entreprise"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformNote(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    title: getString(f["Nom de la note"] ?? f["Nom"] ?? f["Name"] ?? f["Titre"]),
    detail: getString(f["Détail"] ?? f["Detail"] ?? f["Notes"] ?? f["Description"]),
    note_type: getString(f["Type"]),
    note_date: getString(f["Date"]),
    author: getString(f["Auteur"] ?? f["Author"]),
    candidate_airtable_id: firstLinked(f["Candidats"] ?? f["Candidat"]),
    job_airtable_id: firstLinked(f["Jobs"] ?? f["Job"] ?? f["Poste"]),
    contact_airtable_id: firstLinked(f["Contacts"] ?? f["Contact"]),
    shortlist_airtable_id: firstLinked(f["Shortlists"] ?? f["Shortlist"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformAppointment(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    title: getString(f["Nom"] ?? f["Name"] ?? f["Titre"]),
    appointment_date: getString(f["Date"] ?? f["Date du RDV"]),
    appointment_type: getString(f["Type"] ?? f["Type de RDV"]),
    status: getString(f["Statut"] ?? f["Status"]),
    notes: getString(f["Notes"] ?? f["Commentaire"]),
    candidate_airtable_id: firstLinked(f["Candidats"] ?? f["Candidat"]),
    contact_airtable_id: firstLinked(f["Contacts"] ?? f["Contact"]),
    job_airtable_id: firstLinked(f["Jobs"] ?? f["Job"] ?? f["Poste"]),
    shortlist_airtable_id: firstLinked(f["Shortlists"] ?? f["Shortlist"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformTask(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    title: getString(f["Nom"] ?? f["Name"] ?? f["Titre"]),
    description: getString(f["Description"] ?? f["Détail"]),
    due_date: getString(f["Date d'échéance"] ?? f["Date"] ?? f["Deadline"]),
    status: getString(f["Statut"] ?? f["Status"]),
    task_type: getString(f["Type"]),
    assignee: getString(f["Assigné à"] ?? f["Responsable"]),
    candidate_airtable_id: firstLinked(f["Candidats"] ?? f["Candidat"]),
    contact_airtable_id: firstLinked(f["Contacts"] ?? f["Contact"]),
    job_airtable_id: firstLinked(f["Jobs"] ?? f["Job"] ?? f["Poste"]),
    shortlist_airtable_id: firstLinked(f["Shortlists"] ?? f["Shortlist"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformShortlistCumulated(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    candidate_airtable_id: firstLinked(f["Candidats"] ?? f["Candidat"]),
    company_airtable_id: firstLinked(f["Entreprises"] ?? f["Entreprise"]),
    total_shortlists: typeof f["Total"] === 'number' ? f["Total"] : null,
    last_shortlist_date: getString(f["Dernière date"] ?? f["Date"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformGlossary(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    term: getString(f["Nom"] ?? f["Name"] ?? f["Terme"]),
    category: getString(f["Catégorie"] ?? f["Category"] ?? f["Type"]),
    description: getString(f["Description"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

function transformKpi(record: AirtableRecord, sourceBase: string) {
  const f = record.fields;
  return {
    airtable_id: record.id,
    source_base: sourceBase,
    name: getString(f["Nom"] ?? f["Name"]),
    value: getString(f["Valeur"] ?? f["Value"]),
    period: getString(f["Période"] ?? f["Period"]),
    category: getString(f["Catégorie"] ?? f["Category"]),
    raw_data: f,
    synced_at: new Date().toISOString(),
  };
}

// Upsert records into Supabase
async function upsertRecords(
  supabase: ReturnType<typeof createClient>,
  tableName: string,
  records: Record<string, unknown>[],
) {
  if (records.length === 0) return 0;

  let count = 0;
  for (let i = 0; i < records.length; i += 50) {
    const batch = records.slice(i, i + 50);
    const { error } = await supabase
      .from(tableName)
      .upsert(batch, { onConflict: 'airtable_id,source_base' });

    if (error) {
      console.error(`Error upserting ${tableName}:`, error);
      throw new Error(`Failed to upsert ${tableName}: ${error.message}`);
    }
    count += batch.length;
  }
  return count;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!AIRTABLE_API_KEY) throw new Error('AIRTABLE_API_KEY is not configured');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase config missing');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'sync_all';
    const tables = body.tables || Object.keys(TABLE_MAP);
    // Which bases to sync: 'all', 'konekt', or 'prospect'
    const targetBases: string[] = body.base
      ? [body.base]
      : Object.keys(BASES);

    if (action === 'list_tables') {
      const baseKey = body.base || 'konekt';
      const baseId = BASES[baseKey]?.baseId;
      if (!baseId) throw new Error(`Base ${baseKey} not configured`);
      
      const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      if (!response.ok) {
        const error = await response.text();
        return new Response(JSON.stringify({ success: false, error: `Airtable meta API: ${error}` }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const data = await response.json();
      return new Response(JSON.stringify({ success: true, base: baseKey, tables: data.tables?.map((t: any) => ({ id: t.id, name: t.name, fields: t.fields?.map((f: any) => f.name) })) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'debug_airtable') {
      const diagnosticBaseId = typeof body.base_id === 'string' ? body.base_id.trim() : BASES.konekt.baseId;
      const tableIdOrName = typeof body.table_id_or_name === 'string' ? body.table_id_or_name.trim() : null;

      const metaUrl = `https://api.airtable.com/v0/meta/bases/${diagnosticBaseId}/tables`;
      const tableUrl = tableIdOrName
        ? `https://api.airtable.com/v0/${diagnosticBaseId}/${encodeURIComponent(tableIdOrName)}?maxRecords=1`
        : null;

      const [metaResponse, tableResponse] = await Promise.all([
        fetch(metaUrl, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }),
        tableUrl ? fetch(tableUrl, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }) : Promise.resolve(null),
      ]);

      const [metaPayload, tablePayload] = await Promise.all([
        metaResponse.text(),
        tableResponse ? tableResponse.text() : Promise.resolve(null),
      ]);

      return new Response(JSON.stringify({
        success: metaResponse.ok || !!tableResponse?.ok,
        debug: {
          has_api_key: !!AIRTABLE_API_KEY,
          token_prefix: AIRTABLE_API_KEY?.slice(0, 4) ?? null,
          configured_bases: Object.fromEntries(Object.entries(BASES).map(([k, v]) => [k, { configured: !!v.baseId, masked: maskValue(v.baseId) }])),
          used_base_id_masked: maskValue(diagnosticBaseId),
          table_id_or_name: tableIdOrName,
          meta: { url: metaUrl, status: metaResponse.status, ok: metaResponse.ok, body: metaPayload },
          table: tableUrl ? { url: tableUrl, status: tableResponse?.status ?? null, ok: tableResponse?.ok ?? false, body: tablePayload } : null,
        },
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'search_candidate') {
      const { linkedin_url, name, email } = body;
      let query = supabase.from('airtable_candidates').select('*');
      
      if (linkedin_url) {
        const normalized = linkedin_url.replace(/\/$/, '').toLowerCase();
        query = query.ilike('linkedin_url', `%${normalized.split('/in/')[1]?.split('/')[0] || normalized}%`);
      } else if (email) {
        query = query.ilike('email', email);
      } else if (name) {
        query = query.ilike('full_name', `%${name}%`);
      } else {
        return new Response(JSON.stringify({ success: false, error: 'Provide linkedin_url, email, or name' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: candidates, error } = await query.limit(5);
      if (error) throw error;

      const enriched = await Promise.all((candidates || []).map(async (candidate: any) => {
        const [shortlists, placements, notes] = await Promise.all([
          supabase.from('airtable_shortlists').select('*').eq('candidate_airtable_id', candidate.airtable_id),
          supabase.from('airtable_placements').select('*').eq('candidate_airtable_id', candidate.airtable_id),
          supabase.from('airtable_notes').select('*').eq('candidate_airtable_id', candidate.airtable_id),
        ]);

        const enrichedShortlists = await Promise.all((shortlists.data || []).map(async (sl: any) => {
          const [job, company] = await Promise.all([
            sl.job_airtable_id ? supabase.from('airtable_jobs').select('title, status').eq('airtable_id', sl.job_airtable_id).maybeSingle() : null,
            sl.company_airtable_id ? supabase.from('airtable_companies').select('name').eq('airtable_id', sl.company_airtable_id).maybeSingle() : null,
          ]);
          return { ...sl, job: job?.data, company: company?.data };
        }));

        return {
          ...candidate,
          shortlists: enrichedShortlists,
          placements: placements.data || [],
          notes: notes.data || [],
        };
      }));

      return new Response(JSON.stringify({ success: true, candidates: enriched }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sync tables
    const transformMap: Record<string, (r: AirtableRecord, sourceBase: string) => Record<string, unknown>> = {
      companies: transformCompany,
      contacts: transformContact,
      jobs: transformJob,
      candidates: transformCandidate,
      shortlists: transformShortlist,
      placements: transformPlacement,
      notes: transformNote,
      appointments: transformAppointment,
      tasks: transformTask,
      shortlists_cumulated: transformShortlistCumulated,
      glossary: transformGlossary,
      kpi: transformKpi,
    };

    const supabaseTableMap: Record<string, string> = {
      companies: 'airtable_companies',
      contacts: 'airtable_contacts',
      jobs: 'airtable_jobs',
      candidates: 'airtable_candidates',
      shortlists: 'airtable_shortlists',
      placements: 'airtable_placements',
      notes: 'airtable_notes',
      appointments: 'airtable_appointments',
      tasks: 'airtable_tasks',
      shortlists_cumulated: 'airtable_shortlists_cumulated',
      glossary: 'airtable_glossary',
      kpi: 'airtable_kpi',
    };

    const results: Record<string, Record<string, { count: number; status: string }>> = {};

    for (const baseKey of targetBases) {
      const baseConfig = BASES[baseKey];
      if (!baseConfig?.baseId) {
        results[baseKey] = { _error: { count: 0, status: `Base ${baseKey} not configured` } };
        continue;
      }

      results[baseKey] = {};

      for (const tableKey of tables) {
        const airtableName = TABLE_MAP[tableKey];
        const transform = transformMap[tableKey];
        const supabaseTable = supabaseTableMap[tableKey];

        if (!airtableName || !transform || !supabaseTable) {
          results[baseKey][tableKey] = { count: 0, status: 'skipped - unknown table' };
          continue;
        }

        try {
          console.log(`Syncing ${baseConfig.label} > ${airtableName}...`);
          const records = await fetchAirtableTable(baseConfig.baseId, airtableName);
          const transformed = records.map(r => transform(r, baseKey));
          const count = await upsertRecords(supabase, supabaseTable, transformed);

          await supabase.from('airtable_sync_meta').upsert({
            table_name: tableKey,
            source_base: baseKey,
            last_synced_at: new Date().toISOString(),
            records_count: count,
            status: 'synced',
          }, { onConflict: 'table_name,source_base' });

          results[baseKey][tableKey] = { count, status: 'synced' };
          console.log(`${baseConfig.label} > ${airtableName}: ${count} records synced`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`Error syncing ${baseConfig.label} > ${airtableName}:`, msg);
          results[baseKey][tableKey] = { count: 0, status: `error: ${msg}` };
        }
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in fetch-airtable:', errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
