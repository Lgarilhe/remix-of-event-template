// deno test --no-check supabase/functions/_shared/seq-steps-2.test.ts
//
// Lot « steps-2 » (tests de bout en bout du module séquences, septembre 2026) :
// les décisions pures que les tests d'API (e2e/api/seq-steps-2.spec.ts)
// exercent à travers le moteur, vérifiées ici sans base ni réseau, avec les
// valeurs exactes du contrat (CLAUDE.md, docs/audit-2026-09-25-sequences.md).
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { interpolateAndStrip, isLikelyRealFirstName } from "./template-interpolation.ts";
import { hasAlreadySentStep, shouldCloseForNoPreviousMessage } from "./sequence-engine-rules.ts";
import { isStaleTemplateSnapshot, rotationUnavailablePlan } from "./sequence-cycle-rules.ts";
import { chooseRotationSender } from "./sequence-send-rules.ts";
import { chatLookupOutcome, implicitWaitEvent, replyReferenceDate } from "./sequence-wait-rules.ts";
import { replyStateOfMessages, unresolvedAttendees } from "./sequence-wait-guards.ts";

// interp-unknown-stripped
Deno.test("variables inconnues retirées sans espace avant la ponctuation, repli utilisé, aucun « {{ »", () => {
  assert(!isLikelyRealFirstName("🚀"), "un émoji n'est pas un prénom");
  const { result, leftover } = interpolateAndStrip(
    'Bonjour {{prenom}}, {{city}} ok {{ville | fallback:"Paris"}} {{ai_snippet}}.',
    { nom: "Martin" },
  );
  assertEquals(result, "Bonjour, ok Paris.");
  assertEquals(leftover.length, 3);
  assert(!result.includes("{{"));
});

// interp-known-vars
Deno.test("variables connues remplies, objet compris", () => {
  const ctx = { prenom: "Camille", job_title: "Lead Dev", poste_recherche: "Data Engineer", client: "Acme", ma_signature: "Claire Dupont" };
  assertEquals(interpolateAndStrip("{{poste_recherche}} chez {{client}}", ctx).result, "Data Engineer chez Acme");
  assertEquals(interpolateAndStrip("{{prenom}} {{job_title}} {{ma_signature}}", ctx).result, "Camille Lead Dev Claire Dupont");
});

// engine-no-previous-message-guard
Deno.test("garde « aucun message précédent » : échec ou annulation bloquent, saut manuel ou par condition non", () => {
  assert(shouldCloseForNoPreviousMessage([{ status: "failed" }]));
  assert(shouldCloseForNoPreviousMessage([{ status: "cancelled" }]));
  assert(!shouldCloseForNoPreviousMessage([{ status: "skipped", skip_reason: "Manuellement sautée par le recruteur" }]));
  assert(!shouldCloseForNoPreviousMessage([{ status: "skipped", skip_reason: "Condition: if_connected" }]));
  assert(!shouldCloseForNoPreviousMessage([{ status: "failed" }, { status: "sent" }]), "un envoi parti suffit");
});

// engine-branch-loop-no-resend
Deno.test("une étape déjà partie chez le candidat n'est jamais renvoyée", () => {
  assert(hasAlreadySentStep([{ status: "sent" }]));
  assert(hasAlreadySentStep([{ status: "cancelled", skip_reason: "Enrollment became replied during execution" }]));
  assert(!hasAlreadySentStep([{ status: "failed" }, { status: "skipped", skip_reason: "Condition: if_connected" }]));
});

// rotation-unavailable-plans
Deno.test("rotation : plafond du jour → lendemain, groupe vide → compte de l'inscription, lecture en échec → 15 min", () => {
  assertEquals(rotationUnavailablePlan("capped").kind, "block_until_tomorrow");
  assertEquals(rotationUnavailablePlan("empty_pool").kind, "use_enrollment_account");
  const retry = rotationUnavailablePlan("lookup_failed");
  assertEquals(retry.kind, "retry_soon");
  assertEquals((retry as { delayMs: number }).delayMs, 15 * 60 * 1000);
  assertEquals(chooseRotationSender([{ account_id: "L2", daily_limit: 1 }], "round_robin", new Map([["L2", 1]])), null);
});

// ai-retry-keeps-generated-text
Deno.test("copie du modèle marquée : régénérée ; texte résolu ou correction du Journal : gardés", () => {
  const tpl = "Bonjour {{prenom}}";
  assert(isStaleTemplateSnapshot({ trackingData: { content_origin: "template_snapshot" }, finalMessage: tpl, messageTemplate: tpl }));
  assert(!isStaleTemplateSnapshot({ trackingData: { content_origin: "resolved" }, finalMessage: "Texte IA", messageTemplate: tpl }));
  assert(!isStaleTemplateSnapshot({ trackingData: { content_origin: "template_snapshot" }, finalMessage: "Corrigé", messageTemplate: tpl }));
});

// engine-wait-reply / engine-condition-no-response
Deno.test("attente de réponse sans wait_for_event, réponse postérieure au dernier envoi, doute ≠ pas de réponse", () => {
  assertEquals(implicitWaitEvent({ action_type: "wait_reply" }), "reply_received");
  const lastSent = "2026-09-25T10:00:00.000Z";
  assertEquals(replyReferenceDate(lastSent, null, Date.parse("2026-09-27T10:00:00Z")), lastSent);
  const after = Date.parse(lastSent);
  const candidate = replyStateOfMessages([{ is_sender: 0, timestamp: "2026-09-26T09:00:00Z" }], after, unresolvedAttendees());
  assertEquals(candidate.state, "replied");
  const older = replyStateOfMessages([{ is_sender: 0, timestamp: "2026-09-24T09:00:00Z" }], after, unresolvedAttendees());
  assertEquals(older.state, "no_reply");
  const unknown = replyStateOfMessages([{ timestamp: "2026-09-26T09:00:00Z" }], after, unresolvedAttendees());
  assertEquals(unknown.state, "unknown");
  assertEquals(chatLookupOutcome(503), "unknown");
  assertEquals(chatLookupOutcome(404), "no_thread");
});
