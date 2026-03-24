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

    // Clean LinkedIn URL to get identifier
    const cleanUrl = linkedinUrl.trim().replace(/\/+$/, "");
    const match = cleanUrl.match(/linkedin\.com\/in\/([^/?]+)/);
    if (!match) throw new Error("URL LinkedIn invalide. Format attendu: linkedin.com/in/votre-profil");
    const identifier = match[1];

    // Fetch profile from Unipile
    const UNIPILE_DSN = Deno.env.get("UNIPILE_DSN");
    const UNIPILE_API_KEY = Deno.env.get("UNIPILE_API_KEY");
    if (!UNIPILE_DSN || !UNIPILE_API_KEY) throw new Error("Configuration manquante");

    // Get user's organization to find their LinkedIn account
    const { data: profile } = await supabase
      .from("profiles")
      .select("active_organization_id")
      .eq("user_id", user.id)
      .single();

    let accountId: string | null = null;
    if (profile?.active_organization_id) {
      const { data: linkedAccounts } = await supabase
        .from("member_linkedin_accounts")
        .select("linkedin_account_id")
        .eq("organization_id", profile.active_organization_id)
        .eq("user_id", user.id)
        .limit(1);
      if (linkedAccounts?.length) accountId = linkedAccounts[0].linkedin_account_id;
    }

    // If no linked account, try to find any account in the org
    if (!accountId && profile?.active_organization_id) {
      const { data: anyAccount } = await supabase
        .from("member_linkedin_accounts")
        .select("linkedin_account_id")
        .eq("organization_id", profile.active_organization_id)
        .limit(1);
      if (anyAccount?.length) accountId = anyAccount[0].linkedin_account_id;
    }

    if (!accountId) throw new Error("Aucun compte LinkedIn connecté. Connectez d'abord votre compte LinkedIn dans les paramètres.");

    const profileRes = await fetch(
      `https://${UNIPILE_DSN}/api/v1/users/${identifier}?account_id=${accountId}&linkedin_sections=experience,about,skills,education`,
      { headers: { "X-API-KEY": UNIPILE_API_KEY, Accept: "application/json" } }
    );

    if (!profileRes.ok) {
      console.error("Unipile error:", profileRes.status, await profileRes.text());
      throw new Error("Impossible de récupérer le profil LinkedIn. Vérifiez l'URL.");
    }

    const profile = await profileRes.json();

    // Build context for AI summary
    const name = profile.first_name && profile.last_name
      ? `${profile.first_name} ${profile.last_name}`
      : profile.name || "Ce recruteur";
    const headline = profile.headline || "";
    const about = profile.about || "";
    const skills = (profile.skills || []).map((s: any) => typeof s === "string" ? s : s.name).filter(Boolean);
    const experiences = (profile.experience || []).slice(0, 8).map((e: any) => {
      const parts = [e.title, e.company_name, e.location].filter(Boolean);
      if (e.description) parts.push(e.description.slice(0, 200));
      return parts.join(" — ");
    });
    const education = (profile.education || []).slice(0, 3).map((e: any) =>
      [e.school_name, e.degree, e.field_of_study].filter(Boolean).join(" — ")
    );

    // Calculate approximate years of experience
    let totalYears = 0;
    for (const exp of (profile.experience || [])) {
      if (exp.start_date) {
        const start = new Date(exp.start_date);
        const end = exp.end_date ? new Date(exp.end_date) : new Date();
        totalYears += (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365);
      }
    }
    const yearsExperience = Math.round(totalYears);

    // Generate AI bio
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("Clé AI manquante");

    const prompt = `Tu es un rédacteur spécialisé en personal branding pour les recruteurs.

Voici le profil LinkedIn d'un recruteur :

Nom : ${name}
Titre : ${headline}
À propos : ${about}

Expériences :
${experiences.join("\n")}

Formation :
${education.join("\n")}

Compétences : ${skills.join(", ")}

Rédige une présentation professionnelle percutante de ce recruteur en 3-4 phrases courtes (max 500 caractères).
Le ton doit être professionnel mais humain, à la troisième personne.
Mets en avant :
- Son expertise sectorielle et ses domaines de spécialisation
- Son expérience et sa valeur ajoutée
- Ce qui le différencie

Ne mentionne PAS de dates, d'entreprises spécifiques ou de chiffres inventés.
Réponds uniquement avec le texte de la bio, sans guillemets ni introduction.`;

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
