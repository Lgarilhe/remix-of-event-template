// Deno.serve used directly
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Non authentifié");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) throw new Error("Non authentifié");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("Clé AI manquante");

    const { profileData, classifications } = await req.json();
    if (!profileData) throw new Error("Données de profil manquantes");

    const {
      name = "",
      headline = "",
      about = "",
      experiences = [],
      skills = [],
      yearsExperience = 0,
      location = null,
      currentCompany = null,
      education = [],
      companies = [],
    } = profileData;

    // Build classification context for the AI prompt
    const classifiedExperiences = (classifications || []) as Array<{
      company: string;
      title: string;
      type: "rpo" | "cabinet" | "direct" | null;
    }>;

    const typeLabels: Record<string, string> = {
      rpo: "RPO / Recrutement embarqué",
      cabinet: "Cabinet de recrutement",
      direct: "Recrutement en entreprise (client final)",
      other: "Autre (hors recrutement)",
    };

    let classificationContext = "";
    if (classifiedExperiences.some((c) => c.type)) {
      const grouped: Record<string, string[]> = {};
      for (const c of classifiedExperiences) {
        if (!c.type) continue;
        const label = typeLabels[c.type] || c.type;
        if (!grouped[label]) grouped[label] = [];
        grouped[label].push([c.title, c.company].filter(Boolean).join(" @ "));
      }
      classificationContext = Object.entries(grouped)
        .map(([type, exps]) => `${type} :\n${exps.map((e) => `  - ${e}`).join("\n")}`)
        .join("\n\n");
    }

    const hasExperiences = experiences.length > 0;
    const hasAbout = (about || "").length > 10;
    const hasSkills = skills.length > 0;

    const richPrompt = `Tu es un copywriter expert en personal branding pour recruteurs.

Tu dois rédiger une bio qui donne envie à un potentiel client (entreprise, DRH, hiring manager) de travailler avec ce recruteur. Le lecteur doit se dire "cette personne connaît MON marché, je veux bosser avec elle".

Voici les données du profil :

Nom : ${name}
Titre : ${headline}
À propos : ${about}

Parcours :
${experiences.join("\n")}

${classificationContext ? `\nClassification des expériences par le recruteur :\n${classificationContext}\n\nIMPORTANT : Utilise cette classification pour adapter la bio. Par exemple :\n- Si le recruteur a fait du RPO, mentionne son expérience embarquée côté client\n- Si le recruteur vient du cabinet, mets en avant son expertise en chasse/approche directe\n- Si le recruteur a recruté en direct, souligne sa connaissance terrain des enjeux internes\n- Mixe les expériences pour montrer la polyvalence si applicable\n` : ""}

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
- Mentionne les VRAIS noms d'entreprises et secteurs où la personne a travaillé
- Mentionne le nombre d'années d'expérience si disponible
- Termine par une phrase qui indique clairement le type de missions/profils sur lesquels tu interviens
- PAS de formules bateau ("passionné", "expert reconnu", "à votre écoute")
- PAS de guillemets, PAS d'introduction, juste le texte brut de la bio
- INTERDICTION ABSOLUE d'utiliser des crochets [comme ceci] ou des placeholders`;

    const lightPrompt = `Tu es un copywriter expert en personal branding pour recruteurs.

Données disponibles :
Nom : ${name}
Titre : ${headline}
Entreprise actuelle : ${currentCompany || "non renseignée"}
Localisation : ${location || "non renseignée"}
Organisations visibles : ${companies.join(", ")}
${classificationContext ? `\nClassification des expériences :\n${classificationContext}` : ""}

CONSIGNES STRICTES :
- Écris à la PREMIÈRE PERSONNE ("Je", "Mon", "J'ai")
- 2-3 phrases max, ton direct et crédible
- Appuie-toi UNIQUEMENT sur les informations disponibles ci-dessus
- N'invente aucun parcours passé, aucun chiffre, aucun secteur absent des données
- PAS de crochets, PAS de placeholders, PAS de guillemets`;

    const prompt = hasExperiences || hasAbout || hasSkills ? richPrompt : lightPrompt;

    const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
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

    // Save bio + classifications to profile
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        recruiter_bio: bio,
        experience_classifications: classifiedExperiences.filter((c) => c.type !== null),
      })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Update error:", updateError);
      throw new Error("Erreur lors de la sauvegarde");
    }

    return new Response(
      JSON.stringify({ bio }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-recruiter-bio error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Erreur inconnue" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
