#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const filename = path.join(__dirname, '../../docs/evidence/2026-09-22/sensory-scale-review.json');
const report = JSON.parse(fs.readFileSync(filename, 'utf8'));

assert.strictEqual(report.status, 'approved-source-native-scale');
assert.strictEqual(report.publishAllowed, true);
assert.strictEqual(report.publishPolicy, 'source-native-values-only');
assert.deepStrictEqual(report.source.descriptorIds, ['Be', 'Ch', 'Cz', 'Dt', 'H', 'L', 'Li', 'Lm', 'Mn', 'Mw', 'O', 'Pc', 'Rb', 'Sb', 'Se']);
assert.deepStrictEqual(report.source.observedDomain, [1, 2, 3, 4, 5]);
assert.strictEqual(report.source.missingValueMeaning, 'descriptor absent from the source array; it is not zero');
assert.strictEqual(report.decision.scaleId, 'thetea-native-intensity');
assert.strictEqual(report.decision.version, 1);
assert.strictEqual(report.decision.kind, 'ordinal');
assert.strictEqual(report.decision.min, 1);
assert.strictEqual(report.decision.max, 5);
assert.strictEqual(report.decision.zeroMeaning, 'invalid; absence is unknown');
assert.strictEqual(report.decision.anchors, null);
assert.strictEqual(report.decision.normalization, null);
assert.strictEqual(report.nonEquivalentScaleEvidence[0].observedScale.max, 10);
assert.strictEqual(report.approval.status, 'approved');
assert.strictEqual(report.approval.authority, 'catalog-owner');

console.log('test-sensory-scale-review: ok');
