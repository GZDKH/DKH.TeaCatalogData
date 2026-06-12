#!/usr/bin/env node
const assert = require('assert');
const {
    isLegacyJunkSpecificationAttribute,
    isLegacyJunkSpecificationGroup,
} = require('./lib/cleanup-junk');

assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: 'SPEC-TT-MARKDOWN-LV' }), true);
assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: 'SPEC-TT-SIMILAR-RU-RU' }), true);
assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: 'SPEC-TT-FIELD-PRODUCTION-PRODUCTION-X1' }), true);
assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: 'SPEC-TT-FIELD-DETAIL-BOTANY-MATERIAL-BOTANY-MATERIAL-X7' }), true);
assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: 'SPEC-TT-FIELD-BOTANY-MATERIAL-CULTIVAR' }), false);
assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: 'SPEC-TT-GROUP-MARKDOWN' }), false);
assert.strictEqual(isLegacyJunkSpecificationAttribute({ code: '' }), false);

assert.strictEqual(isLegacyJunkSpecificationGroup({ code: 'SPEC-TT-GROUP-MARKDOWN' }), true);
assert.strictEqual(isLegacyJunkSpecificationGroup({ code: 'SPEC-TT-GROUP-RELATED' }), true);
assert.strictEqual(isLegacyJunkSpecificationGroup({ code: 'SPEC-TT-GROUP-EXT-17' }), true);
assert.strictEqual(isLegacyJunkSpecificationGroup({ code: 'SPEC-TT-GROUP-PRODUCTION' }), false);
assert.strictEqual(isLegacyJunkSpecificationGroup({ code: 'SPEC-TT-MARKDOWN-LV' }), false);

console.log('test-cleanup-junk: OK');
