// deno test --no-check supabase/functions/_shared/sequence-schedule-time.test.ts
// Lancer aussi avec TZ=UTC et TZ=America/Los_Angeles : le fuseau du serveur ne
// doit jamais changer le résultat.
import { ok as assert, strictEqual as assertEquals } from "node:assert";
import {
  addLocalDays, atLocalTime, isInMailCreditsError, isWithinSendingHours, localDateTime,
  nextSendingSlot, rateLimitDeferral, rateLimitRetryAt, zonedTimeToUtc,
} from "./sequence-schedule-time.ts";

const iso = (d: Date) => d.toISOString();

Deno.test("SEQ-038 — heure locale posée sur la date LOCALE, pas sur la date UTC", () => {
  // Mercredi 00:30 à Paris (été) = mardi 22:30 UTC : 9 h le jour même = mercredi 9 h.
  const wedEarly = new Date("2026-09-22T22:30:00Z");
  assertEquals(iso(atLocalTime(wedEarly, "Europe/Paris", 9)), "2026-09-23T07:00:00.000Z");
  // Avant : mardi 07:00 UTC (dans le passé).
});

Deno.test("SEQ-038 — relance de 6 h après un envoi à 18:30 (Paris) : mercredi 9 h, jamais dans le passé", () => {
  const sentAt = new Date("2026-09-22T16:30:00Z"); // mardi 18:30 Paris
  const due = new Date(sentAt.getTime() + 6 * 3600_000); // mercredi 00:30 Paris
  const slot = nextSendingSlot(due, "Europe/Paris", 9, 18, 0);
  assertEquals(iso(slot), "2026-09-23T07:00:00.000Z");
  assert(slot.getTime() > sentAt.getTime());
});

Deno.test("SEQ-038 — mercredi 00:30 Paris : prochain créneau mercredi 8 h (et non mardi 8 h)", () => {
  const now = new Date("2026-09-22T22:30:00Z");
  assertEquals(iso(nextSendingSlot(now, "Europe/Paris", 8, 19, 0)), "2026-09-23T06:00:00.000Z");
});

Deno.test("SEQ-038 — samedi 21:00 New York : lundi 9 h (lundi n'est plus sauté)", () => {
  const now = new Date("2026-09-27T01:00:00Z"); // samedi 26/09 21:00 EDT
  assertEquals(localDateTime(now, "America/New_York").weekday, 6);
  assertEquals(iso(nextSendingSlot(now, "America/New_York", 9, 18, 0)), "2026-09-28T13:00:00.000Z");
});

Deno.test("SEQ-038 — lundi 20:30 New York : mardi 9 h (mardi n'est plus sauté)", () => {
  const now = new Date("2026-09-29T00:30:00Z"); // lundi 28/09 20:30 EDT
  assertEquals(iso(nextSendingSlot(now, "America/New_York", 9, 18, 0)), "2026-09-29T13:00:00.000Z");
});

Deno.test("SEQ-038 — vendredi 20:00 Tokyo : lundi 8 h, jamais un samedi", () => {
  const now = new Date("2026-09-25T11:00:00Z"); // vendredi 20:00 JST
  const slot = nextSendingSlot(now, "Asia/Tokyo", 8, 19, 0);
  assertEquals(localDateTime(slot, "Asia/Tokyo").weekday, 1);
  assertEquals(iso(slot), "2026-09-27T23:00:00.000Z");
});

Deno.test("SEQ-038 — dans la plage : maintenant", () => {
  const now = new Date("2026-09-23T08:15:00Z"); // mercredi 10:15 Paris
  assert(isWithinSendingHours(now, "Europe/Paris", 8, 19));
  assertEquals(iso(nextSendingSlot(now, "Europe/Paris", 8, 19, 0)), iso(now));
});

Deno.test("SEQ-038 — gigue des minutes conservée", () => {
  const now = new Date("2026-09-23T03:00:00Z"); // mercredi 05:00 Paris
  assertEquals(iso(nextSendingSlot(now, "Europe/Paris", 8, 19, 17)), "2026-09-23T06:17:00.000Z");
});

Deno.test("SEQ-038 — changements d'heure (29/03/2026 et 25/10/2026)", () => {
  // Samedi 28/03 20:00 Paris (UTC+1) : lundi 30/03 8 h, en heure d'été (UTC+2).
  const beforeSpring = new Date("2026-03-28T19:00:00Z");
  assertEquals(iso(nextSendingSlot(beforeSpring, "Europe/Paris", 8, 19, 0)), "2026-03-30T06:00:00.000Z");
  // Samedi 24/10 20:00 Paris (UTC+2) : lundi 26/10 8 h, en heure d'hiver (UTC+1).
  const beforeFall = new Date("2026-10-24T18:00:00Z");
  assertEquals(iso(nextSendingSlot(beforeFall, "Europe/Paris", 8, 19, 0)), "2026-10-26T07:00:00.000Z");
  // Minuit local le jour du changement.
  assertEquals(iso(zonedTimeToUtc(2026, 3, 29, 0, 0, "Europe/Paris")), "2026-03-28T23:00:00.000Z");
  assertEquals(iso(zonedTimeToUtc(2026, 10, 25, 12, 0, "Europe/Paris")), "2026-10-25T11:00:00.000Z");
});

Deno.test("SEQ-038 — jours avancés sur le calendrier local (fin de mois, fuseau à demi-heure)", () => {
  const now = new Date("2026-01-31T20:00:00Z"); // samedi 31/01 21:00 Paris
  assertEquals(iso(addLocalDays(now, "Europe/Paris", 2, 9)), "2026-02-02T08:00:00.000Z");
  const kolkata = new Date("2026-09-23T20:00:00Z"); // jeudi 01:30 IST
  assertEquals(iso(atLocalTime(kolkata, "Asia/Kolkata", 8)), "2026-09-24T02:30:00.000Z");
});

Deno.test("SEQ-038 — fuseau invalide : Europe/Paris, sans exception", () => {
  const now = new Date("2026-09-22T22:30:00Z");
  assertEquals(iso(atLocalTime(now, "Pas/UnFuseau", 9)), "2026-09-23T07:00:00.000Z");
});

Deno.test("SEQ-088 — 429 passager sur smart_message ou InMail : jour ouvré suivant", () => {
  assertEquals(rateLimitDeferral("smart_message", { error: "linkedin_send_failed_429: too many requests", sentAsInMail: false }), "next_business_day");
  assertEquals(rateLimitDeferral("inmail", { error: "linkedin_send_failed_429: too many requests", sentAsInMail: true }), "next_business_day");
  assertEquals(rateLimitDeferral("inmail"), "next_business_day");
  assertEquals(rateLimitDeferral("message", { error: "429" }), "next_business_day");
});

Deno.test("SEQ-088 — mois suivant seulement pour un InMail dont l'erreur cite les crédits", () => {
  assertEquals(rateLimitDeferral("inmail", { error: "linkedin_send_failed_429: InMail credits exhausted", sentAsInMail: true }), "next_month");
  assertEquals(rateLimitDeferral("smart_message", { error: "429 insufficient InMail credits", sentAsInMail: true }), "next_month");
  // Parti en message direct : jamais de report mensuel.
  assertEquals(rateLimitDeferral("smart_message", { error: "429 insufficient InMail credits", sentAsInMail: false }), "next_business_day");
  // Mode inconnu (exception dans le cycle, needsInMail absent) : jour ouvré
  // suivant, le contrôle du solde du cycle suivant prend le relais.
  assertEquals(rateLimitDeferral("smart_message", { error: "429 insufficient InMail credits" }), "next_business_day");
  assertEquals(rateLimitDeferral("inmail", { error: "linkedin_send_failed_429: InMail credits exhausted", sentAsInMail: null }), "next_business_day");
  // Contrôle du solde indisponible : pas un épuisement.
  assertEquals(isInMailCreditsError("inmail_balance_unavailable: Contrôle des crédits InMail momentanément indisponible"), false);
  assertEquals(isInMailCreditsError("inmail_credits_exhausted: Crédits InMail épuisés"), true);
  assertEquals(rateLimitDeferral("connection_request", { error: "429" }), "next_monday");
});

Deno.test("SEQ-088 — dates de report à 9 h locales", () => {
  const friday = new Date("2026-09-25T15:00:00Z"); // vendredi 17:00 Paris
  assertEquals(iso(rateLimitRetryAt("next_business_day", friday, "Europe/Paris")), "2026-09-28T07:00:00.000Z");
  assertEquals(iso(rateLimitRetryAt("next_monday", friday, "Europe/Paris")), "2026-09-28T07:00:00.000Z");
  const monday = new Date("2026-09-28T10:00:00Z");
  assertEquals(iso(rateLimitRetryAt("next_monday", monday, "Europe/Paris")), "2026-10-05T07:00:00.000Z");
  const december = new Date("2026-12-15T10:00:00Z");
  assertEquals(iso(rateLimitRetryAt("next_month", december, "Europe/Paris")), "2027-01-01T08:00:00.000Z");
  // Mercredi 00:30 Paris = mardi en UTC : jour ouvré suivant = jeudi.
  assertEquals(iso(rateLimitRetryAt("next_business_day", new Date("2026-09-22T22:30:00Z"), "Europe/Paris")), "2026-09-24T07:00:00.000Z");
});
