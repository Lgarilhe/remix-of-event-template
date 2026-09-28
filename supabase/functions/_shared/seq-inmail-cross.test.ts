// deno test --no-check --allow-read supabase/functions/_shared/seq-inmail-cross.test.ts
//
// Lot « inmail-cross » (tests de bout en bout du module séquences, septembre
// 2026) : anti-doublon côté navigateur (src/lib/enrollmentDuplicates.ts), lu
// par les modales d'inscription et d'InMail groupé.
//
// Le module vit dans src/ et importe `@/lib/linkedinUtils` : il est chargé en
// mémoire après réécriture de cet alias vers le fichier réel (les imports de
// type sont effacés à la transpilation). Le client Supabase est un faux qui
// applique les filtres `eq`, `in` et `gte` comme la base, sans réseau.
import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";

const ROOT = new URL("../../../", import.meta.url);

async function loadEnrollmentDuplicates() {
  const source = await Deno.readTextFile(new URL("src/lib/enrollmentDuplicates.ts", ROOT));
  const utilsUrl = new URL("src/lib/linkedinUtils.ts", ROOT).href;
  const rewritten = source
    .replace(/^import type .*$/gm, "")
    .replace("from '@/lib/linkedinUtils'", `from '${utilsUrl}'`);
  const dataUrl = `data:application/typescript;base64,${btoa(unescape(encodeURIComponent(rewritten)))}`;
  return await import(dataUrl);
}

type Row = Record<string, unknown>;

/** Faux client : tables en mémoire, filtres eq / in / gte appliqués, RPC vide. */
function fakeClient(tables: Record<string, Row[]>) {
  const statusFilters: Record<string, unknown[][]> = {};
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const builder = {
      select: () => builder,
      eq: (col: string, value: unknown) => { filters.push((r) => r[col] === value); return builder; },
      gte: (col: string, value: string) => { filters.push((r) => String(r[col]) >= value); return builder; },
      in: (col: string, values: unknown[]) => {
        if (col === "status") (statusFilters[table] ??= []).push([...values]);
        filters.push((r) => values.includes(r[col]));
        return builder;
      },
      or: () => builder,
      order: () => builder,
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
        resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }),
    };
    return builder;
  };
  return {
    client: { from, rpc: () => Promise.resolve({ data: [], error: null }) },
    statusFilters,
  };
}

// antidoublon-client-inmail-replied
Deno.test("anti-doublon : un candidat dont l'InMail groupé est « répondu » reste signalé comme déjà contacté", async () => {
  const { findRecentEnrollments } = await loadEnrollmentDuplicates();
  const orgId = "11111111-1111-1111-1111-111111111111";
  const profileId = "ACoAAInmailCrossReplied";
  const { client, statusFilters } = fakeClient({
    inmail_queue: [{
      organization_id: orgId,
      recipient_profile_id: profileId,
      created_by: "22222222-2222-2222-2222-222222222222",
      created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      status: "replied",
    }],
    profiles: [],
  });

  const result: Map<string, { hasRecentInMail: boolean; source: string }> =
    await findRecentEnrollments(client, orgId, [{ id: profileId }]);

  const inmailStatuses = (statusFilters.inmail_queue ?? []).flat();
  // DÉFAUT inmail-replied-hors-antidoublon-client : INMAIL_CONTACT_STATUSES omet 'replied' (src/lib/enrollmentDuplicates.ts:45).
  assert(result.has(profileId), `le candidat qui a répondu à un InMail doit être signalé (statuts lus dans inmail_queue : ${JSON.stringify(inmailStatuses)})`);
  assertEquals(result.get(profileId)?.hasRecentInMail, true);
  assertEquals(result.get(profileId)?.source, "inmail");
  // La lecture de la file InMail demande aussi les lignes « replied ».
  assert(inmailStatuses.includes("replied"));
});

// Témoin : un InMail « envoyé » est bien signalé (le faux client reproduit la base).
Deno.test("anti-doublon (témoin) : un InMail groupé envoyé est signalé", async () => {
  const { findRecentEnrollments } = await loadEnrollmentDuplicates();
  const orgId = "11111111-1111-1111-1111-111111111111";
  const profileId = "ACoAAInmailCrossSent";
  const { client } = fakeClient({
    inmail_queue: [{
      organization_id: orgId,
      recipient_profile_id: profileId,
      created_by: null,
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
      status: "sent",
    }],
  });
  const result: Map<string, { hasRecentInMail: boolean }> = await findRecentEnrollments(client, orgId, [{ id: profileId }]);
  assertEquals(result.get(profileId)?.hasRecentInMail, true);
});
