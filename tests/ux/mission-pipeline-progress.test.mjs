import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const { code } = transformSync(readFileSync('src/lib/missionPipelineProgress.ts', 'utf8'), { loader: 'ts', format: 'esm' });
const { missionPipelineProgress, MISSION_PIPELINE_STAGES } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const empty = { unopened: 0, toSort: 0, retained: 0, contacted: 0, replied: 0, interviewing: 0, hired: 0, rejected: 0 };

test('The dot shows the furthest current stage even when most candidates are earlier in the pipeline', () => {
  for (const stage of MISSION_PIPELINE_STAGES) {
    const result = missionPipelineProgress({ ...empty, toSort: 99, [stage.key]: 1 });
    assert.equal(result.key, stage.key);
    assert.equal(result.count, 1);
    assert.equal(result.color, stage.color);
  }
  assert.equal(missionPipelineProgress({ ...empty, replied: 4, interviewing: 2, hired: 1 }).key, 'hired');
});

test('Historical totals and discarded candidates never overstate current progress', () => {
  const result = missionPipelineProgress({ ...empty, retained: 2, rejected: 100, everHired: 8, everInterviewed: 14 });
  assert.equal(result.key, 'retained');
  assert.equal(result.count, 2);
  assert.equal(missionPipelineProgress({ ...empty, rejected: 4 }).label, 'Aucun candidat actif');
  assert.equal(missionPipelineProgress({ ...empty, unopened: 10, rejected: 4 }).key, 'sourcing');
});

test('Unknown data is distinct from an empty pipeline and never receives a progress color', () => {
  for (const counts of [undefined, null]) {
    assert.deepEqual(missionPipelineProgress(counts), { key: 'unknown', label: 'Avancement indisponible', color: null, count: null });
  }
  assert.equal(missionPipelineProgress(empty).key, 'empty');
  assert.equal(missionPipelineProgress({ ...empty, unopened: 8 }).count, 8);
});

test('The dot follows a candidate advancing or moving back out of the last advanced stage', () => {
  const counts = { ...empty, retained: 3 };
  assert.equal(missionPipelineProgress(counts).key, 'retained');
  counts.retained -= 1;
  counts.contacted += 1;
  assert.equal(missionPipelineProgress(counts).key, 'contacted');
  counts.contacted -= 1;
  counts.retained += 1;
  assert.equal(missionPipelineProgress(counts).key, 'retained');
});
