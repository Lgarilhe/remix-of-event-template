import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Non authentifié");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify user
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Non authentifié");

    const { linkedinUrl } = await req.json();
    if (!linkedinUrl || typeof linkedinUrl !== "string") {
      throw new Error("URL LinkedIn requise");
    }

    // Normalize LinkedIn URL for Apollo People Enrichment
    let cleanUrl = linkedinUrl.trim();
    try {
      const parsed = new URL(cleanUrl.startsWith("http") ? cleanUrl : `https://${cleanUrl}`);
      if (!parsed.hostname.includes("linkedin.com") || !parsed.pathname.startsWith("/in/")) {
        throw new Error("invalid_linkedin_url");
      }
      parsed.search = "";
      parsed.hash = "";
      cleanUrl = parsed.toString().replace(/\/+$/, "");
    } catch {
      throw new Error("URL LinkedIn invalide. Format attendu: linkedin.com/in/votre-profil");
    }

    const APOLLO_API_KEY = Deno.env.get("APOLLO_API_KEY");
    if (!APOLLO_API_KEY) throw new Error("Configuration Apollo manquante");

    const apolloUrl = new URL("https://api.apollo.io/api/v1/people/match");
    apolloUrl.searchParams.set("linkedin_url", cleanUrl);
    apolloUrl.searchParams.set("reveal_personal_emails", "false");
    apolloUrl.searchParams.set("reveal_phone_number", "false");

    const profileRes = await fetch(apolloUrl.toString(), {
      method: "POST",
      headers: {
        "X-Api-Key": APOLLO_API_KEY,
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
    });

    if (!profileRes.ok) {
      const errorText = await profileRes.text();
      console.error("Apollo error:", profileRes.status, errorText);
      throw new Error("Impossible de récupérer le profil via Apollo. Vérifiez l'URL LinkedIn.");
    }

    const apolloData = await profileRes.json();
    const profile = apolloData?.person;
    if (!profile) {
      console.error("Apollo empty response:", apolloData);
      throw new Error("Aucun profil trouvé dans Apollo pour cette URL LinkedIn.");
    }

    const employmentHistory = Array.isArray(profile.employment_history)
      ? profile.employment_history
      : Array.isArray(profile.experience)
        ? profile.experience
        : [];

    const educationHistory = Array.isArray(profile.education)
      ? profile.education
      : Array.isArray(profile.education_history)
        ? profile.education_history
        : [];

    // Build context for AI summary
    const name = profile.name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Ce recruteur";
    const headline = profile.headline || profile.title || "";
    const about = profile.bio || profile.organization?.short_description || profile.organization?.seo_description || "";
    const skills = Array.from(new Set([
      ...(Array.isArray(profile.skills) ? profile.skills.map((s: any) => typeof s === "string" ? s : s?.name) : []),
      ...(Array.isArray(profile.organization?.keywords) ? profile.organization.keywords : []),
    ].filter(Boolean)));
    const experiences = employmentHistory.slice(0, 8).map((e: any) => {
      const parts = [e.title, e.organization_name || e.company_name, e.location].filter(Boolean);
      return parts.join(" — ");
    });
    const education = educationHistory.slice(0, 3).map((e: any) =>
      [e.school_name || e.school, e.degree, e.field_of_study].filter(Boolean).join(" — ")
    );

    const validStartDates = employmentHistory
      .map((exp: any) => exp.start_date ? new Date(exp.start_date) : null)
      .filter((date: Date | null): date is Date => !!date && !Number.isNaN(date.getTime()));
    const earliestStart = validStartDates.length
      ? Math.min(...validStartDates.map((date) => date.getTime()))
      : null;
    const yearsExperience = earliestStart
      ? Math.max(1, Math.round((Date.now() - earliestStart) / (1000 * 60 * 60 * 24 * 365)))
      : 0;

    // Extract rich metadata
    const seniority = profile.seniority || null;
    const currentCompany = profile.organization_name || profile.organization?.name || employmentHistory[0]?.organization_name || null;
    const currentTitle = profile.title || employmentHistory[0]?.title || null;
    const location = [profile.city, profile.state, profile.country].filter(Boolean).join(", ") || null;
    const industry = profile.organization?.industry || null;
    const photoUrl = profile.photo_url || null;
    const email = profile.email || null;
    const phoneNumbers = (profile.phone_numbers || []).map((p: any) => p.sanitized_number || p.raw_number).filter(Boolean);

    // Extract all unique companies worked at
    const companies = Array.from(new Set(
      employmentHistory.map((e: any) => e.organization_name || e.company_name).filter(Boolean)
    )).slice(0, 10) as string[];

    // Extract industries from org data
    const industries = Array.from(new Set([
      ...(Array.isArray(profile.organization?.industries) ? profile.organization.industries : []),
      ...(industry ? [industry] : []),
    ].filter(Boolean))) as string[];

    // Build tags from various sources
    const tags = Array.from(new Set([
      ...(seniority ? [seniority] : []),
      ...(industries.slice(0, 3)),
      ...(profile.organization?.technology_names?.slice(0, 5) || []),
    ].filter(Boolean))) as string[];

    // Generate AI bio
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("Clé AI manquante");

    const prompt = `Tu es un copywriter expert en personal branding pour recruteurs indépendants.

Tu dois rédiger une bio qui donne envie à un potentiel client (entreprise, DRH, hiring manager) de travailler avec ce recruteur. Le lecteur doit se dire "cette personne connaît MON marché, je veux bosser avec elle".

Voici les données du profil :

Nom : ${name}
Titre : ${headline}
À propos : ${about}

Parcours :
${experiences.join("\n")}

Formation :
${education.join("\n")}

Compétences/secteurs : ${skills.join(", ")}
Années d'expérience : ${yearsExperience > 0 ? yearsExperience : "non renseigné"}
Localisation : ${location || "non renseignée"}
Entreprise actuelle : ${currentCompany || "non renseignée"}

CONSIGNES STRICTES :
- Écris à la PREMIÈRE PERSONNE ("Je", "Mon", "J'ai")
- 3-4 phrases max, ~400-500 caractères
- Ton direct, concret, orienté résultats — pas de blabla corporate
- Mentionne les VRAIS noms d'entreprises et secteurs où la personne a travaillé (ceux visibles dans le parcours ci-dessus)
- Mentionne le nombre d'années d'expérience si disponible
- Termine par une phrase qui indique clairement le type de missions/profils sur lesquels tu interviens
- PAS de formules bateau ("passionné", "expert reconnu", "à votre écoute")
- PAS de guillemets, PAS d'introduction, juste le texte brut de la bio`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      console.error("AI error:", aiRes.status);
      throw new Error("Erreur lors de la génération du résumé");
    }

    const aiData = await aiRes.json();
    const bio = aiData.choices?.[0]?.message?.content?.trim() || "";

    if (!bio) throw new Error("Résumé vide généré");

    // Generate a public slug
    const slugBase = name
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const slug = `${slugBase}-${Date.now().toString(36).slice(-4)}`;

    // Save to profile
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        linkedin_url: cleanUrl,
        recruiter_bio: bio,
        recruiter_headline: headline,
        linkedin_skills: skills.slice(0, 20),
        years_experience: yearsExperience,
        public_slug: slug,
      })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Update error:", updateError);
      throw new Error("Erreur lors de la sauvegarde");
    }

    return new Response(
      JSON.stringify({
        bio,
        headline,
        skills: skills.slice(0, 20),
        yearsExperience,
        slug,
        name,
        seniority,
        currentCompany,
        currentTitle,
        location,
        industries,
        tags,
        companies,
        photoUrl,
        education: education.slice(0, 3),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scan-recruiter-linkedin error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
