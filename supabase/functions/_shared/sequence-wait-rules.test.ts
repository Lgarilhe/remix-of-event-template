// deno test --no-check supabase/functions/_shared/sequence-wait-rules.test.ts
import { ok as assert, strictEqual as assertEquals } from "node:assert";
import {
  chatLookupOutcome, closedEnrollmentWaitReason, combineReplyStates, effectiveWaitTimeoutDays,
  hasTimeLeft, implicitWaitEvent, isThrottled, isWaitTimedOut, replyReferenceDate, waitStartedAt,
  waitsForConnection, waitsForReply, CHECK_PASS_BUDGET_MS, IMPLICIT_WAIT_DEFAULT_TIMEOUT_DAYS,
  MIN_REMAINING_FOR_PROVIDER_CHECK_MS, REPLY_FALLBACK_WINDOW_MS, TERMINAL_ENROLLMENT_STATUSES,
} from "./sequence-wait-rules.ts";

const DAY = 86_400_000;

Deno.test("SEQ-031 — attente sans événement : événement déduit du type d'étape", () => {
  assertEquals(implicitWaitEvent({ action_type: "wait_reply", wait_for_event: null, condition_type: "always" }), "reply_received");
  assertEquals(implicitWaitEvent({ action_type: "wait_connection", wait_for_event: null }), "connection_accepted");
  assertEquals(implicitWaitEvent({ action_type: "wait_reply", wait_for_event: "" }), "reply_received");
  // L'événement explicite l'emporte.
  assertEquals(implicitWaitEvent({ action_type: "wait_reply", wait_for_event: "email_opened" }), "email_opened");
  // Les étapes qui envoient ne reçoivent jamais d'événement implicite.
  assertEquals(implicitWaitEvent({ action_type: "message", wait_for_event: null }), null);
  assertEquals(implicitWaitEvent(null), null);
});

Deno.test("SEQ-031 / SEQ-085 — nature de l'attente", () => {
  assert(waitsForConnection({ action_type: "wait_connection" }));
  assert(waitsForConnection({ action_type: "message", condition_type: "wait_until_connected" }));
  assert(!waitsForConnection({ action_type: "wait_reply" }));
  assert(waitsForReply({ action_type: "wait_reply", wait_for_event: null }));
  assert(waitsForReply({ action_type: "wait_reply", wait_for_event: "reply_received" }));
  assert(!waitsForReply({ action_type: "wait_connection" }));
  assert(!waitsForReply({ action_type: "email", wait_for_event: "email_opened" }));
});

Deno.test("SEQ-084 — date de référence : dernier envoi visible, relance plus récente, repli 72 h", () => {
  const now = Date.parse("2026-09-25T10:00:00Z");
  assertEquals(replyReferenceDate("2026-09-20T08:00:00.000Z", null, now), "2026-09-20T08:00:00.000Z");
  // Réponse de 4 jours toujours vue : la référence est l'envoi, pas maintenant − 72 h.
  assert(Date.parse(replyReferenceDate("2026-09-20T08:00:00Z", null, now)) < now - REPLY_FALLBACK_WINDOW_MS);
  assertEquals(replyReferenceDate("2026-09-10T08:00:00Z", "2026-09-22T09:00:00Z", now), "2026-09-22T09:00:00.000Z");
  assertEquals(replyReferenceDate(null, undefined, now), new Date(now - REPLY_FALLBACK_WINDOW_MS).toISOString());
  assertEquals(replyReferenceDate("pas une date", null, now), new Date(now - REPLY_FALLBACK_WINDOW_MS).toISOString());
});

Deno.test("SEQ-078 — 404 = aucun fil ; 5xx, 429, délai = inconnu", () => {
  assertEquals(chatLookupOutcome(200), "ok");
  assertEquals(chatLookupOutcome(404), "no_thread");
  assertEquals(chatLookupOutcome(500), "unknown");
  assertEquals(chatLookupOutcome(503), "unknown");
  assertEquals(chatLookupOutcome(429), "unknown");
  assertEquals(chatLookupOutcome(null), "unknown");
  assertEquals(combineReplyStates(["unknown", "no_reply"]), "unknown");
  assertEquals(combineReplyStates(["no_reply", "no_reply"]), "no_reply");
  assertEquals(combineReplyStates(["unknown", "replied"]), "replied");
});

Deno.test("SEQ-083 — délai compté depuis le début de l'attente (scheduled_at)", () => {
  const created = "2026-09-01T09:00:00Z";
  const due = "2026-09-03T09:00:00Z"; // délai de l'étape : 2 jours
  assertEquals(waitStartedAt({ created_at: created, scheduled_at: due }), due);
  assertEquals(waitStartedAt({ created_at: created, scheduled_at: null }), created);
  const now = Date.parse("2026-09-04T10:00:00Z");
  // Attente de 3 jours : pas expirée au 4 (avant : expirée, compte depuis created_at).
  assertEquals(isWaitTimedOut(waitStartedAt({ created_at: created, scheduled_at: due }), 3, now), false);
  assertEquals(isWaitTimedOut(created, 3, now), true);
  assertEquals(isWaitTimedOut(due, 3, Date.parse(due) + 3 * DAY), true);
  assertEquals(isWaitTimedOut(due, null, now), false);
});

Deno.test("SEQ-031 — délai effectif : réglage de l'inscription, étape, défaut des attentes implicites", () => {
  assertEquals(effectiveWaitTimeoutDays({ action_type: "wait_connection", timeout_days: 5 }, undefined), 5);
  assertEquals(effectiveWaitTimeoutDays({ action_type: "wait_connection", timeout_days: 5 }, 2), 2);
  // Attente de l'assistant sans événement ni délai : plus jamais d'attente à vie.
  assertEquals(effectiveWaitTimeoutDays({ action_type: "wait_reply", wait_for_event: null, timeout_days: null }, undefined), IMPLICIT_WAIT_DEFAULT_TIMEOUT_DAYS);
  // Étape avec événement explicite et sans délai : inchangé (aucun délai).
  assertEquals(effectiveWaitTimeoutDays({ action_type: "wait_reply", wait_for_event: "reply_received", timeout_days: null }, undefined), null);
  // 0 : aucun délai, comme avant.
  assertEquals(effectiveWaitTimeoutDays({ action_type: "wait_connection", timeout_days: 0 }, undefined), null);
  assertEquals(effectiveWaitTimeoutDays({ action_type: "message", timeout_days: null }, 4), null);
});

Deno.test("SEQ-027 — statuts terminaux et motif d'annulation", () => {
  for (const s of ["completed", "replied", "bounced", "cancelled", "stopped"]) assert(TERMINAL_ENROLLMENT_STATUSES.includes(s));
  assert(!TERMINAL_ENROLLMENT_STATUSES.includes("paused"));
  assert(!TERMINAL_ENROLLMENT_STATUSES.includes("active"));
  assert(closedEnrollmentWaitReason("replied").startsWith("Inscription close"));
});

Deno.test("SEQ-074 / SEQ-075 — budget de temps et étranglement", () => {
  const start = 1_000_000;
  const deadline = start + CHECK_PASS_BUDGET_MS;
  assert(hasTimeLeft(deadline, start, MIN_REMAINING_FOR_PROVIDER_CHECK_MS));
  assert(!hasTimeLeft(deadline, deadline - MIN_REMAINING_FOR_PROVIDER_CHECK_MS + 1, MIN_REMAINING_FOR_PROVIDER_CHECK_MS));
  const now = Date.parse("2026-09-25T10:00:00Z");
  assert(isThrottled("2026-09-25T08:00:00Z", 4 * 3600_000, now));
  assert(!isThrottled("2026-09-25T05:00:00Z", 4 * 3600_000, now));
  assert(!isThrottled(null, 4 * 3600_000, now));
  assert(!isThrottled("n'importe quoi", 4 * 3600_000, now));
});
