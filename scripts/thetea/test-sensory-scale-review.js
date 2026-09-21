#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const filename = path.join(__dirname, '../../docs/evidence/2026-09-22/sensory-scale-review.json');
const report = JSON.parse(fs.readFileSync(filename, 'utf8'));

assert.strictEqual(report.status, 'owner-approval-required');
assert.strictEqual(report.publishAllowed, false);
assert.deepStrictEqual(report.source.observedDomain, [1, 2, 3, 4, 5]);
assert.strictEqual(report.source.missingValueMeaning, 'descriptor absent from the source array; it is not zero');
assert.strictEqual(report.decision.scaleId, null);
assert.strictEqual(report.decision.normalization, null);
assert.strictEqual(report.nonEquivalentScaleEvidence[0].observedScale.max, 10);
assert(report.requiredOwnerApproval.length >= 5);

console.log('test-sensory-scale-review: ok');
