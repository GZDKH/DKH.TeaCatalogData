'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./lib/artifacts');
const {
    CommerceGrpcurlClient,
} = require('./lib/commerce-grpcurl-client');
const {
    buildProtoClosure,
} = require('./lib/proto-closure');
const {
    METHODS,
    buildCanaryEnvelope,
    publishCanary,
} = require('./lib/commerce-publication');
const {
    acquireApplyLock,
    initializeApplyReceipt,
    releaseApplyLock,
    runCommercePublisher,
} = require('./publish-commerce-observations');

const PARTICIPANT_ID = '11111111-2222-4333-8444-555555555555';
const CHANNEL_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const IMPORT_ID = '99999999-8888-4777-8666-555555555555';
const OBSERVED_AT = '2026-07-28T03:00:00.000Z';

function projection() {
    return {
        schemaVersion: 'catalog-source-observation-projection-v1',
        inputEvidence: {
            artifactFile: 'catalog-source-artifact-v1.fixture.json',
            artifactSha256: 'a'.repeat(64),
            checkpointFile: 'source-checkpoint.json',
            checkpointSha256: 'b'.repeat(64),
            rawPayloadDigest: 'c'.repeat(64),
            semanticDigest: 'd'.repeat(64),
        },
        source: {
            id: 'fixture-source',
            connectorVersion: 'fixture-connector-v1',
            parserVersion: 'fixture-parser-v1',
        },
        snapshot: {
            id: 'fixture-snapshot',
            observedAt: OBSERVED_AT,
        },
        itemCount: 2,
        items: [
            projectedItem('7'),
            projectedItem('42'),
        ],
        deletionCount: 0,
        deletions: [],
        authoritativeReferencesIncluded: false,
        reconciliationComplete: false,
        productionWrites: false,
    };
}

function projectedItem(externalId) {
    return {
        externalId,
        idempotencyKey: `fixture.${externalId}`,
        observation: {
            externalId,
            semanticRevisionDigest: sha256(`semantic-${externalId}`),
            listPayloadDigest: sha256(`list-${externalId}`),
            detailPayloadDigest: sha256(`detail-${externalId}`),
            localizedText: [{
                languageCode: 'en-US',
                title: `Fixture ${externalId}`,
                description: 'Tea catalog facts — year: 2025.',
            }],
            factualAttributes: [],
            sourceDestination: {
                lookupUri: `https://source.example/items/${externalId}`,
                observedAt: OBSERVED_AT,
                provenanceDigest: sha256(`destination-${externalId}`),
            },
            packageComponents: [],
            packageComponentsExact: false,
            imageUris: [],
            referencePrices: [],
            diagnosticCodes: [],
        },
    };
}

function bundle() {
    const value = projection();
    return {
        manifest: {
            sourceId: value.source.id,
            snapshotId: value.snapshot.id,
            itemCount: value.itemCount,
            projectionSha256: sha256(stableJson(value)),
        },
        manifestSha256: 'e'.repeat(64),
        projection: value,
    };
}

function envelope() {
    return buildCanaryEnvelope(bundle(), {
        externalId: '42',
        participantId: PARTICIPANT_ID,
        commerceChannelId: CHANNEL_ID,
        artifactSchemaVersion: 'catalog-source-artifact-v1',
    });
}

function response(state, acceptedItemCount = '0') {
    return {
        importId: { value: IMPORT_ID },
        state,
        expectedItemCount: '1',
        acceptedItemCount,
        quarantinedItemCount: '0',
    };
}

function transport(responses) {
    const calls = [];
    return {
        calls,
        async invoke(method, request) {
            calls.push({ method, request });
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return next;
        },
    };
}

function receiptMetadata(endpoint = 'commerce.example:443') {
    return {
        sanitizedTargetEndpoint: endpoint,
        tlsMode: endpoint.startsWith('127.0.0.1:')
            ? 'plaintext-loopback'
            : 'tls-system-ca',
        protoFile:
            'commerce_network/api/catalog_source_ingestion/v1/' +
            'catalog_source_ingestion_admin_service.proto',
        protoSha256: 'f'.repeat(64),
        contractClosureSha256: '1'.repeat(64),
        contractFileCount: 4,
        contractFileListSha256: '2'.repeat(64),
        contractBuiltInImportCount: 1,
        contractBuiltInImportListSha256: '3'.repeat(64),
    };
}

function latestReceiptLocation(applyDirectory) {
    const latest = readJson(path.join(applyDirectory, 'latest.json'));
    const receiptFile = path.join(
        applyDirectory,
        ...latest.receiptFile.split('/'),
    );
    return {
        latest,
        receipt: readJson(receiptFile),
        receiptFile,
    };
}

async function testEnvelopeAndSequence() {
    const first = envelope();
    const second = envelope();
    assert.deepStrictEqual(second, first);
    assert.strictEqual(first.mode, 'one-item-canary');
    assert.strictEqual(first.expectedItemCount, 1);
    assert.strictEqual(first.authoritativeForDeletion, false);
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(first, 'productionWrites'),
        false,
    );
    assert.deepStrictEqual(first.planGeneration, {
        complete: true,
        networkCalls: false,
        remoteMutationAttempted: false,
    });
    assert.strictEqual(first.selection.selectedItemCount, 1);
    assert.strictEqual(first.selection.externalId, '42');
    assert.strictEqual(first.requests.begin.expectedItemCount, '1');
    assert.strictEqual(first.requests.importItem.item.externalId, '42');
    assert.ok(first.snapshot.id.startsWith('canary.'));
    assert.notStrictEqual(first.snapshot.id, first.snapshot.originalId);
    for (const request of Object.values(first.requests)) {
        assert.ok(request.command.idempotencyKey.length <= 200);
        assert.ok(request.command.idempotencyKey.includes(first.publicationDigest));
    }

    const fake = transport([
        response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
        { replayed: false },
        response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED', '1'),
    ]);
    const result = await publishCanary(first, fake);
    assert.strictEqual(result.importId, IMPORT_ID);
    assert.strictEqual(result.replayedCompletedImport, false);
    assert.deepStrictEqual(fake.calls.map(call => call.method), [
        METHODS.begin,
        METHODS.importItem,
        METHODS.commit,
    ]);
    assert.deepStrictEqual(
        fake.calls[1].request.importId,
        { value: IMPORT_ID },
    );
    assert.deepStrictEqual(
        fake.calls[2].request.importId,
        { value: IMPORT_ID },
    );

    const completed = transport([
        response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED', '1'),
    ]);
    const replay = await publishCanary(first, completed);
    assert.strictEqual(replay.replayedCompletedImport, true);
    assert.strictEqual(completed.calls.length, 1);
}

async function testFailureStops() {
    const value = envelope();
    const beginFailure = transport([new Error('begin failed')]);
    await assert.rejects(
        publishCanary(value, beginFailure),
        /begin failed/,
    );
    assert.strictEqual(beginFailure.calls.length, 1);

    const malformedBegin = transport([{
        state: 'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN',
        expectedItemCount: '1',
    }]);
    await assert.rejects(
        publishCanary(value, malformedBegin),
        /import ID/,
    );
    assert.strictEqual(malformedBegin.calls.length, 1);

    const importFailure = transport([
        response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
        new Error('item failed'),
    ]);
    await assert.rejects(
        publishCanary(value, importFailure),
        /item failed/,
    );
    assert.deepStrictEqual(importFailure.calls.map(call => call.method), [
        METHODS.begin,
        METHODS.importItem,
    ]);

    const commitFailure = transport([
        response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
        { replayed: false },
        response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_FAILED'),
    ]);
    await assert.rejects(
        publishCanary(value, commitFailure),
        /Commit returned an unsupported import state/,
    );
    assert.strictEqual(commitFailure.calls.length, 3);

    const invalidBeginAcknowledgements = [];
    await assert.rejects(
        publishCanary(
            value,
            transport([
                response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_FAILED'),
            ]),
            {
                onAcknowledged(event) {
                    invalidBeginAcknowledgements.push(event);
                },
            },
        ),
        /Begin returned an unsupported import state/,
    );
    assert.deepStrictEqual(invalidBeginAcknowledgements, []);

    const malformedCommittedAcknowledgements = [];
    await assert.rejects(
        publishCanary(
            value,
            transport([{
                ...response(
                    'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                    '0',
                ),
            }]),
            {
                onAcknowledged(event) {
                    malformedCommittedAcknowledgements.push(event);
                },
            },
        ),
        /acceptedItemCount did not match the canary contract/,
    );
    assert.deepStrictEqual(malformedCommittedAcknowledgements, []);

    const reflectedSecret = 'S'.repeat(20_000);
    for (const action of [
        () => publishCanary(value, transport([{
            ...response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
            expectedItemCount: `Bearer ${reflectedSecret}`,
        }])),
        () => publishCanary(value, transport([{
            ...response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
            state: `Bearer ${reflectedSecret.slice(0, 12_000)}`,
        }])),
        () => publishCanary(value, transport([
            response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
            { replayed: false },
            {
                ...response(
                    'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                    '1',
                ),
                state: reflectedSecret,
            },
        ])),
    ]) {
        await assert.rejects(action(), error => {
            assert.ok(error.message.length < 200);
            assert.doesNotMatch(error.message, /S{8}|Bearer/);
            return true;
        });
    }

    assert.throws(
        () => buildCanaryEnvelope(bundle(), {
            externalId: '404',
            participantId: PARTICIPANT_ID,
            commerceChannelId: CHANNEL_ID,
            artifactSchemaVersion: 'catalog-source-artifact-v1',
        }),
        /exactly one/,
    );
    assert.throws(
        () => buildCanaryEnvelope(bundle(), {
            externalId: '42',
            participantId: PARTICIPANT_ID,
            commerceChannelId: CHANNEL_ID,
            registeredSourceCode: 'different-source',
            artifactSchemaVersion: 'catalog-source-artifact-v1',
        }),
        /must exactly match/,
    );
}

function testGrpcurlClient(root) {
    const commerceProtoRoot = path.join(root, 'commerce-proto');
    const platformProtoRoot = path.join(root, 'platform-proto');
    const protoFile = path.join(
        commerceProtoRoot,
        'commerce_network',
        'api',
        'catalog_source_ingestion',
        'v1',
        'catalog_source_ingestion_admin_service.proto',
    );
    const importedProto = path.join(
        platformProtoRoot,
        'fixture',
        'dependency.proto',
    );
    fs.mkdirSync(path.dirname(protoFile), { recursive: true });
    fs.mkdirSync(path.dirname(importedProto), { recursive: true });
    fs.writeFileSync(
        protoFile,
        'syntax = "proto3";\n' +
        'import "fixture/dependency.proto";\n' +
        'import "google/protobuf/timestamp.proto";\n',
    );
    fs.writeFileSync(importedProto, 'syntax = "proto3";\nmessage Dependency {}\n');
    const environment = {
        COMMERCE_NETWORK_ADMIN_TOKEN: '  fixture-secret-token \n',
    };
    let invocation;
    const client = new CommerceGrpcurlClient({
        endpoint: 'commerce.example:443',
        timeoutSeconds: 15,
        commerceProtoRoot,
        platformProtoRoot,
        environment,
        spawn(executable, args, options) {
            invocation = { executable, args, options };
            return {
                status: 0,
                stdout: '{"state":"ok"}',
                stderr: '',
            };
        },
    });
    assert.deepStrictEqual(
        client.invoke(METHODS.begin, { fixture: true }),
        { state: 'ok' },
    );
    assert.strictEqual(invocation.executable, 'grpcurl');
    assert.ok(invocation.args.includes('-expand-headers'));
    assert.ok(invocation.args.includes(
        'Authorization: Bearer ${COMMERCE_NETWORK_ADMIN_TOKEN}',
    ));
    assert.ok(!invocation.args.join(' ').includes('fixture-secret-token'));
    assert.strictEqual(invocation.options.input, '{"fixture":true}');
    assert.strictEqual(
        invocation.options.env.COMMERCE_NETWORK_ADMIN_TOKEN,
        'fixture-secret-token',
    );
    const firstMetadata = client.getReceiptMetadata();
    assert.strictEqual(firstMetadata.sanitizedTargetEndpoint, 'commerce.example:443');
    assert.strictEqual(firstMetadata.tlsMode, 'tls-system-ca');
    assert.strictEqual(firstMetadata.contractFileCount, 2);
    assert.strictEqual(firstMetadata.contractBuiltInImportCount, 1);
    assert.strictEqual(
        firstMetadata.protoSha256,
        sha256(fs.readFileSync(protoFile)),
    );
    assert.match(firstMetadata.contractClosureSha256, /^[a-f0-9]{64}$/);
    assert.match(firstMetadata.contractFileListSha256, /^[a-f0-9]{64}$/);
    fs.writeFileSync(
        importedProto,
        'syntax = "proto3";\nmessage Dependency { string changed = 1; }\n',
    );
    assert.throws(
        () => client.invoke(METHODS.begin, { fixture: true }),
        /proto closure changed after apply preflight/,
    );
    const changedClient = new CommerceGrpcurlClient({
        endpoint: 'commerce.example:443',
        timeoutSeconds: 15,
        commerceProtoRoot,
        platformProtoRoot,
        environment,
    });
    const changedMetadata = changedClient.getReceiptMetadata();
    assert.strictEqual(changedMetadata.protoSha256, firstMetadata.protoSha256);
    assert.strictEqual(
        changedMetadata.contractFileListSha256,
        firstMetadata.contractFileListSha256,
    );
    assert.notStrictEqual(
        changedMetadata.contractClosureSha256,
        firstMetadata.contractClosureSha256,
    );

    const failing = new CommerceGrpcurlClient({
        endpoint: 'commerce.example:443',
        timeoutSeconds: 15,
        commerceProtoRoot,
        platformProtoRoot,
        environment,
        spawn() {
            return {
                status: 1,
                stdout: '',
                stderr: 'request rejected fixture-secret-token',
            };
        },
    });
    assert.throws(
        () => failing.invoke(METHODS.begin, {}),
        error => {
            assert.match(error.message, /\[REDACTED_TOKEN\]/);
            assert.doesNotMatch(error.message, /fixture-secret-token/);
            return true;
        },
    );
    assert.throws(
        () => new CommerceGrpcurlClient({
            endpoint: 'commerce.example:5000',
            timeoutSeconds: 15,
            plaintext: true,
            commerceProtoRoot,
            platformProtoRoot,
            environment,
        }),
        /restricted to a loopback endpoint/,
    );
    const loopback = new CommerceGrpcurlClient({
        endpoint: '127.0.0.1:5000',
        timeoutSeconds: 15,
        plaintext: true,
        commerceProtoRoot,
        platformProtoRoot,
        environment,
    });
    assert.strictEqual(
        loopback.getReceiptMetadata().tlsMode,
        'plaintext-loopback',
    );

    const longToken = 'Z'.repeat(20_000);
    const longTokenClient = new CommerceGrpcurlClient({
        endpoint: 'commerce.example:443',
        timeoutSeconds: 15,
        commerceProtoRoot,
        platformProtoRoot,
        environment: {
            COMMERCE_NETWORK_ADMIN_TOKEN: longToken,
        },
        spawn() {
            return {
                status: 1,
                stdout: '',
                stderr: `${longToken}${'x'.repeat(20_000)}`,
            };
        },
    });
    assert.throws(
        () => longTokenClient.invoke(METHODS.begin, {}),
        error => {
            assert.doesNotMatch(error.message, /Z{8}/);
            assert.match(error.message, /\[REDACTED_TOKEN\]/);
            assert.match(error.message, /\[TRUNCATED\]/);
            return true;
        },
    );

    const partialTokenClient = new CommerceGrpcurlClient({
        endpoint: 'commerce.example:443',
        timeoutSeconds: 15,
        commerceProtoRoot,
        platformProtoRoot,
        environment: {
            COMMERCE_NETWORK_ADMIN_TOKEN: longToken,
        },
        spawn() {
            return {
                status: 1,
                stdout: '',
                stderr:
                    `Bearer ${longToken.slice(0, 12_000)} ` +
                    `${longToken.slice(0, 256)}`,
            };
        },
    });
    assert.throws(
        () => partialTokenClient.invoke(METHODS.begin, {}),
        error => {
            assert.doesNotMatch(error.message, /Z{8}/);
            assert.match(error.message, /Bearer \[REDACTED_TOKEN\]/);
            assert.match(error.message, /\[REDACTED_TOKEN_FRAGMENT\]/);
            return true;
        },
    );

    for (const malformedOutput of [
        `Bearer ${longToken} {`,
        `{"error":"Bearer ${longToken.slice(0, 12_000)}`,
    ]) {
        const malformedSuccessClient = new CommerceGrpcurlClient({
            endpoint: 'commerce.example:443',
            timeoutSeconds: 15,
            commerceProtoRoot,
            platformProtoRoot,
            environment: {
                COMMERCE_NETWORK_ADMIN_TOKEN: longToken,
            },
            spawn() {
                return {
                    status: 0,
                    stdout: malformedOutput,
                    stderr: '',
                };
            },
        });
        assert.throws(
            () => malformedSuccessClient.invoke(METHODS.begin, {}),
            error => {
                assert.match(error.message, /returned invalid JSON\.$/);
                assert.doesNotMatch(error.message, /Z{8}|Bearer/);
                return true;
            },
        );
    }

    assert.throws(
        () => new CommerceGrpcurlClient({
            endpoint: 'commerce.example:443',
            timeoutSeconds: 15,
            commerceProtoRoot,
            platformProtoRoot,
            environment: {
                COMMERCE_NETWORK_ADMIN_TOKEN: 'invalid token',
            },
        }).invoke(METHODS.begin, {}),
        /valid bearer token/,
    );

    const closureRoot = path.join(root, 'closure-cases');
    fs.mkdirSync(closureRoot, { recursive: true });
    fs.writeFileSync(
        path.join(closureRoot, 'cycle-a.proto'),
        'syntax = "proto3";\nimport "cycle-b.proto";\n',
    );
    fs.writeFileSync(
        path.join(closureRoot, 'cycle-b.proto'),
        'syntax = "proto3";\nimport "cycle-a.proto";\n',
    );
    assert.throws(
        () => buildProtoClosure('cycle-a.proto', [closureRoot]),
        /cycle detected/,
    );
    fs.writeFileSync(
        path.join(closureRoot, 'missing.proto'),
        'syntax = "proto3";\nimport "not-found.proto";\n',
    );
    assert.throws(
        () => buildProtoClosure('missing.proto', [closureRoot]),
        /missing from allowlisted roots/,
    );
    fs.writeFileSync(
        path.join(closureRoot, 'unsafe.proto'),
        'syntax = "proto3";\nimport "../outside.proto";\n',
    );
    assert.throws(
        () => buildProtoClosure('unsafe.proto', [closureRoot]),
        /import path.*unsafe/,
    );
    fs.writeFileSync(
        path.join(root, 'outside.proto'),
        'syntax = "proto3";\n',
    );
    fs.symlinkSync(
        path.join(root, 'outside.proto'),
        path.join(closureRoot, 'linked.proto'),
    );
    assert.throws(
        () => buildProtoClosure('linked.proto', [closureRoot]),
        /rejects symlinked path/,
    );
    fs.writeFileSync(
        path.join(closureRoot, 'inline-dependency.proto'),
        'syntax = "proto3";\nmessage InlineDependency {}\n',
    );
    fs.writeFileSync(
        path.join(closureRoot, 'inline-root.proto'),
        'syntax = "proto3"; import "inline-dependency.proto"; message Root {}\n',
    );
    const inlineBefore = buildProtoClosure('inline-root.proto', [closureRoot]);
    assert.strictEqual(inlineBefore.fileCount, 2);
    fs.writeFileSync(
        path.join(closureRoot, 'inline-dependency.proto'),
        'syntax = "proto3";\nmessage InlineDependency { string changed = 1; }\n',
    );
    const inlineAfter = buildProtoClosure('inline-root.proto', [closureRoot]);
    assert.notStrictEqual(
        inlineAfter.closureSha256,
        inlineBefore.closureSha256,
    );
    fs.writeFileSync(
        path.join(closureRoot, 'malformed-import.proto'),
        'syntax = "proto3"; import public; message Root {}\n',
    );
    assert.throws(
        () => buildProtoClosure('malformed-import.proto', [closureRoot]),
        /unsupported import statement/,
    );
}

function writeProjectionBundle(root) {
    const value = projection();
    const projectionJson = stableJson(value);
    const projectionSha256 = sha256(projectionJson);
    const projectionFile =
        `catalog-source-observation-projection-v1.${projectionSha256}.json`;
    const report = {
        schemaVersion: 'catalog-source-observation-projection-report-v1',
        mode: 'dry-run',
        sourceId: value.source.id,
        snapshotId: value.snapshot.id,
        projectedItemCount: value.itemCount,
        deletionCount: 0,
        productionWriteCount: 0,
        projectionFile,
        projectionSha256,
        inputArtifactSha256: value.inputEvidence.artifactSha256,
        inputSemanticDigest: value.inputEvidence.semanticDigest,
    };
    const reportJson = stableJson(report);
    const reportSha256 = sha256(reportJson);
    const directory = path.join(root, 'projection');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, projectionFile), projectionJson);
    fs.writeFileSync(path.join(directory, 'projection-report.json'), reportJson);
    writeJsonAtomic(path.join(directory, 'projection-manifest.json'), {
        schemaVersion: 'catalog-source-observation-projection-manifest-v1',
        complete: true,
        sourceId: value.source.id,
        snapshotId: value.snapshot.id,
        itemCount: value.itemCount,
        scope: 'commerce-observation-dry-run',
        authoritativeReferencesIncluded: false,
        reconciliationComplete: false,
        productionWrites: false,
        projectionFile,
        projectionSha256,
        reportFile: 'projection-report.json',
        reportSha256,
        inputArtifactSha256: value.inputEvidence.artifactSha256,
        inputCheckpointSha256: value.inputEvidence.checkpointSha256,
    });
    return directory;
}

async function testApplyLocking(root, common, plannedEnvelope) {
    const artifactsRoot = path.join(
        root,
        'artifacts',
        'catalog-source-commerce-canaries',
    );

    const normalLockRoot = path.join(artifactsRoot, 'normal-lock-release');
    const normalLock = acquireApplyLock(normalLockRoot);
    assert.strictEqual(
        fs.existsSync(path.join(normalLockRoot, '.apply.lock')),
        true,
    );
    releaseApplyLock(normalLock);
    assert.strictEqual(
        fs.existsSync(path.join(normalLockRoot, '.apply.lock')),
        false,
    );

    const replacedLockRoot = path.join(artifactsRoot, 'replaced-lock-release');
    const replacedLock = acquireApplyLock(replacedLockRoot);
    const replacedLockFile = path.join(replacedLockRoot, '.apply.lock');
    const displacedLockFile = path.join(replacedLockRoot, 'displaced.lock');
    fs.renameSync(replacedLockFile, displacedLockFile);
    const replacementBytes = Buffer.from('replacement-lock\n');
    fs.writeFileSync(replacedLockFile, replacementBytes, { mode: 0o600 });
    assert.throws(
        () => releaseApplyLock(replacedLock),
        /inode changed/,
    );
    assert.deepStrictEqual(fs.readFileSync(replacedLockFile), replacementBytes);

    const staleOutput = path.join(artifactsRoot, 'stale-lock', 'plan');
    const staleApplyRoot = path.join(path.dirname(staleOutput), 'apply');
    const staleLock = acquireApplyLock(staleApplyRoot);
    let staleTransportCreated = false;
    try {
        await assert.rejects(
            runCommercePublisher({
                ...common,
                apply: true,
                yes: true,
                'grpc-url': 'commerce.example:443',
                out: staleOutput,
            }, {
                repositoryRoot: root,
                environment: {},
                createTransport() {
                    staleTransportCreated = true;
                    throw new Error('locked apply must not create transport');
                },
            }),
            /Apply audit root is locked/,
        );
        assert.strictEqual(staleTransportCreated, false);
        assert.strictEqual(
            fs.existsSync(path.join(staleApplyRoot, 'attempts')),
            false,
        );
        assert.strictEqual(
            fs.existsSync(path.join(staleApplyRoot, '.apply.lock')),
            true,
        );
    } finally {
        releaseApplyLock(staleLock);
    }
    assert.strictEqual(
        fs.existsSync(path.join(staleApplyRoot, '.apply.lock')),
        false,
    );

    const nonterminalOutput = path.join(
        artifactsRoot,
        'nonterminal-attempt',
        'plan',
    );
    const nonterminalApplyRoot = path.join(
        path.dirname(nonterminalOutput),
        'apply',
    );
    const nonterminalLock = acquireApplyLock(nonterminalApplyRoot);
    const nonterminalAttempt = initializeApplyReceipt(
        nonterminalApplyRoot,
        plannedEnvelope,
        receiptMetadata(),
        nonterminalLock,
    );
    releaseApplyLock(nonterminalLock);
    const nonterminalReceiptBytes = fs.readFileSync(
        nonterminalAttempt.receiptFile,
    );
    const nonterminalLatestBytes = fs.readFileSync(path.join(
        nonterminalApplyRoot,
        'latest.json',
    ));
    let nonterminalInvoked = false;
    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
            out: nonterminalOutput,
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                return {
                    getReceiptMetadata: () => receiptMetadata(),
                    invoke() {
                        nonterminalInvoked = true;
                        throw new Error('nonterminal retry must not invoke');
                    },
                };
            },
        }),
        /Previous apply attempt is non-terminal/,
    );
    assert.strictEqual(nonterminalInvoked, false);
    assert.strictEqual(
        fs.readdirSync(path.join(nonterminalApplyRoot, 'attempts')).length,
        1,
    );
    assert.deepStrictEqual(
        fs.readFileSync(nonterminalAttempt.receiptFile),
        nonterminalReceiptBytes,
    );
    assert.deepStrictEqual(
        fs.readFileSync(path.join(nonterminalApplyRoot, 'latest.json')),
        nonterminalLatestBytes,
    );
    assert.strictEqual(
        fs.existsSync(path.join(nonterminalApplyRoot, '.apply.lock')),
        false,
    );

    const overlapOutput = path.join(artifactsRoot, 'overlap', 'plan');
    const overlapApplyRoot = path.join(path.dirname(overlapOutput), 'apply');
    let markBeginStarted;
    const beginStarted = new Promise(resolve => {
        markBeginStarted = resolve;
    });
    let releaseBegin;
    const beginGate = new Promise(resolve => {
        releaseBegin = resolve;
    });
    const firstRun = runCommercePublisher({
        ...common,
        apply: true,
        yes: true,
        'grpc-url': 'commerce.example:443',
        out: overlapOutput,
    }, {
        repositoryRoot: root,
        environment: {},
        createTransport() {
            return {
                getReceiptMetadata: () => receiptMetadata(),
                async invoke(method) {
                    if (method === METHODS.begin) {
                        markBeginStarted();
                        await beginGate;
                        return response(
                            'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN',
                        );
                    }
                    if (method === METHODS.importItem) {
                        return { replayed: false };
                    }
                    if (method === METHODS.commit) {
                        return response(
                            'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                            '1',
                        );
                    }
                    throw new Error('unexpected overlap test method');
                },
            };
        },
    });
    await beginStarted;
    const overlapAttemptsRoot = path.join(overlapApplyRoot, 'attempts');
    const overlapAttemptNames = fs.readdirSync(overlapAttemptsRoot).sort();
    const overlapLatestBytes = fs.readFileSync(path.join(
        overlapApplyRoot,
        'latest.json',
    ));
    const overlapReceiptFile = latestReceiptLocation(
        overlapApplyRoot,
    ).receiptFile;
    const overlapReceiptBytes = fs.readFileSync(overlapReceiptFile);
    let overlapTransportCreated = false;
    try {
        await assert.rejects(
            runCommercePublisher({
                ...common,
                apply: true,
                yes: true,
                'grpc-url': 'commerce.example:443',
                out: overlapOutput,
            }, {
                repositoryRoot: root,
                environment: {},
                createTransport() {
                    overlapTransportCreated = true;
                    throw new Error('overlapping apply must not create transport');
                },
            }),
            /Apply audit root is locked/,
        );
        assert.strictEqual(overlapTransportCreated, false);
        assert.deepStrictEqual(
            fs.readdirSync(overlapAttemptsRoot).sort(),
            overlapAttemptNames,
        );
        assert.deepStrictEqual(
            fs.readFileSync(path.join(overlapApplyRoot, 'latest.json')),
            overlapLatestBytes,
        );
        assert.deepStrictEqual(
            fs.readFileSync(overlapReceiptFile),
            overlapReceiptBytes,
        );
    } finally {
        releaseBegin();
    }
    const completedOverlap = await firstRun;
    assert.strictEqual(
        completedOverlap.applyReceipt.attemptStatus,
        'commit-acknowledged-read-back-pending',
    );
    assert.strictEqual(
        fs.existsSync(path.join(overlapApplyRoot, '.apply.lock')),
        false,
    );
}

async function testDryRunCli(root) {
    const projectionDirectory = writeProjectionBundle(root);
    let transportCreated = false;
    const common = {
        'projection-dir': projectionDirectory,
        only: '42',
        'participant-id': PARTICIPANT_ID,
        'commerce-channel-id': CHANNEL_ID,
    };
    const dryRun = await runCommercePublisher(common, {
        repositoryRoot: root,
        environment: {},
        createTransport() {
            transportCreated = true;
            throw new Error('dry-run must not create a transport');
        },
    });
    assert.strictEqual(dryRun.mode, 'dry-run');
    assert.strictEqual(transportCreated, false);
    assert.deepStrictEqual(fs.readdirSync(dryRun.outputDirectory).sort(), [
        dryRun.plan.envelopeFile,
        'commerce-canary-manifest.json',
    ].sort());
    const manifest = readJson(path.join(
        dryRun.outputDirectory,
        'commerce-canary-manifest.json',
    ));
    assert.strictEqual(
        Object.prototype.hasOwnProperty.call(manifest, 'productionWrites'),
        false,
    );
    assert.strictEqual(manifest.planGenerationComplete, true);
    assert.strictEqual(manifest.networkCalls, false);
    assert.strictEqual(manifest.remoteMutationAttempted, false);
    assert.strictEqual(manifest.authoritativeForDeletion, false);
    assert.strictEqual(manifest.expectedItemCount, 1);

    const initializedDirectory = path.join(
        root,
        'artifacts',
        'catalog-source-commerce-canaries',
        'receipt-initialization',
    );
    const initializationLock = acquireApplyLock(initializedDirectory);
    const initialized = initializeApplyReceipt(
        initializedDirectory,
        envelope(),
        receiptMetadata(),
        initializationLock,
    );
    assert.strictEqual(initialized.receipt.mode, 'apply');
    assert.strictEqual(initialized.receipt.complete, false);
    assert.strictEqual(initialized.receipt.remoteMutationAttempted, false);
    assert.strictEqual(initialized.receipt.lastAcknowledgedStage, 'none');
    assert.strictEqual(initialized.receipt.receiptSequence, 0);
    assert.strictEqual(initialized.receipt.attemptNumber, 1);
    assert.match(initialized.attemptId, /^attempt-1-[a-f0-9]{64}$/);
    assert.match(initialized.receipt.auditBindingSha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(
        initialized.receipt.registeredSourceCode,
        'fixture-source',
    );
    releaseApplyLock(initializationLock);
    assert.strictEqual(
        fs.existsSync(path.join(initializedDirectory, '.apply.lock')),
        false,
    );

    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                transportCreated = true;
                throw new Error('must not create transport without confirmation');
            },
        }),
        /requires the separate --yes/,
    );
    assert.strictEqual(transportCreated, false);

    let invocationBeforeMetadata = false;
    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                return {
                    invoke() {
                        invocationBeforeMetadata = true;
                        throw new Error('must not invoke without receipt metadata');
                    },
                };
            },
        }),
        /receipt metadata before any remote mutation/,
    );
    assert.strictEqual(invocationBeforeMetadata, false);

    await assert.rejects(
        runCommercePublisher({
            ...common,
            'registered-source-code': 'different-source',
        }, {
            repositoryRoot: root,
            environment: {},
        }),
        /must exactly match/,
    );

    let applyCalls;
    let receiptBeforeFirstRpc;
    const applyOutput = path.join(
        root,
        'artifacts',
        'catalog-source-commerce-canaries',
        'apply-success',
        'plan',
    );
    const apply = await runCommercePublisher({
        ...common,
        apply: true,
        yes: true,
        'grpc-url': 'commerce.example:443',
        out: applyOutput,
    }, {
        repositoryRoot: root,
        environment: {},
        createTransport(options) {
            assert.strictEqual(options.endpoint, 'commerce.example:443');
            const fake = transport([
                response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
                { replayed: false },
                response(
                    'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                    '1',
                ),
            ]);
            applyCalls = fake.calls;
            const invoke = fake.invoke.bind(fake);
            fake.invoke = (...parameters) => {
                if (fake.calls.length === 0) {
                    receiptBeforeFirstRpc = latestReceiptLocation(path.join(
                        path.dirname(applyOutput),
                        'apply',
                    )).receipt;
                }
                return invoke(...parameters);
            };
            fake.getReceiptMetadata = () => receiptMetadata();
            return fake;
        },
    });
    assert.strictEqual(apply.mode, 'apply');
    assert.strictEqual(applyCalls.length, 3);
    assert.strictEqual(receiptBeforeFirstRpc.mode, 'apply');
    assert.strictEqual(receiptBeforeFirstRpc.complete, false);
    assert.strictEqual(receiptBeforeFirstRpc.remoteMutationAttempted, true);
    assert.strictEqual(receiptBeforeFirstRpc.lastAcknowledgedStage, 'none');
    assert.strictEqual(receiptBeforeFirstRpc.receiptSequence, 1);
    assert.strictEqual(apply.applyReceipt.mode, 'apply');
    assert.strictEqual(apply.applyReceipt.complete, false);
    assert.strictEqual(apply.applyReceipt.readBackVerified, false);
    assert.strictEqual(apply.applyReceipt.readBackRequired, true);
    assert.strictEqual(apply.applyReceipt.remoteMutationAttempted, true);
    assert.strictEqual(apply.applyReceipt.commitAcknowledged, true);
    assert.strictEqual(apply.applyReceipt.productionStateCommitted, true);
    assert.strictEqual(apply.applyReceipt.commitKind, 'new');
    assert.strictEqual(apply.applyReceipt.replayedCommit, false);
    assert.strictEqual(apply.applyReceipt.newCommit, true);
    assert.strictEqual(
        apply.applyReceipt.attemptStatus,
        'commit-acknowledged-read-back-pending',
    );
    assert.strictEqual(apply.applyReceipt.lastAcknowledgedStage, 'commit');
    assert.deepStrictEqual(apply.applyReceipt.acknowledgedStages, [
        'begin',
        'importItem',
        'commit',
    ]);
    assert.strictEqual(apply.applyReceipt.receiptSequence, 4);
    assert.strictEqual(apply.applyReceipt.importId, IMPORT_ID);
    assert.strictEqual(apply.applyReceipt.acceptedItemCount, '1');
    assert.strictEqual(apply.applyReceipt.commitRpcInvoked, true);
    assert.deepStrictEqual(apply.applyReceipt.target, {
        endpoint: 'commerce.example:443',
        tlsMode: 'tls-system-ca',
    });
    assert.strictEqual(
        apply.applyReceipt.contract.protoSha256,
        'f'.repeat(64),
    );
    assert.strictEqual(
        apply.applyReceipt.contract.contractClosureSha256,
        '1'.repeat(64),
    );
    assert.strictEqual(apply.applyReceipt.contract.fileCount, 4);
    assert.strictEqual(
        apply.applyReceipt.contract.fileListSha256,
        '2'.repeat(64),
    );
    assert.deepStrictEqual(apply.applyReceipt.contract.methods, [
        METHODS.begin,
        METHODS.importItem,
        METHODS.commit,
    ]);
    assert.deepStrictEqual(apply.applyReceipt.requiredReadBack, {
        registeredSourceCode: 'fixture-source',
        externalId: '42',
        semanticRevisionDigest: sha256('semantic-42'),
        referencePriceCount: 0,
        referencePricesSha256: sha256(stableJson([])),
    });
    const receiptText = stableJson(apply.applyReceipt);
    assert.doesNotMatch(receiptText, /fixture-secret-token/);
    assert.doesNotMatch(receiptText, /participantId|commerceChannelId|requests/);
    assert.strictEqual(
        fs.existsSync(path.join(apply.applyDirectory, '.apply.lock')),
        false,
    );

    await testApplyLocking(root, common, dryRun.envelope);

    const commitFaultOutput = path.join(
        root,
        'artifacts',
        'catalog-source-commerce-canaries',
        'commit-receipt-fault',
        'plan',
    );
    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
            out: commitFaultOutput,
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                const fake = transport([
                    response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
                    { replayed: false },
                    response(
                        'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                        '1',
                    ),
                ]);
                fake.getReceiptMetadata = () => receiptMetadata();
                return fake;
            },
            afterRemoteCommitAcknowledged() {
                throw new Error('fault after remote commit response');
            },
        }),
        /fault after remote commit response/,
    );
    const commitFaultReceipt = latestReceiptLocation(path.join(
        path.dirname(commitFaultOutput),
        'apply',
    )).receipt;
    assert.strictEqual(commitFaultReceipt.attemptStatus, 'failed');
    assert.strictEqual(commitFaultReceipt.lastAcknowledgedStage, 'importItem');
    assert.deepStrictEqual(commitFaultReceipt.acknowledgedStages, [
        'begin',
        'importItem',
    ]);
    assert.strictEqual(commitFaultReceipt.commitAcknowledged, false);
    assert.strictEqual(commitFaultReceipt.productionStateCommitted, false);
    assert.notStrictEqual(commitFaultReceipt.state, 'committed');
    assert.strictEqual(
        fs.existsSync(path.join(
            path.dirname(commitFaultOutput),
            'apply',
            '.apply.lock',
        )),
        false,
    );

    const failureOutput = path.join(
        root,
        'artifacts',
        'catalog-source-commerce-canaries',
        'apply-failure',
        'plan',
    );
    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
            out: failureOutput,
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                const fake = transport([
                    response('CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN'),
                    new Error('Bearer reflected-secret-token'),
                ]);
                fake.getReceiptMetadata = () => receiptMetadata();
                return fake;
            },
        }),
        /reflected-secret-token/,
    );
    const failureApplyDirectory = path.join(
        path.dirname(failureOutput),
        'apply',
    );
    const failedLocation = latestReceiptLocation(failureApplyDirectory);
    const failedReceipt = failedLocation.receipt;
    const failedReceiptBytes = fs.readFileSync(failedLocation.receiptFile);
    const failedReceiptSha256 = sha256(failedReceiptBytes);
    assert.strictEqual(failedReceipt.mode, 'apply');
    assert.strictEqual(failedReceipt.complete, false);
    assert.strictEqual(failedReceipt.remoteMutationAttempted, true);
    assert.strictEqual(failedReceipt.attemptStatus, 'failed');
    assert.strictEqual(failedReceipt.lastAcknowledgedStage, 'begin');
    assert.deepStrictEqual(failedReceipt.acknowledgedStages, ['begin']);
    assert.strictEqual(failedReceipt.importId, IMPORT_ID);
    assert.strictEqual(failedReceipt.failure.redacted, true);
    assert.doesNotMatch(
        stableJson(failedReceipt),
        /reflected-secret-token|Bearer/,
    );
    assert.strictEqual(
        fs.existsSync(path.join(failureApplyDirectory, '.apply.lock')),
        false,
    );

    const retry = await runCommercePublisher({
        ...common,
        apply: true,
        yes: true,
        'grpc-url': 'commerce.example:443',
        out: failureOutput,
    }, {
        repositoryRoot: root,
        environment: {},
        createTransport() {
            const fake = transport([
                response(
                    'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                    '1',
                ),
            ]);
            fake.getReceiptMetadata = () => receiptMetadata();
            return fake;
        },
    });
    const attemptsRoot = path.join(failureApplyDirectory, 'attempts');
    const attemptDirectories = fs.readdirSync(attemptsRoot).sort();
    assert.strictEqual(attemptDirectories.length, 2);
    assert.strictEqual(retry.applyReceipt.attemptNumber, 2);
    assert.strictEqual(
        retry.applyReceipt.previousReceiptSha256,
        failedReceiptSha256,
    );
    assert.deepStrictEqual(
        fs.readFileSync(failedLocation.receiptFile),
        failedReceiptBytes,
    );
    assert.strictEqual(
        sha256(fs.readFileSync(failedLocation.receiptFile)),
        failedReceiptSha256,
    );
    const retryLocation = latestReceiptLocation(failureApplyDirectory);
    assert.strictEqual(retryLocation.latest.attemptNumber, 2);
    assert.strictEqual(
        retryLocation.latest.receiptSha256,
        sha256(fs.readFileSync(retryLocation.receiptFile)),
    );
    assert.notStrictEqual(
        retryLocation.receiptFile,
        failedLocation.receiptFile,
    );

    let mixedPublicationInvoked = false;
    await assert.rejects(
        runCommercePublisher({
            ...common,
            only: '7',
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
            out: path.join(
                path.dirname(failureOutput),
                'different-publication-plan',
            ),
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                return {
                    getReceiptMetadata: () => receiptMetadata(),
                    invoke() {
                        mixedPublicationInvoked = true;
                        throw new Error('mixed publication must not invoke');
                    },
                };
            },
        }),
        /bound to a different or tampered publication/,
    );
    assert.strictEqual(mixedPublicationInvoked, false);
    assert.strictEqual(fs.readdirSync(attemptsRoot).length, 2);

    const latestForChain = readJson(path.join(
        failureApplyDirectory,
        'latest.json',
    ));
    const chainReceiptFile = path.join(
        failureApplyDirectory,
        ...latestForChain.receiptFile.split('/'),
    );
    const chainReceipt = readJson(chainReceiptFile);
    chainReceipt.previousReceiptSha256 = '0'.repeat(64);
    writeJsonAtomic(chainReceiptFile, chainReceipt);
    latestForChain.receiptSha256 = sha256(fs.readFileSync(chainReceiptFile));
    writeJsonAtomic(
        path.join(failureApplyDirectory, 'latest.json'),
        latestForChain,
    );
    let chainTamperInvoked = false;
    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
            out: failureOutput,
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                return {
                    getReceiptMetadata: () => receiptMetadata(),
                    invoke() {
                        chainTamperInvoked = true;
                        throw new Error('tampered chain must not invoke');
                    },
                };
            },
        }),
        /chain is discontinuous or tampered/,
    );
    assert.strictEqual(chainTamperInvoked, false);
    assert.strictEqual(fs.readdirSync(attemptsRoot).length, 2);

    const bindingTamperOutput = path.join(
        root,
        'artifacts',
        'catalog-source-commerce-canaries',
        'binding-tamper',
        'plan',
    );
    await runCommercePublisher({
        ...common,
        apply: true,
        yes: true,
        'grpc-url': 'commerce.example:443',
        out: bindingTamperOutput,
    }, {
        repositoryRoot: root,
        environment: {},
        createTransport() {
            const fake = transport([
                response(
                    'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                    '1',
                ),
            ]);
            fake.getReceiptMetadata = () => receiptMetadata();
            return fake;
        },
    });
    const bindingApplyDirectory = path.join(
        path.dirname(bindingTamperOutput),
        'apply',
    );
    const bindingLocation = latestReceiptLocation(bindingApplyDirectory);
    const bindingReceipt = bindingLocation.receipt;
    bindingReceipt.requiredReadBack.semanticRevisionDigest = '9'.repeat(64);
    writeJsonAtomic(bindingLocation.receiptFile, bindingReceipt);
    const bindingLatest = readJson(path.join(
        bindingApplyDirectory,
        'latest.json',
    ));
    bindingLatest.receiptSha256 =
        sha256(fs.readFileSync(bindingLocation.receiptFile));
    writeJsonAtomic(
        path.join(bindingApplyDirectory, 'latest.json'),
        bindingLatest,
    );
    let bindingTamperInvoked = false;
    await assert.rejects(
        runCommercePublisher({
            ...common,
            apply: true,
            yes: true,
            'grpc-url': 'commerce.example:443',
            out: bindingTamperOutput,
        }, {
            repositoryRoot: root,
            environment: {},
            createTransport() {
                return {
                    getReceiptMetadata: () => receiptMetadata(),
                    invoke() {
                        bindingTamperInvoked = true;
                        throw new Error('tampered binding must not invoke');
                    },
                };
            },
        }),
        /different or tampered publication/,
    );
    assert.strictEqual(bindingTamperInvoked, false);

    const replayed = await runCommercePublisher({
        ...common,
        apply: true,
        yes: true,
        'grpc-url': 'commerce.example:443',
    }, {
        repositoryRoot: root,
        environment: {},
        createTransport() {
            const fake = transport([
                response(
                    'CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED',
                    '1',
                ),
            ]);
            fake.getReceiptMetadata = () => receiptMetadata();
            return fake;
        },
    });
    assert.strictEqual(replayed.applyReceipt.commitKind, 'replayed');
    assert.strictEqual(replayed.applyReceipt.replayedCommit, true);
    assert.strictEqual(replayed.applyReceipt.newCommit, false);
    assert.strictEqual(replayed.applyReceipt.commitRpcInvoked, false);
    assert.deepStrictEqual(replayed.applyReceipt.acknowledgedStages, [
        'begin',
        'commit',
    ]);
    assert.strictEqual(replayed.applyReceipt.receiptSequence, 3);
}

async function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'commerce-publication-'));
    try {
        await testEnvelopeAndSequence();
        await testFailureStops();
        testGrpcurlClient(root);
        await testDryRunCli(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    console.log('test-commerce-publication: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
