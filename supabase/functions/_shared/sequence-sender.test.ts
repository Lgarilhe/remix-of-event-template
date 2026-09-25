// deno test --no-check supabase/functions/_shared/sequence-sender.test.ts
import { deepStrictEqual as assertEquals } from "node:assert";
import { clearSenderCache, resolveSequenceSenderUserId, sendingAccountId } from "./sequence-sender.ts";
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
