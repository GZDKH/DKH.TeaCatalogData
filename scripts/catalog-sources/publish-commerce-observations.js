#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    REPO_ROOT,
    parseArgs,
    requireArg,
} = require('../thetea/lib/env');
const {
    assertScopedPath,
    withStagedOutput,
} = require('../thetea/lib/generated-output');
const {
    readJson,
    safeSegment,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./lib/artifacts');
const {
    CommerceGrpcurlClient,
} = require('./lib/commerce-grpcurl-client');
const {
    buildCanaryEnvelope,
    METHODS,
    SERVICE,
    publishCanary,
} = require('./lib/commerce-publication');
const {
    loadVerifiedProjectionBundle,
} = require('./lib/reconciliation-bundle');

const PLAN_MANIFEST_SCHEMA = 'catalog-source-commerce-canary-manifest-v1';
const APPLY_RECEIPT_SCHEMA = 'catalog-source-commerce-canary-apply-receipt-v1';
const DIGEST = /^[a-f0-9]{64}$/;
const ENDPOINT =
    /^(?:[A-Za-z0-9.-]+|\[[0-9a-f:]+\]):[1-9]\d{0,4}$/i;
const TLS_MODES = new Set([
    'tls-system-ca',
    'tls-custom-ca',
    'plaintext-loopback',
]);
const APPLY_RECEIPT_FILE = 'commerce-canary-apply-receipt.json';
const APPLY_ATTEMPTS_DIRECTORY = 'attempts';
const APPLY_LATEST_FILE = 'latest.json';
const APPLY_LATEST_SCHEMA = 'catalog-source-commerce-canary-latest-attempt-v1';
const APPLY_LOCK_FILE = '.apply.lock';
const APPLY_LOCK_SCHEMA = 'catalog-source-commerce-canary-apply-lock-v1';
const TERMINAL_ATTEMPT_STATUSES = new Set([
    'failed',
    'commit-acknowledged-read-back-pending',
]);
const ATTEMPT_DIRECTORY =
    /^attempt-(?<number>[1-9]\d*)-(?<digest>[a-f0-9]{64})$/;
const ACKNOWLEDGED_STAGES = new Set(['begin', 'importItem', 'commit']);
const GUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_STATES = new Map([
    ['1', 'open'],
    ['CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_OPEN', 'open'],
    ['2', 'committed'],
    ['CATALOG_SOURCE_SNAPSHOT_IMPORT_STATE_COMMITTED', 'committed'],
]);

function valueFrom(args, argumentName, environment, environmentName, fallback) {
    const argument = args[argumentName];
    if (argument !== undefined && argument !== true && argument !== '') {
        return String(argument);
    }
    const configured = environment[environmentName];
    if (configured !== undefined && configured !== '') {
        return String(configured);
    }
    return fallback;
}

function requireConfigured(value, argumentName, environmentName) {
    if (!value) {
        throw new Error(
            `--${argumentName}=... or ${environmentName} is required.`,
        );
    }
    return value;
}

function requireOutputChild(allowedRoot, outputDirectory) {
    const relative = path.relative(allowedRoot, outputDirectory);
    if (!relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(
            'Commerce canary output must be a child of ' +
            'artifacts/catalog-source-commerce-canaries/.',
        );
    }
}

function writePlan(outputDirectory, envelope) {
    if (fs.existsSync(outputDirectory)) {
        const outputStat = fs.lstatSync(outputDirectory);
        const existingManifestFile = path.join(
            outputDirectory,
            'commerce-canary-manifest.json',
        );
        if (outputStat.isSymbolicLink() ||
            !outputStat.isDirectory() ||
            !fs.existsSync(existingManifestFile)) {
            throw new Error('Existing Commerce canary plan is invalid.');
        }
        const manifestStat = fs.lstatSync(existingManifestFile);
        const existingManifest = readJson(existingManifestFile);
        if (manifestStat.isSymbolicLink() ||
            !manifestStat.isFile() ||
            existingManifest.publicationDigest !== envelope.publicationDigest) {
            throw new Error(
                'Commerce canary plan output is bound to a different publication.',
            );
        }
    }
    return withStagedOutput(outputDirectory, stagingDirectory => {
        const envelopeJson = stableJson(envelope);
        const envelopeSha256 = sha256(envelopeJson);
        const envelopeFile =
            `commerce-canary-envelope.${envelopeSha256}.json`;
        fs.writeFileSync(path.join(stagingDirectory, envelopeFile), envelopeJson);
        const manifest = {
            schemaVersion: PLAN_MANIFEST_SCHEMA,
            complete: true,
            mode: 'dry-run',
            publicationDigest: envelope.publicationDigest,
            sourceId: envelope.source.registeredSourceCode,
            originalSnapshotId: envelope.snapshot.originalId,
            canarySnapshotId: envelope.snapshot.id,
            selectedExternalId: envelope.selection.externalId,
            expectedItemCount: 1,
            authoritativeForDeletion: false,
            planGenerationComplete: true,
            networkCalls: false,
            remoteMutationAttempted: false,
            envelopeFile,
            envelopeSha256,
        };
        // The manifest is deliberately the final file written.
        writeJsonAtomic(
            path.join(stagingDirectory, 'commerce-canary-manifest.json'),
            manifest,
        );
        return { envelopeFile, envelopeSha256, manifest };
    });
}

function requireReceiptMetadata(transport) {
    if (!transport || typeof transport.getReceiptMetadata !== 'function') {
        throw new Error(
            'Apply transport must expose receipt metadata before any remote mutation.',
        );
    }
    const metadata = transport.getReceiptMetadata();
    if (!metadata ||
        typeof metadata.sanitizedTargetEndpoint !== 'string' ||
        !ENDPOINT.test(metadata.sanitizedTargetEndpoint) ||
        !TLS_MODES.has(metadata.tlsMode) ||
        typeof metadata.protoFile !== 'string' ||
        !metadata.protoFile.endsWith('.proto') ||
        !DIGEST.test(metadata.protoSha256) ||
        !DIGEST.test(metadata.contractClosureSha256) ||
        !Number.isSafeInteger(metadata.contractFileCount) ||
        metadata.contractFileCount < 1 ||
        !DIGEST.test(metadata.contractFileListSha256) ||
        !Number.isSafeInteger(metadata.contractBuiltInImportCount) ||
        metadata.contractBuiltInImportCount < 0 ||
        !DIGEST.test(metadata.contractBuiltInImportListSha256)) {
        throw new Error('Apply transport receipt metadata is incomplete or invalid.');
    }
    if (metadata.tlsMode === 'plaintext-loopback' &&
        !/^(?:localhost|127\.0\.0\.1|\[::1\]):/.test(
            metadata.sanitizedTargetEndpoint,
        )) {
        throw new Error('Plaintext receipt metadata must identify a loopback target.');
    }
    return {
        sanitizedTargetEndpoint: metadata.sanitizedTargetEndpoint,
        tlsMode: metadata.tlsMode,
        protoFile: metadata.protoFile,
        protoSha256: metadata.protoSha256,
        contractClosureSha256: metadata.contractClosureSha256,
        contractFileCount: metadata.contractFileCount,
        contractFileListSha256: metadata.contractFileListSha256,
        contractBuiltInImportCount: metadata.contractBuiltInImportCount,
        contractBuiltInImportListSha256:
            metadata.contractBuiltInImportListSha256,
    };
}

function buildAuditBinding(envelope, transportMetadata) {
    const referencePrices = envelope.requests.importItem.item.referencePrices || [];
    return {
        publicationDigest: envelope.publicationDigest,
        selectedExternalId: envelope.selection.externalId,
        registeredSourceCode: envelope.source.registeredSourceCode,
        expectedItemCount: 1,
        authoritativeForDeletion: false,
        target: {
            endpoint: transportMetadata.sanitizedTargetEndpoint,
            tlsMode: transportMetadata.tlsMode,
        },
        contract: {
            service: SERVICE,
            methods: [
                METHODS.begin,
                METHODS.importItem,
                METHODS.commit,
            ],
            protoFile: transportMetadata.protoFile,
            protoSha256: transportMetadata.protoSha256,
            contractClosureSha256:
                transportMetadata.contractClosureSha256,
            fileCount: transportMetadata.contractFileCount,
            fileListSha256:
                transportMetadata.contractFileListSha256,
            builtInImportCount:
                transportMetadata.contractBuiltInImportCount,
            builtInImportListSha256:
                transportMetadata.contractBuiltInImportListSha256,
        },
        requiredReadBack: {
            registeredSourceCode: envelope.source.registeredSourceCode,
            externalId: envelope.selection.externalId,
            semanticRevisionDigest:
                envelope.requests.importItem.item.semanticRevisionDigest,
            referencePriceCount: referencePrices.length,
            referencePricesSha256: sha256(stableJson(referencePrices)),
        },
    };
}

function receiptAuditBinding(receipt) {
    return {
        publicationDigest: receipt.publicationDigest,
        selectedExternalId: receipt.selectedExternalId,
        registeredSourceCode: receipt.registeredSourceCode,
        expectedItemCount: receipt.expectedItemCount,
        authoritativeForDeletion: receipt.authoritativeForDeletion,
        target: receipt.target,
        contract: receipt.contract,
        requiredReadBack: receipt.requiredReadBack,
    };
}

function baseApplyReceipt(
    auditBinding,
    auditBindingSha256,
    attemptNumber,
    attemptId,
    previousReceiptSha256,
) {
    return {
        schemaVersion: APPLY_RECEIPT_SCHEMA,
        mode: 'apply',
        complete: false,
        readBackVerified: false,
        readBackRequired: true,
        attemptStatus: 'prepared',
        receiptSequence: 0,
        attemptNumber,
        attemptId,
        previousReceiptSha256,
        remoteMutationAttempted: false,
        lastAcknowledgedStage: 'none',
        commitAcknowledged: false,
        productionStateCommitted: false,
        commitKind: null,
        replayedCommit: false,
        newCommit: false,
        auditBindingSha256,
        ...auditBinding,
    };
}

function acquireApplyLock(outputDirectory) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputStat = fs.lstatSync(outputDirectory);
    if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
        throw new Error('Apply audit root must be a real directory.');
    }
    const lockFile = path.join(outputDirectory, APPLY_LOCK_FILE);
    let fd;
    let createdStat;
    try {
        fd = fs.openSync(lockFile, 'wx', 0o600);
        createdStat = fs.fstatSync(fd);
    } catch (error) {
        if (error.code === 'EEXIST') {
            const existing = fs.lstatSync(lockFile);
            if (existing.isSymbolicLink() || !existing.isFile()) {
                throw new Error('Existing apply lock is not a real file.');
            }
            throw new Error(
                'Apply audit root is locked; inspect the existing attempt and lock before explicit operator recovery.',
            );
        }
        throw error;
    }
    const ownerToken = crypto.randomBytes(32).toString('hex');
    const ownerTokenSha256 = sha256(ownerToken);
    try {
        fs.writeFileSync(fd, stableJson({
            schemaVersion: APPLY_LOCK_SCHEMA,
            ownerTokenSha256,
            processId: process.pid,
        }));
        fs.fsyncSync(fd);
        return {
            auditRoot: path.resolve(outputDirectory),
            dev: createdStat.dev,
            fd,
            ino: createdStat.ino,
            lockFile,
            ownerToken,
            ownerTokenSha256,
            released: false,
        };
    } catch (error) {
        try {
            if (createdStat && fs.existsSync(lockFile)) {
                const pathStat = fs.lstatSync(lockFile);
                if (!pathStat.isSymbolicLink() &&
                    pathStat.isFile() &&
                    pathStat.dev === createdStat.dev &&
                    pathStat.ino === createdStat.ino) {
                    fs.unlinkSync(lockFile);
                }
            }
        } finally {
            if (fd !== undefined) fs.closeSync(fd);
        }
        throw error;
    }
}

function assertOwnedApplyLock(lock, outputDirectory) {
    if (!lock ||
        lock.released === true ||
        path.resolve(outputDirectory) !== lock.auditRoot ||
        sha256(lock.ownerToken) !== lock.ownerTokenSha256) {
        throw new Error('Apply lock ownership is invalid.');
    }
    const descriptorStat = fs.fstatSync(lock.fd);
    const pathStat = fs.lstatSync(lock.lockFile);
    if (pathStat.isSymbolicLink() ||
        !pathStat.isFile() ||
        descriptorStat.dev !== lock.dev ||
        descriptorStat.ino !== lock.ino ||
        pathStat.dev !== lock.dev ||
        pathStat.ino !== lock.ino) {
        throw new Error('Apply lock inode changed while held.');
    }
    const value = readJson(lock.lockFile);
    if (value.schemaVersion !== APPLY_LOCK_SCHEMA ||
        value.ownerTokenSha256 !== lock.ownerTokenSha256) {
        throw new Error('Apply lock token changed while held.');
    }
}

function releaseApplyLock(lock) {
    if (!lock || lock.released === true) {
        throw new Error('Apply lock is not held.');
    }
    let ownershipError = null;
    try {
        assertOwnedApplyLock(lock, lock.auditRoot);
        fs.unlinkSync(lock.lockFile);
    } catch (error) {
        ownershipError = error;
    } finally {
        fs.closeSync(lock.fd);
        lock.released = true;
    }
    if (ownershipError) throw ownershipError;
}

function initializeApplyReceipt(
    outputDirectory,
    envelope,
    transportMetadata,
    lock,
) {
    assertOwnedApplyLock(lock, outputDirectory);
    const auditBinding = buildAuditBinding(envelope, transportMetadata);
    const auditBindingSha256 = sha256(stableJson(auditBinding));
    fs.mkdirSync(outputDirectory, { recursive: true });
    const outputStat = fs.lstatSync(outputDirectory);
    if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
        throw new Error('Apply audit root must be a real directory.');
    }
    const attemptsRoot = path.join(outputDirectory, APPLY_ATTEMPTS_DIRECTORY);
    fs.mkdirSync(attemptsRoot, { recursive: true });
    const attemptsStat = fs.lstatSync(attemptsRoot);
    if (attemptsStat.isSymbolicLink() || !attemptsStat.isDirectory()) {
        throw new Error('Apply attempts root must be a real directory.');
    }
    const allowedRootEntries = new Set([
        APPLY_LOCK_FILE,
        APPLY_ATTEMPTS_DIRECTORY,
        APPLY_LATEST_FILE,
    ]);
    if (fs.readdirSync(outputDirectory).some(
        entry => !allowedRootEntries.has(entry),
    )) {
        throw new Error('Apply audit root contains an unsupported entry.');
    }

    const attempts = [];
    for (const entry of fs.readdirSync(attemptsRoot, { withFileTypes: true })) {
        const match = ATTEMPT_DIRECTORY.exec(entry.name);
        if (!match || entry.isSymbolicLink() || !entry.isDirectory()) {
            throw new Error('Apply attempts root contains an unsupported entry.');
        }
        const attemptNumber = Number(match.groups.number);
        if (!Number.isSafeInteger(attemptNumber)) {
            throw new Error('Apply attempt number is invalid.');
        }
        const attemptDirectory = path.join(attemptsRoot, entry.name);
        const receiptFile = path.join(attemptDirectory, APPLY_RECEIPT_FILE);
        if (!fs.existsSync(receiptFile)) {
            throw new Error('Historical apply attempt has no receipt.');
        }
        if (fs.readdirSync(attemptDirectory).some(
            file => file !== APPLY_RECEIPT_FILE,
        )) {
            throw new Error('Historical apply attempt contains an unsupported entry.');
        }
        const receiptStat = fs.lstatSync(receiptFile);
        if (receiptStat.isSymbolicLink() || !receiptStat.isFile()) {
            throw new Error('Historical apply receipt must be a real file.');
        }
        const bytes = fs.readFileSync(receiptFile);
        const receipt = JSON.parse(bytes.toString('utf8'));
        if (receipt.schemaVersion !== APPLY_RECEIPT_SCHEMA ||
            receipt.attemptNumber !== attemptNumber ||
            receipt.attemptId !== entry.name) {
            throw new Error('Historical apply receipt identity is invalid.');
        }
        const historicalBinding = receiptAuditBinding(receipt);
        const historicalBindingSha256 = sha256(stableJson(historicalBinding));
        if (receipt.auditBindingSha256 !== historicalBindingSha256 ||
            historicalBindingSha256 !== auditBindingSha256 ||
            stableJson(historicalBinding) !== stableJson(auditBinding)) {
            throw new Error(
                'Apply audit root is bound to a different or tampered publication.',
            );
        }
        attempts.push({
            attemptId: entry.name,
            attemptNumber,
            bytes,
            receipt,
            receiptSha256: sha256(bytes),
        });
    }
    attempts.sort((left, right) => left.attemptNumber - right.attemptNumber);
    let previousReceiptSha256 = null;
    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        const expectedNumber = index + 1;
        if (attempt.attemptNumber !== expectedNumber ||
            attempt.receipt.previousReceiptSha256 !== previousReceiptSha256) {
            throw new Error('Apply receipt chain is discontinuous or tampered.');
        }
        const expectedDigest = sha256(stableJson({
            schemaVersion: APPLY_RECEIPT_SCHEMA,
            publicationDigest: attempt.receipt.publicationDigest,
            attemptNumber: attempt.attemptNumber,
            previousReceiptSha256,
        }));
        if (attempt.attemptId !==
            `attempt-${attempt.attemptNumber}-${expectedDigest}`) {
            throw new Error('Apply attempt identity is invalid or tampered.');
        }
        previousReceiptSha256 = attempt.receiptSha256;
    }
    const latestFile = path.join(outputDirectory, APPLY_LATEST_FILE);
    if (attempts.length > 0) {
        const latestStat = fs.lstatSync(latestFile);
        if (latestStat.isSymbolicLink() || !latestStat.isFile()) {
            throw new Error('Apply latest pointer must be a real file.');
        }
        const latest = readJson(latestFile);
        const previous = attempts.at(-1);
        const expectedReceiptFile = [
            APPLY_ATTEMPTS_DIRECTORY,
            previous.attemptId,
            APPLY_RECEIPT_FILE,
        ].join('/');
        if (latest.schemaVersion !== APPLY_LATEST_SCHEMA ||
            latest.attemptNumber !== previous.attemptNumber ||
            latest.attemptId !== previous.attemptId ||
            latest.receiptFile !== expectedReceiptFile ||
            latest.receiptSha256 !== previous.receiptSha256 ||
            latest.auditBindingSha256 !== auditBindingSha256) {
            throw new Error('Apply latest pointer is invalid or tampered.');
        }
        if (!TERMINAL_ATTEMPT_STATUSES.has(previous.receipt.attemptStatus)) {
            throw new Error(
                'Previous apply attempt is non-terminal; inspect its receipt and lock state before explicit operator recovery.',
            );
        }
    } else if (fs.existsSync(latestFile)) {
        throw new Error('Apply latest pointer exists without an attempt.');
    }

    const attemptNumber = attempts.length + 1;
    const attemptDigest = sha256(stableJson({
        schemaVersion: APPLY_RECEIPT_SCHEMA,
        publicationDigest: envelope.publicationDigest,
        attemptNumber,
        previousReceiptSha256,
    }));
    const attemptId = `attempt-${attemptNumber}-${attemptDigest}`;
    const attemptDirectory = path.join(attemptsRoot, attemptId);
    fs.mkdirSync(attemptDirectory);
    const receipt = baseApplyReceipt(
        auditBinding,
        auditBindingSha256,
        attemptNumber,
        attemptId,
        previousReceiptSha256,
    );
    const receiptFile = path.join(attemptDirectory, APPLY_RECEIPT_FILE);
    writeJsonAtomic(receiptFile, receipt);
    writeLatestPointer(outputDirectory, attemptDirectory, lock);
    return {
        attemptDirectory,
        attemptId,
        attemptNumber,
        receipt,
        receiptFile,
    };
}

function writeLatestPointer(outputDirectory, attemptDirectory, lock) {
    assertOwnedApplyLock(lock, outputDirectory);
    const receiptFile = path.join(attemptDirectory, APPLY_RECEIPT_FILE);
    const receiptBytes = fs.readFileSync(receiptFile);
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    const relativeReceiptFile = path.relative(outputDirectory, receiptFile);
    if (!relativeReceiptFile ||
        relativeReceiptFile === '..' ||
        relativeReceiptFile.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeReceiptFile)) {
        throw new Error('Apply receipt escapes its audit root.');
    }
    writeJsonAtomic(path.join(outputDirectory, APPLY_LATEST_FILE), {
        schemaVersion: APPLY_LATEST_SCHEMA,
        attemptNumber: receipt.attemptNumber,
        attemptId: receipt.attemptId,
        receiptFile: relativeReceiptFile.split(path.sep).join('/'),
        receiptSha256: sha256(receiptBytes),
        auditBindingSha256: receipt.auditBindingSha256,
    });
}

function updateApplyReceipt(attemptDirectory, update, lock) {
    const outputDirectory = path.dirname(path.dirname(attemptDirectory));
    assertOwnedApplyLock(lock, outputDirectory);
    const directoryStat = fs.lstatSync(attemptDirectory);
    const receiptFile = path.join(attemptDirectory, APPLY_RECEIPT_FILE);
    const receiptStat = fs.lstatSync(receiptFile);
    if (directoryStat.isSymbolicLink() ||
        !directoryStat.isDirectory() ||
        receiptStat.isSymbolicLink() ||
        !receiptStat.isFile()) {
        throw new Error('Apply receipt path must remain a real directory and file.');
    }
    const current = readJson(receiptFile);
    if (current.schemaVersion !== APPLY_RECEIPT_SCHEMA ||
        current.mode !== 'apply' ||
        current.complete !== false ||
        !Number.isSafeInteger(current.receiptSequence) ||
        current.receiptSequence < 0) {
        throw new Error('Existing apply receipt is invalid.');
    }
    const immutableBinding = receiptAuditBinding(current);
    if (current.auditBindingSha256 !== sha256(stableJson(immutableBinding))) {
        throw new Error('Existing apply receipt binding is invalid.');
    }
    const patch = typeof update === 'function' ? update(current) : update;
    const next = {
        ...current,
        ...patch,
        complete: false,
        readBackVerified: false,
        readBackRequired: true,
        receiptSequence: current.receiptSequence + 1,
    };
    if (stableJson(receiptAuditBinding(next)) !== stableJson(immutableBinding) ||
        next.auditBindingSha256 !== current.auditBindingSha256) {
        throw new Error('Apply receipt update attempted to change its immutable binding.');
    }
    writeJsonAtomic(receiptFile, next);
    writeLatestPointer(outputDirectory, attemptDirectory, lock);
    return next;
}

function safeAcknowledgement(event) {
    if (!event || !ACKNOWLEDGED_STAGES.has(event.stage)) {
        throw new Error('Apply acknowledgement stage is invalid.');
    }
    const value = {
        stage: event.stage,
        importId: GUID.test(event.importId) ? event.importId.toLowerCase() : null,
    };
    if (!value.importId) {
        throw new Error('Apply acknowledgement import ID is invalid.');
    }
    for (const field of ['providerConnectionId', 'providerSyncRunId']) {
        if (typeof event[field] === 'string' && GUID.test(event[field])) {
            value[field] = event[field].toLowerCase();
        }
    }
    for (const field of [
        'expectedItemCount',
        'acceptedItemCount',
        'replayedItemCount',
        'quarantinedItemCount',
    ]) {
        if (event[field] !== undefined && event[field] !== null) {
            const count = String(event[field]);
            if (/^(?:0|[1-9]\d*)$/.test(count)) value[field] = count;
        }
    }
    if (event.stage === 'importItem') {
        value.externalId = event.externalId;
        value.replayed = event.replayed === true;
    }
    const state = SAFE_STATES.get(String(event.state));
    if (state) value.state = state;
    return value;
}

function safeFailure() {
    return {
        redacted: true,
        category: 'apply_failed',
        message: 'Failure detail omitted from the durable receipt.',
    };
}

function defaultProtoRoots(repositoryRoot) {
    const monorepoRoot = path.resolve(repositoryRoot, '../..');
    return {
        commerceProtoRoot: path.join(
            monorepoRoot,
            'services',
            'DKH.CommerceNetworkService',
            'DKH.CommerceNetworkService.Contracts',
            'proto',
        ),
        platformProtoRoot: path.join(
            monorepoRoot,
            'libraries',
            'DKH.Platform',
            'src',
            'Api',
            'DKH.Platform.Grpc.Common',
            'proto',
        ),
    };
}

async function runCommercePublisher(args, options = {}) {
    const environment = options.environment || process.env;
    const repositoryRoot = path.resolve(options.repositoryRoot || REPO_ROOT);
    if (args.apply === true && args.yes !== true) {
        throw new Error('--apply requires the separate --yes confirmation.');
    }
    const projectionDirectory = path.resolve(
        repositoryRoot,
        requireArg(args, 'projection-dir'),
    );
    const externalId = requireArg(args, 'only');
    const bundle = loadVerifiedProjectionBundle(projectionDirectory);
    const participantId = requireConfigured(
        valueFrom(
            args,
            'participant-id',
            environment,
            'COMMERCE_CATALOG_SOURCE_PARTICIPANT_ID',
        ),
        'participant-id',
        'COMMERCE_CATALOG_SOURCE_PARTICIPANT_ID',
    );
    const commerceChannelId = requireConfigured(
        valueFrom(
            args,
            'commerce-channel-id',
            environment,
            'COMMERCE_CATALOG_SOURCE_CHANNEL_ID',
        ),
        'commerce-channel-id',
        'COMMERCE_CATALOG_SOURCE_CHANNEL_ID',
    );
    const configuredSourceCode = valueFrom(
        args,
        'registered-source-code',
        environment,
        'COMMERCE_CATALOG_SOURCE_REGISTERED_SOURCE_CODE',
        null,
    );
    if (configuredSourceCode !== null &&
        configuredSourceCode !== bundle.projection.source.id) {
        throw new Error(
            'Registered source code must exactly match the verified projection source ID.',
        );
    }
    const envelope = buildCanaryEnvelope(bundle, {
        externalId,
        participantId,
        commerceChannelId,
        registeredSourceCode: configuredSourceCode === null
            ? undefined
            : configuredSourceCode,
        artifactSchemaVersion: valueFrom(
            args,
            'artifact-schema-version',
            environment,
            'COMMERCE_CATALOG_SOURCE_ARTIFACT_SCHEMA_VERSION',
            'catalog-source-artifact-v1',
        ),
    });
    const allowedOutputRoot = path.join(
        repositoryRoot,
        'artifacts',
        'catalog-source-commerce-canaries',
    );
    const defaultOutputDirectory = path.join(
        allowedOutputRoot,
        safeSegment(envelope.source.registeredSourceCode, 'source ID'),
        safeSegment(envelope.snapshot.originalId, 'snapshot ID'),
        envelope.publicationDigest,
        `only-${safeSegment(externalId, 'external ID')}`,
        'plan',
    );
    const outputDirectory = args.out
        ? path.resolve(repositoryRoot, String(args.out))
        : defaultOutputDirectory;
    requireOutputChild(allowedOutputRoot, outputDirectory);
    assertScopedPath(outputDirectory, {
        repoRoot: repositoryRoot,
        allowedRoot: allowedOutputRoot,
        allowedDescription: 'artifacts/catalog-source-commerce-canaries/',
        label: 'Commerce canary output',
    });
    const plan = writePlan(outputDirectory, envelope);
    if (args.apply !== true) {
        return {
            mode: 'dry-run',
            envelope,
            outputDirectory,
            plan,
            result: null,
        };
    }

    const defaults = defaultProtoRoots(repositoryRoot);
    const timeoutText = valueFrom(
        args,
        'timeout-seconds',
        environment,
        'COMMERCE_NETWORK_GRPC_TIMEOUT_SECONDS',
        '30',
    );
    if (!/^\d+$/.test(timeoutText)) {
        throw new Error('Commerce gRPC timeout must be a whole number of seconds.');
    }
    const clientOptions = {
        endpoint: requireConfigured(
            valueFrom(
                args,
                'grpc-url',
                environment,
                'COMMERCE_NETWORK_GRPC_URL',
            ),
            'grpc-url',
            'COMMERCE_NETWORK_GRPC_URL',
        ),
        timeoutSeconds: Number(timeoutText),
        plaintext: args.plaintext === true,
        caCertificate: valueFrom(
            args,
            'cacert',
            environment,
            'COMMERCE_NETWORK_GRPC_CA_CERTIFICATE',
            null,
        ),
        grpcurl: valueFrom(
            args,
            'grpcurl',
            environment,
            'GRPCURL_BIN',
            'grpcurl',
        ),
        commerceProtoRoot: valueFrom(
            args,
            'commerce-proto-root',
            environment,
            'COMMERCE_NETWORK_PROTO_ROOT',
            defaults.commerceProtoRoot,
        ),
        platformProtoRoot: valueFrom(
            args,
            'platform-proto-root',
            environment,
            'DKH_PLATFORM_GRPC_PROTO_ROOT',
            defaults.platformProtoRoot,
        ),
        environment,
    };
    const applyDirectory = path.join(path.dirname(outputDirectory), 'apply');
    requireOutputChild(allowedOutputRoot, applyDirectory);
    const applyLock = acquireApplyLock(applyDirectory);
    let applyError = null;
    try {
        const transport = options.createTransport
            ? options.createTransport(clientOptions)
            : new CommerceGrpcurlClient(clientOptions);
        const transportMetadata = requireReceiptMetadata(transport);
        const applyAttempt = initializeApplyReceipt(
            applyDirectory,
            envelope,
            transportMetadata,
            applyLock,
        );
        const applyAttemptDirectory = applyAttempt.attemptDirectory;
        let applyReceipt = applyAttempt.receipt;
        // Persist the attempt flag before the first RPC. A crash after this write
        // cannot leave the remote operation looking like a dry-run.
        applyReceipt = updateApplyReceipt(
            applyAttemptDirectory,
            {
                remoteMutationAttempted: true,
                attemptStatus: 'in-progress',
            },
            applyLock,
        );
        let result;
        try {
            result = await publishCanary(envelope, transport, {
                onAcknowledged(event) {
                    const acknowledgement = safeAcknowledgement(event);
                    applyReceipt = updateApplyReceipt(
                        applyAttemptDirectory,
                        current => ({
                            attemptStatus: 'in-progress',
                            remoteMutationAttempted: true,
                            lastAcknowledgedStage: acknowledgement.stage,
                            lastAcknowledgement: acknowledgement,
                            acknowledgedStages: [
                                ...new Set([
                                    ...(current.acknowledgedStages || []),
                                    acknowledgement.stage,
                                ]),
                            ],
                            importId: acknowledgement.importId,
                            providerConnectionId:
                                acknowledgement.providerConnectionId ||
                                current.providerConnectionId,
                            providerSyncRunId:
                                acknowledgement.providerSyncRunId ||
                                current.providerSyncRunId,
                            acceptedItemCount:
                                acknowledgement.acceptedItemCount ??
                                current.acceptedItemCount,
                            replayedItemCount:
                                acknowledgement.replayedItemCount ??
                                current.replayedItemCount,
                            quarantinedItemCount:
                                acknowledgement.quarantinedItemCount ??
                                current.quarantinedItemCount,
                        }),
                        applyLock,
                    );
                },
            });
            if (options.afterRemoteCommitAcknowledged) {
                await options.afterRemoteCommitAcknowledged();
            }
            const commitAcknowledgement = safeAcknowledgement({
                stage: 'commit',
                importId: result.importId,
                providerConnectionId:
                    result.commit?.providerConnectionId?.value || null,
                providerSyncRunId:
                    result.commit?.providerSyncRunId?.value || null,
                state: result.commit.state,
                expectedItemCount: result.commit.expectedItemCount,
                acceptedItemCount: result.commit.acceptedItemCount,
                replayedItemCount: result.commit.replayedItemCount,
                quarantinedItemCount: result.commit.quarantinedItemCount,
            });
            applyReceipt = updateApplyReceipt(
                applyAttemptDirectory,
                current => ({
                    attemptStatus: 'commit-acknowledged-read-back-pending',
                    remoteMutationAttempted: true,
                    lastAcknowledgedStage: 'commit',
                    lastAcknowledgement: commitAcknowledgement,
                    acknowledgedStages: [
                        ...new Set([
                            ...(current.acknowledgedStages || []),
                            'commit',
                        ]),
                    ],
                    commitAcknowledged: true,
                    productionStateCommitted: true,
                    commitKind: result.replayedCompletedImport
                        ? 'replayed'
                        : 'new',
                    commitRpcInvoked: result.commitRpcInvoked,
                    replayedCommit: result.replayedCompletedImport,
                    newCommit: !result.replayedCompletedImport,
                    importId: result.importId,
                    replayedCompletedImport: result.replayedCompletedImport,
                    state: 'committed',
                    acceptedItemCount: '1',
                    quarantinedItemCount:
                        commitAcknowledgement.quarantinedItemCount ??
                        current.quarantinedItemCount,
                }),
                applyLock,
            );
        } catch (error) {
            try {
                applyReceipt = updateApplyReceipt(
                    applyAttemptDirectory,
                    {
                        attemptStatus: 'failed',
                        remoteMutationAttempted: true,
                        failure: safeFailure(error),
                    },
                    applyLock,
                );
            } catch (receiptError) {
                throw new AggregateError(
                    [error, receiptError],
                    'Apply failed and its durable receipt could not be updated.',
                );
            }
            throw error;
        }
        return {
            mode: 'apply',
            envelope,
            outputDirectory,
            plan,
            result,
            applyDirectory,
            applyAttemptDirectory,
            applyReceipt,
        };
    } catch (error) {
        applyError = error;
        throw error;
    } finally {
        try {
            releaseApplyLock(applyLock);
        } catch (releaseError) {
            if (applyError) {
                throw new AggregateError(
                    [applyError, releaseError],
                    'Apply failed and its exclusive lock could not be released safely.',
                );
            }
            throw releaseError;
        }
    }
}

async function main() {
    const result = await runCommercePublisher(parseArgs());
    console.log(`Mode: ${result.mode}`);
    console.log(`Source: ${result.envelope.source.registeredSourceCode}`);
    console.log(`Snapshot: ${result.envelope.snapshot.originalId}`);
    console.log(`Canary external ID: ${result.envelope.selection.externalId}`);
    console.log('Expected item count: 1');
    console.log('Deletion authority: none');
    console.log(`Plan: ${result.outputDirectory}`);
    if (result.mode === 'dry-run') {
        console.log('Network calls: none');
        console.log('Production writes: none');
    } else {
        console.log(`Import ID: ${result.result.importId}`);
        console.log(`Apply receipt: ${result.applyDirectory}`);
        console.log('Read-back verified: no');
        console.log('Canary complete: no');
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`${error.code || error.name}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    acquireApplyLock,
    defaultProtoRoots,
    initializeApplyReceipt,
    releaseApplyLock,
    requireReceiptMetadata,
    runCommercePublisher,
    updateApplyReceipt,
    writePlan,
};
