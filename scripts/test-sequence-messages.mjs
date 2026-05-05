// ────────────────────────────────────────────────────────────────────
// Test bout-en-bout : génère les 6 messages successifs de la séquence
// "Outreach Adaptatif" en appelant ai-chat-completion (Claude Sonnet 4.6)
// avec un prompt similaire à ce que process-sequences/index.ts construit.
//
// Simule un faux candidat tech (Marie Durand, Senior SWE chez Datadog)
// et ENCHAÎNE les appels en accumulant prevMessages pour montrer la
// progression (premier message → relance → relance après accept...).
//
// Usage : node scripts/test-sequence-messages.mjs <SERVICE_ROLE_KEY>
// ────────────────────────────────────────────────────────────────────

const ENDPOINT = "https://crckfywoyjxkawathdff.functions.supabase.co/test-msg-gen";
const TEST_SECRET = "konekt-temp-test-2026-05-05";

// Profil candidat fictif réaliste
const PROFILE = {
  first_name: "Marie",
  headline: "Senior Software Engineer at Datadog | Distributed Systems & SRE",
  current_company_name: "Datadog",
  summary:
    "Passionnée par les systèmes distribués à grande échelle. Avant Datadog, j'ai bossé 3 ans chez Algolia sur l'infra search. Side project : un framework Rust open-source pour le tracing perf (https://github.com/marie/perftrace, 2.1k stars). Convaincue que l'observabilité est le métier le plus excitant en 2026.",
  skills: ["Rust", "Go", "Kubernetes", "Distributed Systems", "Observability", "Datadog APM"],
  yearsXP: 6,
  education: "EPITA — Master Informatique, Systèmes & Réseaux",
};

const JOB = {
  title: "Lead Backend Engineer",
  client: "Numspot",
  sector: "Cloud souverain français (Docaposte/Bouygues/Dassault)",
  description:
    "Numspot monte une équipe back-end de 8 personnes pour le compute & storage du cloud souverain français. Stack Go/Rust, K8s, déploiement on-prem.",
  must_have: ["6+ ans XP backend", "Distributed systems", "Go ou Rust"],
};

const SENDER = "Laurent Garilhe (Konekt — recrutement tech)";

// Helper : construit un prompt façon process-sequences avec le contexte progressif
function buildPrompt({ msgType, toneInstructions, prevMessages, isInvite }) {
  const prevMsgContext =
    prevMessages.length > 0
      ? `\nMESSAGES PRÉCÉDENTS ENVOYÉS (pour varier l'angle et t'inspirer pour ta relance) :\n${prevMessages
          .map((m, i) => `MESSAGE ${i + 1} (${m.type}): "${m.content.slice(0, 200)}"`)
          .join("\n")}`
      : "";

  return `Tu es un recruteur tech senior chez Konekt. Tu écris des messages LinkedIn ULTRA personnalisés et percutants.

PROFIL CANDIDAT :
- Prénom : ${PROFILE.first_name}
- Titre : ${PROFILE.headline}
- Entreprise actuelle : ${PROFILE.current_company_name}
- Compétences : ${PROFILE.skills.join(", ")}
- XP : ~${PROFILE.yearsXP} ans
- Formation : ${PROFILE.education}

À PROPOS DU CANDIDAT (clé pour personnaliser) :
"${PROFILE.summary}"

POSTE CIBLÉ :
- Intitulé : ${JOB.title}
- Client : ${JOB.client} (${JOB.sector})
- Description : ${JOB.description}
- Must-have : ${JOB.must_have.join(", ")}

POSTURE : Tu es un connecteur, pas un expert tech. Tu fais le pont entre le candidat et l'environnement du poste.

SENDER : ${SENDER}

TYPE DE MESSAGE : ${msgType}
${toneInstructions}
${prevMsgContext}

RÈGLES ABSOLUES :
- Personnalisation hyper-spécifique obligatoire (cite l'À propos, side project, ancien employeur)
- Pas de "je reviens vers toi" sur un PREMIER MESSAGE
- ${isInvite ? "Note d'invitation max 280 caractères, pas de signature" : "200-400 caractères pour le corps du message"}
- Tutoiement (le candidat est tech, ton direct)
- Pas de jargon corporate, pas de "j'espère que ce message vous trouvera bien"
- Tu peux mentionner que c'est une opportunité chez ${JOB.client}, sans pitcher salaire

Réponds UNIQUEMENT en JSON strict (pas de markdown), format :
{
  "subject": "<sujet si InMail/email, sinon null>",
  "message": "<le message complet>",
  "personalization_points": ["<élément spécifique 1>", "<élément 2>"]
}`;
}

const STEPS = [
  {
    label: "ÉTAPE 2 — Message direct (déjà 1er degré, J+1 après visite)",
    msgType: "PREMIER MESSAGE",
    toneInstructions:
      "PREMIER CONTACT direct (le candidat est déjà 1er degré). Accroche personnalisée + pitch concis + CTA non-engageant. 200-400 caractères. Tone professional.",
    isInvite: false,
  },
  {
    label: "ÉTAPE 4 — Relance (3 jours après step 2, sans réponse)",
    msgType: "RELANCE 1",
    toneInstructions:
      "PREMIÈRE RELANCE. Le candidat n'a pas répondu au précédent message (3j ago). Tu PEUX référencer ton précédent message. Apporte un angle complémentaire. Ton plus direct, familier. 200-350 caractères. Tone casual.",
    isInvite: false,
  },
  {
    label: "ÉTAPE 5 — Note d'invitation LinkedIn (branche NO, candidat 2e degré)",
    msgType: "INVITATION",
    toneInstructions:
      "Note d'invitation courte. MAX 280 caractères. Pas de signature, accroche personnelle qui donne envie d'accepter. Tone professional.",
    isInvite: true,
  },
  {
    label: "ÉTAPE 7 — Premier message après acceptation invitation",
    msgType: "SUITE INVITATION",
    toneInstructions:
      "PREMIER MESSAGE après acceptation de connexion. Bref remerciement (1 phrase) puis pitch direct. NE DIS PAS 'je reviens vers vous' (c'est ton 1er message). 200-400 caractères. Tone professional.",
    isInvite: false,
  },
  {
    label: "ÉTAPE 9 — Relance après step 7 (3 jours sans réponse)",
    msgType: "RELANCE 1",
    toneInstructions:
      "PREMIÈRE RELANCE. Le candidat a accepté l'invitation et reçu un message il y a 3j sans répondre. Tu PEUX référencer le précédent. Angle complémentaire. Tone casual. 200-350 caractères.",
    isInvite: false,
  },
  {
    label: "ÉTAPE 10 — InMail fallback (si invitation pas acceptée en 3j)",
    msgType: "INMAIL INITIAL",
    toneInstructions:
      "InMail fallback. Le candidat n'a PAS accepté l'invitation. Ton FORMEL ET DIRECT. Subject obligatoire (max 200 chars, mobile-first). Proposition de valeur claire. CTA non-engageant (demande d'avis, pas de proposition de call). 200-400 chars pour le corps.",
    isInvite: false,
  },
];

async function callAI(prompt) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-secret": TEST_SECRET,
    },
    body: JSON.stringify({ prompt }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function extractJson(content) {
  // Strip markdown fences if present
  let s = content.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(s);
}

async function main() {
  console.log("\n🧪 SIMULATION COMPLÈTE — Séquence Outreach Adaptatif");
  console.log("Candidat fictif : Marie Durand, Senior SWE chez Datadog (~6 ans XP)");
  console.log("Poste cible    : Lead Backend Engineer chez Numspot (cloud souverain)");
  console.log("Recruteur      : Laurent Garilhe (Konekt)");
  console.log("Modèle IA      : claude-sonnet-4-6\n");

  // Branche YES (déjà connecté) : étapes 2 + 4
  const branchYesPrev = [];

  // Branche NO (pas connecté) : étapes 5 + 7 + 9 + 10 (timeout)
  const branchNoPrev = [];

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    console.log("\n" + "═".repeat(74));
    console.log(`▶ ${step.label}`);
    console.log("═".repeat(74));

    // Détermine le contexte cumulé selon la branche
    let prev = [];
    if (i === 0) prev = []; // étape 2 (YES) première
    else if (i === 1) prev = branchYesPrev; // étape 4 (YES) après step 2
    else if (i === 2) prev = []; // étape 5 (NO) invitation, branche distincte
    else if (i === 3) prev = [{ type: "connection_request", content: "Note d'invitation envoyée" }]; // étape 7 après step 5
    else if (i === 4) prev = branchNoPrev; // étape 9 après step 7
    else if (i === 5) prev = [{ type: "connection_request", content: "Note d'invitation envoyée (pas acceptée)" }]; // étape 10 timeout

    const prompt = buildPrompt({
      msgType: step.msgType,
      toneInstructions: step.toneInstructions,
      prevMessages: prev,
      isInvite: step.isInvite,
    });

    try {
      const result = await callAI(prompt);
      const parsed = extractJson(result.response);

      if (parsed.subject) {
        console.log(`\n📧 SUBJECT (${parsed.subject.length} chars) : ${parsed.subject}`);
      }
      console.log(`\n💬 MESSAGE (${parsed.message.length} chars) :\n`);
      console.log(parsed.message);
      if (parsed.personalization_points?.length) {
        console.log(`\n✨ Points de personnalisation détectés :`);
        parsed.personalization_points.forEach((p) => console.log(`   • ${p}`));
      }

      // Accumule pour la prochaine étape
      if (i === 0) branchYesPrev.push({ type: "message", content: parsed.message }); // step 2 → utilisé pour step 4
      if (i === 3) branchNoPrev.push({ type: "message", content: parsed.message }); // step 7 → utilisé pour step 9
    } catch (err) {
      console.log(`❌ ERREUR : ${err.message}`);
    }

    // Petit delay pour éviter rate limit
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n" + "═".repeat(74));
  console.log("✅ Simulation terminée");
  console.log("═".repeat(74) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
