// Normaliseurs de profil, de compte et de crédits InMail : exemples de référence
// (fixtures/*.json, valeurs inventées sur les champs du schéma), lecture tolérante
// (jamais d'exception, un champ absent devient null) et chemins de l'accroche et
// du lieu, dont la position réelle est inconnue.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/unipile/normalize/profile.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import accountFixture from '../fixtures/account-linkedin.json' with { type: 'json' };
import creditsFixture from '../fixtures/inmail-credits.json' with { type: 'json' };
import profileFull from '../fixtures/profile-full.json' with { type: 'json' };
import profileMinimal from '../fixtures/profile-minimal.json' with { type: 'json' };
import profileRecruiter from '../fixtures/profile-recruiter-extras.json' with { type: 'json' };
import {
  pickInmailProduct,
  type ProfileDiagnostic,
  slugFromProfileUrl,
  toKonektAccount,
  toKonektDate,
  toKonektInmailCredits,
  toKonektPosition,
  toKonektProfile,
  toLegacyNetworkDistance,
  toMemberUrn,
  toNetworkDegree,
} from './profile.ts';

// ---------------------------------------------------------------------------
// Exemples de référence
// ---------------------------------------------------------------------------

Deno.test('toKonektProfile : profil complet, toutes les sections demandées', () => {
  deepStrictEqual(toKonektProfile(profileFull.input), profileFull.expected);
});

Deno.test('toKonektProfile : profil minimal, tout le reste est null (sections absentes = null, pas [])', () => {
  const profile = toKonektProfile(profileMinimal.input);
  deepStrictEqual(profile, profileMinimal.expected);
  strictEqual(profile.work_experience, null);
  strictEqual(profile.education, null);
  strictEqual(profile.skills, null);
  strictEqual(profile.recommendations, null);
  strictEqual(profile.headline, null);
  strictEqual(profile.contact_info, null);
  strictEqual(profile.invitation, null);
  strictEqual(profile.pending_invitation, null);
});

Deno.test('toKonektProfile : variante Recruiter, étiquettes, notes et activité', () => {
  deepStrictEqual(toKonektProfile(profileRecruiter.input), profileRecruiter.expected);
});

Deno.test('toKonektProfile : une section vide envoyée reste [] (distincte d’une section absente)', () => {
  const profile = toKonektProfile({ id: 'ACoAAx', specifics: { experience: [], skills: [], education: [] } });
  deepStrictEqual(profile.work_experience, []);
  deepStrictEqual(profile.skills, []);
  deepStrictEqual(profile.education, []);
  strictEqual(profile.languages, null);
});

Deno.test('toKonektProfile : les champs lus par buildProfileData et le moteur ont leur nom d’avant', () => {
  const p = toKonektProfile(profileFull.input);
  strictEqual(p.provider_id, 'ACoAAB1234567');
  strictEqual(p.id, p.provider_id);
  strictEqual(p.public_identifier, 'marie-dupont-123');
  strictEqual(p.network_distance, 'DISTANCE_2');
  strictEqual(p.network_degree, 'SECOND_DEGREE');
  strictEqual(p.work_experience?.[0].role, 'Directrice Produit');
  strictEqual(p.work_experience?.[0].company, 'Acme');
  deepStrictEqual(p.work_experience?.[0].start, { year: 2019, month: 3 });
  strictEqual(p.work_experience?.[0].end, null);
  strictEqual(p.work_experience?.[0].current, true);
  strictEqual(p.work_experience?.[1].current, false);
  strictEqual(p.education?.[0].school, 'HEC Paris');
  strictEqual(p.education?.[0].field_of_study, 'Management, Finance');
  strictEqual(p.recommendations?.received[0].actor?.headline, 'CEO chez Acme');
  strictEqual(p.summary?.startsWith('Dix ans'), true);
  strictEqual(p.profile_picture_url, 'https://media.licdn.com/dms/image/marie.jpg');
  strictEqual(p.connections_count, 500);
  strictEqual(p.contact_info?.phones[0], '+33600000000');
});

Deno.test('toKonektProfile : ne lève jamais, quelle que soit l’entrée', () => {
  const inputs: unknown[] = [
    null,
    undefined,
    'texte',
    42,
    true,
    [],
    [1, 2, 3],
    {},
    { specifics: 'x' },
    { specifics: { experience: 'x', skills: 5, education: [null, 1, 'x', {}], languages: [{}], recommendations: [] } },
    { specifics: { experience: [{ company: 'Acme', job_title: 5, started_on: {} }] } },
    { id: 12, display_name: {}, specifics: { member_id: {} } },
  ];
  for (const input of inputs) {
    const profile = toKonektProfile(input);
    strictEqual(typeof profile, 'object');
    strictEqual(profile.headline, null);
  }
  // Même un profil sans rien : toutes les clés existent.
  strictEqual(Object.keys(toKonektProfile(null)).length, Object.keys(profileFull.expected).length);
});

Deno.test('toKonektProfile : une société donnée en chaîne est lue, un rôle sans titre reste null', () => {
  const profile = toKonektProfile({ specifics: { experience: [{ company: 'Acme', job_title: 5 }] } });
  strictEqual(profile.work_experience?.[0].company, 'Acme');
  strictEqual(profile.work_experience?.[0].role, null);
});

// ---------------------------------------------------------------------------
// Accroche, lieu, résumé : chemins candidats et rapport
// ---------------------------------------------------------------------------

function diagnostics(input: unknown): Record<string, string | null> {
  const seen: Record<string, string | null> = {};
  toKonektProfile(input, { onDiagnostic: (d: ProfileDiagnostic) => (seen[d.field] = d.path) });
  return seen;
}

Deno.test('accroche : le premier chemin renseigné gagne, et le rapport dit lequel', () => {
  deepStrictEqual(diagnostics({ headline: 'A', description: 'D' }).headline, 'headline');
  deepStrictEqual(diagnostics({ specifics: { headline: 'B' }, description: 'D' }).headline, 'specifics.headline');
  deepStrictEqual(diagnostics({ specifics: { linkedin: { headline: 'C' } }, description: 'D' }).headline, 'specifics.linkedin.headline');
  deepStrictEqual(diagnostics({ description: 'D' }).headline, 'description');
  strictEqual(toKonektProfile({ description: 'D' }).headline, 'D');
  strictEqual(toKonektProfile({ specifics: { headline: 'B' }, description: 'D' }).headline, 'B');
});

Deno.test('accroche : aucun chemin renseigné, le rapport donne null et le champ est null', () => {
  const seen = diagnostics({ id: 'x', description: '   ' });
  strictEqual(seen.headline, null);
  strictEqual(seen.location, null);
  strictEqual(seen.summary, null);
  strictEqual(toKonektProfile({ description: '   ' }).headline, null);
});

Deno.test('lieu et résumé : chemins candidats dans l’ordre, le bio d’abord pour le résumé', () => {
  deepStrictEqual(diagnostics({ location: 'Paris' }).location, 'location');
  deepStrictEqual(diagnostics({ specifics: { location: 'Lyon' } }).location, 'specifics.location');
  deepStrictEqual(diagnostics({ addresses: ['1 rue X'] }).location, 'addresses.0');
  deepStrictEqual(diagnostics({ bio: 'B', summary: 'S' }).summary, 'bio');
  deepStrictEqual(diagnostics({ summary: 'S' }).summary, 'summary');
  strictEqual(toKonektProfile({ addresses: ['1 rue X'] }).location, '1 rue X');
});

Deno.test('rapport : appelé une fois par champ, et un rapport qui échoue ne casse pas la normalisation', () => {
  const calls: string[] = [];
  toKonektProfile({ id: 'x' }, { onDiagnostic: (d) => calls.push(d.field) });
  deepStrictEqual(calls, ['headline', 'location', 'summary']);
  const profile = toKonektProfile({ id: 'x', description: 'H' }, {
    onDiagnostic: () => {
      throw new Error('boom');
    },
  });
  strictEqual(profile.headline, 'H');
});

// ---------------------------------------------------------------------------
// Dates, distances, identifiants
// ---------------------------------------------------------------------------

Deno.test('toKonektDate : MM/DD/YYYY du fournisseur et formes voisines', () => {
  deepStrictEqual(toKonektDate('03/15/2019'), { year: 2019, month: 3 });
  deepStrictEqual(toKonektDate('12/01/2020'), { year: 2020, month: 12 });
  deepStrictEqual(toKonektDate('31/03/2019'), { year: 2019, month: 3 }); // jour d'abord, un mois ne dépasse pas 12
  deepStrictEqual(toKonektDate('03/2019'), { year: 2019, month: 3 });
  deepStrictEqual(toKonektDate('2019'), { year: 2019, month: null });
  deepStrictEqual(toKonektDate('2019-04'), { year: 2019, month: 4 });
  deepStrictEqual(toKonektDate('2019-04-23'), { year: 2019, month: 4 });
  deepStrictEqual(toKonektDate('2019-04-23T10:00:00.000Z'), { year: 2019, month: 4 });
  deepStrictEqual(toKonektDate({ year: 2018, month: 7 }), { year: 2018, month: 7 });
  deepStrictEqual(toKonektDate({ year: '2018' }), { year: 2018, month: null });
  deepStrictEqual(toKonektDate(2017), { year: 2017, month: null });
});

Deno.test('toKonektDate : tout le reste est null', () => {
  for (const bad of [null, undefined, '', '   ', 'hier', '13/45/2019x', '03/15/1850', '03/15/2300', {}, { year: 1800 }, [], true, NaN, 1850]) {
    strictEqual(toKonektDate(bad), null, String(bad));
  }
  deepStrictEqual(toKonektDate('13/13/2019'), { year: 2019, month: null }); // année lisible, mois impossible
});

Deno.test('distance de relation : valeur d’interface DISTANCE_n et énumération du fournisseur', () => {
  for (const [input, legacy, degree] of [
    ['FIRST_DEGREE', 'DISTANCE_1', 'FIRST_DEGREE'],
    ['SECOND_DEGREE', 'DISTANCE_2', 'SECOND_DEGREE'],
    ['THIRD_DEGREE', 'DISTANCE_3', 'THIRD_DEGREE'],
    ['DISTANCE_1', 'DISTANCE_1', 'FIRST_DEGREE'],
    [2, 'DISTANCE_2', 'SECOND_DEGREE'],
    ['3', 'DISTANCE_3', 'THIRD_DEGREE'],
    ['first_degree', 'DISTANCE_1', 'FIRST_DEGREE'],
    ['OUT_OF_NETWORK', 'OUT_OF_NETWORK', 'OUT_OF_NETWORK'],
    ['SELF', 'SELF', 'SELF'],
  ] as const) {
    strictEqual(toLegacyNetworkDistance(input), legacy, String(input));
    strictEqual(toNetworkDegree(input), degree, String(input));
  }
  for (const bad of [null, undefined, '', 'FOURTH', 4, {}]) {
    strictEqual(toLegacyNetworkDistance(bad), null);
    strictEqual(toNetworkDegree(bad), null);
  }
});

Deno.test('toMemberUrn et slugFromProfileUrl : jamais d’alias inventé', () => {
  strictEqual(toMemberUrn('123456'), 'urn:li:member:123456');
  strictEqual(toMemberUrn(123456), 'urn:li:member:123456');
  strictEqual(toMemberUrn('urn:li:member:55'), 'urn:li:member:55');
  strictEqual(toMemberUrn('ACoAAx'), null);
  strictEqual(toMemberUrn(''), null);
  strictEqual(toMemberUrn(null), null);
  strictEqual(slugFromProfileUrl('https://www.linkedin.com/in/jean-martin/'), 'jean-martin');
  strictEqual(slugFromProfileUrl('https://fr.linkedin.com/in/jean%20m?x=1'), 'jean m');
  strictEqual(slugFromProfileUrl('https://www.linkedin.com/company/acme'), null);
  strictEqual(slugFromProfileUrl(null), null);
});

Deno.test('position : sans date de fin la position est en cours, une date de fin la clôt', () => {
  strictEqual(toKonektPosition({ job_title: 'A', company: { name: 'X', id: '1' }, started_on: '01/01/2020' }).current, true);
  strictEqual(toKonektPosition({ job_title: 'A', company: { name: 'X', id: '1' }, started_on: '01/01/2020', ended_on: '01/01/2021' }).current, false);
  strictEqual(toKonektPosition({ job_title: 'A', company: { name: 'X', id: '1' }, ended_on: 'n’importe quoi' }).current, true);
});

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

Deno.test('toKonektAccount : exemple de référence, statut partial, contrats fournis', () => {
  deepStrictEqual(toKonektAccount(accountFixture.input, accountFixture.context), accountFixture.expected);
});

Deno.test('toKonektAccount : le statut passe par mapAccountStatus, un doute n’est jamais OK', () => {
  const status = (raw: Record<string, unknown>) => toKonektAccount({ id: 'acc_1', provider: 'linkedin', ...raw }).status;
  strictEqual(status({ status: 'running', is_locked: false }), 'OK');
  strictEqual(status({ status: 'running', is_locked: true }), 'LOCKED');
  strictEqual(status({ status: 'disconnected' }), 'CREDENTIALS');
  strictEqual(status({ status: 'errored' }), 'ERROR');
  strictEqual(status({ status: 'degraded' }), 'DEGRADED');
  strictEqual(status({ status: 'partial' }), 'PARTIAL');
  strictEqual(status({}), 'ERROR');
  strictEqual(status({ status: 'inconnu' }), 'ERROR');
  const ok1 = toKonektAccount({ id: 'acc_1', provider: 'linkedin', status: 'running' });
  strictEqual(ok1.sendable, true);
  strictEqual(ok1.reconnectable, false);
  const degraded = toKonektAccount({ id: 'acc_1', provider: 'linkedin', status: 'degraded' });
  strictEqual(degraded.sendable, false);
  strictEqual(degraded.reconnectable, false);
});

Deno.test('toKonektAccount : types d’avant par fournisseur, sans contrats pas d’abonnements, jamais d’exception', () => {
  const type = (provider: string) => toKonektAccount({ id: 'acc_1', provider, status: 'running' }).type;
  strictEqual(type('linkedin'), 'LINKEDIN');
  strictEqual(type('google'), 'GOOGLE_OAUTH');
  strictEqual(type('outlook'), 'OUTLOOK');
  strictEqual(type('imap'), 'MAIL');
  strictEqual(type('whatsapp'), 'WHATSAPP');
  strictEqual(type('nouveau'), 'NOUVEAU');
  strictEqual(toKonektAccount({ id: 'acc_1' }).subscriptions, null);
  deepStrictEqual(toKonektAccount({ id: 'acc_1' }, { contracts: [] }).subscriptions, { classic: true, recruiter: false, sales_navigator: false });
  for (const bad of [null, undefined, 'x', 3, []]) {
    const account = toKonektAccount(bad);
    strictEqual(account.id, null);
    strictEqual(account.status, 'ERROR');
    strictEqual(account.sendable, false);
  }
});

// ---------------------------------------------------------------------------
// Crédits InMail
// ---------------------------------------------------------------------------

Deno.test('toKonektInmailCredits : classic devient premium, une licence absente est null et non 0', () => {
  const balance = toKonektInmailCredits(creditsFixture.input);
  deepStrictEqual(balance, creditsFixture.expected);
  strictEqual(balance.sales_navigator, null);
  strictEqual(balance.premium, 0);
});

Deno.test('toKonektInmailCredits : tolère l’ancienne forme balance (éventuellement null) et les clés à la racine', () => {
  deepStrictEqual(toKonektInmailCredits({ object: 'InmailCreditBalance', balance: { premium: 3, recruiter: 1 } }), { premium: 3, recruiter: 1, sales_navigator: null });
  deepStrictEqual(toKonektInmailCredits({ balance: null }), { premium: null, recruiter: null, sales_navigator: null });
  deepStrictEqual(toKonektInmailCredits({ premium: 5, recruiter: 0, sales_navigator: 2 }), { premium: 5, recruiter: 0, sales_navigator: 2 });
  deepStrictEqual(toKonektInmailCredits({ credits: { classic: '5', recruiter: NaN } }), { premium: null, recruiter: null, sales_navigator: null });
  for (const bad of [null, undefined, 'x', 7, []]) {
    deepStrictEqual(toKonektInmailCredits(bad), { premium: null, recruiter: null, sales_navigator: null });
  }
});

Deno.test('pickInmailProduct : recruiter, puis sales navigator, puis classic, le premier avec des crédits', () => {
  strictEqual(pickInmailProduct({ premium: 4, recruiter: 1, sales_navigator: 9 }), 'recruiter');
  strictEqual(pickInmailProduct({ premium: 4, recruiter: 0, sales_navigator: 9 }), 'sales_navigator');
  strictEqual(pickInmailProduct({ premium: 4, recruiter: null, sales_navigator: null }), 'classic');
  strictEqual(pickInmailProduct({ premium: 0, recruiter: 0, sales_navigator: 0 }), null);
  strictEqual(pickInmailProduct({ premium: null, recruiter: null, sales_navigator: null }), null);
});

Deno.test('les fixtures sont marquées : base du schéma et points déduits', () => {
  for (const fixture of [profileFull, profileMinimal, profileRecruiter, accountFixture, creditsFixture]) {
    strictEqual(fixture._meta.basis, 'schema-derived');
    strictEqual(fixture._meta.values, 'synthetic');
  }
  ok(Array.isArray((profileFull._meta as { inferred?: string[] }).inferred));
});
