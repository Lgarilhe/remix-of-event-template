// deno test --no-check supabase/functions/_shared/sequence-sender.test.ts
import { deepStrictEqual as assertEquals } from "node:assert";
import { clearSenderCache, isMailboxDisconnected, resolveEmailStepSender, resolveSequenceSenderUserId, sendingAccountId } from "./sequence-sender.ts";
import { loadAndBuildAiContext, loadAiContextForEnrollment } from "./ai-context.ts";

function fakeClient(owner: Record<string, string>, aiContexts: Record<string, unknown> = {}) {
  const userIdsRead: string[] = [];
  return {
    userIdsRead,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select() { return builder; },
        eq(col: string, value: unknown) { filters[col] = value; return builder; },
        maybeSingle() {
          if (table === "member_linkedin_accounts") {
            const userId = owner[`${filters.organization_id}::${filters.linkedin_account_id}`];
            return Promise.resolve({ data: userId ? { user_id: userId } : null, error: null });
          }
          if (table === "profiles") {
            userIdsRead.push(String(filters.user_id));
            return Promise.resolve({ data: { ai_context: aiContexts[String(filters.user_id)] ?? null }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
}

Deno.test("SEQ-013 : le compte de rotation désigne son titulaire, jamais un user_id", async () => {
  clearSenderCache();
  assertEquals(sendingAccountId({ assigned_sender_id: "ACC_B", account_id: "ACC_A" }), "ACC_B");
  const client = fakeClient({ "org1::ACC_B": "u-claire" });
  const enrollment = { organization_id: "org1", assigned_sender_id: "ACC_B", account_id: "ACC_A", created_by: "u-laurent" };
  assertEquals(await resolveSequenceSenderUserId(client, enrollment), "u-claire");
  // Compte non rattaché à l'organisation : repli sur l'auteur de l'inscription.
  assertEquals(await resolveSequenceSenderUserId(client, { ...enrollment, organization_id: "org2" }), "u-laurent");
});

Deno.test("SEQ-013 : le contexte IA est celui du titulaire du compte d'envoi", async () => {
  clearSenderCache();
  const client = fakeClient({ "org9::ACC_B": "u-claire" });
  await loadAiContextForEnrollment(client, { organization_id: "org9", assigned_sender_id: "ACC_B", account_id: "ACC_A", created_by: "u-laurent" });
  assertEquals(client.userIdsRead, ["u-claire"], "assigned_sender_id ne doit jamais être lu comme un user_id");
  // Sans cache : même résultat qu'un chargement direct pour ce titulaire.
  assertEquals(typeof (await loadAndBuildAiContext(client, { orgId: null, userId: "u-claire", noCache: true })), "string");
});

/** Faux client des tables de comptes : filtres eq / in, lecture en liste. */
function accountsClient(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const ins: Record<string, unknown[]> = {};
      const rows = () => (tables[table] || []).filter((row) =>
        Object.entries(eqs).every(([k, v]) => row[k] === v)
        && Object.entries(ins).every(([k, v]) => v.includes(row[k])));
      const builder = {
        select() { return builder; },
        eq(col: string, value: unknown) { eqs[col] = value; return builder; },
        in(col: string, values: unknown[]) { ins[col] = values; return builder; },
        maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

Deno.test("SEQ-067/100 : étape e-mail, même boîte et même titulaire que sequence-send-email", async () => {
  clearSenderCache();
  const client = accountsClient({
    member_email_accounts: [
      { organization_id: "org1", user_id: "u-claire", email_account_id: "MAIL_KO", account_status: "CREDENTIALS" },
      { organization_id: "org1", user_id: "u-claire", email_account_id: "MAIL_OK", account_status: "OK" },
      { organization_id: "org1", user_id: "u-theo", email_account_id: "MAIL_THEO", account_status: "CREDENTIALS" },
    ],
    member_linkedin_accounts: [
      { organization_id: "org1", user_id: "u-claire", linkedin_account_id: "LI_CLAIRE" },
    ],
  });
  const enrollment = { organization_id: "org1", account_id: "LI_CLAIRE", created_by: "u-laurent" };
  // Compte LinkedIn de l'inscription : boîte de sa titulaire, l'état OK d'abord.
  const viaLinkedIn = await resolveEmailStepSender(client, enrollment, null);
  assertEquals(viaLinkedIn, { kind: "ok", mailboxId: "MAIL_OK", mailboxStatus: "OK", ownerUserId: "u-claire" });
  // Boîte désignée par l'étape : elle sert telle quelle, état compris.
  const viaStep = await resolveEmailStepSender(client, enrollment, { sender_id: "MAIL_THEO" });
  assertEquals(viaStep, { kind: "ok", mailboxId: "MAIL_THEO", mailboxStatus: "CREDENTIALS", ownerUserId: "u-theo" });
  assertEquals(isMailboxDisconnected("CREDENTIALS"), true);
  assertEquals(isMailboxDisconnected("OK"), false);
  assertEquals(isMailboxDisconnected(null), false);
  // Signature d'une étape e-mail : titulaire de la boîte, pas l'auteur de l'inscription.
  assertEquals(await resolveSequenceSenderUserId(client, enrollment, { sender_id: "MAIL_THEO", action_type: "email" }), "u-theo");
  // Compte absent de l'organisation : rien n'est résolu.
  assertEquals((await resolveEmailStepSender(client, { ...enrollment, organization_id: "org2" }, null)).kind, "not_in_org");
});
