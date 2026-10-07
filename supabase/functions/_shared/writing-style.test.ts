// deno test --no-check --import-map=e2e/local-stack/import_map.json supabase/functions/_shared/writing-style.test.ts
//
// Lot 5e-2 : style et niveau de l'IA qui rédige (module pur). Épingle :
// - niveaux : lecture tolérante des réglages de l'organisation, résolution
//   (défaut, 400, 403 sans rétrogradation), modèle par niveau lu dans
//   ai-config, coût égal à l'estimation du garde des crédits ;
// - style : normalisation tolérante, analyse stricte des requêtes, anciens
//   tons sans tutoiement, résumé d'une ligne ;
// - consigne : vouvoiement en tête, longueurs (Standard = valeurs actuelles,
//   note sous 300), appel à l'action et règle unique de l'agenda ;
// - tutoiement : détecté, sauf sur les noms propres connus ;
// - plafond sur toutes les combinaisons (défaut, plafond, demande) : jamais
//   au-dessus, jamais rétrogradé, valeur hors liste refusée ;
// - consigne par réglage : chaque valeur a sa ligne, et ne change qu'elle ;
// - lecture des réglages (writing-settings.ts) : clés lues, défauts, refus
//   sur une lecture en échec.
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { ACTION_COSTS, MODEL_CATALOG, WRITING_LEVEL_MODELS, getModel } from "./ai-config.ts";
import { estimateActionCredits } from "./credit-guard.ts";
import { computeMessageTypeContext } from "./sequence-message-context.ts";
import {
  AI_LEVELS,
  AI_LEVEL_LABELS,
  DEFAULT_AI_LEVEL,
  DEFAULT_AI_LEVEL_MAX,
  DEFAULT_WRITING_STYLE,
  INVITATION_NOTE_HARD_MAX,
  LENGTH_TARGETS,
  STYLE_VALUES,
  allowedLevels,
  buildStyleInstructions,
  ctaFor,
  hasTutoiement,
  isAiLevel,
  lengthLine,
  levelChoices,
  levelCredits,
  levelOfModel,
  levelRank,
  modelForLevel,
  mergeStyle,
  normalizeOrgLevels,
  normalizeWritingStyle,
  parseStyleOverrides,
  resolveAiLevel,
  slotFor,
  styleFromLegacyTone,
  styleSummary,
  toneLines,
  type AiLevel,
  type MessageKind,
  type WritingSlot,
  type WritingStyle,
} from "./writing-style.ts";
import { loadWritingSettings } from "./writing-settings.ts";

// ─── Niveaux ────────────────────────────────────────────────────────────────

Deno.test("niveaux : réglages de l'organisation lus avec tolérance", () => {
  assertEquals(normalizeOrgLevels(null), { defaultLevel: "equilibre", maxLevel: "avance" });
  assertEquals(normalizeOrgLevels({}), { defaultLevel: "equilibre", maxLevel: "avance" });
  assertEquals(normalizeOrgLevels({ hide_payments_from_members: true }), { defaultLevel: "equilibre", maxLevel: "avance" });
  assertEquals(normalizeOrgLevels({ ai_writing: { level: "rapide", max: "equilibre" } }), { defaultLevel: "rapide", maxLevel: "equilibre" });
  // Valeurs inconnues : défauts ; défaut au-dessus du plafond : le plafond.
  assertEquals(normalizeOrgLevels({ ai_writing: { level: "expert", max: "turbo" } }), { defaultLevel: "equilibre", maxLevel: "avance" });
  assertEquals(normalizeOrgLevels({ ai_writing: { level: "avance", max: "rapide" } }), { defaultLevel: "rapide", maxLevel: "rapide" });
  assertEquals(normalizeOrgLevels({ ai_writing: { max: "rapide" } }), { defaultLevel: "rapide", maxLevel: "rapide" });
  assertEquals(normalizeOrgLevels({ ai_writing: "avance" }), { defaultLevel: "equilibre", maxLevel: "avance" });
});

Deno.test("niveaux : défaut, 400 inconnu, 403 au-dessus du plafond, jamais de rétrogradation", () => {
  const org = { defaultLevel: "rapide" as const, maxLevel: "equilibre" as const };
  assertEquals(resolveAiLevel(undefined, org), { ok: true, level: "rapide", requested: false });
  assertEquals(resolveAiLevel("", org), { ok: true, level: "rapide", requested: false });
  assertEquals(resolveAiLevel("equilibre", org), { ok: true, level: "equilibre", requested: true });
  const unknown = resolveAiLevel("expert", org);
  assert(!unknown.ok && unknown.status === 400 && unknown.code === "AI_LEVEL_INVALID");
  const above = resolveAiLevel("avance", org);
  assert(!above.ok && above.status === 403 && above.code === "AI_LEVEL_NOT_ALLOWED");
  if (!above.ok) assertEquals(above.error, "Votre organisation n'autorise pas le niveau Avancé. Choisissez Rapide ou Équilibré.");
  const onlyFast = resolveAiLevel("equilibre", { defaultLevel: "rapide", maxLevel: "rapide" });
  if (!onlyFast.ok) assertEquals(onlyFast.error, "Votre organisation n'autorise pas le niveau Équilibré. Choisissez Rapide.");
  else assert(false, "Équilibré aurait dû être refusé");
});

Deno.test("niveaux : modèle lu dans ai-config, Équilibré = modèle actuel de la rédaction", () => {
  for (const level of AI_LEVELS) assertEquals(modelForLevel(level), WRITING_LEVEL_MODELS[level]);
  assertEquals(modelForLevel("equilibre"), getModel("default", null, null, "sequence_draft"));
  assertEquals(modelForLevel("equilibre"), getModel("default", null, null, "outreach_message"));
  assertEquals(levelOfModel("claude-haiku-4-5-20251001"), "rapide");
  assertEquals(levelOfModel("claude-sonnet-4-6"), "equilibre");
  assertEquals(levelOfModel("claude-sonnet-5-5"), "equilibre");
  assertEquals(levelOfModel("claude-opus-4-6"), "avance");
  assertEquals(levelOfModel("claude-opus-5-5"), "avance");
  assertEquals(levelOfModel("gpt-4"), null);
});

Deno.test("niveaux : coût égal à l'estimation du garde, permission par le plafond", () => {
  for (const action of ["sequence_draft", "outreach_message", "rewrite_text"]) {
    assert(ACTION_COSTS[action], action);
    for (const level of AI_LEVELS) {
      assertEquals(levelCredits(action, level), estimateActionCredits(action, modelForLevel(level)).estimated, `${action} ${level}`);
    }
  }
  assertEquals(AI_LEVELS.map((l) => levelCredits("sequence_draft", l)), [3, 7, 11]);
  assertEquals(AI_LEVELS.map((l) => levelCredits("outreach_message", l)), [2, 5, 8]);
  assertEquals(AI_LEVELS.map((l) => levelCredits("rewrite_text", l)), [1, 2, 3]);
  assertEquals(levelChoices("sequence_draft", { maxLevel: "equilibre" }), [
    { id: "rapide", label: "Rapide", credits: 3, allowed: true },
    { id: "equilibre", label: "Équilibré", credits: 7, allowed: true },
    { id: "avance", label: "Avancé", credits: 11, allowed: false },
  ]);
});

// ─── Style ──────────────────────────────────────────────────────────────────

Deno.test("style : normalisation tolérante, ancien ton en point de départ", () => {
  assertEquals(normalizeWritingStyle(undefined), DEFAULT_WRITING_STYLE);
  assertEquals(normalizeWritingStyle({ length: "court", tone: "inconnu", hook: "poste" }), { ...DEFAULT_WRITING_STYLE, length: "court", hook: "poste" });
  // L'ancien ton ne sert que tant qu'aucun style n'a été enregistré.
  assertEquals(normalizeWritingStyle(undefined, "tu"), { ...DEFAULT_WRITING_STYLE, tone: "chaleureux", spontaneity: "naturel" });
  assertEquals(normalizeWritingStyle({ tone: "direct" }, "tu").tone, "direct");
});

Deno.test("style : anciens tons, jamais de tutoiement ni de « spontané »", () => {
  assertEquals(styleFromLegacyTone("professional"), { tone: "formel" });
  assertEquals(styleFromLegacyTone("formal"), { tone: "formel" });
  assertEquals(styleFromLegacyTone("casual"), { tone: "chaleureux", spontaneity: "naturel" });
  assertEquals(styleFromLegacyTone("enthusiastic"), { tone: "chaleureux" });
  assertEquals(styleFromLegacyTone("empathetic"), { tone: "chaleureux" });
  assertEquals(styleFromLegacyTone("direct"), { tone: "direct" });
  assertEquals(styleFromLegacyTone("concise"), { length: "court", tone: "direct" });
  assertEquals(styleFromLegacyTone("autre"), {});
  for (const legacy of ["casual", "tu", "enthusiastic"]) assert(styleFromLegacyTone(legacy).spontaneity !== "spontane", legacy);
});

Deno.test("style : requêtes analysées strictement, partielles permises", () => {
  assertEquals(parseStyleOverrides(undefined), { ok: true, overrides: {} });
  assertEquals(parseStyleOverrides({ length: "detaille", cta: "question", futur: "x" }), { ok: true, overrides: { length: "detaille", cta: "question" } });
  for (const bad of ["court", [], { length: "long" }, { tone: "tutoiement" }, { spontaneity: 3 }]) {
    const r = parseStyleOverrides(bad);
    assert(!r.ok && r.status === 400 && r.code === "STYLE_INVALID", JSON.stringify(bad));
  }
  assertEquals(mergeStyle(DEFAULT_WRITING_STYLE, { tone: "direct" }), { ...DEFAULT_WRITING_STYLE, tone: "direct" });
  assertEquals(styleSummary(DEFAULT_WRITING_STYLE), "Standard, formel, naturel, accroche sur son parcours, court échange");
  assertEquals(
    styleSummary({ length: "detaille", tone: "chaleureux", spontaneity: "spontane", hook: "entreprise", cta: "agenda" }),
    "Détaillé, chaleureux, spontané, accroche sur l'entreprise, lien d'agenda",
  );
});

// ─── Consigne ───────────────────────────────────────────────────────────────

const NOTE: WritingSlot = { kind: "invitation_note", followUp: false };
const FIRST: WritingSlot = { kind: "first_message", followUp: false };
const RELANCE: WritingSlot = { kind: "relance", followUp: true };
const FIRST_INMAIL: WritingSlot = { kind: "inmail", followUp: false };
const RELANCE_INMAIL: WritingSlot = { kind: "inmail", followUp: true };

function allStyles(): WritingStyle[] {
  const out: WritingStyle[] = [];
  for (const length of STYLE_VALUES.length) for (const tone of STYLE_VALUES.tone) for (const spontaneity of STYLE_VALUES.spontaneity)
    for (const hook of STYLE_VALUES.hook) for (const cta of STYLE_VALUES.cta) out.push({ length, tone, spontaneity, hook, cta });
  return out;
}

Deno.test("emplacements : note, premier message, relance, InMail", () => {
  assertEquals(slotFor("connection_request", true), NOTE);
  assertEquals(slotFor("message", true), FIRST);
  assertEquals(slotFor("message", false), RELANCE);
  assertEquals(slotFor("inmail", true), FIRST_INMAIL);
  assertEquals(slotFor("inmail", false), RELANCE_INMAIL);
  assertEquals(slotFor("email", true), FIRST_INMAIL);
});

Deno.test("longueurs : Standard = valeurs actuelles, note toujours sous 300, Détaillé sous les plafonds", () => {
  assertEquals(LENGTH_TARGETS.first_message.standard, { min: 200, max: 400 });
  assertEquals(LENGTH_TARGETS.relance.standard, { min: 200, max: 350 });
  assertEquals(LENGTH_TARGETS.inmail.standard, { min: 200, max: 400 });
  for (const length of STYLE_VALUES.length) assert(LENGTH_TARGETS.invitation_note[length].max < 300, length);
  assert(LENGTH_TARGETS.first_message.detaille.max <= 1200 && LENGTH_TARGETS.relance.detaille.max <= 1200);
  assert(LENGTH_TARGETS.inmail.detaille.max <= 1900);
  const standard = buildStyleInstructions(DEFAULT_WRITING_STYLE, { slots: [NOTE, FIRST, RELANCE], audience: "template", agenda: "none" });
  assert(standard.includes("Note d'invitation : environ 200 caractères (de 150 à 220), 300 au plus variables comprises."), standard);
  assert(standard.includes("Premier message : de 200 à 400 caractères.") && standard.includes("Relances : de 200 à 350 caractères."), standard);
  // Seuls les types présents.
  const inmail = buildStyleInstructions(DEFAULT_WRITING_STYLE, { slots: [FIRST_INMAIL, RELANCE_INMAIL], audience: "template", agenda: "none" });
  assert(inmail.includes("InMail : corps de 200 à 400 caractères, objet de 40 caractères au plus.") && !inmail.includes("Note d'invitation"), inmail);
});

Deno.test("appel à l'action : agenda permis en relance (variable) et partout (adresse fournie), sinon repli annoncé", () => {
  assert(ctaFor(RELANCE, "agenda", { agenda: "variable" }).instruction.includes("{{lien_calendly}}"));
  assertEquals(ctaFor(RELANCE, "agenda", { agenda: "variable" }).fellBack, false);
  for (const slot of [NOTE, FIRST, FIRST_INMAIL]) {
    const r = ctaFor(slot, "agenda", { agenda: "variable" });
    assert(r.fellBack && r.effective === "echange" && !r.instruction.includes("lien_calendly"), JSON.stringify(r));
    assert(r.instruction.startsWith("Pas de lien d'agenda dans la note ni dans le premier message"), r.instruction);
  }
  const none = ctaFor(RELANCE, "agenda", { agenda: "none" });
  assert(none.fellBack && none.instruction.startsWith("La mission n'a pas de lien d'agenda"), none.instruction);
  // Fenêtre de message hors séquence : l'adresse fournie, même en premier message.
  const url = ctaFor(FIRST, "agenda", { agenda: "url" });
  assert(!url.fellBack && url.effective === "agenda" && !url.instruction.includes("{{"), url.instruction);
  // Court échange : ni appel ni rendez-vous en ouverture.
  assert(ctaFor(FIRST, "echange", { agenda: "variable" }).instruction.includes("sans proposer d'appel ni de rendez-vous"));
  assert(ctaFor(NOTE, "question", { agenda: "none" }).instruction.includes("question ouverte"));
  // La question ouverte n'invite jamais à parler d'argent.
  assert(ctaFor(FIRST, "question", { agenda: "none" }).instruction.includes("jamais sur la rémunération ni les attentes salariales"));
});

Deno.test("consigne : vouvoiement en tête, sans tiret long ni nom de modèle, pour chaque style", () => {
  for (const style of allStyles()) {
    for (const audience of ["template", "candidate"] as const) {
      const text = buildStyleInstructions(style, { slots: [NOTE, FIRST, RELANCE], audience, agenda: "variable" });
      assert(text.startsWith("- Vouvoyez le candidat dans chaque texte"), text);
      assert(!/[—–]/.test(text), text);
      assert(!/claude|haiku|sonnet|opus|anthropic/i.test(text), text);
      // « tutoi » n'apparaît que dans la phrase qui transpose les exemples.
      assertEquals((text.match(/tutoi/g) ?? []).length, 1, text);
      assert(!hasTutoiement(text.replace("Les exemples qui tutoient se transposent au vouvoiement.", "")), text);
    }
  }
  const relanceOnly = buildStyleInstructions({ ...DEFAULT_WRITING_STYLE, hook: "poste" }, { slots: [RELANCE], audience: "candidate", agenda: "none" });
  assert(!relanceOnly.includes("Accroche"), "une relance seule n'a pas d'accroche d'ouverture");
  assert(relanceOnly.includes("rappelle le sujet du message précédent"), relanceOnly);
  const parcoursTemplate = buildStyleInstructions(DEFAULT_WRITING_STYLE, { slots: [NOTE], audience: "template", agenda: "none" });
  assert(parcoursTemplate.includes('{{poste_actuel | fallback:"votre poste actuel"}}'), parcoursTemplate);
  const parcoursCandidate = buildStyleInstructions(DEFAULT_WRITING_STYLE, { slots: [FIRST], audience: "candidate", agenda: "none" });
  assert(!parcoursCandidate.includes("{{"), parcoursCandidate);
});

// ─── Tutoiement ─────────────────────────────────────────────────────────────

Deno.test("tutoiement : détecté dans les formes courantes", () => {
  for (const text of [
    "Bonjour Paul, tu cherches un nouveau poste ?",
    "Je te propose un échange.",
    "Ton profil m'a frappé.",
    "Ta carrière avance vite.",
    "Tes compétences en IFRS.",
    "Ça t'intéresse ?",
    "Et toi, qu'en penses-tu ?",
  ]) assert(hasTutoiement(text), text);
  assert(!hasTutoiement("Le statut du poste à Toulouse est ouvert."));
  assert(!hasTutoiement("Le ton du projet est direct."));
  assert(!hasTutoiement("Bonjour Paul, seriez-vous ouvert à en échanger ?"));
});

Deno.test("tutoiement : les noms propres connus ne comptent pas", () => {
  const cases: Array<[string, string[]]> = [
    ["Bonjour Minh Tu, votre parcours m'a frappé.", ["Minh Tu", "Minh"]],
    ["Votre passage à la TU Munich m'a frappé.", ["TU Munich"]],
    ["Bonjour Ta Thi Lan, seriez-vous ouverte à en échanger ?", ["Ta Thi Lan", "Ta"]],
    ["Votre rôle chez Te Whare Digital m'intéresse.", ["Te Whare Digital"]],
    ["Votre rôle chez Te  Whare  Digital m'intéresse.", ["Te Whare Digital"]],
  ];
  for (const [text, names] of cases) {
    assert(hasTutoiement(text), `sans masquage, « ${text} » passerait pour du tutoiement`);
    assert(!hasTutoiement(text, names), text);
  }
  // Le masquage ne cache pas un vrai tutoiement à côté du nom.
  assert(hasTutoiement("Bonjour Minh Tu, tu cherches un poste ?", ["Minh Tu"]));
  assert(hasTutoiement("Votre passage à la TU Munich, ton école.", ["TU Munich"]));
});

Deno.test("tutoiement : un nom qui est lui-même un pronom ne masque que la salutation", () => {
  // Prénom « Tu » (premier mot de « Tu Nguyen ») : seule la salutation est retirée.
  const names = ["Tu Nguyen", "Tu"];
  assert(!hasTutoiement("Bonjour Tu, votre parcours m'a frappé.", names));
  assert(!hasTutoiement("Bonjour Tu Nguyen, seriez-vous ouvert à en échanger ?", names));
  assert(hasTutoiement("Bonjour Tu, tu as un parcours solide. Tu serais partant pour en parler ?", names));
  assert(hasTutoiement("Bonjour Tu, votre parcours m'a frappé. Tu serais partant ?", names), "« Tu » en début de phrase reste un pronom");
  for (const pronoun of ["Te", "Ta", "Toi", "Ton", "Tes"]) {
    assert(!hasTutoiement(`Bonjour ${pronoun}, votre parcours m'a frappé.`, [pronoun]), pronoun);
    assert(hasTutoiement(`Bonjour ${pronoun}, tu cherches un poste ?`, [pronoun]), pronoun);
  }
  // École « TU » (sigle en capitales) : le sigle est retiré, jamais le pronom.
  assert(!hasTutoiement("Votre passage à la TU m'a frappé.", ["TU"]));
  assert(hasTutoiement("Votre passage à la TU m'a frappé, tu y as appris beaucoup.", ["TU"]));
  // Un nom d'un seul mot est retiré en respectant la casse.
  assert(hasTutoiement("Bonjour Paul, tu cherches ?", ["Paul", "tu"]));
});

Deno.test("tutoiement : impératifs et élisions à la deuxième personne du singulier", () => {
  for (const text of [
    "N'hésite pas à me répondre.",
    "N’hésite pas à me répondre.",
    "Bonjour Paul, dis-moi si on en parle cette semaine.",
    "Réponds-moi ici.",
    "Écris-moi quand vous voulez.",
    "Fais-moi signe.",
    "Contacte-moi directement.",
    "Envoie-moi ton CV.",
    "Tiens-moi au courant.",
    "Préviens-moi si besoin.",
    "Reviens vers moi si le sujet vous parle.",
    "Je t'écris au sujet d'un poste.",
    "Je t’envoie la fiche du poste.",
  ]) assert(hasTutoiement(text), text);
  for (const text of [
    "N'hésitez pas à me répondre.",
    "Dites-moi si le sujet vous parle.",
    "Répondez-moi ici.",
    "Écrivez-moi quand vous voulez.",
    "Faites-moi signe.",
    "Revenez vers moi si le sujet vous parle.",
    "Aujourd'hui, l'équipe recrute ; c'est un poste qu'on aime.",
  ]) assert(!hasTutoiement(text), text);
});

Deno.test("aperçus : les exemples donnés au modèle par type de message vouvoient tous", () => {
  // generate-outreach-message reprend ces consignes (lignes de longueur et de
  // politesse retirées) : un exemple au tutoiement pousserait le modèle vers
  // un texte que le contrôle de sortie refuse ensuite.
  const SENT = (actionType: string) => ({ actionType, finalMessage: "Bonjour, un poste pourrait vous parler." });
  const histories = [
    [],
    [SENT("connection_request")],
    [SENT("message")],
    [SENT("message"), SENT("message")],
    [SENT("connection_request"), SENT("message"), SENT("message")],
    [SENT("inmail")],
  ];
  let examples = 0;
  for (const action of ["connection_request", "message", "inmail", "smart_message"]) {
    for (const prev of histories) {
      const { toneInstructions } = computeMessageTypeContext(action, prev);
      for (const [, quoted] of toneInstructions.matchAll(/"([^"\n]+)"/g)) {
        examples += 1;
        assert(!hasTutoiement(quoted), `${action} après ${prev.map((p) => p.actionType).join(", ") || "rien"} : « ${quoted} »`);
      }
    }
  }
  assert(examples > 10, `exemples relevés : ${examples}`);
});

// ─── Plafond : propriétés sur toutes les combinaisons ───────────────────────

const ALL_ORGS: Array<{ defaultLevel: AiLevel; maxLevel: AiLevel }> = AI_LEVELS.flatMap((maxLevel) =>
  allowedLevels(maxLevel).map((defaultLevel) => ({ defaultLevel, maxLevel }))
);

Deno.test("plafond : aucune résolution au-dessus du niveau maximal, jamais de rétrogradation", () => {
  for (const org of ALL_ORGS) {
    for (const requested of [undefined, null, "", ...AI_LEVELS]) {
      const r = resolveAiLevel(requested, org);
      if (r.ok) {
        assert(levelRank(r.level) <= levelRank(org.maxLevel), `${JSON.stringify(org)} ${requested}`);
        // Niveau demandé : rendu tel quel ; absent : le défaut de l'organisation.
        assertEquals(r.level, typeof requested === "string" && requested ? requested : org.defaultLevel);
        assertEquals(r.requested, typeof requested === "string" && requested !== "");
      } else {
        assertEquals([r.status, r.code], [403, "AI_LEVEL_NOT_ALLOWED"]);
        assert(levelRank(requested as AiLevel) > levelRank(org.maxLevel), `${JSON.stringify(org)} ${requested}`);
        // La phrase nomme le niveau refusé et chaque niveau permis, jamais un modèle.
        assert(r.error.includes(AI_LEVEL_LABELS[requested as AiLevel]), r.error);
        for (const allowed of allowedLevels(org.maxLevel)) assert(r.error.includes(AI_LEVEL_LABELS[allowed]), r.error);
        assert(!/claude|haiku|sonnet|opus/i.test(r.error), r.error);
      }
    }
  }
});

Deno.test("plafond : valeur hors liste refusée (400), jamais lue comme un niveau voisin", () => {
  const org = { defaultLevel: "equilibre" as const, maxLevel: "avance" as const };
  for (const bad of ["Avancé", "AVANCE", "avancé", " avance", "advanced", "opus", "claude-opus-5-5", 2, true, {}, ["avance"]]) {
    assertEquals(isAiLevel(bad), false, String(bad));
    const r = resolveAiLevel(bad, org);
    assert(!r.ok && r.status === 400 && r.code === "AI_LEVEL_INVALID", JSON.stringify(bad));
  }
  assertEquals(DEFAULT_AI_LEVEL, "equilibre");
  assertEquals(DEFAULT_AI_LEVEL_MAX, "avance");
  assertEquals(allowedLevels("rapide"), ["rapide"]);
  assertEquals(allowedLevels("equilibre"), ["rapide", "equilibre"]);
  assertEquals(allowedLevels("avance"), ["rapide", "equilibre", "avance"]);
});

Deno.test("plafond : choix proposés par niveau maximal, coûts croissants, défaut toujours permis", () => {
  for (const org of ALL_ORGS) {
    for (const action of ["sequence_draft", "outreach_message", "rewrite_text"]) {
      const choices = levelChoices(action, org);
      assertEquals(choices.map((c) => c.id), [...AI_LEVELS]);
      assertEquals(choices.filter((c) => c.allowed).map((c) => c.id), allowedLevels(org.maxLevel));
      assert(choices.find((c) => c.id === org.defaultLevel)?.allowed, "le niveau par défaut est toujours proposé");
      for (let i = 1; i < choices.length; i++) assert(choices[i].credits >= choices[i - 1].credits, `${action} : coût croissant`);
    }
  }
  // Lecture tolérante : le défaut lu est toujours permis par le plafond lu.
  for (const level of [...AI_LEVELS, "x", undefined]) {
    for (const max of [...AI_LEVELS, "y", undefined]) {
      const read = normalizeOrgLevels({ ai_writing: { level, max } });
      assert(levelRank(read.defaultLevel) <= levelRank(read.maxLevel), `${level} ${max}`);
    }
  }
});

// ─── Niveau → modèle, coût ──────────────────────────────────────────────────

Deno.test("niveau → modèle : un modèle du catalogue par niveau, gamme croissante, aller-retour par levelOfModel", () => {
  const tiers = AI_LEVELS.map((l) => MODEL_CATALOG[modelForLevel(l)]?.tier);
  assertEquals(tiers, ["budget", "balanced", "premium"]);
  for (const level of AI_LEVELS) assertEquals(levelOfModel(modelForLevel(level)), level);
  // Trois modèles distincts : un niveau supérieur ne rappelle jamais le modèle d'un niveau inférieur.
  assertEquals(new Set(AI_LEVELS.map(modelForLevel)).size, 3);
  // Avancé coûte plus qu'Équilibré, qui coûte plus que Rapide, sur la même action.
  const m = AI_LEVELS.map((l) => MODEL_CATALOG[modelForLevel(l)].multiplier);
  assert(m[0] < m[1] && m[1] < m[2], JSON.stringify(m));
});

// ─── Consigne par réglage ───────────────────────────────────────────────────

const CONSIGNE_CTX = {
  slots: [{ kind: "invitation_note", followUp: false }, { kind: "first_message", followUp: false }, { kind: "relance", followUp: true }] as WritingSlot[],
  audience: "template" as const,
  agenda: "variable" as const,
};
const linesOf = (style: WritingStyle) => buildStyleInstructions(style, CONSIGNE_CTX).split("\n");

/** Lignes de la consigne qui dépendent de chaque réglage (préfixe de ligne). */
const LINES_OF_KEY: Record<keyof WritingStyle, RegExp> = {
  length: /^- Longueurs visées/,
  tone: /^- Registre /,
  spontaneity: /^- Style (écrit|naturel|spontané)/,
  hook: /^- Accroche/,
  cta: /^- Appel à l'action/,
};

Deno.test("consigne : chaque réglage change sa propre ligne, et seulement elle", () => {
  const base = linesOf(DEFAULT_WRITING_STYLE);
  for (const key of Object.keys(STYLE_VALUES) as Array<keyof WritingStyle>) {
    const seen = new Set<string>();
    for (const value of STYLE_VALUES[key]) {
      const lines = linesOf({ ...DEFAULT_WRITING_STYLE, [key]: value });
      assertEquals(lines.length, base.length, `${key}=${value} : même nombre de lignes`);
      const changed = lines.filter((l, i) => l !== base[i]);
      for (const line of changed) assert(LINES_OF_KEY[key].test(line), `${key}=${value} a changé une autre ligne : ${line}`);
      seen.add(lines.filter((l) => LINES_OF_KEY[key].test(l)).join("\n"));
    }
    // Chaque valeur a sa consigne : aucune valeur sans effet.
    assertEquals(seen.size, STYLE_VALUES[key].length, `${key} : une consigne par valeur`);
  }
});

Deno.test("consigne : longueurs exactes par type de message et par longueur, note plafonnée à 300", () => {
  const kinds: MessageKind[] = ["invitation_note", "first_message", "relance", "inmail"];
  for (const kind of kinds) {
    for (const length of STYLE_VALUES.length) {
      const { min, max } = LENGTH_TARGETS[kind][length];
      assert(min < max, `${kind} ${length}`);
      const line = lengthLine(kind, length);
      assert(line.includes(String(min)) && line.includes(String(max)), line);
      if (kind === "invitation_note") assert(line.includes(`${INVITATION_NOTE_HARD_MAX} au plus variables comprises`), line);
      if (kind === "inmail") assert(line.includes("objet de 40 caractères au plus"), line);
    }
    // Court < Standard < Détaillé, sans trou ni recouvrement inversé.
    const [c, s, d] = STYLE_VALUES.length.map((l) => LENGTH_TARGETS[kind][l]);
    assert(c.max <= s.max && s.max <= d.max && c.min <= s.min && s.min <= d.min, kind);
  }
  assertEquals(LENGTH_TARGETS.invitation_note.court, { min: 100, max: 150 });
  assertEquals(LENGTH_TARGETS.invitation_note.detaille, { min: 220, max: 270 });
  assertEquals(LENGTH_TARGETS.first_message.court, { min: 120, max: 200 });
  assertEquals(LENGTH_TARGETS.first_message.detaille, { min: 400, max: 650 });
  assertEquals(LENGTH_TARGETS.relance.court, { min: 80, max: 160 });
  assertEquals(LENGTH_TARGETS.relance.detaille, { min: 350, max: 550 });
  assertEquals(LENGTH_TARGETS.inmail.court, { min: 120, max: 220 });
  assertEquals(LENGTH_TARGETS.inmail.detaille, { min: 400, max: 800 });
});

Deno.test("consigne : registre et spontanéité seuls (retouche « Plus direct »), toujours au vouvoiement", () => {
  for (const tone of STYLE_VALUES.tone) {
    for (const spontaneity of STYLE_VALUES.spontaneity) {
      const lines = toneLines({ tone, spontaneity });
      assertEquals(lines.length, 3);
      assert(lines[0].startsWith("Vouvoyez le candidat dans chaque texte"), lines[0]);
      assert(lines[1].startsWith("Registre ") && lines[2].startsWith("Style "), lines.join(" | "));
      assert(!lines.some((l) => /[—–]/.test(l)), lines.join(" | "));
    }
  }
  // « Spontané » reste au vouvoiement, écrit dans la consigne même.
  assert(toneLines({ tone: "direct", spontaneity: "spontane" })[2].includes("toujours au vouvoiement"));
});

Deno.test("consigne : accroche seulement à l'ouverture, appel à l'action par emplacement, repli écrit", () => {
  // InMail seul (ouverture et relances par InMail) : accroche et deux appels.
  const inmail = buildStyleInstructions({ ...DEFAULT_WRITING_STYLE, cta: "agenda" }, {
    slots: [{ kind: "inmail", followUp: false }, { kind: "inmail", followUp: true }],
    audience: "template",
    agenda: "variable",
  });
  assert(inmail.includes("- Accroche :"), inmail);
  assert(inmail.includes("Appel à l'action de la note et du premier message : pas de lien d'agenda dans la note ni dans le premier message ;"), inmail);
  assert(inmail.includes("Appel à l'action des relances : terminez en proposant de choisir un créneau avec {{lien_calendly}}, écrit exactement ainsi."), inmail);
  // Une seule ouverture (fenêtre de message hors séquence, adresse fournie) : un seul appel, l'adresse telle quelle.
  const single = buildStyleInstructions({ ...DEFAULT_WRITING_STYLE, cta: "agenda" }, { slots: [{ kind: "first_message", followUp: false }], audience: "candidate", agenda: "url" });
  assertEquals((single.match(/Appel à l'action/g) ?? []).length, 1, single);
  assert(single.includes("lien de rendez-vous fourni, écrit tel quel"), single);
  assert(!single.includes("{{"), single);
  // Aucun emplacement : vouvoiement, registre et spontanéité seulement.
  const empty = buildStyleInstructions(DEFAULT_WRITING_STYLE, { slots: [], audience: "template", agenda: "none" });
  assertEquals(empty.split("\n").length, 3, empty);
  assert(empty.startsWith("- Vouvoyez"), empty);
});

// ─── Lecture des réglages (writing-settings.ts) ─────────────────────────────

/** Faux client : une réponse par table, ou une exception. */
function fakeClient(rows: { organizations?: unknown; profiles?: unknown; orgError?: string; profileError?: string; throws?: boolean }) {
  const reads: Array<{ table: string; columns: string; column: string; value: string }> = [];
  return {
    reads,
    client: {
      from(table: string) {
        return {
          select(columns: string) {
            return {
              eq(column: string, value: string) {
                reads.push({ table, columns, column, value });
                return {
                  maybeSingle() {
                    if (rows.throws) return Promise.reject(new Error("réseau"));
                    const error = table === "organizations" ? rows.orgError : rows.profileError;
                    if (error) return Promise.resolve({ data: null, error: { message: error } });
                    return Promise.resolve({ data: table === "organizations" ? rows.organizations ?? null : rows.profiles ?? null, error: null });
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

const IDS = { organizationId: "org-1", userId: "user-1" };

Deno.test("réglages : niveaux de l'organisation et style de la personne, lus par leurs seules clés", async () => {
  const { client, reads } = fakeClient({
    organizations: { agency_permissions: { hide_payments_from_members: true, ai_writing: { level: "rapide", max: "equilibre" } } },
    profiles: { ai_context: { tone: "tu", writing_style: { length: "court", cta: "question", futur: "x" } } },
  });
  const settings = await loadWritingSettings(client, IDS);
  assertEquals(settings, { ok: true, defaultLevel: "rapide", maxLevel: "equilibre", style: { ...DEFAULT_WRITING_STYLE, length: "court", cta: "question" } });
  // L'organisation par son identifiant, le profil par l'utilisateur appelant : jamais celui d'un autre.
  assertEquals(reads.map((r) => [r.table, r.columns, r.column, r.value]).sort(), [
    ["organizations", "agency_permissions", "id", "org-1"],
    ["profiles", "ai_context", "user_id", "user-1"],
  ]);
});

Deno.test("réglages : rien d'enregistré, défauts ; ancien ton des consignes en point de départ, sans tutoiement", async () => {
  assertEquals(await loadWritingSettings(fakeClient({}).client, IDS), { ok: true, defaultLevel: "equilibre", maxLevel: "avance", style: DEFAULT_WRITING_STYLE });
  const legacy = await loadWritingSettings(fakeClient({ organizations: { agency_permissions: null }, profiles: { ai_context: { tone: "tu" } } }).client, IDS);
  assert(legacy.ok);
  if (legacy.ok) assertEquals(legacy.style, { ...DEFAULT_WRITING_STYLE, tone: "chaleureux", spontaneity: "naturel" });
  // ai_context illisible (texte, tableau) : défauts.
  for (const aiContext of ["texte", ["a"], 3]) {
    const r = await loadWritingSettings(fakeClient({ profiles: { ai_context: aiContext } }).client, IDS);
    assert(r.ok && JSON.stringify(r.style) === JSON.stringify(DEFAULT_WRITING_STYLE), JSON.stringify(aiContext));
  }
});

Deno.test("réglages : lecture en échec, refus (jamais un niveau supposé)", async () => {
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    for (const rows of [{ orgError: "permission denied" }, { profileError: "timeout" }, { throws: true }]) {
      assertEquals(await loadWritingSettings(fakeClient(rows).client, IDS), { ok: false }, JSON.stringify(rows));
    }
  } finally {
    console.error = original;
  }
  assertEquals(logged.length, 3, "chaque échec est journalisé");
});
