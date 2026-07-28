'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    sha256,
    stableJson,
} = require('./lib/artifacts');
const { writeProjectionBundle } = require('./lib/projection-output');
const { buildArtifact } = require('./lib/runtime');
const {
    loadVerifiedProjectionBundle,
} = require('./lib/reconciliation-bundle');
const {
    assertReconciliationReferences,
    reconcileCatalogSource,
} = require('./reconcile-projection');
const {
    SOURCE_SPECIFICATIONS,
} = require('./lib/reconciliation');
const {
    writeProductReference,
} = require('../thetea/lib/product-reference');

const WORKSPACE_ID = '11111111-2222-4333-8444-555555555555';
const OBSERVED_AT = '2026-07-28T03:00:00.000Z';

function sourceItem(externalId) {
    return {
        schemaVersion: 'catalog-source-item-v1',
        externalId,
        localizedFields: {
            'zh-CN': { name: `Fixture Tea ${externalId}` },
        },
        facts: {
            year: 2025,
            batch: '春',
            productionTechnology: '熟茶',
            shape: '饼',
            brand: { externalId: '88', name: 'Fixture Brand' },
        },
        images: [],
        sourceLinks: {
            stableLookupUrl: `https://zzctea.com/teaDetail/${externalId}.html`,
            observedCanonicalUrl:
                `https://zzctea.com/tea/fixture-${externalId}.html`,
        },
        package: {
            rawText: '357克/片',
            components: [{
                quantity: '357',
                containedUnitCode: 'g',
                containerUnitCode: 'cake',
            }],
            isExact: true,
            diagnosticCode: null,
        },
        referencePrices: [],
        sourceUpdatedAt: null,
        diagnostics: [],
        provenance: {
            parserVersion: 'zzctea-public-catalog-js-v2',
            listPayloadDigest: sha256(`list-${externalId}`),
            detailPayloadDigest: sha256(`detail-${externalId}`),
            observedAt: OBSERVED_AT,
        },
    };
}

function writeProjectionFixture(root) {
    const checkpoint = {
        sourceId: 'zzctea',
        snapshotId: 'zzctea-fixture',
        connectorVersion: 'zzctea-connector-v2',
        parserVersion: 'zzctea-public-catalog-js-v2',
        observedAt: OBSERVED_AT,
        diagnostics: [],
        pages: [{ page: 1, sha256: sha256('page') }],
        details: {
            '9': { sha256: sha256('detail-9') },
            '17641': { sha256: sha256('detail-17641') },
        },
    };
    const artifact = buildArtifact(checkpoint, [
        sourceItem('9'),
        sourceItem('17641'),
    ]);
    const artifactSha256 = sha256(stableJson(artifact));
    const projectionRoot = path.join(root, 'projection');
    const documents = writeProjectionBundle(projectionRoot, {
        artifact,
        manifest: {
            sourceId: checkpoint.sourceId,
            connectorVersion: checkpoint.connectorVersion,
            parserVersion: checkpoint.parserVersion,
            snapshotId: checkpoint.snapshotId,
            artifactFile:
                `catalog-source-artifact-v1.${artifactSha256}.json`,
            artifactSha256,
            checkpointFile: 'source-checkpoint.json',
            checkpointSha256: sha256('checkpoint'),
            rawPayloadDigest: artifact.snapshot.rawPayloadDigest,
            semanticDigest: artifact.semanticDigest,
        },
    });
    return { documents, projectionRoot };
}

function product(code, id) {
    return {
        id,
        code,
        published: true,
        translations: [
            {
                lang: 'en-US',
                name: `English ${code}`,
                description: 'Source: zzctea.com.',
                metaDescription: 'Source: zzctea.com.',
            },
            {
                lang: 'zh-CN',
                name: `中文 ${code}`,
                description: '资料来源：找找茶（zzctea.com）。',
                metaDescription: '资料来源：找找茶（zzctea.com）。',
                metaTitle: '旧 meta title',
                seoTitle: '旧 SEO title',
                seo: {
                    title: '旧嵌套 SEO',
                },
            },
        ],
        specifications: [],
        tags: [],
        tierPrices: [{ quantity: 10, price: 900 }],
        catalogPrices: [{ catalog: 'CATALOG-TEA', price: 950 }],
        storePriceOverrides: [{ store: 'STORE-ONE', price: 975 }],
        packages: [],
        catalogs: [],
        origins: [],
        related: [],
        crossSells: [],
    };
}

function writeReferences(root) {
    const productRoot = path.join(root, 'product-reference');
    fs.mkdirSync(productRoot);
    writeProductReference(productRoot, [
        product(
            'ZZC-17641',
            '11111111-1111-4111-8111-111111111111',
        ),
        product(
            'TEA-MANUAL',
            '22222222-2222-4222-8222-222222222222',
        ),
    ], {
        workspaceId: WORKSPACE_ID,
        fetchedAt: OBSERVED_AT,
    });
    const catalogFile = path.join(root, 'catalog-reference.json');
    fs.writeFileSync(catalogFile, stableJson({
        source: 'AdminGateway ProductCatalog',
        workspaceId: WORKSPACE_ID,
        fetchedAt: OBSERVED_AT,
        catalogs: [{ code: 'CATALOG-TEA' }, { code: 'CATALOG-PUERH' }],
        categories: [
            { code: 'CATEGORY-TEA' },
            { code: 'CAT-PUER-TEA' },
            { code: 'CAT-PUER-SHU' },
            { code: 'CAT-SHAPE-CAKE' },
        ],
        specificationGroups: [
            { code: 'SPEC-GROUP-TEA' },
            { code: 'SPEC-TT-GROUP-ATOMIC' },
            { code: 'SPEC-TT-GROUP-CLASSIFICATION-ORIGIN' },
        ],
        specificationAttributes: [
            { code: 'SPEC-ATTRIBUTE-TEA' },
            ...Object.values(SOURCE_SPECIFICATIONS).map(code => ({ code })),
        ],
        specificationAttributeOptions: [
            { code: 'SPEC-OPTION-TEA' },
            {
                code:
                    'SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-PUER',
            },
            { code: 'OPT-PUERH-VINTAGE-2025' },
            { code: 'OPT-PUERH-PROCESSING-SHU' },
            { code: 'OPT-D902FEC129A64389' },
        ],
    }));
    return { catalogFile, productRoot };
}

function directoryContents(root) {
    return Object.fromEntries(fs.readdirSync(root).sort().map(file => [
        file,
        fs.readFileSync(path.join(root, file), 'utf8'),
    ]));
}

function main() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-source-reconciliation-'));
    try {
        const projection = writeProjectionFixture(root);
        const references = writeReferences(root);
        const args = {
            'projection-dir': projection.projectionRoot,
            'catalog-ref': references.catalogFile,
            'product-ref': references.productRoot,
            only: '17641',
        };
        const first = reconcileCatalogSource(args, { repositoryRoot: root });
        assert.ok(first.outputDirectory.startsWith(path.join(
            root,
            'artifacts',
            'catalog-source-reconciliations',
        )));
        assert.strictEqual(first.documents.manifest.selection.mode, 'one-product');
        assert.strictEqual(first.documents.manifest.selectionComplete, false);
        assert.strictEqual(first.documents.manifest.inputProjectionItemCount, 2);
        assert.strictEqual(first.documents.manifest.selectedItemCount, 1);
        assert.strictEqual(first.documents.manifest.counts.matched, 1);
        assert.strictEqual(first.documents.manifest.counts.missing, 0);
        assert.strictEqual(first.documents.manifest.productionWrites, false);
        assert.strictEqual(first.documents.manifest.publicationEligible, false);
        assert.strictEqual(first.documents.manifest.commerceRollbackCovered, false);
        assert.strictEqual(
            first.documents.manifest.completeProductReferenceIncluded,
            true,
        );
        assert.strictEqual(
            first.documents.manifest.catalogReferenceCompletenessProven,
            false,
        );
        assert.strictEqual(first.documents.manifest.rollbackComplete, true);
        assert.deepStrictEqual(
            first.documents.manifest.nonReversibleCreateCodes,
            [],
        );
        assert.deepStrictEqual(
            first.documents.mappingsDocument.value[0].sourceLinks,
            {
                observedCanonicalUrl:
                    'https://zzctea.com/tea/fixture-17641.html',
                stableLookupUrl:
                    'https://zzctea.com/teaDetail/17641.html',
            },
        );
        const patch = first.documents.patchesDocument.value[0];
        const sourceTranslation = patch.translations.find(
            translation => translation.lang === 'zh-CN',
        );
        assert.deepStrictEqual(
            patch.translations.map(translation => translation.lang),
            ['zh-CN'],
            'Source-owned bundle must contain only the source language.',
        );
        assert.strictEqual(sourceTranslation.name, 'Fixture Tea 17641');
        assert.ok(!/(?:zzctea|找找茶)/iu.test(sourceTranslation.description));
        for (const field of ['seo', 'seoTitle', 'metaTitle', 'metaDescription']) {
            assert.strictEqual(Object.hasOwn(sourceTranslation, field), false);
        }
        assert.ok(patch.specifications.every(specification =>
            Object.values(SOURCE_SPECIFICATIONS).includes(
                specification.attribute,
            )));
        assert.deepStrictEqual(
            patch.catalogPrices,
            first.documents.rollbackDocument.value[0].catalogPrices,
        );

        const firstContents = directoryContents(first.outputDirectory);
        const second = reconcileCatalogSource(args, { repositoryRoot: root });
        assert.deepStrictEqual(
            directoryContents(second.outputDirectory),
            firstContents,
        );

        const full = reconcileCatalogSource({
            ...args,
            only: undefined,
        }, {
            repositoryRoot: root,
        });
        assert.strictEqual(full.documents.manifest.counts.matched, 1);
        assert.strictEqual(full.documents.manifest.counts.missing, 1);
        assert.strictEqual(full.documents.manifest.selectionComplete, true);
        assert.strictEqual(full.documents.manifest.rollbackComplete, false);
        assert.strictEqual(full.documents.report.productPatchCount, 2);
        assert.strictEqual(full.documents.manifest.productPatchCount, 2);
        assert.strictEqual(full.documents.report.rollbackProductCount, 1);
        assert.deepStrictEqual(
            full.documents.manifest.nonReversibleCreateCodes,
            ['ZZC-9'],
        );
        const draftPatch = full.documents.patchesDocument.value.find(
            value => value.code === 'ZZC-9',
        );
        assert.strictEqual(draftPatch.published, false);
        assert.strictEqual(draftPatch.sku, 'ZZC-9');
        assert.deepStrictEqual(
            draftPatch.translations.map(translation => [
                translation.lang,
                translation.name,
            ]),
            [['zh-CN', 'Fixture Tea 9']],
        );
        assert.deepStrictEqual(
            Object.keys(draftPatch.translations[0]).sort(),
            ['description', 'lang', 'name'],
        );
        assert.deepStrictEqual(draftPatch.catalogPrices, []);
        assert.deepStrictEqual(draftPatch.tierPrices, []);
        assert.deepStrictEqual(draftPatch.storePriceOverrides, []);
        for (const retailField of [
            'price',
            'oldPrice',
            'catalogPrice',
            'productCost',
        ]) {
            assert.strictEqual(Object.hasOwn(draftPatch, retailField), false);
        }
        assert.throws(
            () => assertReconciliationReferences(full.reconciliation, {
                catalogs: [{ code: 'CATALOG-PUERH' }],
                categories: [{ code: 'CAT-PUER-TEA' }],
                specificationGroups: [],
                specificationAttributes: [],
                specificationAttributeOptions: [],
            }),
            /unavailable specification definition/,
        );

        assert.throws(
            () => reconcileCatalogSource({
                ...args,
                out: path.join(root, 'unrelated-output'),
            }, {
                repositoryRoot: root,
            }),
            /must be a child of/,
        );
        const allowedOutputRoot = path.join(
            root,
            'artifacts',
            'catalog-source-reconciliations',
        );
        const outsideRoot = path.join(root, 'outside-output');
        fs.mkdirSync(allowedOutputRoot, { recursive: true });
        fs.mkdirSync(outsideRoot);
        fs.symlinkSync(
            outsideRoot,
            path.join(allowedOutputRoot, 'escape'),
        );
        assert.throws(
            () => reconcileCatalogSource({
                ...args,
                out: path.join(
                    allowedOutputRoot,
                    'escape',
                    'would-replace-external',
                ),
            }, {
                repositoryRoot: root,
            }),
            /must resolve inside/,
        );
        assert.deepStrictEqual(fs.readdirSync(outsideRoot), []);
        assert.throws(
            () => reconcileCatalogSource({
                ...args,
                only: '99999',
            }, {
                repositoryRoot: root,
            }),
            /must identify exactly one/,
        );

        fs.appendFileSync(
            path.join(
                projection.projectionRoot,
                projection.documents.projectionFile,
            ),
            '\n',
        );
        assert.throws(
            () => loadVerifiedProjectionBundle(projection.projectionRoot),
            /hash differs/,
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
    console.log('test-reconciliation-cli: OK');
}

main();
