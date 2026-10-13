// Plan de bascule : rapprochement base / service et règles de refus.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-migration/plan.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import {
  applyRefusal,
  buildPlan,
  dedupeDbAccounts,
  mappableItems,
  planFingerprint,
  providerMatchesKind,
  summarizePlan,
  unmappedItems,
  type ApplyPreconditions,
  type DbAccount,
} from './plan.ts';

const service = [
  { id: 'acc_LI1', provider: 'linkedin', name: 'Jean Dupont', metadata: { v1_account_id: 'v1-li-1' } },
  { id: 'acc_LI2', provider: 'linkedin', name: 'Claire Martin', metadata: { v1_account_id: 'v1-li-2' } },
  { id: 'acc_WA1', provider: 'whatsapp', name: '+33612345678', metadata: { v1_account_id: 'v1-wa-1' } },
  { id: 'acc_MAIL1', provider: 'outlook', name: 'Sophie.Bernard@Cabinet.fr', metadata: {} },
  { id: 'acc_MAIL2', provider: 'google', name: 'theo@agence.io', metadata: { v1_account_id: 'v1-mail-2' } },
  // Deux comptes du service revendiquent le même ancien identifiant : jamais résolu.
  { id: 'acc_DUP_A', provider: 'linkedin', name: 'A', metadata: { v1_account_id: 'v1-dup' } },
  { id: 'acc_DUP_B', provider: 'linkedin', name: 'B', metadata: { v1_account_id: 'v1-dup' } },
  // Fournisseur différent du type attendu.
  { id: 'acc_WRONG', provider: 'whatsapp', name: 'x', metadata: { v1_account_id: 'v1-wrong' } },
];

const db: DbAccount[] = [
  { kind: 'linkedin', storedId: 'v1-li-1', label: 'Jean Dupont', email: null },
  { kind: 'linkedin', storedId: 'v1-li-2', label: 'Claire Martin', email: null },
  { kind: 'linkedin', storedId: 'acc_ALREADY', label: 'Déjà migré', email: null },
  { kind: 'linkedin', storedId: 'v1-absent', label: 'Paul Absent', email: null },
  { kind: 'linkedin', storedId: 'v1-dup', label: 'Doublon', email: null },
  { kind: 'linkedin', storedId: 'v1-wrong', label: 'Mauvais type', email: null },
  { kind: 'whatsapp', storedId: 'v1-wa-1', label: 'Mon WhatsApp', email: null },
  // Messagerie Outlook : retrouvée par son adresse (aucun v1_account_id côté service).
  { kind: 'email', storedId: 'v1-mail-1', label: 'sophie.bernard@cabinet.fr', email: 'sophie.bernard@cabinet.fr' },
  // Messagerie retrouvée par v1_account_id.
  { kind: 'email', storedId: 'v1-mail-2', label: 'theo@agence.io', email: 'theo@agence.io' },
  // Messagerie introuvable.
  { kind: 'email', storedId: 'v1-mail-3', label: 'inconnu@nulle-part.fr', email: 'inconnu@nulle-part.fr' },
];

Deno.test('buildPlan : chaque compte tombe dans la bonne case', () => {
  const plan = buildPlan(db, service);
  const byId = new Map(plan.items.map((item) => [item.oldId, item]));
  strictEqual(byId.get('v1-li-1')?.status, 'mappable');
  strictEqual(byId.get('v1-li-1')?.newId, 'acc_LI1');
  strictEqual(byId.get('v1-li-1')?.via, 'v1_account_id');
  strictEqual(byId.get('acc_ALREADY')?.status, 'already_v2');
  strictEqual(byId.get('acc_ALREADY')?.newId, 'acc_ALREADY');
  strictEqual(byId.get('v1-absent')?.status, 'unmapped');
  strictEqual(byId.get('v1-absent')?.reason, 'not_in_service');
  strictEqual(byId.get('v1-dup')?.status, 'unmapped');
  strictEqual(byId.get('v1-dup')?.reason, 'ambiguous');
  strictEqual(byId.get('v1-wrong')?.status, 'unmapped');
  strictEqual(byId.get('v1-wrong')?.reason, 'provider_mismatch');
  strictEqual(byId.get('v1-wa-1')?.newId, 'acc_WA1');
  strictEqual(byId.get('v1-mail-1')?.newId, 'acc_MAIL1');
  strictEqual(byId.get('v1-mail-1')?.via, 'email');
  strictEqual(byId.get('v1-mail-2')?.newId, 'acc_MAIL2');
  strictEqual(byId.get('v1-mail-2')?.via, 'v1_account_id');
  strictEqual(byId.get('v1-mail-3')?.status, 'unmapped');
});

Deno.test('buildPlan : effectifs par type', () => {
  const plan = buildPlan(db, service);
  deepStrictEqual(plan.counts.all, { total: 10, already_v2: 1, via_v1_account_id: 4, via_email: 1, unmapped: 4 });
  deepStrictEqual(plan.counts.linkedin, { total: 6, already_v2: 1, via_v1_account_id: 2, via_email: 0, unmapped: 3 });
  deepStrictEqual(plan.counts.email, { total: 3, already_v2: 0, via_v1_account_id: 1, via_email: 1, unmapped: 1 });
  deepStrictEqual(plan.counts.whatsapp, { total: 1, already_v2: 0, via_v1_account_id: 1, via_email: 0, unmapped: 0 });
  strictEqual(plan.serviceAccounts, service.length);
  strictEqual(mappableItems(plan).length, 5);
  strictEqual(unmappedItems(plan).length, 4);
});

Deno.test('buildPlan : un compte LinkedIn n\'est jamais rapproché par adresse', () => {
  const plan = buildPlan(
    [{ kind: 'linkedin', storedId: 'v1-x', label: 'x', email: 'sophie.bernard@cabinet.fr' }],
    service,
  );
  strictEqual(plan.items[0].status, 'unmapped');
});

Deno.test('buildPlan : adresse revendiquée par deux comptes du service = ambiguë', () => {
  const twoMailboxes = [
    { id: 'acc_M1', provider: 'outlook', name: 'a@b.fr', metadata: {} },
    { id: 'acc_M2', provider: 'google', name: 'A@B.fr', metadata: {} },
  ];
  const plan = buildPlan([{ kind: 'email', storedId: 'v1-m', label: 'a@b.fr', email: 'a@b.fr' }], twoMailboxes);
  strictEqual(plan.items[0].status, 'unmapped');
  strictEqual(plan.items[0].reason, 'ambiguous');
});

Deno.test('buildPlan : libellés masqués, jamais d\'adresse ni de numéro', () => {
  const plan = buildPlan(db, service);
  const json = JSON.stringify(plan.items);
  ok(!json.includes('sophie.bernard@cabinet.fr'));
  ok(!json.includes('inconnu@nulle-part.fr'));
  ok(!json.includes('theo@agence.io'));
  ok(!json.includes('Dupont'));
  ok(!json.includes('+33'));
  const mail3 = plan.items.find((item) => item.oldId === 'v1-mail-3');
  strictEqual(mail3?.maskedLabel, 'i***@nulle-part.fr');
  strictEqual(mail3?.ref, '…il-3');
});

Deno.test('buildPlan : messagerie et agenda du même compte donnent une seule ligne', () => {
  const plan = buildPlan(
    [
      { kind: 'email', storedId: 'v1-mail-2', label: null, email: null },
      { kind: 'email', storedId: 'v1-mail-2', label: 'theo@agence.io', email: 'THEO@agence.io' },
    ],
    service,
  );
  strictEqual(plan.items.length, 1);
  strictEqual(plan.items[0].maskedLabel, 't***@agence.io');
});

Deno.test('buildPlan : deux anciens identifiants vers un même compte du service sont signalés', () => {
  const plan = buildPlan(
    [
      { kind: 'email', storedId: 'v1-mail-2', label: null, email: null },
      { kind: 'email', storedId: 'v1-calendar-2', label: 'theo@agence.io', email: 'theo@agence.io' },
    ],
    service,
  );
  strictEqual(mappableItems(plan).length, 2);
  strictEqual(plan.sharedTargets, 1);
});

Deno.test('dedupeDbAccounts : ignore les identifiants vides et les types inconnus, garde le type le plus précis', () => {
  const out = dedupeDbAccounts([
    { kind: 'email', storedId: ' ', label: null, email: null },
    { kind: 'sms' as never, storedId: 'x', label: null, email: null },
    { kind: 'email', storedId: 'same', label: null, email: null },
    { kind: 'linkedin', storedId: 'same', label: 'L', email: null },
  ]);
  strictEqual(out.length, 1);
  strictEqual(out[0].kind, 'linkedin');
  strictEqual(out[0].label, 'L');
});

Deno.test('providerMatchesKind', () => {
  ok(providerMatchesKind('linkedin', 'linkedin'));
  ok(!providerMatchesKind('linkedin', 'whatsapp'));
  ok(providerMatchesKind('email', 'outlook') && providerMatchesKind('email', 'google') && providerMatchesKind('email', 'imap'));
  ok(!providerMatchesKind('email', 'linkedin'));
  ok(providerMatchesKind('whatsapp', 'whatsapp'));
  ok(!providerMatchesKind('whatsapp', undefined));
});

Deno.test('summarizePlan : une phrase sans identifiant', () => {
  const sentence = summarizePlan(buildPlan(db, service));
  strictEqual(sentence, '10 comptes en base, 1 déjà au nouveau format, 4 retrouvés par leur ancien identifiant, 1 retrouvé par leur adresse, 4 sans correspondance.');
  strictEqual(summarizePlan(buildPlan([], service)), 'Aucun compte relié en base.');
});

const READY: ApplyPreconditions = {
  confirm: 'BASCULER', allowUnmapped: false, keyConfigured: true, serviceReachable: true, listTruncated: false, unmappedCount: 0,
};

Deno.test('applyRefusal : rien à refuser quand tout est prêt', () => {
  strictEqual(applyRefusal(READY), null);
});

Deno.test('applyRefusal : la confirmation doit être exacte', () => {
  for (const confirm of [undefined, null, '', 'bascule', 'BASCULER ', ' BASCULER', 'basculer', true, 1]) {
    const refusal = applyRefusal({ ...READY, confirm });
    strictEqual(refusal?.error_code, 'confirmation_required');
    strictEqual(refusal?.status, 400);
  }
});

Deno.test('applyRefusal : clé absente, service muet, liste tronquée, dans cet ordre', () => {
  strictEqual(applyRefusal({ ...READY, keyConfigured: false, serviceReachable: false })?.error_code, 'key_missing');
  strictEqual(applyRefusal({ ...READY, serviceReachable: false, listTruncated: true })?.error_code, 'service_unreachable');
  strictEqual(applyRefusal({ ...READY, listTruncated: true, unmappedCount: 2 })?.error_code, 'list_truncated');
});

Deno.test('applyRefusal : comptes sans correspondance refusés sauf allow_unmapped === true', () => {
  strictEqual(applyRefusal({ ...READY, unmappedCount: 3 })?.error_code, 'unmapped_accounts');
  strictEqual(applyRefusal({ ...READY, unmappedCount: 3, allowUnmapped: 'true' })?.error_code, 'unmapped_accounts');
  strictEqual(applyRefusal({ ...READY, unmappedCount: 3, allowUnmapped: 1 })?.error_code, 'unmapped_accounts');
  strictEqual(applyRefusal({ ...READY, unmappedCount: 3, allowUnmapped: true }), null);
});

Deno.test('applyRefusal : messages français, sans tiret long ni nom de prestataire', () => {
  const messages = [
    applyRefusal({ ...READY, confirm: 'x' }),
    applyRefusal({ ...READY, keyConfigured: false }),
    applyRefusal({ ...READY, serviceReachable: false }),
    applyRefusal({ ...READY, listTruncated: true }),
    applyRefusal({ ...READY, unmappedCount: 1 }),
    applyRefusal({ ...READY, unmappedCount: 4 }),
  ].map((refusal) => refusal?.error ?? '');
  for (const message of messages) {
    ok(message.length > 10, message);
    ok(!/unipile|—/i.test(message), message);
  }
  ok(messages[4].startsWith('1 compte n\'a pas'));
  ok(messages[5].startsWith('4 comptes n\'ont pas'));
});

Deno.test('planFingerprint : stable, indépendante de l\'ordre, sensible aux comptes et aux correspondances', async () => {
  const accounts: DbAccount[] = [
    { kind: 'linkedin', storedId: 'v1-li-1', label: 'Jean Dupont', email: null },
    { kind: 'linkedin', storedId: 'v1-li-2', label: 'Claire Martin', email: null },
    { kind: 'linkedin', storedId: 'v1-perdu', label: 'Paul Perdu', email: null },
    { kind: 'linkedin', storedId: 'acc_DEJA', label: 'Déjà', email: null },
  ];
  const base = await planFingerprint(buildPlan(accounts, service));
  ok(/^[0-9a-f]{64}$/.test(base));
  strictEqual(await planFingerprint(buildPlan([...accounts].reverse(), service)), base, 'ordre des comptes sans effet');
  strictEqual(await planFingerprint(buildPlan(accounts.map((a) => ({ ...a, label: 'autre libellé' })), service)), base, 'libellés sans effet');
  // Un compte déjà converti en plus ou en moins ne change pas ce qui reste à faire.
  strictEqual(await planFingerprint(buildPlan(accounts.filter((a) => a.storedId !== 'acc_DEJA'), service)), base);
  // Un compte relié en plus (même sans correspondance), un compte retiré, une cible modifiée : empreinte différente.
  const added = await planFingerprint(buildPlan([...accounts, { kind: 'linkedin', storedId: 'v1-nouveau', label: null, email: null }], service));
  ok(added !== base, 'compte ajouté');
  ok(await planFingerprint(buildPlan(accounts.filter((a) => a.storedId !== 'v1-li-2'), service)) !== base, 'compte retiré');
  const moved = service.map((a) => (a.id === 'acc_LI2' ? { ...a, id: 'acc_LI2_BIS' } : a));
  ok(await planFingerprint(buildPlan(accounts, moved)) !== base, 'cible modifiée');
  // Le compte sans correspondance qui en trouve une change aussi l'empreinte.
  const found = [...service, { id: 'acc_PERDU', provider: 'linkedin', name: 'Paul', metadata: { v1_account_id: 'v1-perdu' } }];
  ok(await planFingerprint(buildPlan(accounts, found)) !== base, 'compte sans correspondance désormais retrouvé');
});
