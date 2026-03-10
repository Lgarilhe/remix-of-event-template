import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APOLLO_BASE = "https://api.apollo.io";

interface ContactToEnrich {
  airtable_id: string;
  full_name: string | null;
  email: string | null;
  title: string | null;
  contact_type: string | null;
  city: string | null;
  company_name: string | null;
  company_airtable_id: string | null;
  raw_data: Record<string, any> | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!APOLLO_API_KEY) throw new Error("APOLLO_API_KEY not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { contact_ids, organization_id } = await req.json();
    if (!contact_ids?.length || !organization_id) {
      throw new Error("contact_ids and organization_id required");
    }

    // 1. Fetch contacts with company info
    const { data: contacts, error: ctErr } = await supabase
      .from("airtable_contacts")
      .select("airtable_id, full_name, email, title, contact_type, city, company_airtable_id, raw_data")
      .in("airtable_id", contact_ids);
    if (ctErr) throw ctErr;

    // Fetch company names
    const companyIds = [...new Set((contacts || []).map((c: any) => c.company_airtable_id).filter(Boolean))];
    let companyMap = new Map<string, string>();
    if (companyIds.length > 0) {
      const { data: companies } = await supabase
        .from("airtable_companies")
        .select("airtable_id, name")
        .in("airtable_id", companyIds);
      (companies || []).forEach((co: any) => companyMap.set(co.airtable_id, co.name));
    }

    const enrichedContacts: ContactToEnrich[] = (contacts || []).map((c: any) => ({
      ...c,
      company_name: c.company_airtable_id ? companyMap.get(c.company_airtable_id) || null : null,
    }));

    // 2. Apollo bulk_match — split into linkedin vs fuzzy
    const results: Array<{ contact: ContactToEnrich; apollo: any; match_type: string }> = [];

    for (const contact of enrichedContacts) {
      const raw = contact.raw_data || {};
      const linkedinUrl = raw["URL linkedin"] || raw["linkedin_url"] || null;
      const firstName = raw["Prénom"] || (contact.full_name?.split(" ")[0]) || "";
      const lastName = raw["Nom"] || (contact.full_name?.split(" ").slice(1).join(" ")) || "";

      let apolloResult: any = null;
      let matchType = "fuzzy";

      if (linkedinUrl) {
        // Direct match via linkedin_url
        matchType = "linkedin";
        try {
          const resp = await fetch(`${APOLLO_BASE}/v1/people/match`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify({ linkedin_url: linkedinUrl }),
          });
          if (resp.ok) {
            const data = await resp.json();
            apolloResult = data.person || null;
          }
        } catch (e) {
          console.error(`[Apollo] LinkedIn match error for ${contact.airtable_id}:`, e);
        }
      }

      if (!apolloResult && firstName && lastName) {
        // Fuzzy match via name + company
        try {
          const matchBody: Record<string, any> = {
            first_name: firstName,
            last_name: lastName,
          };
          if (contact.company_name) {
            matchBody.organization_name = contact.company_name;
          }
          if (contact.email) {
            matchBody.email = contact.email;
          }

          const resp = await fetch(`${APOLLO_BASE}/v1/people/match`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify(matchBody),
          });
          if (resp.ok) {
            const data = await resp.json();
            apolloResult = data.person || null;
            if (apolloResult && !linkedinUrl) matchType = "fuzzy";
          }
        } catch (e) {
          console.error(`[Apollo] Fuzzy match error for ${contact.airtable_id}:`, e);
        }
      }

      results.push({ contact, apollo: apolloResult, match_type: matchType });

      // Small delay to respect rate limits
      await new Promise((r) => setTimeout(r, 300));
    }

    // 3. Fetch historical context for AI qualification
    const allContactIds = enrichedContacts.map((c) => c.airtable_id);
    const allCompanyIds = enrichedContacts.map((c) => c.company_airtable_id).filter(Boolean) as string[];

    const [shortlistsRes, notesRes, placementsRes] = await Promise.all([
      supabase
        .from("airtable_shortlists")
        .select("airtable_id, contact_airtable_id, company_airtable_id, status, date_added, job_airtable_id, candidate_airtable_id")
        .or(`contact_airtable_id.in.(${allContactIds.join(",")}),company_airtable_id.in.(${allCompanyIds.join(",")})`)
        .order("date_added", { ascending: false })
        .limit(200),
      supabase
        .from("airtable_notes")
        .select("airtable_id, contact_airtable_id, title, detail, note_type, note_date, author")
        .in("contact_airtable_id", allContactIds)
        .order("note_date", { ascending: false })
        .limit(100),
      supabase
        .from("airtable_placements")
        .select("airtable_id, company_airtable_id, name, status, start_date, salary")
        .in("company_airtable_id", allCompanyIds)
        .limit(50),
    ]);

    // Resolve job titles for shortlists
    const jobIds = new Set<string>();
    const candIds = new Set<string>();
    (shortlistsRes.data || []).forEach((s: any) => {
      if (s.job_airtable_id) jobIds.add(s.job_airtable_id);
      if (s.candidate_airtable_id) candIds.add(s.candidate_airtable_id);
    });

    const [jobsRes, candsRes] = await Promise.all([
      jobIds.size > 0
        ? supabase.from("airtable_jobs").select("airtable_id, title").in("airtable_id", [...jobIds])
        : Promise.resolve({ data: [] }),
      candIds.size > 0
        ? supabase.from("airtable_candidates").select("airtable_id, full_name").in("airtable_id", [...candIds])
        : Promise.resolve({ data: [] }),
    ]);

    const jobMap = new Map((jobsRes.data || []).map((j: any) => [j.airtable_id, j.title]));
    const candMap = new Map((candsRes.data || []).map((c: any) => [c.airtable_id, c.full_name]));

    // 4. AI qualification + message generation per contact
    const upserts: any[] = [];

    for (const { contact, apollo, match_type } of results) {
      if (!apollo) {
        // No Apollo match — store as not found
        upserts.push({
          contact_airtable_id: contact.airtable_id,
          match_type: "not_found",
          is_relevant: null,
          organization_id,
          enriched_at: new Date().toISOString(),
        });
        continue;
      }

      const raw = contact.raw_data || {};
      const hasMobile = !!(raw["Mobile"] || raw["Ligne direct"]);
      const tutoiement = raw["Tutoiement"] === "Oui" || raw["Tutoiement"] === true;

      // Build context for AI
      const contactShortlists = (shortlistsRes.data || []).filter(
        (s: any) => s.contact_airtable_id === contact.airtable_id || s.company_airtable_id === contact.company_airtable_id
      );
      const contactNotes = (notesRes.data || []).filter((n: any) => n.contact_airtable_id === contact.airtable_id);
      const contactPlacements = (placementsRes.data || []).filter(
        (p: any) => p.company_airtable_id === contact.company_airtable_id
      );

      const shortlistContext = contactShortlists
        .slice(0, 10)
        .map((s: any) => {
          const job = s.job_airtable_id ? jobMap.get(s.job_airtable_id) : null;
          const cand = s.candidate_airtable_id ? candMap.get(s.candidate_airtable_id) : null;
          return `- Shortlist "${job || "poste inconnu"}" pour ${cand || "candidat inconnu"} (${s.status || "?"}, ${s.date_added || "?"})`;
        })
        .join("\n");

      const notesContext = contactNotes
        .slice(0, 5)
        .map((n: any) => `- ${n.note_date || "?"}: ${n.title || ""} ${n.detail?.slice(0, 100) || ""}`)
        .join("\n");

      const placementContext = contactPlacements
        .slice(0, 5)
        .map((p: any) => `- Placement: ${p.name || "?"} (${p.status || "?"}, ${p.start_date || "?"})`)
        .join("\n");

      const apolloProfile = `
Poste actuel: ${apollo.title || "?"}
Société actuelle: ${apollo.organization_name || apollo.organization?.name || "?"}
Headline: ${apollo.headline || "?"}
Localisation: ${[apollo.city, apollo.state, apollo.country].filter(Boolean).join(", ") || "?"}
Email: ${apollo.email || "?"}
Parcours récent: ${(apollo.employment_history || []).slice(0, 3).map((e: any) => `${e.title} @ ${e.organization_name} (${e.start_date || "?"} - ${e.end_date || "actuel"})`).join(" → ") || "?"}
`.trim();

      const messageType = hasMobile ? "sms" : "linkedin";
      const maxChars = hasMobile ? 160 : 400;

      const prompt = `Tu es un recruteur tech senior chez Konekt, un cabinet de recrutement tech.

CONTACT CLIENT :
- Nom : ${contact.full_name || "?"}
- Ancien titre : ${contact.title || "?"}
- Type : ${contact.contact_type || "?"}
- Société dans notre CRM : ${contact.company_name || "?"}
- Ville : ${contact.city || "?"}
${tutoiement ? "- TUTOIEMENT : oui, tutoie cette personne" : "- VOUVOIEMENT : vouvoie cette personne"}

PROFIL APOLLO ACTUEL :
${apolloProfile}

HISTORIQUE AVEC KONEKT :
${shortlistContext || "Aucune shortlist"}
${notesContext || "Aucune note"}
${placementContext || "Aucun placement"}

INSTRUCTIONS :
1. QUALIFIE : Ce contact est-il pertinent pour une reprise de relation commerciale ? (oui/non)
   - Pertinent si : toujours en poste décisionnaire (RH, DRH, Head of, CTO, CEO, manager), dans une boîte qui recrute, historique positif
   - Non pertinent si : a quitté son poste décisionnaire, plus dans le même secteur, relation difficile dans les notes

2. GÉNÈRE UN MESSAGE ${messageType === "sms" ? "SMS (~" + maxChars + " caractères max)" : "LinkedIn (~" + maxChars + " caractères max)"} :
   - ${tutoiement ? "Tutoie" : "Vouvoie"} la personne
   - Mentionne un élément concret de l'historique (un placement réussi, un candidat présenté)
   - Ton naturel, peer-to-peer, pas corporate
   - Ne dis jamais "j'ai vu dans notre CRM" ou similaire
   - Si le contact a changé de société, mentionne-le naturellement
   - Objectif : reprendre contact et proposer un échange

Réponds EXACTEMENT dans ce format JSON :
{
  "is_relevant": true/false,
  "relevance_reason": "explication courte",
  "message": "le message"
}`;

      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error(`[AI] Error for ${contact.airtable_id}:`, aiResp.status, errText);
          // Store apollo data without AI
          upserts.push({
            contact_airtable_id: contact.airtable_id,
            linkedin_url: apollo.linkedin_url || null,
            match_type,
            current_job_title: apollo.title || null,
            current_company: apollo.organization_name || apollo.organization?.name || null,
            headline: apollo.headline || null,
            location: [apollo.city, apollo.state, apollo.country].filter(Boolean).join(", ") || null,
            apollo_data: apollo,
            is_relevant: null,
            relevance_reason: `AI error: ${aiResp.status}`,
            organization_id,
            enriched_at: new Date().toISOString(),
          });
          continue;
        }

        const aiData = await aiResp.json();
        const aiContent = aiData.choices?.[0]?.message?.content || "";

        // Parse JSON from AI response
        let parsed: any = {};
        try {
          const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          }
        } catch {
          console.error(`[AI] JSON parse error for ${contact.airtable_id}:`, aiContent);
        }

        upserts.push({
          contact_airtable_id: contact.airtable_id,
          linkedin_url: apollo.linkedin_url || null,
          match_type,
          current_job_title: apollo.title || null,
          current_company: apollo.organization_name || apollo.organization?.name || null,
          headline: apollo.headline || null,
          location: [apollo.city, apollo.state, apollo.country].filter(Boolean).join(", ") || null,
          apollo_data: apollo,
          is_relevant: parsed.is_relevant ?? null,
          relevance_reason: parsed.relevance_reason || null,
          generated_message: parsed.message || null,
          message_type: messageType,
          message_status: "draft",
          organization_id,
          enriched_at: new Date().toISOString(),
        });
      } catch (e) {
        console.error(`[AI] Exception for ${contact.airtable_id}:`, e);
        upserts.push({
          contact_airtable_id: contact.airtable_id,
          linkedin_url: apollo.linkedin_url || null,
          match_type,
          current_job_title: apollo.title || null,
          current_company: apollo.organization_name || apollo.organization?.name || null,
          headline: apollo.headline || null,
          location: [apollo.city, apollo.state, apollo.country].filter(Boolean).join(", ") || null,
          apollo_data: apollo,
          organization_id,
          enriched_at: new Date().toISOString(),
        });
      }

      // Delay between AI calls
      await new Promise((r) => setTimeout(r, 500));
    }

    // 5. Upsert results
    if (upserts.length > 0) {
      const { error: upsertErr } = await supabase
        .from("vivier_enrichments")
        .upsert(upserts, { onConflict: "contact_airtable_id" });
      if (upsertErr) {
        console.error("[Upsert] Error:", upsertErr);
        throw upsertErr;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        enriched: results.filter((r) => r.apollo).length,
        not_found: results.filter((r) => !r.apollo).length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[enrich-vivier-contacts] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
