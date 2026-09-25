// deno test --no-check supabase/functions/_shared/template-interpolation.test.ts
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { buildSequenceContext, interpolateAndStrip, isLikelyRealFirstName } from "./template-interpolation.ts";
import { clearSenderCache } from "./sequence-sender.ts";

type Query = { table: string; cols: string; filters: Record<string, unknown> };
type Handler = (q: Query) => { data: unknown; error: { message: string } | null };

/** Faux client Supabase : chaque table répond via un handler, les requêtes sont gardées. */
function fakeClient(handlers: Record<string, Handler>) {
  const queries: Query[] = [];
  const client = {
    queries,
    from(table: string) {
      const q: Query = { table, cols: "", filters: {} };
      queries.push(q);
      const answer = () => Promise.resolve(handlers[table]?.(q) ?? { data: null, error: null });
      const builder = {
        select(cols: string) { q.cols = cols; return builder; },
        eq(col: string, value: unknown) { q.filters[col] = value; return builder; },
        maybeSingle: answer,
        then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
          return Promise.resolve(handlers[table]?.(q) ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return client;
}

const profiles: Handler = (q) => {
  if (/first_name|last_name/.test(q.cols)) return { data: null, error: { message: 'column profiles.first_name does not exist' } };
  if (q.filters.user_id === "u-claire") return { data: { display_name: "Claire Dubois", job_title: "Talent Partner" }, error: null };
  if (q.filters.user_id === "u-laurent") return { data: { display_name: "Laurent Garilhe", job_title: "Recruteur" }, error: null };
  return { data: null, error: null };
};

Deno.test("SEQ-062 : variables expéditeur et lien de rendez-vous résolus (colonnes réelles)", async () => {
  clearSenderCache();
  const client = fakeClient({
    profiles,
    sourcing_projects: () => ({ data: { name: "Lead Dev Go", job_details: { title: "Lead Dev Go" }, calendly_link: "https://cal.example/laurent", client_name: "Qonto" }, error: null }),
    organizations: () => ({ data: { name: "Talentis" }, error: null }),
  });
  const ctx = await buildSequenceContext(client as never, {
    enrollment: { profile_name: "Marie Curie", job_id: "p1", organization_id: "org1", created_by: "u-laurent", account_id: "ACC_A" },
    senderUserId: "u-laurent",
  });
  assertEquals(ctx.sender_name, "Laurent");
  assertEquals(ctx.mon_prenom, "Laurent");
  assertEquals(ctx.ma_signature, "Laurent Garilhe");
  assertEquals(ctx.mon_poste, "Recruteur");
  assertEquals(ctx.calendly_link, "https://cal.example/laurent");
  assertEquals(ctx.client, "Qonto");
  const profileQuery = client.queries.find((q) => q.table === "profiles");
  assert(profileQuery && !/first_name/.test(profileQuery.cols), "profiles n'a pas de first_name");
});

Deno.test("SEQ-100 : l'expéditeur est le titulaire du compte d'envoi (rotation), pas l'inscripteur", async () => {
  clearSenderCache();
  const client = fakeClient({
    profiles,
    member_linkedin_accounts: (q) => ({
      data: q.filters.linkedin_account_id === "ACC_CLAIRE" && q.filters.organization_id === "org1" ? { user_id: "u-claire" } : null,
      error: null,
    }),
  });
  const ctx = await buildSequenceContext(client as never, {
    enrollment: { profile_name: "Marie Curie", organization_id: "org1", created_by: "u-laurent", account_id: "ACC_A", assigned_sender_id: "ACC_CLAIRE" },
    senderUserId: "u-laurent",
  });
  assertEquals(ctx.ma_signature, "Claire Dubois");
});

Deno.test("SEQ-064 : {{job_title}} reste le poste du candidat, la mission va dans poste_recherche", async () => {
  clearSenderCache();
  const client = fakeClient({ profiles });
  const ctx = await buildSequenceContext(client as never, {
    enrollment: { profile_name: "Marie Curie", profile_headline: "Engineering Manager chez Qonto", job_title: "Lead Dev Go" },
  });
  assertEquals(ctx.job_title, "Engineering Manager");
  assertEquals(ctx.poste_recherche, "Lead Dev Go");
  const noHeadline = await buildSequenceContext(client as never, { enrollment: { profile_name: "Marie Curie", job_title: "Lead Dev Go" } });
  assertEquals(noHeadline.job_title, undefined, "sans titre LinkedIn, la variable est effacée plutôt que remplacée par la mission");
});

Deno.test("SEQ-099 : prénom non fiable = salutation neutre, sans espace avant la virgule", async () => {
  clearSenderCache();
  const client = fakeClient({ profiles });
  for (const name of ["🚀 Julie Martin", "Dr. Paul Roux", ""]) {
    const ctx = await buildSequenceContext(client as never, { enrollment: { profile_name: name } });
    assertEquals(interpolateAndStrip("Bonjour {{first_name}}, ravi de te lire.", ctx).result, "Bonjour, ravi de te lire.", name);
  }
  assertEquals(interpolateAndStrip("Salut {{prenom}} ! Ça va ?", {}).result, "Salut ! Ça va ?");
  for (const ok of ["Driss", "Drew", "Devon", "Łukasz", "Ştefan", "N’Golo", "Jean-Pierre", "Marie"]) assert(isLikelyRealFirstName(ok), ok);
  for (const ko of ["Dr.", "Dr", "Hiring", "OPEN", "Mme", "🚀", "J4ne", "Lead"]) assert(!isLikelyRealFirstName(ko), ko);
});
