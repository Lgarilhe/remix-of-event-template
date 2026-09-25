// deno test --no-check supabase/functions/_shared/sequence-send-rules.test.ts
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import {
  allowsNewChatFallback,
  chooseRotationSender,
  classifySendStatus,
  detectSequenceViolations,
  directFollowUpType,
  directMessageActionTypes,
  greetingFor,
  hasTimeForAiCorrection,
  inmailQueueRetry,
  inviteRejectionSkipReason,
  isFirstDegreeCandidate,
  isSendUncertain,
  isUsableAiMessage,
  sendLedgerActionType,
  sendsAsInMail,
  sendUncertainError,
  smartTruncate,
} from "./sequence-send-rules.ts";

Deno.test("SEQ-005 : seules les réponses « conversation inutilisable » autorisent une nouvelle conversation", () => {
  for (const s of [400, 403, 404, 422]) assert(allowsNewChatFallback(s), `${s}`);
  for (const s of [429, 500, 502, 503, 504, 401]) assert(!allowsNewChatFallback(s), `${s}`);
});

Deno.test("SEQ-005 : 5xx et délai = issue inconnue, 429 = limite, sans code HTTP dans le libellé", () => {
  assertEquals(classifySendStatus(null), "uncertain");
  assertEquals(classifySendStatus(502), "uncertain");
  assertEquals(classifySendStatus(504), "uncertain");
  assertEquals(classifySendStatus(429), "rate_limited");
  assertEquals(classifySendStatus(422), "rejected");
  assertEquals(classifySendStatus(201), "ok");
  const err = sendUncertainError("LinkedIn");
  assert(isSendUncertain(err));
  assert(!/\d{3}/.test(err), "un code 5xx rendrait l'erreur relançable");
});

Deno.test("SEQ-036/037/095 : degré de relation, mode d'envoi et type au ledger", () => {
  assert(isFirstDegreeCandidate({}, { network_distance: "DISTANCE_1" }));
  assert(isFirstDegreeCandidate({ connection_status: "connected" }, { network_distance: "SECOND_DEGREE" }));
  assert(isFirstDegreeCandidate({ network_distance: "FIRST_DEGREE" }, null), "repli sur le degré enregistré si la lecture échoue");
  assert(!isFirstDegreeCandidate({ network_distance: "FIRST_DEGREE" }, { network_distance: "SECOND_DEGREE" }));
  assert(!sendsAsInMail("smart_message", true));
  assert(sendsAsInMail("smart_message", false));
  assert(!sendsAsInMail("message", false));
  assertEquals(sendLedgerActionType("smart_message", true), "message");
  assertEquals(sendLedgerActionType("smart_message", false), "inmail");
  assertEquals(sendLedgerActionType("inmail", true), "message");
  assertEquals(sendLedgerActionType("connection_request", false), "connection_request");
});

Deno.test("SEQ-036 : refus d'invitation « déjà en relation / déjà invité » = étape sautée", () => {
  assertEquals(inviteRejectionSkipReason(422, '{"type":"errors/already_connected"}'), "Déjà en relation : invitation inutile");
  assertEquals(inviteRejectionSkipReason(422, '{"type":"errors/already_invited_recently"}'), "Invitation déjà en attente");
  assertEquals(inviteRejectionSkipReason(400, "An invitation is already pending"), "Invitation déjà en attente");
  assertEquals(inviteRejectionSkipReason(422, '{"type":"errors/cannot_resend_yet"}'), "Invitation déjà envoyée récemment");
  assertEquals(inviteRejectionSkipReason(429, "already invited"), null);
  assertEquals(inviteRejectionSkipReason(503, "already invited"), null);
  assertEquals(inviteRejectionSkipReason(422, '{"type":"errors/limit_exceeded"}'), null);
});

Deno.test("SEQ-096 : la note n'est jamais coupée sur un point interne", () => {
  const note = "Bonjour Marie, je vois que vous travaillez en Node.js et TypeScript chez Acme depuis plusieurs années sur des sujets de paiement. " +
    "Nous cherchons une personne pour prendre la main sur l'architecture backend, voir https://www.welcometothejungle.com/fr/companies/acme pour le contexte. " +
    "Au plaisir d'échanger avec vous, Laurent";
  const cut = smartTruncate(note, 300);
  assert(cut.length <= 300);
  assert(!cut.endsWith("Node."), cut);
  assert(!/welcometothejungle\.$/.test(cut), cut);
  assert(cut.endsWith("pour le contexte."), cut);
  assert(cut.includes("https://www.welcometothejungle.com/fr/companies/acme "), "lien intact");
  // Sans fin de phrase avant la limite : coupe au dernier mot, jamais dans « Node.js ».
  const long = "Bonjour Marie, " + "ton travail sur les paiements temps réel et la fiabilité des services ".repeat(3) + "avec du Node.js et du Go " + "chez Acme ".repeat(20);
  const cut2 = smartTruncate(long, 300);
  assert(cut2.length <= 300 && cut2.endsWith("…"), cut2);
  assert(cut2.includes("Node.js"), cut2);
  assertEquals(smartTruncate("Court.", 300), "Court.");
});

Deno.test("SEQ-103 : file InMail, 429 et 503 relancés trois fois, 502/504/délai définitifs", () => {
  const first = inmailQueueRetry(503, null);
  assertEquals([first.retry, first.attempt], [true, 1]);
  const third = inmailQueueRetry(429, "Service LinkedIn momentanément indisponible, nouvel essai 2/3 dans 1 h");
  assertEquals([third.retry, third.attempt], [true, 3]);
  const fourth = inmailQueueRetry(503, third.message);
  assertEquals(fourth.retry, false);
  for (const s of [502, 504, null, 400, 422]) assertEquals(inmailQueueRetry(s, null).retry, false, `${s}`);
});

Deno.test("SEQ-035 : message IA vide ou réduit à la signature refusé", () => {
  assert(!isUsableAiMessage("", "Laurent"));
  assert(!isUsableAiMessage(undefined, "Laurent"));
  assert(!isUsableAiMessage("\n\nLaurent", "Laurent"));
  assert(!isUsableAiMessage("Salut Marie,\n\nLaurent", "Laurent"));
  assert(isUsableAiMessage("Salut Marie,\n\nOn monte une équipe Go chez Acme, ça te parlerait ?\n\nLaurent", "Laurent"));
});

Deno.test("SEQ-091 : salaire, signature « Recruteur » et formulations cabinet en RPO bloquent", () => {
  const blocking = (isRPO: boolean, m: string) => detectSequenceViolations(isRPO, m).filter((v) => v.blocking).map((v) => v.label);
  assertEquals(blocking(false, "Le package est à 75k€, ça te parle ?").length, 1);
  assertEquals(blocking(false, "Bonjour Marie,\n\nOn cherche une lead.\n\nRecruteur").length, 1);
  assertEquals(blocking(false, "Je suis recruteur chez Acme et on cherche une lead backend.").length, 0);
  assertEquals(blocking(true, "J'accompagne mon client sur ce poste").length, 2);
  assertEquals(blocking(false, "Tu serais disponible pour en parler ?").length, 0, "CTA corrigé mais non bloquant");
});

Deno.test("SEQ-098 : salutation selon le canal et le ton", () => {
  assertEquals(greetingFor(true, null), "Bonjour");
  assertEquals(greetingFor(true, "casual"), "Salut");
  assertEquals(greetingFor(false, "professional"), "Bonjour");
  assertEquals(greetingFor(false, null), "Salut");
});

Deno.test("SEQ-155 : tous les expéditeurs au plafond = aucun expéditeur, jamais le premier par défaut", () => {
  const pool = [{ account_id: "A", daily_limit: 2 }, { account_id: "B", daily_limit: 2 }];
  assertEquals(chooseRotationSender(pool, "round_robin", new Map([["A", 2], ["B", 2]])), null);
  assertEquals(chooseRotationSender(pool, "least_used", new Map([["A", 1], ["B", 0]]))?.account_id, "B");
  assertEquals(chooseRotationSender(pool, "random", new Map([["A", 2]]), () => 0)?.account_id, "B");
});

Deno.test("SEQ-074 : pas d'appel de correction à moins de 30 s de l'échéance du cycle", () => {
  const deadline = 1_000_000;
  assertEquals(hasTimeForAiCorrection(undefined, deadline), true);
  assertEquals(hasTimeForAiCorrection(deadline, deadline - 31_000), true);
  assertEquals(hasTimeForAiCorrection(deadline, deadline - 29_000), false);
  assertEquals(hasTimeForAiCorrection(deadline, deadline + 1), false);
});

Deno.test("SEQ-095 : un Message IA parti en direct compte comme message direct, après un InMail seul = RELANCE 1", () => {
  assertEquals(directMessageActionTypes(false), ["message", "smart_message"]);
  assertEquals(directMessageActionTypes(true), ["message", "smart_message", "email"]);
  assertEquals(directFollowUpType(0), "RELANCE 1");
  assertEquals(directFollowUpType(1), "RELANCE 1");
  assertEquals(directFollowUpType(2), "RELANCE 2");
});
