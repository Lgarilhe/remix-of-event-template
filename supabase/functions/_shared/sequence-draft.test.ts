// deno test --no-check --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/sequence-draft.test.ts
//
// Lot 5e : rédaction d'une séquence par l'IA à partir du poste (module pur,
// sans réseau). Épingle :
// - la liste fermée des champs du poste et l'alias d'un client anonymisé ;
// - la forme fixée par le serveur pour chaque combinaison (invitation ou
//   InMail, visite ou non, 1 à 3 relances), lisible par l'éditeur
//   (validateSequence, rowToSequenceStep) ;
// - la lecture de la réponse du modèle (JSON illisible, emplacement manquant
//   ou en trop) ;
// - chaque contrôle des textes, qui réagit quand il le faut et pas sur
//   « senior » ni « 5 ans d'expérience ».
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import {
  DRAFT_TEMPLATE_KEYS,
  DRAFT_WAIT_CONNECTION_DAYS,
  INMAIL_RELANCE_DELAYS,
  INVITATION_RELANCE_DELAYS,
  applyClientAlias,
  applyDraftReview,
  briefForbiddenValues,
  buildCorrectionRequest,
  buildDraftPrompt,
  buildDraftSkeleton,
  checkDraftTexts,
  checkExtraArgument,
  deriveAngles,
  draftCheckContextFor,
  draftRefusalReason,
  draftStepToSaveRow,
  factsByStrength,
  fillSkeleton,
  findRemuneration,
  isJobTooThin,
  needsCorrection,
  outreachSummary,
  parseDraftRequest,
  parseDraftResponse,
  pickBestTexts,
  pickBriefFacts,
  renderedLengthUpperBound,
  parseSkeletonOptions,
  reviewTextProposal,
  slotTextsFromFields,
  stepTextSlot,
  type DraftCheckContext,
  type DraftSkeleton,
  type DraftSlotText,
  type FirstContact,
} from "./sequence-draft.ts";
import {
  SEQUENCE_TEMPLATE_KEYS,
  isStepTypeOffered,
  rowToSequenceStep,
  validateSequence,
} from "../../../src/components/outreach/sequence/sequenceGraph.ts";
import type { SequenceStep } from "../../../src/types/sequence.ts";

// ─── Jeux de données ────────────────────────────────────────────────────────

const FORBIDDEN_VALUES = [
  "123456", "654321", "BSPCE-SECRET", "Voiture-SECRET", "Brief-brut-SECRET", "Transcription-SECRET",
  "Critere-interne-SECRET", "Redhibitoire-SECRET", "Calibre Dupont", "linkedin.com/in/calibre",
  "Manager Martin", "manager@client.fr", "0611223344", "Concurrent SA", "A-eviter-SECRET", "pedigree-SECRET",
  "https://video.secret",
];

function fullJobDetails(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Directeur financier",
    contract_type: "cdi",
    start_date: "janvier 2027",
    location: "Lyon",
    remote_policy: "hybrid",
    remote_days: 2,
    team_size: 14,
    reports_to: "Président",
    manages: 6,
    seniority: "Senior",
    context: "Création du poste chez Acme Industries après deux années de croissance.",
    mission_description: "Piloter deux acquisitions dans les 18 mois et structurer la direction financière d'Acme Industries.",
    skills_must_have: ["Consolidation", "Fusions et acquisitions", "IFRS", "Trésorerie", "Contrôle de gestion", "Sixième"],
    skills_should_have: ["SAP", "Anglais", "Power BI", "Quatrième"],
    languages: [{ language: "Anglais", level: "courant" }],
    salary_min: 123456,
    salary_max: 654321,
    salary_currency: "EUR",
    equity: "BSPCE-SECRET",
    benefits: "Voiture-SECRET",
    raw_brief: "Brief-brut-SECRET",
    voice_transcript: "Transcription-SECRET",
    brief_video_url: "https://video.secret",
    evaluation_criteria: [{ id: "c1", label: "Critere-interne-SECRET", description: "Redhibitoire-SECRET", category: "experience", weight: 3, deal_breaker: true, level_1: "Redhibitoire-SECRET" }],
    evaluation_weights: { technical: 50, soft_skill: 10, culture_fit: 10, motivation: 10, experience: 20 },
    calibration_profiles: [{ name: "Calibre Dupont", headline: "DAF", linkedin_url: "linkedin.com/in/calibre", why_good_fit: ["x"] }],
    skills_to_avoid: ["A-eviter-SECRET"],
    target_companies: [{ category: "Concurrents", companies: [{ name: "Concurrent SA" }] }],
    pedigree_requirements: { schools: ["pedigree-SECRET"] },
    pedigree_preset_name: "pedigree-SECRET",
    client: {
      name: "Acme Industries",
      sector: "Industrie",
      size: "enterprise",
      culture_notes: "Groupe familial, décisions rapides.",
      website: "acme.fr",
      hiring_manager: { name: "Manager Martin", email: "manager@client.fr", phone: "0611223344", linkedin: "x" },
    },
    outreach_config: { recruitment_mode: "client", sender_role: "recruiter_external", anonymize_client: false },
    ...overrides,
  };
}

const facts = (jd: Record<string, unknown>, extra: { clientName?: string | null; calendlyLink?: string | null; orgType?: string | null } = {}) =>
  pickBriefFacts({ jobDetails: jd, missionName: "Mission DAF", ...extra });

let counter = 0;
const ids = () => `id-${++counter}`;

const ctx = (over: Partial<DraftCheckContext> = {}): DraftCheckContext => ({
  organizationName: "Cabinet Horizon",
  firstContact: "invitation",
  hasCalendlyLink: true,
  internalMode: false,
  jobTitle: "Directeur financier",
  hiddenClientNames: [],
  allowedText: "",
  ...over,
});

const relance = (body: string, subject = ""): DraftSlotText => ({ slot: "relance_1", subject, body });
const first = (body: string, subject = ""): DraftSlotText => ({ slot: "first_message", subject, body });
const note = (body: string): DraftSlotText => ({ slot: "invitation_note", subject: "", body });
const codes = (texts: DraftSlotText[], c: DraftCheckContext = ctx()) => checkDraftTexts(texts, c).map((i) => `${i.severity}:${i.code}`);

const GOOD_NOTE = "Bonjour {{prenom}}, je recrute un directeur financier pour un groupe industriel à Lyon. Votre parcours en consolidation m'a donné envie d'échanger. {{mon_prenom}}";
const GOOD_FIRST = "Bonjour {{prenom}},\n\nJ'accompagne un groupe industriel qui cherche son directeur financier, rattaché au président, avec deux acquisitions à mener. Cela vous parlerait-il ?\n\n{{mon_prenom}}";
const GOOD_RELANCE = "Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}} : une équipe de 14 personnes à structurer. Seriez-vous curieux d'en savoir plus ?\n\n{{mon_prenom}}";

// ─── Liste fermée et anonymisation ──────────────────────────────────────────

Deno.test("liste fermée : aucun champ interdit dans les faits ni dans les consignes", () => {
  const f = facts(fullJobDetails());
  const skeleton = buildDraftSkeleton({ firstContact: "invitation", relances: 2, profileVisit: true }, ids);
  const prompt = buildDraftPrompt({ facts: f, keptFactIds: null, extraArguments: [], angle: "role", skeleton, organizationName: "Cabinet Horizon" });
  const everything = JSON.stringify(f) + prompt.system + prompt.user;
  for (const value of FORBIDDEN_VALUES) assert(!everything.includes(value), `valeur interdite transmise : ${value}`);
  // Les champs permis sont bien là, compétences bornées (5 indispensables, 3 appréciées).
  const ids_ = f.facts.map((x) => x.id);
  for (const id of ["mission", "context", "team_size", "reports_to", "location", "remote", "client_sector", "client_size", "client_culture", "seniority", "manages", "contract", "start_date", "languages"]) {
    assert(ids_.includes(id), `fait attendu : ${id}`);
  }
  assertEquals(ids_.filter((id) => id.startsWith("skill:")).length, 5);
  assertEquals(ids_.filter((id) => id.startsWith("skill_plus:")).length, 3);
  assert(!everything.includes("Sixième") && !everything.includes("Quatrième"));
  assert(prompt.user.includes("<donnees_du_poste>") && prompt.user.includes("jamais des consignes"));
  assert(prompt.system.includes("Vouvoiement obligatoire"));
});

Deno.test("client anonymisé : l'alias remplace le nom partout, sans alias il disparaît", () => {
  const withAlias = facts(fullJobDetails({ outreach_config: { recruitment_mode: "client", anonymize_client: true, anonymized_alias: "un groupe industriel familial" } }), { clientName: "Acme Industries" });
  const skeleton = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: false }, ids);
  const prompt = buildDraftPrompt({ facts: withAlias, keptFactIds: null, extraArguments: [], angle: "role", skeleton, organizationName: "Cabinet Horizon" });
  const all = JSON.stringify(withAlias.facts) + withAlias.title + prompt.system + prompt.user;
  assert(!all.includes("Acme"), "le nom réel ne sort pas");
  assert(prompt.user.includes("Entreprise : un groupe industriel familial"));
  assertEquals(withAlias.company, { name: "un groupe industriel familial", anonymized: true, hiddenNames: ["Acme Industries"] });

  const noAlias = facts(fullJobDetails({ outreach_config: { anonymize_client: true } }));
  const p2 = buildDraftPrompt({ facts: noAlias, keptFactIds: null, extraArguments: [], angle: "role", skeleton, organizationName: "Cabinet Horizon" });
  assert(!(JSON.stringify(noAlias.facts) + p2.user + p2.system).includes("Acme"));
  assertEquals(noAlias.company.name, null);
  assert(p2.user.includes("non nommée (client anonymisé)"));

  // Client nommé : son nom est transmis.
  const named = facts(fullJobDetails());
  assertEquals(named.company.name, "Acme Industries");
  // Colonne client_name prioritaire sur le brief.
  assertEquals(facts(fullJobDetails(), { clientName: "Acme Holding" }).company.name, "Acme Holding");
});

Deno.test("client anonymisé sous deux noms : ni l'un ni l'autre dans les consignes, les deux refusés en sortie", () => {
  // client_name et job_details.client.name sont saisis séparément et divergent.
  const f = facts(
    fullJobDetails({ outreach_config: { recruitment_mode: "client", anonymize_client: true, anonymized_alias: "un groupe industriel" } }),
    { clientName: "Acme Holding" },
  );
  assertEquals(f.company.hiddenNames.slice().sort(), ["Acme Holding", "Acme Industries"]);
  const skeleton = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: false }, ids);
  const prompt = buildDraftPrompt({ facts: f, keptFactIds: null, extraArguments: [], angle: "role", skeleton, organizationName: "Cabinet Horizon" });
  const all = JSON.stringify(f.facts) + f.title + prompt.system + prompt.user;
  assert(!all.includes("Acme Industries"), "le nom du brief ne sort pas");
  assert(!all.includes("Acme Holding"), "le nom de la colonne ne sort pas");
  assert(prompt.user.includes("un groupe industriel"));

  const c = draftCheckContextFor(f, { organizationName: "Cabinet Horizon", firstContact: "invitation" });
  for (const name of ["Acme Industries", "Acme Holding"]) {
    assert(codes([relance(`Bonjour {{prenom}}, ${name} structure sa direction financière. {{mon_prenom}}`)], c).includes("refuse:client_name"), name);
    const aliased = applyClientAlias([relance(`Bonjour {{prenom}}, ${name} recrute. {{mon_prenom}}`)], f.company.hiddenNames, "un groupe industriel");
    assertEquals(aliased[0].body, "Bonjour {{prenom}}, un groupe industriel recrute. {{mon_prenom}}");
  }
});

Deno.test("client anonymisé dans l'intitulé : {{poste_recherche}} refusé, l'intitulé s'écrit en clair", () => {
  // Le moteur rend {{poste_recherche}} avec l'intitulé enregistré, sans alias.
  const f = facts(
    fullJobDetails({ title: "DAF Acme Holding", outreach_config: { recruitment_mode: "client", anonymize_client: true, anonymized_alias: "un groupe industriel" } }),
    { clientName: "Acme Holding" },
  );
  assertEquals(f.title, "DAF un groupe industriel");
  assertEquals(f.titleRevealsClient, true);
  const skeleton = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: false }, ids);
  const prompt = buildDraftPrompt({ facts: f, keptFactIds: null, extraArguments: [], angle: "role", skeleton, organizationName: "Cabinet Horizon" });
  assert(!prompt.system.includes("{{poste_recherche}} (intitulé du poste)"));
  assert(prompt.system.includes("ni {{poste_recherche}}"));
  const c = draftCheckContextFor(f, { organizationName: "Cabinet Horizon", firstContact: "invitation" });
  assert(codes([relance(GOOD_RELANCE)], c).includes("refuse:client_name"));
  // Intitulé sans le nom du client : la variable reste permise.
  const plain = facts(fullJobDetails({ outreach_config: { anonymize_client: true, anonymized_alias: "un groupe industriel" } }), { clientName: "Acme Holding" });
  assertEquals(plain.titleRevealsClient, false);
  assertEquals(codes([relance(GOOD_RELANCE)], draftCheckContextFor(plain, { organizationName: "Cabinet Horizon", firstContact: "invitation" })), []);
});

Deno.test("faits retirés par la personne : absents des consignes ; arguments ajoutés transmis", () => {
  const f = facts(fullJobDetails());
  const skeleton = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: false }, ids);
  const prompt = buildDraftPrompt({ facts: f, keptFactIds: ["team_size"], extraArguments: ["Création du poste"], angle: "environnement", skeleton, organizationName: "Cabinet Horizon" });
  assert(prompt.user.includes("Équipe de 14 personnes"));
  assert(!prompt.user.includes("Piloter deux acquisitions"));
  assert(prompt.user.includes("- Création du poste"));
  assert(prompt.user.includes("Angle : L'équipe et l'environnement"));
});

Deno.test("poste trop peu décrit : sans titre, non décrit, ou moins de deux points forts", () => {
  assertEquals(isJobTooThin(facts(fullJobDetails())), false);
  assertEquals(isJobTooThin(facts({ skills_must_have: ["Go", "Postgres"] })), true, "sans intitulé");
  assertEquals(isJobTooThin(facts({ title: "DAF", location: "Lyon", contract_type: "cdi" })), true, "ni compétence ni description");
  assertEquals(isJobTooThin(facts({ title: "DAF", skills_must_have: ["IFRS"] })), true, "un seul point fort");
  assertEquals(isJobTooThin(facts({ title: "DAF", skills_must_have: ["IFRS", "Consolidation"] })), false);
  assertEquals(isJobTooThin(facts({ title: "DAF", mission_description: "Structurer la direction financière du groupe et piloter les acquisitions.", location: "Lyon" })), false);
});

Deno.test("angles fixes : trois, un seul recommandé (le plus de matière), chacun avec son Pourquoi", () => {
  const angles = deriveAngles(facts({ title: "DAF", team_size: 14, reports_to: "Président", location: "Lyon", skills_must_have: ["IFRS"] }));
  assertEquals(angles.map((a) => a.id), ["role", "environnement", "trajectoire"]);
  assertEquals(angles.filter((a) => a.recommended).map((a) => a.id), ["environnement"]);
  assert(angles[1].why.startsWith("Pourquoi : le poste précise « Équipe de 14 personnes »"));
  assert(angles[2].why.includes("le poste en dit peu"));
  // Égalité : le premier.
  assertEquals(deriveAngles(facts({ title: "DAF" })).find((a) => a.recommended)?.id, "role");
  // Les missions décrites pèsent plus que des repères génériques (lieu, secteur, taille).
  assertEquals(deriveAngles(facts({
    title: "DAF", mission_description: "Piloter deux acquisitions et structurer la direction financière.",
    location: "Lyon", remote_policy: "hybrid", client: { sector: "Industrie", size: "enterprise" },
  })).find((a) => a.recommended)?.id, "role");
});

Deno.test("écran « Le poste » : faits du plus fort au plus faible, ordre du poste à égalité", () => {
  const f = facts({
    title: "DAF", location: "Lyon", team_size: 14, reports_to: "Président", seniority: "Senior", contract_type: "cdi",
    context: "Création du poste.", mission_description: "Piloter deux acquisitions.", skills_must_have: ["IFRS", "Consolidation"],
  });
  assertEquals(factsByStrength(f.facts).map((x) => x.id), [
    "mission", "context", "skill:0", "skill:1", "team_size", "reports_to", "seniority", "contract", "location",
  ]);
  // Les consignes gardent l'ordre de pickBriefFacts.
  assertEquals(f.facts[0].id, "mission");
});

Deno.test("Vos messages : mode, rôle, anonymisation et lien de rendez-vous repris du Cadrage", () => {
  const f = facts(fullJobDetails({ outreach_config: { recruitment_mode: "client", sender_role: "recruiter_external", anonymize_client: true, anonymized_alias: "un groupe industriel" } }), { calendlyLink: "https://agenda.exemple/x" });
  assertEquals(outreachSummary(f), [
    "Vous recrutez pour un client.",
    "Rôle de l'expéditeur : Consultant du cabinet.",
    "Client anonymisé : les messages parlent de « un groupe industriel ».",
    "Lien de rendez-vous de la mission : proposé dans une relance.",
  ]);
  const derived = facts(fullJobDetails({ outreach_config: {} }), { orgType: "enterprise" });
  assertEquals(derived.outreach.mode, "internal");
  assertEquals(outreachSummary(derived)[0], "Qui recrute : non précisé, les messages parlent au nom de votre entreprise.");
  assertEquals(outreachSummary(derived).at(-1), "Pas de lien de rendez-vous dans les messages.");
});

// ─── Forme fixée par le serveur ─────────────────────────────────────────────

const COMBINATIONS: Array<{ firstContact: FirstContact; profileVisit: boolean; relances: number }> = [];
for (const firstContact of ["invitation", "inmail"] as const) {
  for (const profileVisit of [true, false]) {
    for (const relances of [1, 2, 3]) COMBINATIONS.push({ firstContact, profileVisit, relances });
  }
}

const textsFor = (skeleton: DraftSkeleton): DraftSlotText[] =>
  skeleton.slots.map((s) => ({
    slot: s.slot,
    subject: s.needsSubject ? "Direction financière à Lyon" : "",
    body: s.slot === "invitation_note" ? GOOD_NOTE : s.slot === "first_message" ? GOOD_FIRST : GOOD_RELANCE,
  }));

Deno.test("forme : chaque combinaison (invitation ou InMail, visite ou non, 1 à 3 relances)", () => {
  for (const combo of COMBINATIONS) {
    const label = JSON.stringify(combo);
    const sk = buildDraftSkeleton(combo, ids);
    const types = sk.steps.map((s) => s.actionType);
    assertEquals(sk.steps.map((s) => s.order), sk.steps.map((_, i) => i), `${label} : ordres continus depuis 0`);
    assertEquals(new Set(sk.steps.map((s) => s.id)).size, sk.steps.length, `${label} : identifiants uniques`);
    for (const s of sk.steps) {
      assertEquals(s.useAiPersonalization, false, `${label} : jamais de rédaction par l'IA à l'envoi`);
      assertEquals(s.aiTone, "professional");
      assert(isStepTypeOffered(s.actionType), `${label} : type ${s.actionType} offert par l'éditeur`);
      assertEquals([s.preferredHourStart, s.preferredHourEnd], [9, 18]);
    }
    const visit = combo.profileVisit ? ["profile_visit"] : [];
    if (combo.firstContact === "invitation") {
      assertEquals(types, [...visit, "connection_request", "wait_connection", "message", ...Array(combo.relances).fill("message")], label);
      const wait = sk.steps.find((s) => s.actionType === "wait_connection")!;
      assertEquals([wait.waitForEvent, wait.timeoutDays, wait.timeoutAction], ["connection_accepted", DRAFT_WAIT_CONNECTION_DAYS, "skip"]);
      const messages = sk.steps.filter((s) => s.actionType === "message");
      assertEquals(messages.map((s) => s.conditionType), messages.map(() => "if_connected"), `${label} : « Si connecté »`);
      assertEquals(messages.map((s) => s.delayDays), [0, ...INVITATION_RELANCE_DELAYS.slice(0, combo.relances)], `${label} : 0, 4, puis 7 jours`);
      assertEquals(sk.slots.map((s) => s.slot), ["invitation_note", "first_message", ...Array.from({ length: combo.relances }, (_, i) => `relance_${i + 1}`)]);
      assertEquals(sk.steps.find((s) => s.actionType === "connection_request")!.delayDays, 0);
    } else {
      assertEquals(types, [...visit, "inmail", ...Array(combo.relances).fill("inmail")], label);
      const inmails = sk.steps.filter((s) => s.actionType === "inmail");
      assertEquals(inmails.map((s) => s.delayDays), [0, ...INMAIL_RELANCE_DELAYS.slice(0, combo.relances)]);
      assertEquals(inmails.map((s) => s.conditionType), inmails.map(() => "always"));
      assert(sk.slots.every((s) => s.needsSubject), `${label} : objet demandé pour chaque InMail`);
      assertEquals(sk.slots.map((s) => s.slot), ["first_message", ...Array.from({ length: combo.relances }, (_, i) => `relance_${i + 1}`)]);
    }

    // Remplie, la séquence s'ouvre et s'enregistre dans l'éditeur sans point bloquant.
    const steps = fillSkeleton(sk, textsFor(sk)) as unknown as SequenceStep[];
    const validation = validateSequence({ name: "Approche Directeur financier", steps }, null, { unknownVariables: "block" });
    assertEquals(validation.errors, [], `${label} : aucun point bloquant`);
    // Aller-retour par la ligne de save_sequence_steps, comme la relecture de l'éditeur.
    for (const step of steps) {
      const back = rowToSequenceStep(draftStepToSaveRow(step as never) as never);
      const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
      assertEquals(clean(back as unknown as Record<string, unknown>), clean({ ...step, variantWeight: 100 } as unknown as Record<string, unknown>), `${label} : ${step.actionType}`);
    }
  }
});

Deno.test("forme : relances hors bornes ramenées entre 1 et 3", () => {
  assertEquals(buildDraftSkeleton({ firstContact: "invitation", relances: 9, profileVisit: false }, ids).relances, 3);
  assertEquals(buildDraftSkeleton({ firstContact: "invitation", relances: 0, profileVisit: false }, ids).relances, 1);
});

Deno.test("variables : copie fidèle de SEQUENCE_TEMPLATE_KEYS de l'éditeur", () => {
  assertEquals([...DRAFT_TEMPLATE_KEYS], [...SEQUENCE_TEMPLATE_KEYS]);
});

Deno.test("consignes InMail : objet demandé pour chaque texte ; lien de rendez-vous seulement si la mission en a un", () => {
  const sk = buildDraftSkeleton({ firstContact: "inmail", relances: 2, profileVisit: false }, ids);
  const withLink = buildDraftPrompt({ facts: facts(fullJobDetails(), { calendlyLink: "https://agenda.exemple" }), keptFactIds: null, extraArguments: [], angle: "role", skeleton: sk, organizationName: "Cabinet Horizon" });
  assert(withLink.user.includes('{"first_message": {"subject": "...", "body": "..."}, "relances": [{"subject": "...", "body": "..."}, {"subject": "...", "body": "..."}]}'));
  assert(!withLink.user.includes("invitation_note"));
  assert(withLink.system.includes("{{lien_calendly}}"));
  const noLink = buildDraftPrompt({ facts: facts(fullJobDetails()), keptFactIds: null, extraArguments: [], angle: "role", skeleton: sk, organizationName: "Cabinet Horizon" });
  assert(!noLink.system.includes("{{lien_calendly}}"));
  assert(noLink.system.includes("Ne citez jamais « Konekt »"));
  const konekt = buildDraftPrompt({ facts: facts(fullJobDetails()), keptFactIds: null, extraArguments: [], angle: "role", skeleton: sk, organizationName: "Konekt Recrutement" });
  assert(!konekt.system.includes("Ne citez jamais « Konekt »"));
});

// ─── Réponse du modèle ──────────────────────────────────────────────────────

Deno.test("réponse invalide : JSON illisible refusé ; emplacement manquant vide ; emplacement en trop ignoré", () => {
  const sk = buildDraftSkeleton({ firstContact: "invitation", relances: 2, profileVisit: true }, ids);
  assertEquals(parseDraftResponse("Voici votre séquence !", sk).ok, false);
  assertEquals(parseDraftResponse('{"invitation_note": "Bonjour"', sk).ok, false);
  assertEquals(parseDraftResponse("[1, 2]", sk).ok, false);
  assertEquals(parseDraftResponse("", sk).ok, false);

  const fenced = parseDraftResponse('```json\n{"invitation_note": "Note", "first_message": {"body": "Premier"}, "relances": [{"body": "R1"}, {"body": "R2"}, {"body": "R3 en trop"}], "autre": 1}\n```', sk);
  assert(fenced.ok);
  if (fenced.ok) {
    assertEquals(fenced.texts.map((t) => [t.slot, t.body]), [["invitation_note", "Note"], ["first_message", "Premier"], ["relance_1", "R1"], ["relance_2", "R2"]]);
    assertEquals(fenced.missing, []);
  }
  const partial = parseDraftResponse('{"first_message": "Premier en texte simple", "relances": [{"body": "  "}]}', sk);
  assert(partial.ok);
  if (partial.ok) {
    assertEquals(partial.missing, ["invitation_note", "relance_1", "relance_2"]);
    assertEquals(partial.texts.find((t) => t.slot === "first_message")?.body, "Premier en texte simple");
  }
  // InMail : objet lu ; pas d'objet pour une invitation.
  const inmail = buildDraftSkeleton({ firstContact: "inmail", relances: 1, profileVisit: false }, ids);
  const read = parseDraftResponse('{"first_message": {"subject": "Poste à Lyon", "body": "Corps"}, "relances": [{"subject": "Suite", "body": "Relance"}]}', inmail);
  assert(read.ok);
  if (read.ok) assertEquals(read.texts.map((t) => t.subject), ["Poste à Lyon", "Suite"]);
});

Deno.test("fillSkeleton : textes posés sur leurs étapes, squelette intact", () => {
  const sk = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: true }, ids);
  const steps = fillSkeleton(sk, textsFor(sk));
  assertEquals(steps.find((s) => s.actionType === "connection_request")?.messageTemplate, GOOD_NOTE);
  assertEquals(steps.filter((s) => s.actionType === "message").map((s) => s.messageTemplate), [GOOD_FIRST, GOOD_RELANCE]);
  assertEquals(steps.find((s) => s.actionType === "profile_visit")?.messageTemplate, "");
  assert(sk.steps.every((s) => s.messageTemplate === ""), "le squelette n'est pas modifié");
});

// ─── Contrôles des textes ───────────────────────────────────────────────────

Deno.test("contrôles : un texte correct ne déclenche rien", () => {
  assertEquals(codes([note(GOOD_NOTE), first(GOOD_FIRST), relance(GOOD_RELANCE)]), []);
});

Deno.test("contrôles : rémunération refusée (montant, package, salaire)", () => {
  assert(codes([relance("Bonjour {{prenom}}, poste à 65 k€ fixe. {{mon_prenom}}")]).includes("refuse:remuneration"));
  assert(codes([relance("Bonjour {{prenom}}, un package attractif vous attend. {{mon_prenom}}")]).includes("refuse:remuneration"));
  assert(codes([relance("Bonjour {{prenom}}, le salaire est motivant. {{mon_prenom}}")]).includes("refuse:remuneration"));
  // Formulations courantes, sans le mot « salaire » ni « k€ ».
  for (const text of [
    "le poste est rémunéré entre 55 000 et 65 000 euros brut",
    "salaires attractifs",
    "rémunérations très attractives",
    "4 500 € par mois",
    "une fourchette ouverte selon le profil",
    "jusqu'à 70k brut annuel",
    "un TJM confortable",
    "des primes sur objectifs",
  ]) {
    assert(codes([relance(`Bonjour {{prenom}}, ${text}. {{mon_prenom}}`)]).includes("refuse:remuneration"), text);
  }
  // L'objet d'un InMail aussi.
  const issues = checkDraftTexts([first(GOOD_FIRST, "Poste à 90 k€")], ctx({ firstContact: "inmail" }));
  assert(issues.some((i) => i.field === "subject" && i.code === "remuneration"));
});

Deno.test("contrôles : un nombre qui n'est pas une rémunération passe (« 500 k utilisateurs », effectifs, durées)", () => {
  for (const text of [
    "la plateforme sert 500 k utilisateurs chaque mois",
    "une équipe de 14 personnes et 2 jours de télétravail par semaine",
    "deux acquisitions dans les 18 mois",
    "un parc de 1 200 clients en France",
  ]) {
    assertEquals(codes([relance(`Bonjour {{prenom}}, ${text}. {{mon_prenom}}`)]), [], text);
    assertEquals(findRemuneration(text), null, text);
  }
});

Deno.test("contrôles : valeurs gardées pour l'équipe refusées (montants du poste, critères, contacts, entreprises ciblées)", () => {
  const forbidden = briefForbiddenValues(fullJobDetails({ salary_min: 55000, salary_max: 65 }));
  // 65 est un montant en milliers : 65 000 compte aussi.
  assertEquals(forbidden.amounts.slice().sort((a, b) => a - b), [55000, 65000]);
  const c = ctx({ forbidden, allowedText: facts(fullJobDetails()).facts.map((f) => f.text).join("\n") });
  for (const [text, code] of [
    ["entre 55 000 et 65 000 selon le profil", "remuneration"],
    ["jusqu'à 65k selon le profil", "remuneration"],
    ["le critère Critere-interne-SECRET compte", "internal_brief"],
    ["Manager Martin vous attend", "internal_brief"],
    ["vous venez de chez Concurrent SA", "internal_brief"],
    ["un profil comme Calibre Dupont", "internal_brief"],
    ["appelez le 06 11 22 33 44", "internal_brief"],
  ] as const) {
    assert(codes([relance(`Bonjour {{prenom}}, ${text}. {{mon_prenom}}`)], c).includes(`refuse:${code}`), text);
  }
  // Une valeur reprise des faits du poste reste permise (critère qui est aussi une compétence).
  const shared = briefForbiddenValues(fullJobDetails({ evaluation_criteria: [{ label: "Consolidation", weight: 3 }] }));
  assertEquals(codes([relance("Bonjour {{prenom}}, votre expérience en Consolidation m'a frappé. {{mon_prenom}}")], ctx({ forbidden: shared, allowedText: "Compétence clé : Consolidation" })), []);
});

Deno.test("contrôles : les textes de secours des variables sont contrôlés comme le reste", () => {
  const c = ctx({ hiddenClientNames: ["Acme Holding"] });
  assert(codes([relance('Bonjour {{prenom}}, chez {{entreprise_actuelle | fallback:"Acme Holding"}} vous avez avancé. {{mon_prenom}}')], c).includes("refuse:client_name"));
  assert(codes([relance('Bonjour {{prenom}}, votre rôle de {{poste_actuel | fallback:"voir https://evil.example.com"}} m\'intéresse. {{mon_prenom}}')]).includes("refuse:link"));
  assert(codes([relance('Bonjour {{prenom}}, je vous écris de {{ma_societe | fallback:"Konekt"}}. {{mon_prenom}}')]).includes("refuse:konekt"));
  assert(codes([relance('Bonjour {{prenom}}, chez {{entreprise_actuelle | fallback:"Unipile"}} vous avez avancé. {{mon_prenom}}')]).includes("refuse:vendor"));
  assert(codes([relance('Bonjour {{prenom}}, {{poste_actuel | fallback:"ton poste"}} m\'intéresse. {{mon_prenom}}')]).includes("warn:tutoiement"));
  // Les deux secours prescrits passent.
  assertEquals(codes([relance('Bonjour {{prenom}}, votre rôle de {{poste_actuel | fallback:"votre poste actuel"}} chez {{entreprise_actuelle | fallback:"votre entreprise"}} m\'intéresse. {{mon_prenom}}')]), []);
});

Deno.test("contrôles : chaque nom de prestataire refusé, sauf repris du nom de l'organisation ou du poste", () => {
  for (const vendor of ["Unipile", "People Data Labs", "PDL", "Apollo", "Brandfetch", "Clearbit", "Logo.dev", "Resend", "Anthropic", "Claude AI", "l'assistant Claude", "Lemlist", "HeyReach", "Coresignal", "BetterContact", "Dropcontact", "Phantombuster", "OpenAI", "ChatGPT", "Deepgram"]) {
    assert(codes([relance(`Bonjour {{prenom}}, nous utilisons ${vendor} pour vous écrire. {{mon_prenom}}`)]).includes("refuse:vendor"), vendor);
  }
  // « Claude » est aussi un prénom.
  assertEquals(codes([relance("Bonjour {{prenom}}, je suis Claude, du Cabinet Horizon. Seriez-vous ouvert à un échange ?\n\n{{mon_prenom}}")]), []);
  assertEquals(codes([relance("Bonjour {{prenom}}, l'équipe Apollo cherche un pilote. {{mon_prenom}}")], ctx({ allowedText: "Missions : rejoindre l'équipe Apollo" })), []);
  assertEquals(codes([relance("Bonjour {{prenom}}, chez Apollo Conseil nous cherchons. {{mon_prenom}}")], ctx({ organizationName: "Apollo Conseil" })), []);
});

Deno.test("contrôles : Notion refusé, le nom commun « notion » non", () => {
  assert(codes([relance("Bonjour {{prenom}}, voici notre page Notion. {{mon_prenom}}")]).includes("refuse:external_tool"));
  assertEquals(codes([relance("Bonjour {{prenom}}, la notion d'équipe compte beaucoup ici. {{mon_prenom}}")]), []);
});

Deno.test("contrôles : liens et adresses refusés, compétences à point non", () => {
  for (const text of ["voir https://exemple.fr", "voir www.exemple.fr", "écrivez à jean@exemple.fr", "réservez sur calendly.com/jean", "notre site acme.fr"]) {
    assert(codes([relance(`Bonjour {{prenom}}, ${text}. {{mon_prenom}}`)]).includes("refuse:link"), text);
  }
  assertEquals(codes([relance("Bonjour {{prenom}}, l'équipe travaille en ASP.NET, Node.js et Socket.io. {{mon_prenom}}")]), []);
  // Un nom de domaine repris du poste reste permis.
  assertEquals(codes([relance("Bonjour {{prenom}}, rejoignez Doctolib.fr. {{mon_prenom}}")], ctx({ allowedText: "Contexte : Doctolib.fr recrute" })), []);
});

Deno.test("contrôles : « Konekt » refusé hors du nom de l'organisation", () => {
  assert(codes([relance("Bonjour {{prenom}}, je vous écris de la part de Konekt. {{mon_prenom}}")]).includes("refuse:konekt"));
  assertEquals(codes([relance("Bonjour {{prenom}}, je vous écris de la part de Konekt. {{mon_prenom}}")], ctx({ organizationName: "Konekt" })), []);
});

Deno.test("contrôles : variables hors liste et {{client}} refusées ; lien de rendez-vous à sa place", () => {
  assert(codes([relance("Bonjour {{prenom}}, chez {{client}} nous cherchons. {{mon_prenom}}")]).includes("refuse:client_variable"));
  assert(codes([relance("Bonjour {{prenom}}, chez {{societe}} nous cherchons. {{mon_prenom}}")]).includes("refuse:unknown_variable"));
  assert(codes([relance("Bonjour {{prénom}}, nous cherchons. {{mon_prenom}}")]).includes("refuse:unknown_variable"));
  // {{lien_calendly}} : refusé sans lien, dans la note ou le premier message ; permis dans une relance.
  assert(codes([relance("Bonjour {{prenom}}, un créneau : {{lien_calendly}} {{mon_prenom}}")], ctx({ hasCalendlyLink: false })).includes("refuse:calendly"));
  assert(codes([first("Bonjour {{prenom}}, un créneau : {{lien_calendly}} {{mon_prenom}}")]).includes("refuse:calendly"));
  assert(codes([note("Bonjour {{prenom}}, un créneau : {{lien_calendly}} {{mon_prenom}}")]).includes("refuse:calendly"));
  assertEquals(codes([relance("Bonjour {{prenom}}, choisissez un créneau : {{lien_calendly}}\n\n{{mon_prenom}}")]), []);
  // Variables du moteur permises.
  assertEquals(codes([relance("Bonjour {{prenom}}, votre rôle de {{poste_actuel | fallback:\"responsable\"}} chez {{entreprise_actuelle | fallback:\"votre entreprise\"}} m'intéresse. {{ma_signature}}")]), []);
});

Deno.test("contrôles : repli manquant et prénom mal placé signalés, sans retirer le texte", () => {
  const issues = checkDraftTexts([relance("Bonjour {{prenom}} ! Votre rôle chez {{entreprise_actuelle}} m'intéresse. {{mon_prenom}}")], ctx());
  assertEquals(issues.map((i) => `${i.severity}:${i.code}`).sort(), ["warn:first_name_placement", "warn:missing_fallback"]);
});

Deno.test("contrôles : note d'invitation de plus de 300 caractères une fois les variables remplacées", () => {
  const raw = `Bonjour {{prenom}}, ${"x".repeat(255)} {{mon_prenom}}`;
  assert(raw.length <= 300, "le texte brut tient en 300 caractères");
  assert(renderedLengthUpperBound(raw, "Directeur financier") > 300);
  assert(codes([note(raw)]).includes("refuse:invite_too_long"));
  assertEquals(codes([note(GOOD_NOTE)]), []);
  assert(renderedLengthUpperBound("{{poste_recherche}}", "Directeur financier") === "Directeur financier".length);
});

Deno.test("contrôles : message trop long, objet absent ou trop long, texte absent", () => {
  assert(codes([relance(`Bonjour {{prenom}}, ${"mot ".repeat(400)}`)]).includes("refuse:too_long"));
  const inmail = ctx({ firstContact: "inmail" });
  assert(codes([first(GOOD_FIRST, "")], inmail).includes("refuse:missing"));
  assert(codes([first(GOOD_FIRST, "Un objet bien plus long que quarante caractères au total")], inmail).includes("warn:subject_long"));
  assert(codes([first("")]).includes("refuse:missing"));
});

Deno.test("contrôles : nom réel du client anonymisé refusé, remplacé par l'alias s'il existe", () => {
  const c = ctx({ hiddenClientNames: ["Acme Industries"] });
  assert(codes([relance("Bonjour {{prenom}}, Acme Industries recrute. {{mon_prenom}}")], c).includes("refuse:client_name"));
  const aliased = applyClientAlias([relance("Bonjour {{prenom}}, Acme Industries recrute. {{mon_prenom}}")], ["Acme Industries"], "un groupe industriel");
  assertEquals(aliased[0].body, "Bonjour {{prenom}}, un groupe industriel recrute. {{mon_prenom}}");
  assertEquals(codes(aliased, c), []);
});

Deno.test("contrôles : posture de cabinet refusée en recrutement interne, signature « Recruteur » refusée", () => {
  const internal = ctx({ internalMode: true });
  assert(codes([relance("Bonjour {{prenom}}, mon client cherche un directeur financier. {{mon_prenom}}")], internal).includes("refuse:posture"));
  assertEquals(codes([relance("Bonjour {{prenom}}, mon client cherche un directeur financier. {{mon_prenom}}")]), []);
  assert(codes([relance("Bonjour {{prenom}}, nous cherchons un directeur financier.\n\nRecruteur")]).includes("refuse:signature"));
});

Deno.test("contrôles : formulations discriminatoires signalées, pas « senior » ni « 5 ans d'expérience »", () => {
  for (const text of ["un jeune diplômé", "moins de 35 ans", "un homme de terrain", "de nationalité française", "langue maternelle française", "anglais natif", "célibataire et mobile", "en bonne santé", "habitant à Lyon", "une jeune équipe"]) {
    assert(codes([relance(`Bonjour {{prenom}}, nous cherchons ${text}. {{mon_prenom}}`)]).includes("warn:discriminatory"), text);
  }
  for (const text of [
    "un profil senior", "5 ans d'expérience", "plus de 10 ans d'expérience", "entre 10 et 15 ans d'expérience",
    "une application React Native", "une équipe de 14 personnes",
  ]) {
    assertEquals(codes([relance(`Bonjour {{prenom}}, nous cherchons ${text}. {{mon_prenom}}`)]), [], text);
  }
  // Signalé, jamais retiré.
  const issue = checkDraftTexts([relance("Bonjour {{prenom}}, idéal pour un jeune diplômé. {{mon_prenom}}")], ctx())[0];
  assertEquals([issue.severity, issue.message], ["warn", "À relire : « jeune diplômé » peut être lu comme un critère lié à l'âge."]);
});

Deno.test("contrôles : premier message qui suppose une invitation acceptée signalé, relance non", () => {
  assert(codes([first("Merci d'avoir accepté mon invitation, {{prenom}}. Nous cherchons. {{mon_prenom}}")]).includes("warn:depends_on_invitation"));
  assertEquals(codes([relance("Bonjour {{prenom}}, comme je vous le disais, le poste reste ouvert. {{mon_prenom}}")]), []);
});

Deno.test("contrôles : tutoiement signalé, mots qui le contiennent non", () => {
  assert(codes([relance("Bonjour {{prenom}}, tu cherches un nouveau poste ? {{mon_prenom}}")]).includes("warn:tutoiement"));
  assert(codes([relance("Bonjour {{prenom}}, je te propose un échange. {{mon_prenom}}")]).includes("warn:tutoiement"));
  for (const text of ["ton profil m'a frappé", "ta carrière avance vite", "tes compétences en IFRS"]) {
    assert(codes([relance(`Bonjour {{prenom}}, ${text}. {{mon_prenom}}`)]).includes("warn:tutoiement"), text);
  }
  assertEquals(codes([relance("Bonjour {{prenom}}, le statut du poste à Toulouse est ouvert. {{mon_prenom}}")]), []);
  assertEquals(codes([relance("Bonjour {{prenom}}, le ton du projet est direct et les équipes sont soudées. {{mon_prenom}}")]), []);
});

// ─── Passe de correction et revue finale ────────────────────────────────────

Deno.test("correction : demandée sur un refus ou une formulation sensible, pas sur un détail", () => {
  assertEquals(needsCorrection(checkDraftTexts([relance("Bonjour {{prenom}}, 65 k€. {{mon_prenom}}")], ctx())), true);
  assertEquals(needsCorrection(checkDraftTexts([relance("Bonjour {{prenom}}, un jeune diplômé. {{mon_prenom}}")], ctx())), true);
  assertEquals(needsCorrection(checkDraftTexts([relance("Bonjour {{prenom}} ! Le poste reste ouvert. {{mon_prenom}}")], ctx())), false);
  const request = buildCorrectionRequest(checkDraftTexts([relance("Bonjour {{prenom}}, 65 k€. {{mon_prenom}}")], ctx()));
  assert(request.includes("- relance_1 : il citait une rémunération."));
  assert(!request.includes("Texte retiré"));
});

Deno.test("correction : la version la plus sûre est gardée par emplacement", () => {
  const original = [note(GOOD_NOTE), first("Bonjour {{prenom}}, 65 k€. {{mon_prenom}}")];
  const corrected = [note("Bonjour {{prenom}}, voir https://x.fr {{mon_prenom}}"), first(GOOD_FIRST)];
  const best = pickBestTexts(original, checkDraftTexts(original, ctx()), corrected, checkDraftTexts(corrected, ctx()));
  assertEquals(best.texts.map((t) => t.body), [GOOD_NOTE, GOOD_FIRST]);
  assertEquals(best.issues, []);
});

Deno.test("revue : texte refusé vidé et « À rédiger » (l'éditeur bloque), formulation à relire gardée", () => {
  const sk = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: false }, ids);
  const texts = [note(GOOD_NOTE), first("Bonjour {{prenom}}, poste à 65 k€. {{mon_prenom}}"), relance("Bonjour {{prenom}}, idéal pour un jeune diplômé. {{mon_prenom}}")];
  const { steps, flags } = applyDraftReview(sk, texts, checkDraftTexts(texts, ctx()));
  const firstStep = steps.find((s) => s.id === sk.slots[1].stepId)!;
  const relanceStep = steps.find((s) => s.id === sk.slots[2].stepId)!;
  assertEquals(firstStep.messageTemplate, "");
  assert(relanceStep.messageTemplate.includes("jeune diplômé"));
  assertEquals(flags.map((f) => [f.step_id, f.kind]), [[firstStep.id, "a_rediger"], [relanceStep.id, "a_relire"]]);
  assertEquals(flags[0].messages, ["Texte retiré : il citait une rémunération."]);
  const validation = validateSequence({ name: "Approche", steps: steps as unknown as SequenceStep[] });
  assert(validation.errors.some((e) => e.check === "messages"), "l'éditeur bloque l'enregistrement d'une étape vide");
});

// ─── Arguments ajoutés et requêtes ──────────────────────────────────────────

Deno.test("arguments ajoutés : mêmes interdits que la sortie", () => {
  assert(checkExtraArgument("Package de 90 k€", "Cabinet Horizon")?.includes("rémunération"));
  assert(checkExtraArgument("Outil interne sur Notion", "Cabinet Horizon")?.includes("outil technique"));
  assert(checkExtraArgument("Voir https://exemple.fr", "Cabinet Horizon")?.includes("lien"));
  assert(checkExtraArgument("Idéal pour un jeune diplômé", "Cabinet Horizon")?.includes("âge"));
  assertEquals(checkExtraArgument("Création du poste, rattaché au président", "Cabinet Horizon"), null);
  assertEquals(checkExtraArgument("Poste senior, 5 ans d'expérience", "Cabinet Horizon"), null);
  // Rémunération sous ses formes courantes, refusée avant tout appel.
  for (const text of ["Fourchette 55 000 à 65 000 euros brut annuel", "Salaires attractifs", "4 500 € par mois", "Rémunérations très attractives"]) {
    assert(checkExtraArgument(text, "Cabinet Horizon")?.includes("rémunération"), text);
  }
  // Montant du poste sans unité, et nom réel d'un client anonymisé.
  const guard = { hiddenClientNames: ["Acme Holding"], forbidden: briefForbiddenValues({ salary_min: 55000 }) };
  assert(checkExtraArgument("Entre 55 000 et 60 000", "Cabinet Horizon", guard)?.includes("rémunération"));
  assert(checkExtraArgument("Acme Holding se développe en Europe", "Cabinet Horizon", guard)?.includes("client anonymisé"));
  assertEquals(checkExtraArgument("La plateforme sert 500 k utilisateurs", "Cabinet Horizon", guard), null);
});

Deno.test("requête draft : bornes et valeurs par défaut", () => {
  const base = { organization_id: "00000000-0000-4000-8000-000000000001", mission_id: "00000000-0000-4000-8000-000000000002" };
  const ok = parseDraftRequest(base);
  assert(ok.ok);
  if (ok.ok) {
    assertEquals([ok.request.relances, ok.request.first_contact, ok.request.profile_visit, ok.request.angle, ok.request.kept_fact_ids], [2, "invitation", true, null, null]);
  }
  for (const bad of [
    { relances: 0 }, { relances: 4 }, { relances: 2.5 }, { first_contact: "email" }, { angle: "salaire" },
    { extra_arguments: Array(6).fill("a") }, { extra_arguments: ["x".repeat(161)] }, { kept_fact_ids: ["mission; drop"] },
    { profile_visit: "oui" },
  ]) {
    const parsed = parseDraftRequest({ ...base, ...bad });
    assertEquals(parsed.ok, false, JSON.stringify(bad));
  }
  assertEquals(parseDraftRequest({ ...base, mission_id: "x" }).ok, false);
  const full = parseDraftRequest({ ...base, relances: 3, first_contact: "inmail", profile_visit: false, angle: "trajectoire", kept_fact_ids: ["skill:0", "skill:0", "team_size"], extra_arguments: ["  Création  du poste ", ""] });
  assert(full.ok);
  if (full.ok) {
    assertEquals(full.request.kept_fact_ids, ["skill:0", "team_size"]);
    assertEquals(full.request.extra_arguments, ["Création du poste"]);
  }
});

// ─── Outil create_sequence de l'assistant ───────────────────────────────────

Deno.test("create_sequence : forme demandée avec les défauts de la rédaction, bornes refusées", () => {
  assertEquals(parseSkeletonOptions({}), { ok: true, options: { firstContact: "invitation", relances: 2, profileVisit: true } });
  assertEquals(parseSkeletonOptions({ first_contact: "inmail", relances: 3, profile_visit: false }), {
    ok: true,
    options: { firstContact: "inmail", relances: 3, profileVisit: false },
  });
  assertEquals(parseSkeletonOptions({ relances: "1" }), { ok: true, options: { firstContact: "invitation", relances: 1, profileVisit: true } });
  for (const bad of [{ first_contact: "email" }, { relances: 0 }, { relances: 4 }, { relances: 1.5 }, { relances: "deux" }, { profile_visit: "oui" }]) {
    assert(!parseSkeletonOptions(bad).ok, JSON.stringify(bad));
  }
});

Deno.test("create_sequence : un champ par emplacement, objets d'InMail seulement, texte hors forme ignoré", () => {
  const inv = buildDraftSkeleton({ firstContact: "invitation", relances: 1, profileVisit: false }, ids);
  const fields = {
    invitation_note: "  Bonjour {{prenom}},   une note.  ",
    first_message: "Premier\r\n\r\n\r\nmessage",
    first_message_subject: "Ignoré hors InMail",
    relance_1: "Relance 1",
    relance_2: "Relance en trop",
  };
  assertEquals(slotTextsFromFields(fields, inv), [
    { slot: "invitation_note", subject: "", body: "Bonjour {{prenom}}, une note." },
    { slot: "first_message", subject: "", body: "Premier\n\nmessage" },
    { slot: "relance_1", subject: "", body: "Relance 1" },
  ]);
  const inm = buildDraftSkeleton({ firstContact: "inmail", relances: 1, profileVisit: true }, ids);
  const texts = slotTextsFromFields({ ...fields, relance_1_subject: "Objet\nsur deux lignes" }, inm);
  assertEquals(texts.map((t) => t.slot), ["first_message", "relance_1"]);
  assertEquals(texts[0].subject, "Ignoré hors InMail");
  assertEquals(texts[1].subject, "Objet sur deux lignes");
});

Deno.test("create_sequence : raison du refus rendue au modèle avec le champ à reprendre", () => {
  const issues = checkDraftTexts(
    [first(`${GOOD_FIRST} Salaire de 80 k€.`, ""), relance("", "")],
    ctx({ firstContact: "inmail" }),
  );
  const reason = draftRefusalReason(issues) ?? "";
  assert(reason.startsWith("Séquence refusée : corrigez ces textes puis proposez-la de nouveau."), reason);
  assert(reason.includes("- first_message : il citait une rémunération."), reason);
  assert(reason.includes("- first_message_subject : Objet absent de la proposition."), reason);
  assert(reason.includes("- relance_1 : Texte absent de la proposition."), reason);
  assertEquals(draftRefusalReason(checkDraftTexts([relance(GOOD_RELANCE)], ctx())), null);
  // Une formulation à relire ne refuse pas la séquence.
  assertEquals(draftRefusalReason(checkDraftTexts([relance(`${GOOD_RELANCE} Tu es disponible ?`)], ctx())), null);
});

Deno.test("contexte des contrôles : poste de la mission, ou aucun lien ni client sans mission", () => {
  const f = facts(fullJobDetails({ outreach_config: { recruitment_mode: "internal", anonymize_client: true, anonymized_alias: "un groupe industriel" } }), {
    calendlyLink: "https://calendly.com/x",
  });
  const c = draftCheckContextFor(f, { organizationName: "Acme", firstContact: "inmail", extraArguments: ["Argument ajouté"] });
  assertEquals(c.hasCalendlyLink, true);
  assertEquals(c.internalMode, true);
  assertEquals(c.firstContact, "inmail");
  assertEquals(c.hiddenClientNames, ["Acme Industries"]);
  assert(c.allowedText?.includes("Argument ajouté"));
  assert(!c.allowedText?.includes("Acme Industries"), "nom réel d'un client anonymisé jamais permis");
  assertEquals(draftCheckContextFor(null, { organizationName: "Acme", firstContact: "invitation" }), {
    organizationName: "Acme",
    firstContact: "invitation",
    hasCalendlyLink: false,
    internalMode: false,
    jobTitle: "",
    hiddenClientNames: [],
    jobTitleRevealsClient: false,
    allowedText: "",
  });
});

// ─── text-action sur une étape de séquence ──────────────────────────────────

Deno.test("text-action : emplacement du texte d'une étape", () => {
  assertEquals(stepTextSlot("connection_request", true), "invitation_note");
  assertEquals(stepTextSlot("message", true), "first_message");
  assertEquals(stepTextSlot("inmail", true), "first_message");
  assertEquals(stepTextSlot("message", false), "relance_1");
});

Deno.test("text-action : la proposition est refusée pour ce qu'elle ajoute d'interdit, pas pour le texte d'origine", () => {
  const c = ctx({ hasCalendlyLink: false });
  // Ajout d'une rémunération et d'un lien : refusé.
  const added = reviewTextProposal({ before: GOOD_RELANCE, after: `${GOOD_RELANCE} Package de 90 k€, voir www.acme.fr`, slot: "relance_1" }, c);
  assert(added.refusals.includes("il citait une rémunération."), JSON.stringify(added));
  assert(added.refusals.includes("il contenait un lien ou une adresse."), JSON.stringify(added));
  // Le même point déjà dans le texte d'origine : signalé, pas refusé.
  const inherited = reviewTextProposal({
    before: `${GOOD_RELANCE} {{lien_calendly}}`,
    after: `${GOOD_RELANCE.replace("je reviens", "je me permets de revenir")} {{lien_calendly}}`,
    slot: "relance_1",
  }, c);
  assertEquals(inherited.refusals, []);
  assert(inherited.warnings.some((w) => w.startsWith("Déjà dans votre texte, à revoir : la mission n'a pas de lien")), JSON.stringify(inherited));
  // Une variable inconnue nouvelle est refusée même si le texte en avait déjà une autre.
  const otherVar = reviewTextProposal({ before: `${GOOD_RELANCE} {{foo}}`, after: `${GOOD_RELANCE} {{foo}} {{bar}}`, slot: "relance_1" }, c);
  assertEquals(otherVar.refusals, ["{{bar}} n'est pas une variable connue."]);
});

Deno.test("text-action : tutoiement ajouté refusé, premier message dépendant de l'invitation signalé ; note trop longue refusée", () => {
  // Vouvoiement imposé : une proposition qui tutoie un texte qui vouvoyait est refusée.
  const tutoie = reviewTextProposal({ before: "Bonjour {{prenom}}, voici le poste.", after: "Salut {{prenom}}, tu es parfait pour ce poste.", slot: "relance_1" }, ctx());
  assertEquals(tutoie.refusals, ["le texte tutoie le candidat ; les messages vouvoient."]);
  assert(!tutoie.warnings.some((w) => w.includes("tutoie")), JSON.stringify(tutoie));
  // Un texte d'origine qui tutoyait déjà : signalé, la personne garde la main.
  const already = reviewTextProposal({ before: "Salut {{prenom}}, tu cherches ?", after: "Bonjour {{prenom}}, tu cherches un poste ?", slot: "relance_1" }, ctx());
  assertEquals(already.refusals, []);
  assert(already.warnings.some((w) => w.includes("tutoie")), JSON.stringify(already));
  const warned = reviewTextProposal({ before: GOOD_FIRST, after: `Merci d'avoir accepté mon invitation. ${GOOD_FIRST}`, slot: "first_message" }, ctx());
  assertEquals(warned.refusals, []);
  assert(warned.warnings.some((w) => w.includes("doit se lire seul")), JSON.stringify(warned));
  const long = reviewTextProposal({ before: GOOD_NOTE, after: `${GOOD_NOTE} ${"Une phrase de plus pour allonger la note. ".repeat(4)}`, slot: "invitation_note" }, ctx());
  assert(long.refusals.some((r) => r.includes("300 caractères")), JSON.stringify(long));
  // L'objet n'est pas réécrit : un InMail sans objet ne refuse pas la proposition.
  assertEquals(reviewTextProposal({ before: GOOD_FIRST, after: GOOD_FIRST, slot: "first_message" }, ctx({ firstContact: "inmail" })).refusals, []);
});
