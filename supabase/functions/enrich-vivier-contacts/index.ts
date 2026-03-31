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
    // ── Auth: validate JWT and org membership ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!APOLLO_API_KEY) throw new Error("APOLLO_API_KEY not configured");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { contact_ids, organization_id, sender_name } = await req.json();
    if (!contact_ids?.length || !organization_id) {
      throw new Error("contact_ids and organization_id required");
    }

    // Verify org membership
    const { data: membership } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!membership) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const senderFirstName = sender_name || "Laurent";

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

      // If match returned incomplete data (<=1 employment history), try enriching with Apollo ID
      if (apolloResult && (apolloResult.employment_history || []).length <= 1 && apolloResult.id) {
        try {
          console.log(`[Apollo] Enriching incomplete profile ${apolloResult.id} for ${contact.airtable_id}`);
          const enrichResp = await fetch(`${APOLLO_BASE}/v1/people/match`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify({
              id: apolloResult.id,
              reveal_personal_emails: false,
            }),
          });
          if (enrichResp.ok) {
            const enrichData = await enrichResp.json();
            const enrichedPerson = enrichData.person || null;
            if (enrichedPerson && (enrichedPerson.employment_history || []).length > (apolloResult.employment_history || []).length) {
              console.log(`[Apollo] Got enriched profile with ${(enrichedPerson.employment_history || []).length} jobs (was ${(apolloResult.employment_history || []).length})`);
              apolloResult = enrichedPerson;
            }
          }
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) {
          console.error(`[Apollo] Enrich error for ${contact.airtable_id}:`, e);
        }
      }

      // If we got a linkedin_url from Apollo but originally didn't have one, try re-matching via linkedin for full data
      if (apolloResult && (apolloResult.employment_history || []).length <= 1 && apolloResult.linkedin_url && !linkedinUrl) {
        try {
          console.log(`[Apollo] Re-matching via discovered LinkedIn URL for ${contact.airtable_id}`);
          const reResp = await fetch(`${APOLLO_BASE}/v1/people/match`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Api-Key": APOLLO_API_KEY,
            },
            body: JSON.stringify({ linkedin_url: apolloResult.linkedin_url }),
          });
          if (reResp.ok) {
            const reData = await reResp.json();
            const rePerson = reData.person || null;
            if (rePerson && (rePerson.employment_history || []).length > (apolloResult.employment_history || []).length) {
              console.log(`[Apollo] LinkedIn re-match got ${(rePerson.employment_history || []).length} jobs`);
              apolloResult = rePerson;
              matchType = "linkedin";
            }
          }
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) {
          console.error(`[Apollo] LinkedIn re-match error for ${contact.airtable_id}:`, e);
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
      const tutoiement = true; // Toujours tutoyer

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
        .map((n: any) => `- ${n.note_date || "?"} (par ${n.author || "?"}): ${n.title || ""} ${n.detail?.slice(0, 100) || ""}`)
        .join("\n");

      const placementContext = contactPlacements
        .slice(0, 5)
        .map((p: any) => `- Placement: ${p.name || "?"} (${p.status || "?"}, ${p.start_date || "?"})`)
        .join("\n");

      // Determine the main consultant who interacted with this contact
      const authorCounts = new Map<string, number>();
      contactNotes.forEach((n: any) => {
        if (n.author) authorCounts.set(n.author, (authorCounts.get(n.author) || 0) + 1);
      });
      let mainConsultant: string | null = null;
      let maxCount = 0;
      authorCounts.forEach((count, author) => {
        if (count > maxCount) { maxCount = count; mainConsultant = author; }
      });
      const mainConsultantFirstName = mainConsultant ? (mainConsultant as string).split(" ")[0] : null;
      const isSenderTheMainConsultant = mainConsultantFirstName?.toLowerCase() === senderFirstName.toLowerCase();
      const allConsultantsList = [...authorCounts.entries()].map(([name, count]) => `${name} (${count} notes)`).join(", ") || "aucun";

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

      const consultantContext = mainConsultantFirstName
        ? (isSenderTheMainConsultant
          ? `L'expéditeur (${senderFirstName}) est la personne qui a le plus interagi avec ce contact. Utilise "je" / "on" pour parler de la collaboration passée.`
          : `Le consultant principal qui a interagi avec ce contact est ${mainConsultantFirstName}. L'expéditeur est ${senderFirstName}. Mentionne le collègue naturellement, ex: "mon collègue ${mainConsultantFirstName} avait bossé avec toi en 2023 chez [Société]..."`)
        : `L'expéditeur est ${senderFirstName}. Pas de consultant identifié, utilise "on" pour parler de Konekt.`;

      const prompt = `Tu es ${senderFirstName}, business developer chez Konekt, cabinet de recrutement tech à Paris. Tu reprends contact avec un ancien client.

CONTACT CRM :
Nom : ${contact.full_name || "?"}
Ancien poste : ${contact.title || "?"}
Type : ${contact.contact_type || "?"}
Ancienne société : ${contact.company_name || "?"}
Ville : ${contact.city || "?"}

PROFIL ACTUEL (Apollo) :
${apolloProfile}

HISTORIQUE DÉTAILLÉ AVEC KONEKT (EXPLOITE-LE À FOND) :

Shortlists/missions bossées ensemble :
${shortlistContext || "Aucune shortlist trouvée"}

Notes internes (avec le nom du consultant auteur) :
${notesContext || "Aucune note"}

Placements réussis via cette société :
${placementContext || "Aucun placement"}

Consultant principal ayant le plus interagi : ${mainConsultantFirstName || "inconnu"} (${maxCount} interactions)
Tous les consultants impliqués : ${allConsultantsList}

${consultantContext}

ANALYSE :

1. CHANGEMENT DE POSTE : Compare ancien poste/société CRM vs profil Apollo actuel.

2. PERTINENCE : OUI si poste décisionnaire (RH, DRH, Talent, Head of, CTO, CEO, VP, manager, fondateur) dans boîte tech. NON si freelance, quitté la tech, poste non décisionnaire.

3. ÉVÉNEMENTS NOTABLES : Changement de boîte, promotion, levée de fonds.

GÉNÈRE UN MESSAGE ${messageType === "sms" ? "SMS (MAXIMUM " + maxChars + " caractères)" : "LinkedIn (~" + maxChars + " caractères max)"} :

RÈGLES ABSOLUES :
1. TUTOIE
2. Le message vient de ${senderFirstName} à la première personne
3. STYLE : direct, naturel, comme un vrai message entre pros. Zéro formule corporate ou IA ("je serais ravi", "n'hésite pas", "au plaisir", "je me permets", etc.)
4. JAMAIS de placeholders vagues ("ton ancienne société", "ta précédente boîte"). Utilise les VRAIS NOMS.
5. JAMAIS mentionner CRM/base/données

CONTENU DU MESSAGE (dans cet ordre) :
A) ACCROCHE PERSONNALISÉE : Pioche dans l'historique ci-dessus pour rappeler un moment CONCRET de la relation. Exemples de ce que tu DOIS faire :
   ${isSenderTheMainConsultant
     ? `- "Salut [Prénom], c'est ${senderFirstName} de Konekt. On avait bossé ensemble en [DATE] chez [SOCIÉTÉ], je t'avais présenté [NOM CANDIDAT] pour [TITRE POSTE]"`
     : `- "Salut [Prénom], c'est ${senderFirstName} de Konekt. Mon collègue ${mainConsultantFirstName || "?"} avait bossé avec toi en [DATE] chez [SOCIÉTÉ] sur [POSTE/CANDIDAT]"`}
   - Si un placement a été réussi, mentionne-le ! C'est le meilleur rappel ("on avait réussi à placer [Nom] chez vous")
   - Si plusieurs shortlists, cite le poste le plus marquant
   - Cite la PÉRIODE (déduis-la des dates dans l'historique)
   - Cite la SOCIÉTÉ exacte (champ "Ancienne société" du CRM)

B) CHANGEMENT DÉTECTÉ (seulement si avéré) : si changement de boîte ou promotion, mentionne-le naturellement. Si rien n'a changé, ne dis RIEN.

C) CTA : Konekt a évolué (recrutement, RPO, growth, IA), propose un court call. Formulation directe, genre "Ça te dit un call de 15 min ?"

D) SIGNATURE : "${senderFirstName}" pour les SMS

${messageType === "sms" ? "CONTRAINTE SMS : " + maxChars + " caractères MAX. Sois ultra concis, chaque mot compte." : ""}

Réponds en JSON strict :
{
  "still_same_company": true/false,
  "company_change_detail": "description courte du changement ou null",
  "notable_events": ["événement 1", "événement 2"],
  "is_relevant": true/false,
  "relevance_reason": "explication en 1-2 phrases",
  "main_consultant": "${mainConsultantFirstName || "inconnu"}",
  "message": "le message"
}`;

      try {
        const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
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
        const aiContent = aiData.content?.[0]?.text || "";

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
          still_same_company: parsed.still_same_company ?? null,
          company_change_detail: parsed.company_change_detail || null,
          notable_events: parsed.notable_events || [],
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
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
