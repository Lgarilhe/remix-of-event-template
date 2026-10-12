// deno test --no-check --allow-read supabase/functions/_shared/sequence-ledger-slot.test.ts
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { ledgerSlotSince, LEDGER_SLOT_CLOCK_MARGIN_MS, releaseLedgerSlotRow } from "./sequence-ledger-slot.ts";

// deno-lint-ignore no-explicit-any
function fakeLog(rows: Array<{ id: string }>, opts: { selectError?: boolean; deleteError?: boolean } = {}): any {
  const calls: { filters: Array<[string, unknown]>; deleted: string[] } = { filters: [], deleted: [] };
  return {
    calls,
    from(table: string) {
      assertEquals(table, "linkedin_action_log");
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select() { return q; },
        eq(col: string, val: unknown) { calls.filters.push([col, val]); return q; },
        gte(col: string, val: unknown) { calls.filters.push([col, val]); return q; },
        order() { return q; },
        limit() { return Promise.resolve({ data: rows.slice(0, 1), error: opts.selectError ? { message: "boom" } : null }); },
        delete() {
          return { eq(_col: string, id: string) { calls.deleted.push(id); return Promise.resolve({ error: opts.deleteError ? { message: "boom" } : null }); } };
        },
      };
      return q;
    },
  };
}

const slot = { accountId: "acc_TEST1", actionType: "inmail", source: "inmail_queue", since: "2026-10-12T10:00:00.000Z" };

Deno.test("place du plafond : la ligne la plus récente du compte, du type et de la source est retirée", async () => {
  const db = fakeLog([{ id: "row-9" }, { id: "row-8" }]);
  assertEquals(await releaseLedgerSlotRow(db, slot), true);
  assertEquals(db.calls.deleted, ["row-9"]);
  assertEquals(db.calls.filters, [
    ["account_id", "acc_TEST1"], ["action_type", "inmail"], ["source", "inmail_queue"], ["created_at", slot.since],
  ]);
});

Deno.test("place du plafond : journal vide ou illisible = rien retiré, jamais d'exception", async () => {
  assertEquals(await releaseLedgerSlotRow(fakeLog([]), slot), false);
  assertEquals(await releaseLedgerSlotRow(fakeLog([{ id: "r" }], { selectError: true }), slot), false);
  const failing = fakeLog([{ id: "r" }], { deleteError: true });
  assertEquals(await releaseLedgerSlotRow(failing, slot), false);
  assertEquals(await releaseLedgerSlotRow({ from() { throw new Error("down"); } }, slot), false);
});

Deno.test("place du plafond : la borne basse retranche la marge d'horloge", () => {
  const now = Date.parse("2026-10-12T10:01:00.000Z");
  assertEquals(ledgerSlotSince(now), new Date(now - LEDGER_SLOT_CLOCK_MARGIN_MS).toISOString());
});

Deno.test("file InMail : un compte à reconnecter ou limité (defer) rend la place du plafond avant de reporter l'item", async () => {
  const source = await Deno.readTextFile(new URL("../process-inmail-queue/index.ts", import.meta.url));
  const gate = source.indexOf("const slotSince = ledgerSlotSince(Date.now());");
  const defer = source.indexOf('if (plan.action === "defer") {');
  assert(gate > 0 && defer > 0, "réservation et report introuvables");
  assert(gate < source.indexOf("enforceLinkedInAction(supabase, {"), "la borne est prise avant le gate");
  const body = source.slice(defer, defer + 400);
  assert(body.includes("releaseLedgerSlotRow(supabase"), "la place est rendue dans la branche defer");
  assert(body.includes('source: "inmail_queue"'), "même source que le gate");
  assert(source.includes("actionType: slotActionType,"), "le gate et la libération partagent le type d'action");
});
