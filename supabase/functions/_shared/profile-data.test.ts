// ProfileData (ce que lit le scoring) construit depuis un profil normalisé de l'API v2 du prestataire :
// le contrat du profil LinkedIn de Konekt est tenu par le normaliseur, donc aucune section ne devient
// « [object Object] », aucune date ne disparaît et la distance de réseau reste un nombre.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/profile-data.test.ts

import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import profileFull from './unipile/fixtures/profile-full.json' with { type: 'json' };
import profileMinimal from './unipile/fixtures/profile-minimal.json' with { type: 'json' };
import { toKonektProfile } from './unipile/normalize/profile.ts';
import { buildProfileData } from './profile-data.ts';

Deno.test('buildProfileData : profil complet de l’API v2', () => {
  const data = buildProfileData(toKonektProfile(profileFull.input));
  strictEqual(data.id, 'ACoAAB1234567');
  strictEqual(data.providerId, 'ACoAAB1234567');
  strictEqual(data.name, 'Marie Dupont');
  strictEqual(data.headline, 'Directrice Produit chez Acme | SaaS B2B');
  strictEqual(data.currentRole, 'Directrice Produit');
  strictEqual(data.currentCompany, 'Acme', 'la société est un texte');
  strictEqual(data.profileUrl, 'https://www.linkedin.com/in/marie-dupont-123');
  strictEqual(data.summary.startsWith('Dix ans'), true);
  strictEqual(data.networkDistance, 2, 'SECOND_DEGREE devient 2');
  strictEqual(data.openToWork, true);
  strictEqual(data.openProfile, true);
  strictEqual(data.isHiring, true);
  strictEqual(data.connectionsCount, 500);
  strictEqual(data.sharedConnectionsCount, 12);
  deepStrictEqual(data.education, ['HEC Paris - Master - Management, Finance (2011)']);
  deepStrictEqual(data.pastPositions, ['Cheffe de produit chez Beta SAS']);
  deepStrictEqual(data.skills, ['Product Management', 'SaaS']);
  deepStrictEqual(data.certifications, [{ name: 'PSPO I', organization: 'Scrum.org' }]);
  deepStrictEqual(data.recommendations, [{
    text: 'Une cheffe de produit remarquable, rigoureuse et à l’écoute.',
    author: 'Paul Martin',
    authorHeadline: 'CEO chez Acme',
  }]);
  deepStrictEqual(data.volunteering[0], { role: 'Bénévole', company: 'Croix-Rouge', description: 'Aide aux sans-abri' });
  ok(!JSON.stringify(data).includes('[object Object]'));
});

Deno.test('buildProfileData : les dates « MM/DD/YYYY » du prestataire donnent des durées et une expérience calculée', () => {
  const data = buildProfileData(toKonektProfile(profileFull.input));
  const [current, past] = data.workExperience;
  ok(current.durationMonths > 60, 'poste en cours depuis 03/2019');
  strictEqual(past.durationMonths, 53, '09/2014 à 02/2019');
  strictEqual(past.duration, '4 ans 5 mois');
  strictEqual(data.experienceAssessment.source, 'work');
  strictEqual(data.experienceAssessment.complete, true);
  ok(data.yearsOfExperience >= 12);
  ok(data.averageTenureMonths > 0);
});

Deno.test('buildProfileData : profil minimal, rien d’obligatoire ne manque', () => {
  const data = buildProfileData(toKonektProfile(profileMinimal.input));
  strictEqual(typeof data.id, 'string');
  strictEqual(data.workExperience, undefined);
  deepStrictEqual(data.education, []);
  strictEqual(data.yearsOfExperience, null);
});
