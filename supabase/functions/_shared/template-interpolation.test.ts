// deno test --no-check supabase/functions/_shared/template-interpolation.test.ts
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { ANONYMIZED_CLIENT_FALLBACK, buildSequenceContext, interpolateAndStrip, isLikelyRealFirstName } from "./template-interpolation.ts";
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

// ─── Client anonymisé (correctif 1 du plan du lot 5) ──────────────────────

/** Contexte d'une inscription sur une mission dont la ligne sourcing_projects est `project`. */
async function contextForProject(project: Record<string, unknown>) {
  clearSenderCache();
  const client = fakeClient({ profiles, sourcing_projects: () => ({ data: project, error: null }) });
  return buildSequenceContext(client as never, {
    enrollment: { profile_name: "Marie Curie", job_id: "p1", organization_id: "org1", created_by: "u-laurent", account_id: "ACC_A" },
    senderUserId: "u-laurent",
  });
}

Deno.test("correctif 1 : client anonymisé, {{client}} rend l'alias et jamais le nom réel, sous aucun de ses trois noms", async () => {
  const template = "Nous accompagnons {{client}} sur un poste de {{poste_recherche}}. {{client | upper}} ?";
  const anonymized = { recruitment_mode: "client", anonymize_client: true, anonymized_alias: "  un groupe industriel  " };
  for (const [label, project] of [
    ["colonne client_name", { name: "Lead Dev Go", job_details: { title: "Lead Dev Go", outreach_config: anonymized }, client_name: "Doctolib" }],
    ["client.name du Cadrage", { name: "Lead Dev Go", job_details: { title: "Lead Dev Go", client: { name: "Doctolib" }, outreach_config: anonymized }, client_name: null }],
    ["ancien job_details.client_name", { name: "Lead Dev Go", job_details: { title: "Lead Dev Go", client_name: "Doctolib", outreach_config: anonymized }, client_name: null }],
  ] as const) {
    const ctx = await contextForProject(project);
    assertEquals(ctx.client, "un groupe industriel", label);
    const text = interpolateAndStrip(template, ctx).result;
    assertEquals(text, "Nous accompagnons un groupe industriel sur un poste de Lead Dev Go. UN GROUPE INDUSTRIEL ?", label);
    assert(!/doctolib/i.test(JSON.stringify(ctx)), `${label} : le nom réel n'est dans aucune variable`);
  }
});

Deno.test("correctif 1 : client anonymisé sans alias, repli neutre « notre client », secours du modèle ignoré", async () => {
  const ctx = await contextForProject({
    name: "Lead Dev Go",
    job_details: { title: "Lead Dev Go", client: { name: "Doctolib" }, outreach_config: { anonymize_client: true, anonymized_alias: "   " } },
    client_name: "Doctolib",
  });
  assertEquals(ANONYMIZED_CLIENT_FALLBACK, "notre client");
  assertEquals(ctx.client, ANONYMIZED_CLIENT_FALLBACK);
  assertEquals(interpolateAndStrip('Un poste chez {{client | fallback:"une PME"}}.', ctx).result, "Un poste chez notre client.");
  assert(!/doctolib/i.test(JSON.stringify(ctx)));
});

Deno.test("correctif 1 : sans anonymisation, {{client}} garde le nom ; anonymisé sans aucun nom ni alias, la variable reste vide", async () => {
  const named = await contextForProject({
    name: "Lead Dev Go",
    job_details: { title: "Lead Dev Go", outreach_config: { anonymize_client: false, anonymized_alias: "un groupe industriel" } },
    client_name: "Doctolib",
  });
  assertEquals(named.client, "Doctolib");
  const nothing = await contextForProject({ name: "Lead Dev Go", job_details: { outreach_config: { anonymize_client: true } }, client_name: null });
  assertEquals(nothing.client, undefined, "rien à cacher : le texte de secours du modèle s'applique comme avant");
  assertEquals(interpolateAndStrip('Chez {{client | fallback:"une PME"}}.', nothing).result, "Chez une PME.");
});

// ─── Relevé de la construction (aperçu, lot 5d-1) ─────────────────────────

Deno.test("5d-1 : le relevé note l'expéditeur, ses variables personnelles (alias compris) et ne change pas le contexte", async () => {
  const handlers = {
    profiles,
    member_linkedin_accounts: (q: Query) => ({ data: q.filters.linkedin_account_id === "ACC_CLAIRE" ? { user_id: "u-claire" } : null, error: null }),
    organizations: () => ({ data: { name: "Talentis" }, error: null }),
    user_template_variables: (q: Query) => ({
      data: q.filters.user_id === "u-claire" ? [{ key: "ville", value: "Nantes" }, { key: "tarif", value: "18 %" }, { key: "prenom", value: "Ignorée" }] : [],
      error: null,
    }),
  };
  const enrollment = { profile_name: "Marie Curie", organization_id: "org1", created_by: "u-laurent", account_id: "ACC_CLAIRE" };
  clearSenderCache();
  const plain = await buildSequenceContext(fakeClient(handlers) as never, { enrollment, senderUserId: "u-laurent" });
  clearSenderCache();
  const trace = { senderUserId: null as string | null, personalKeys: [] as string[], failedReads: [] as string[] };
  const traced = await buildSequenceContext(fakeClient(handlers) as never, { enrollment, senderUserId: "u-laurent", trace });
  assertEquals(traced, plain, "contexte identique avec ou sans relevé");
  assertEquals(trace.senderUserId, "u-claire");
  assertEquals([...trace.personalKeys].sort(), ["city", "tarif", "ville"], "prenom déjà rempli par le candidat : pas personnelle");
  assertEquals(trace.failedReads, []);
});

Deno.test("5d-1 : le relevé note chaque lecture en échec (erreur rendue ou exception), le contexte reste construit", async () => {
  const boom = () => ({ data: null, error: { message: "boom" } });
  const thrown = () => { throw new Error("réseau"); };
  for (const [table, handler, expected] of [
    ["sourcing_projects", boom, "sourcing_projects"],
    ["profiles", boom, "profiles"],
    ["organizations", boom, "organizations"],
    ["organizations", thrown, "organizations"],
    ["user_template_variables", boom, "user_template_variables"],
    ["user_template_variables", thrown, "user_template_variables"],
    ["member_linkedin_accounts", boom, "member_linkedin_accounts"],
  ] as const) {
    clearSenderCache();
    const trace = { senderUserId: null as string | null, personalKeys: [] as string[], failedReads: [] as string[] };
    const client = fakeClient({ profiles, [table]: handler });
    const ctx = await buildSequenceContext(client as never, {
      enrollment: { profile_name: "Marie Curie", job_id: "p1", organization_id: "org1", created_by: "u-laurent", account_id: "ACC_A" },
      senderUserId: "u-laurent",
      trace,
    }).catch((e) => { throw new Error(`${table} : le moteur ne doit jamais lever (${e})`); });
    assertEquals(trace.failedReads, [expected], `${table}`);
    assertEquals(ctx.prenom, "Marie");
  }
});
