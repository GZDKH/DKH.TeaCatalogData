#!/usr/bin/env node
const assert = require('assert');
const http = require('http');
const {
    REPAIR_ATTRIBUTE_CODES,
    TARGET_GROUP,
    assertLiveReferenceUnchanged,
    buildRepairPlan,
    requestImport,
    verifyApplied,
} = require('./repair-puerh-spec-groups');

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';

function attribute(code, group = null) {
    return {
        code,
        group,
        type: 'Option',
        order: 1,
        published: true,
        filterable: true,
        comparable: false,
        translations: [{ lang: 'en-US', name: code }],
    };
}

const targetGroup = {
    code: TARGET_GROUP,
    icon: 'list-checks',
    order: 2,
    published: true,
    collapsible: true,
    expanded: true,
    translations: [{ lang: 'en-US', name: 'Core Tea Facts' }],
};
const reference = {
    specificationGroups: [targetGroup],
    specificationAttributes: REPAIR_ATTRIBUTE_CODES.map(code => attribute(code)),
};
const products = [
    {
        code: 'TEA-ONE',
        specifications: [
            { attribute: REPAIR_ATTRIBUTE_CODES[0] },
            { attribute: REPAIR_ATTRIBUTE_CODES[1] },
        ],
    },
    {
        code: 'TEA-TWO',
        specifications: [{ attribute: REPAIR_ATTRIBUTE_CODES[0] }],
    },
];

const plan = buildRepairPlan(reference, products);
assert.deepStrictEqual(plan.counts, { update: 7, noop: 0, conflict: 0 });
assert.strictEqual(plan.affectedProductCount, 2);
assert.strictEqual(plan.affectedSpecificationValueCount, 3);
assert(plan.desiredAttributes.every(item => item.group === TARGET_GROUP));
assert(plan.rollbackAttributes.every(item => item.group === null));
assert(plan.operations.every(item =>
    item.action === 'update' && JSON.stringify(item.changedFields) === '["group"]'));

const partiallyApplied = {
    ...reference,
    specificationAttributes: reference.specificationAttributes.map((item, index) =>
        index === 0 ? { ...item, group: TARGET_GROUP } : item),
};
const partiallyAppliedPlan = buildRepairPlan(partiallyApplied, products);
assert.deepStrictEqual(partiallyAppliedPlan.counts, { update: 6, noop: 1, conflict: 0 });

const conflicting = {
    ...reference,
    specificationAttributes: reference.specificationAttributes.map((item, index) =>
        index === 0 ? { ...item, group: 'SPEC-OTHER' } : item),
};
assert.strictEqual(buildRepairPlan(conflicting, products).counts.conflict, 1);
assert.throws(
    () => buildRepairPlan({ specificationGroups: [], specificationAttributes: [] }, products),
    /Target specification group/);
assert.throws(
    () => buildRepairPlan({}, products),
    /complete specificationGroups/);

assert.doesNotThrow(() => assertLiveReferenceUnchanged(
    plan,
    reference.specificationAttributes,
    reference.specificationGroups));
assert.throws(
    () => assertLiveReferenceUnchanged(
        plan,
        reference.specificationAttributes.map((item, index) =>
            index === 0 ? { ...item, published: false } : item),
        reference.specificationGroups),
    /differs from the immutable catalog reference/);

const applied = plan.desiredAttributes.map(item => ({ ...item }));
assert.doesNotThrow(() => verifyApplied(plan, applied));
assert.throws(
    () => verifyApplied(plan, applied.map((item, index) =>
        index === 0 ? { ...item, published: false } : item)),
    /non-group field changed/);

async function testRequestImport() {
    let invalid = false;
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            assert.strictEqual(request.method, 'POST');
            assert.strictEqual(request.headers.authorization, 'Bearer test-token');
            assert.strictEqual(request.headers['x-workspace-id'], WORKSPACE_ID);
            const body = Buffer.concat(chunks).toString('utf8');
            assert(body.includes('specification_attributes'));
            assert(body.includes(REPAIR_ATTRIBUTE_CODES[0]));
            response.setHeader('Content-Type', 'application/json');
            if (request.url.endsWith('/validate')) {
                response.end(JSON.stringify(invalid
                    ? { valid: false, totalRecords: 1, validRecords: 0, errors: [{ field: 'group', message: 'invalid' }] }
                    : { valid: true, totalRecords: 1, validRecords: 1, errors: [], warnings: [] }));
            } else {
                response.end(JSON.stringify({ processed: 1, failed: 0, errors: [] }));
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const gatewayUrl = `http://127.0.0.1:${server.address().port}`;
        await requestImport(gatewayUrl, 'test-token', WORKSPACE_ID, [plan.desiredAttributes[0]], true);
        await requestImport(gatewayUrl, 'test-token', WORKSPACE_ID, [plan.desiredAttributes[0]], false);
        invalid = true;
        await assert.rejects(
            requestImport(gatewayUrl, 'test-token', WORKSPACE_ID, [plan.desiredAttributes[0]], true),
            /group: invalid/);
    } finally {
        await new Promise((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve()));
    }
}

testRequestImport()
    .then(() => console.log('test-repair-puerh-spec-groups: OK'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
