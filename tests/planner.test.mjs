import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeInput } from '../src/core/contracts.mjs';
import { plan } from '../src/core/planner.mjs';

const cases = JSON.parse(readFileSync(new URL('./fixtures/economy.json', import.meta.url)));
for (const fixture of cases) test(fixture.id, () => {
  const input = makeInput({ bank: fixture.bank, passive: fixture.income,
    commitment: fixture.commitment ? { targetId: fixture.commitment, status: 'saving' } : null,
    offers: fixture.offers.map(([id, price, gain]) => ({ id, kind: id.split(':')[0], targetId: Number(id.split(':')[1]), price,
      effect: { flatPassive: gain }, priority: false, critical: false })) });
  const before = JSON.stringify(input);
  const result = plan(input);
  assert.equal(result.selectedAction.id, fixture.expected);
  if (fixture.target) assert.equal(result.nextCommitment.targetId, fixture.target);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.finalLayer, 'planner');
});
