import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const now = new Date('2026-10-09T12:00:00Z');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
  static now() { return now.getTime(); }
}
const plain = value => JSON.parse(JSON.stringify(value));
function compile(path, globals = {}, suffix = '') {
  const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '');
  const { outputText, diagnostics } = ts.transpileModule(source + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const context = { exports: {}, Date: FixedDate, console, ...globals };
  vm.runInNewContext(outputText, context, { filename: path });
  return context.exports;
}
const experience = compile('supabase/functions/_shared/profile-experience.ts');
const dates = compile('src/components/outreach/dateUtils.ts');
const browser = compile('src/hooks/useLinkedInScoring.ts', { ...experience, ...dates });
const worker = compile('supabase/functions/_shared/profile-data.ts', experience);
const filters = compile('src/components/outreach/calculateExperience.ts', experience);
const identity = compile('src/lib/scoringResultIdentity.ts');
const card = compile('src/components/outreach/result-card/useProfileData.ts', { ...experience, ...dates, useMemo: fn => fn() });
const score = compile('supabase/functions/score-profile-job/index.ts', {
  ...experience,
  Deno: { env: { get: () => undefined }, serve() {} },
}, '\nexports.hard = applyHardFilters; exports.weighted = computeWeightedScore; exports.prompt = buildProfileSection;');
const base = { id: 'profile-a', name: 'Camille', headline: 'Engineer' };

test('a recent diploma never resets a dated career, and workers receive the same evidence', () => {
  const profile = { ...base, work_experience: [{ role: 'Engineer', start: '2010-01', end: '2020-01' },
    { role: 'Lead', start: '2021-01', current: true }], education: [{ degree: 'MBA', end: '2025' }] };
  const front = browser.buildProfileData(profile);
  const back = worker.buildProfileData(profile);
  assert.equal(front.yearsOfExperience, 15);
  assert.deepEqual(plain(front.experienceAssessment), plain(back.experienceAssessment));
  assert.equal(front.yearsOfExperience, back.yearsOfExperience);
  assert.equal(front.averageTenureMonths, back.averageTenureMonths);
  assert.equal(front.experienceAssessment.months, 189);
  assert.match(card.useProfileData(profile).totalExperience, /15 ans d'exp\./);
});

test('simultaneous jobs, duplicates, gaps and closed careers do not inflate duration', () => {
  const profile = { ...base, work_experience: [
    { start: '2010-01', end: '2015-01' }, { start: '2012-01', end: '2016-01' },
    { start: '2010-01', end: '2015-01' }, { start: '2020-01', end: '2022-01' },
  ] };
  const result = experience.assessProfileExperience(profile, now);
  assert.equal(result.months, 96);
  assert.equal(result.years, 8);
  assert.equal(result.complete, true);
});

test('incomplete, missing, impossible and future dates stay neutral rather than inventing a junior career', async () => {
  for (const work_experience of [[], [{ current: true }], [{ start: '2030-01' }],
    [{ start: '2020-13', end: '2024-01' }], [{ start: '2024-01', end: '2020-01' }],
    [{ start: '2020-01', current: false }], [{ start: '2020-01', end: '2022-01' }, { role: 'Past role without dates' }]]) {
    const profile = { ...base, work_experience };
    const data = browser.buildProfileData(profile);
    assert.equal(data.yearsOfExperience, null);
    assert.equal((await score.hard(data, { id: 'job', title: 'Lead', skills: [], xpMin: 10 })).passed, true);
    assert.equal(score.weighted(data, { id: 'job', title: 'Lead', skills: [], xpMin: 10 }).experienceMatchKind, 'incertain');
    assert.equal(experience.matchesCalculatedExperience(profile, 10, 12, now), true);
  }
});

test('education-only fallback is explicit in UI and model input, and cannot reject candidates', async () => {
  const profile = { ...base, education: [{ degree: 'Master', end: '2025' }] };
  const data = worker.buildProfileData(profile);
  assert.equal(data.yearsOfExperience, null);
  assert.equal(data.experienceAssessment.source, 'education');
  assert.match(card.useProfileData(profile).totalExperience, /Formation 2025 · XP à vérifier/);
  assert.equal((await score.hard(data, { id: 'job', title: 'Lead', skills: [], xpMin: 10 })).passed, true);
  const prompt = score.prompt(data, { weightedScore: 50, dimensions: {}, matchedSkills: [], missingSkills: [] }, 0);
  assert.match(prompt, /XP: à vérifier/);
  assert.match(prompt, /durée travaillée inconnue/);
  assert.doesNotMatch(prompt, /XP: 1 ans/);
});

test('year-only dates retain uncertainty near experience cutoffs', async () => {
  const profile = { ...base, work_experience: [{ start: '2019', end: '2026' }] };
  const data = browser.buildProfileData(profile);
  assert.equal(data.experienceAssessment.approximate, true);
  assert.equal(experience.matchesCalculatedExperience(profile, 7.5, null, now), true);
  assert.equal((await score.hard(data, { id: 'job', title: 'Lead', skills: [], xpMin: 10 })).passed, true);
  assert.equal(experience.matchesCalculatedExperience(profile, 9, null, now), false);
  const nearCutoff = score.weighted(data, { id: 'job', title: 'Engineer', skills: [], xpMin: 7.5, xpMax: 9 });
  assert.equal(nearCutoff.experienceMatchKind, 'incertain');
  assert.equal(nearCutoff.dimensions.seniority.score, 50);
});

test('maximum-only and combined experience filters work, unknown experience remains visible', () => {
  const profiles = [
    { ...base, id: 'junior', work_experience: [{ start: '2023-01', end: '2025-01' }] },
    { ...base, id: 'senior', work_experience: [{ start: '2010-01', end: '2020-01' }] },
    { ...base, id: 'unknown' },
  ];
  assert.deepEqual(plain(filters.filterByCalculatedExperience(profiles, null, 5).map(p => p.id)), ['junior', 'unknown']);
  assert.deepEqual(plain(filters.filterByCalculatedExperience(profiles, 8, 12).map(p => p.id)), ['senior', 'unknown']);
  assert.equal(filters.filterByCalculatedExperience(profiles, null, null), profiles);
});

test('legacy current and past position fields share exactly the same career calculation', () => {
  const legacy = { current_positions: [{ start: { year: 2020, month: 1 } }],
    past_positions: [{ start: '2010-01', end: '2015-01' }] };
  const normalized = { work_experience: [{ start: { year: 2020, month: 1 }, current: true },
    { start: '2010-01', end: '2015-01', current: false }] };
  const legacyExperience = experience.assessProfileExperience(legacy, now);
  const normalizedExperience = experience.assessProfileExperience(normalized, now);
  assert.equal(legacyExperience.months, normalizedExperience.months);
  assert.equal(legacyExperience.complete, false, 'position summaries do not prove the full earlier career');
  assert.equal(experience.matchesCalculatedExperience(legacy, 20, null, now), true);
});

test('malformed provider arrays or entries remain unknown rather than crashing a search or worker', () => {
  for (const profile of [null, { work_experience: 'invalid' }, { work_experience: [null, 42], education: [null] },
    { current_positions: 'invalid', past_positions: {} }, { education: [null, { end: '2025-99' }] }]) {
    assert.equal(experience.assessProfileExperience(profile, now).source, 'unknown');
    assert.equal(experience.matchesCalculatedExperience(profile, 5, 10, now), true);
  }
});

test('out-of-order results are matched solely by ID; unknown, absent and duplicate identities remain retryable', () => {
  const profiles = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const results = [{ profile_id: 'b', score: 92 }, { score: 12 }, { profile_id: 'foreign', score: 99 },
    { profile_id: 'a', score: 84 }, { profile_id: 'c', score: 55 }, { profile_id: 'c', score: 65 }, null];
  const matched = identity.matchScoringResultsById(profiles, results);
  assert.deepEqual(plain(matched.map(({ profile, result }) => [profile.id, result.score])), [['b', 92], ['a', 84]]);
  const notedIds = new Set(matched.map(({ profile }) => profile.id));
  assert.deepEqual(profiles.filter(profile => !notedIds.has(profile.id)).map(profile => profile.id), ['c', 'd']);
  assert.equal(identity.matchScoringResultsById([{ id: 'a' }, { id: 'a' }], [{ profile_id: 'a' }]).length, 0);
  assert.deepEqual(plain(identity.matchScoringResultsById([{ id: 'c' }], [{ profile_id: 'c', score: 75 }]))[0].result.score, 75);
});
