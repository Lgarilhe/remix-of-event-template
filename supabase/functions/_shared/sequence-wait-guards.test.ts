// deno test --no-check supabase/functions/_shared/sequence-wait-guards.test.ts
import { ok as assert, strictEqual as assertEquals } from "node:assert";
import {
  flaggedSender, isConnectionWaitSatisfied, messageSender, needsAttendeeResolution, nextWaitPageOffset,
  providerCallAllowed, replyStateOfMessages, shouldReadNextWaitPage, unresolvedAttendees,
  WAIT_SCAN_MAX_PAGES, WAIT_SCAN_PAGE_SIZE,
} from "./sequence-wait-guards.ts";
import { MIN_REMAINING_FOR_PROVIDER_CHECK_MS } from "./sequence-wait-rules.ts";

const AFTER = Date.parse("2026-09-20T08:00:00Z");
const BEFORE_ISO = "2026-09-19T08:00:00Z";
const LATER_ISO = "2026-09-21T08:00:00Z";

Deno.test("REV engine-conditions-channels-1 — is_sender du fournisseur lu en premier (0/1 et booléens)", () => {
  assertEquals(flaggedSender({ is_sender: 1 }), "self");
  assertEquals(flaggedSender({ is_sender: true }), "self");
  assertEquals(flaggedSender({ is_sender: 0 }), "candidate");
  assertEquals(flaggedSender({ is_sender: false }), "candidate");
  // Ancien champ en repli.
  assertEquals(flaggedSender({ is_sender_self: true }), "self");
  assertEquals(flaggedSender({ is_sender_self: false }), "candidate");
  // is_sender l'emporte sur is_sender_self.
  assertEquals(flaggedSender({ is_sender: 0, is_sender_self: true }), "candidate");
  assertEquals(flaggedSender({}), null);
});

Deno.test("REV engine-conditions-channels-1 — participants illisibles : la réponse du candidat est vue grâce à is_sender", () => {
  const attendees = unresolvedAttendees();
  const r = replyStateOfMessages([
    { id: "m1", is_sender: 1, timestamp: LATER_ISO },
    { id: "m2", is_sender: 0, timestamp: LATER_ISO },
  ], AFTER, attendees);
  assertEquals(r.state, "replied");
  assertEquals(r.replies.length, 1);
  assertEquals(r.replies[0].id, "m2");
});

Deno.test("REV engine-conditions-channels-1 — participants illisibles, expéditeur indéterminé : 'unknown', jamais 'no_reply'", () => {
  const r = replyStateOfMessages([
    { id: "m1", sender_attendee_id: "att-x", timestamp: LATER_ISO },
  ], AFTER, unresolvedAttendees());
  assertEquals(r.state, "unknown");
  assertEquals(r.undetermined, 1);
  // Participants lus mais candidat non identifié : on ne sait pas non plus.
  const r2 = replyStateOfMessages([
    { id: "m1", sender_attendee_id: "att-x", timestamp: LATER_ISO },
  ], AFTER, { ownIds: new Set(["self"]), otherIds: new Set(), resolved: true });
  assertEquals(r2.state, "unknown");
});

Deno.test("REV engine-conditions-channels-1 — messages antérieurs à la référence ignorés, même indéterminés", () => {
  const r = replyStateOfMessages([
    { id: "m1", is_sender: 0, timestamp: BEFORE_ISO },
    { id: "m2", sender_attendee_id: "att-x", timestamp: BEFORE_ISO },
    { id: "m3", is_sender: 1, timestamp: LATER_ISO },
  ], AFTER, unresolvedAttendees());
  assertEquals(r.state, "no_reply");
  // Date illisible : pas une réponse postérieure.
  assertEquals(replyStateOfMessages([{ id: "m4", is_sender: 0 }], AFTER, unresolvedAttendees()).state, "no_reply");
});

Deno.test("REV engine-conditions-channels-1 — repli sur les participants (comportement conservé)", () => {
  const attendees = { ownIds: new Set(["self", "me-1"]), otherIds: new Set(["cand-1"]), resolved: true };
  assertEquals(messageSender({ sender_attendee_id: "me-1" }, attendees), "self");
  assertEquals(messageSender({ sender_attendee_id: "cand-1" }, attendees), "candidate");
  // Candidat identifié, expéditeur hors de sa liste : nous.
  assertEquals(messageSender({ sender_attendee_id: "other" }, attendees), "self");
  assertEquals(replyStateOfMessages([{ sender_attendee_id: "cand-1", date: LATER_ISO }], AFTER, attendees).state, "replied");
  assertEquals(replyStateOfMessages([{ sender_attendee_id: "other", created_at: LATER_ISO }], AFTER, attendees).state, "no_reply");
});

Deno.test("REV engine-conditions-channels-1 — participants lus seulement si un message postérieur n'a aucun indicateur", () => {
  assert(!needsAttendeeResolution([{ is_sender: 0, timestamp: LATER_ISO }, { is_sender: 1, timestamp: LATER_ISO }], AFTER));
  assert(!needsAttendeeResolution([{ timestamp: BEFORE_ISO }], AFTER));
  assert(needsAttendeeResolution([{ is_sender: 1, timestamp: LATER_ISO }, { timestamp: LATER_ISO }], AFTER));
});

Deno.test("REV engine-conditions-channels-11 — échéance testée avant chaque appel au fournisseur", () => {
  const now = 1_000_000;
  assert(providerCallAllowed(undefined, now), "sans échéance (avant envoi, conditions) : toujours permis");
  assert(providerCallAllowed(null, now));
  assert(providerCallAllowed(now + MIN_REMAINING_FOR_PROVIDER_CHECK_MS, now));
  assert(!providerCallAllowed(now + MIN_REMAINING_FOR_PROVIDER_CHECK_MS - 1, now));
  assert(!providerCallAllowed(now - 1, now));
});

Deno.test("REV integration-2 — attente de connexion d'un candidat déjà en relation : satisfaite", () => {
  assert(isConnectionWaitSatisfied({ action_type: "wait_connection" }, { connection_status: "connected" }));
  assert(isConnectionWaitSatisfied({ action_type: "message", wait_for_event: "connection_accepted" }, { network_distance: "FIRST_DEGREE" }));
  assert(isConnectionWaitSatisfied({ action_type: "message", condition_type: "wait_until_connected" }, { connection_status: "connected" }));
  assert(!isConnectionWaitSatisfied({ action_type: "wait_connection" }, { connection_status: "pending", network_distance: "SECOND_DEGREE" }));
  assert(!isConnectionWaitSatisfied({ action_type: "wait_connection" }, null));
  // Une attente de réponse n'est jamais « satisfaite » par la connexion.
  assert(!isConnectionWaitSatisfied({ action_type: "wait_reply" }, { connection_status: "connected" }));
});

Deno.test("REV engine-conditions-channels-2 — attentes lues par pages", () => {
  assert(shouldReadNextWaitPage(0, WAIT_SCAN_PAGE_SIZE), "page pleine : page suivante");
  assert(!shouldReadNextWaitPage(0, WAIT_SCAN_PAGE_SIZE - 1), "page incomplète : fin");
  assert(!shouldReadNextWaitPage(WAIT_SCAN_MAX_PAGES - 1, WAIT_SCAN_PAGE_SIZE), "plafond de pages");
  assert(shouldReadNextWaitPage(1, 50, { pageSize: 50, maxPages: 3 }));
  // 200 attentes non échues puis une attente échue : la deuxième page la lit.
  assertEquals(nextWaitPageOffset(0, 200, 0), 200);
  // Les attentes franchies ont quitté le filtre : décalage réduit d'autant.
  assertEquals(nextWaitPageOffset(200, 200, 30), 370);
  assertEquals(nextWaitPageOffset(0, 200, 250), 0);
  assertEquals(nextWaitPageOffset(0, 200, -5), 200);
});
