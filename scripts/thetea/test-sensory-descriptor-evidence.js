#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const filename = path.join(__dirname, '../../docs/evidence/2026-09-21/sensory-descriptor-evidence.json');
const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
const ids = report.descriptors.map(item => item.id);

assert.strictEqual(report.status, 'review-required');
assert.strictEqual(report.publishAllowed, false);
assert.deepStrictEqual(ids, ['Be', 'Ch', 'Cz', 'Dt', 'H', 'L', 'Li', 'Lm', 'Mn', 'Mw', 'O', 'Pc', 'Rb', 'Sb', 'Se']);
assert.deepStrictEqual(report.intensity.observedDomainInSnapshot, [1, 2, 3, 4, 5]);
assert.strictEqual(report.intensity.status, 'unresolved');
assert.strictEqual(report.intensity.scaleEvidence, null);
assert(report.descriptors.every(item => item.semanticStatus === 'review-required'));
assert(report.descriptors.some(item => item.id === 'Cz' && item.candidateLabel === 'Caramelized'));
assert(report.descriptors.some(item => item.id === 'Li' && item.candidateLabel === 'Lichee'));
assert(report.descriptors.some(item => item.id === 'Mw' && item.candidateLabel === 'Marshmallow'));

console.log('test-sensory-descriptor-evidence: ok');
