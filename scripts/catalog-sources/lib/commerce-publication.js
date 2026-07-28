'use strict';

const { sha256, stableJson } = require('./artifacts');

const CANARY_SCHEMA = 'catalog-source-commerce-canary-v1';
const SERVICE =
    'proto.commerce_network.api.catalog_source_ingestion.v1.' +
    'CatalogSourceObservationAdminService';
const METHODS = Object.freeze({
    begin: `${SERVICE}/BeginCatalogSourceSnapshotImport`,
    importItem: `${SERVICE}/ImportCatalogSourceItem`,
    commit: `${SERVICE}/CommitCatalogSourceSnapshotImport`,
});

const CODE = /^[a-z0-9][a-z0-9._-]*$/;
const DIGEST = /^[a-f0-9]{64}$/;
const GUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireString(value, label, maximumLength) {
    if (typeof value !== 'string' ||
        !value ||
        value.length > maximumLength) {
        throw new Error(
            `${label} must be a non-empty string of at most ${maximumLength} characters.`,
        );
    }
    return value;
}

function requireGuid(value, label) {
    const guid = requireString(value, label, 36);
    if (!GUID.test(guid) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(guid)) {
        throw new Error(`${label} must be a non-empty UUID.`);
    }
    return guid.toLowerCase();
}

function requireDigest(value, label) {
    if (typeof value !== 'string' || !DIGEST.test(value)) {
        throw new Error(`${label} must be a lowercase SHA-256 digest.`);
    }
    return value;
}

function requireCode(value, label) {
    const code = requireString(value, label, 64);
    if (!CODE.test(code)) {
        throw new Error(
            `${label} must contain only lowercase letters, numbers, dot, underscore, or dash.`,
        );
    }
    return code;
}

function requireTimestamp(value, label) {
    const timestamp = requireString(value, label, 64);
    const parsed = new Date(timestamp);
    if (!Number.isFinite(parsed.getTime()) ||
        parsed.toISOString() !== timestamp) {
        throw new Error(`${label} must be a canonical UTC timestamp.`);
    }
    return timestamp;
}

function requireProjection(bundle) {
    const projection = bundle?.projection;
    const manifest = bundle?.manifest;
    if (!projection ||
        !manifest ||
        projection.productionWrites !== false ||
        projection.authoritativeReferencesIncluded !== false ||
        projection.reconciliationComplete !== false ||
        projection.deletionCount !== 0 ||
        !Array.isArray(projection.deletions) ||
        projection.deletions.length !== 0 ||
        !Array.isArray(projection.items) ||
        projection.items.length !== projection.itemCount) {
        throw new Error(
            'Commerce publication requires a verified, non-authoritative projection.',
        );
    }
    requireDigest(manifest.projectionSha256, 'Projection hash');
    requireDigest(bundle.manifestSha256, 'Projection manifest hash');
    requireDigest(projection.inputEvidence?.rawPayloadDigest, 'Raw payload digest');
    requireDigest(projection.inputEvidence?.semanticDigest, 'Input semantic digest');
    return projection;
}

function buildCanaryEnvelope(bundle, options) {
    const projection = requireProjection(bundle);
    const externalId = requireString(options?.externalId, 'Canary external ID', 1000);
    const selected = projection.items.filter(item => item.externalId === externalId);
    if (selected.length !== 1) {
        throw new Error(
            `Canary external ID '${externalId}' must identify exactly one projected item.`,
        );
    }

    const participantId = requireGuid(options.participantId, 'Participant ID');
    const commerceChannelId = requireGuid(
        options.commerceChannelId,
        'Commerce channel ID',
    );
    const registeredSourceCode = requireCode(
        projection.source?.id,
        'Registered source code',
    );
    if (options.registeredSourceCode !== undefined &&
        options.registeredSourceCode !== registeredSourceCode) {
        throw new Error(
            'Registered source code must exactly match the verified projection source ID.',
        );
    }
    const connectorVersion = requireString(
        projection.source?.connectorVersion,
        'Connector version',
        64,
    );
    const parserVersion = requireString(
        projection.source?.parserVersion,
        'Parser version',
        64,
    );
    const artifactSchemaVersion = requireString(
        options.artifactSchemaVersion,
        'Artifact schema version',
        64,
    );
    const observedAt = requireTimestamp(
        projection.snapshot?.observedAt,
        'Snapshot observation time',
    );
    const originalSnapshotId = requireString(
        projection.snapshot?.id,
        'Snapshot ID',
        200,
    );
    const item = selected[0];
    if (!item.observation ||
        item.observation.externalId !== externalId ||
        item.externalId !== externalId) {
        throw new Error('Selected projection item identity is inconsistent.');
    }
    requireDigest(
        item.observation.semanticRevisionDigest,
        'Item semantic revision digest',
    );

    const inputBinding = {
        participantId,
        commerceChannelId,
        registeredSourceCode,
        connectorVersion,
        parserVersion,
        artifactSchemaVersion,
        originalSnapshotId,
        observedAt,
        externalId,
        observation: item.observation,
        projectionManifestSha256: bundle.manifestSha256,
        projectionSha256: bundle.manifest.projectionSha256,
        inputRawPayloadDigest: projection.inputEvidence.rawPayloadDigest,
        inputSemanticDigest: projection.inputEvidence.semanticDigest,
    };
    const canarySemanticDigest = sha256(stableJson(inputBinding));
    const publicationDigest = sha256(stableJson({
        schemaVersion: CANARY_SCHEMA,
        mode: 'one-item-canary',
        authoritativeForDeletion: false,
        expectedItemCount: 1,
        canarySemanticDigest,
        inputBinding,
    }));
    const snapshotId = `canary.${publicationDigest.slice(0, 48)}`;
    const idempotencyPrefix =
        `catalog-source.canary.${publicationDigest}`;

    return {
        schemaVersion: CANARY_SCHEMA,
        mode: 'one-item-canary',
        publicationDigest,
        planGeneration: {
            complete: true,
            networkCalls: false,
            remoteMutationAttempted: false,
        },
        authoritativeForDeletion: false,
        expectedItemCount: 1,
        selection: {
            externalId,
            selectedItemCount: 1,
            inputProjectionItemCount: projection.itemCount,
        },
        source: {
            registeredSourceCode,
            connectorVersion,
            parserVersion,
            artifactSchemaVersion,
        },
        snapshot: {
            id: snapshotId,
            originalId: originalSnapshotId,
            observedAt,
        },
        inputEvidence: {
            projectionManifestSha256: bundle.manifestSha256,
            projectionSha256: bundle.manifest.projectionSha256,
            rawPayloadDigest: projection.inputEvidence.rawPayloadDigest,
            semanticDigest: projection.inputEvidence.semanticDigest,
        },
        canarySemanticDigest,
        requests: {
            begin: {
                participantId: { value: participantId },
                commerceChannelId: { value: commerceChannelId },
                registeredSourceCode,
                connectorVersion,
                parserVersion,
                artifactSchemaVersion,
                snapshotId,
                expectedItemCount: '1',
                rawPayloadDigest: projection.inputEvidence.rawPayloadDigest,
                semanticDigest: canarySemanticDigest,
                observedAt,
                command: {
                    idempotencyKey: `${idempotencyPrefix}.begin`,
                },
            },
            importItem: {
                item: item.observation,
                command: {
                    idempotencyKey: `${idempotencyPrefix}.item`,
                },
            },
            commit: {
                semanticDigest: canarySemanticDigest,
                command: {
                    idempotencyKey: `${idempotencyPrefix}.commit`,
                },
            },
        },
    };
}

function responseState(response) {
    return response?.state;
}

function stateIs(response, name, number) {
    const state = responseState(response);
    return state === number ||
        state === String(number) ||
        state === `CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_${name}`;
}

function requireImportId(response) {
    const value = response?.importId?.value;
    return requireGuid(value, 'Begin response import ID');
}

function requireCount(response, field, expected) {
    const actual = response?.[field];
    if (String(actual) !== String(expected)) {
        throw new Error(
            `Commerce response ${field} did not match the canary contract.`,
        );
    }
}

async function publishCanary(envelope, transport, observer = {}) {
    if (envelope?.schemaVersion !== CANARY_SCHEMA ||
        envelope.mode !== 'one-item-canary' ||
        envelope.authoritativeForDeletion !== false ||
        envelope.expectedItemCount !== 1 ||
        envelope.selection?.selectedItemCount !== 1 ||
        !transport ||
        typeof transport.invoke !== 'function') {
        throw new Error('A valid one-item canary envelope and transport are required.');
    }

    const acknowledge = async event => {
        if (observer?.onAcknowledged) {
            await observer.onAcknowledged(event);
        }
    };
    const begin = await transport.invoke(METHODS.begin, envelope.requests.begin);
    const importId = requireImportId(begin);
    requireCount(begin, 'expectedItemCount', 1);
    const beginCommitted = stateIs(begin, 'COMMITTED', 2);
    const beginOpen = stateIs(begin, 'OPEN', 1);
    if (beginCommitted) {
        requireCount(begin, 'acceptedItemCount', 1);
    } else if (!beginOpen) {
        throw new Error(
            'Begin returned an unsupported import state.',
        );
    }
    await acknowledge({
        stage: 'begin',
        importId,
        providerConnectionId: begin?.providerConnectionId?.value || null,
        providerSyncRunId: begin?.providerSyncRunId?.value || null,
        state: responseState(begin),
        expectedItemCount: begin.expectedItemCount,
        acceptedItemCount: begin.acceptedItemCount,
        replayedItemCount: begin.replayedItemCount,
        quarantinedItemCount: begin.quarantinedItemCount,
    });

    if (beginCommitted) {
        return {
            importId,
            replayedCompletedImport: true,
            commitRpcInvoked: false,
            begin,
            importItem: null,
            commit: begin,
        };
    }
    const importItem = await transport.invoke(METHODS.importItem, {
        importId: { value: importId },
        ...envelope.requests.importItem,
    });
    await acknowledge({
        stage: 'importItem',
        importId,
        externalId: envelope.selection.externalId,
        replayed: importItem?.replayed === true,
    });
    const commit = await transport.invoke(METHODS.commit, {
        importId: { value: importId },
        ...envelope.requests.commit,
    });
    if (!stateIs(commit, 'COMMITTED', 2)) {
        throw new Error(
            'Commit returned an unsupported import state.',
        );
    }
    requireCount(commit, 'expectedItemCount', 1);
    requireCount(commit, 'acceptedItemCount', 1);
    return {
        importId,
        replayedCompletedImport: false,
        commitRpcInvoked: true,
        begin,
        importItem,
        commit,
    };
}

module.exports = {
    CANARY_SCHEMA,
    METHODS,
    SERVICE,
    buildCanaryEnvelope,
    publishCanary,
};
