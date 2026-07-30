'use strict';

const fs = require('fs');
const path = require('path');
const {
    readJson,
    sha256,
    stableJson,
    writeJsonAtomic,
} = require('./artifacts');
const {
    verifyAdminConsoleArtifact,
} = require('./admin-console-artifact');
const {
    verifyImportBundle,
} = require('./import-bundle');
const {
    SOURCE_LOCALE,
    archiveTranslationSource,
    artifactFiles,
    artifactIdentity,
    assertRealDirectory,
    assertSeparateOutput,
    canonicalLocale,
    copyTree,
    sourceTranslation,
    sourceTranslationSha256,
    walkFiles,
} = require('./product-translation-markdown');
const {
    withStagedOutput,
} = require('../../thetea/lib/generated-output');

const PACKAGE_KIND = 'dkh.zzctea.chinese-source-markdown';
const PACKAGE_SCHEMA_VERSION = 2;
const DIGEST = /^[a-f0-9]{64}$/;

const FACT_LABELS = new Map([
    ['batch', '批次'],
    ['brand.external-id', '品牌源编号'],
    ['brand.name', '品牌'],
    ['market.aggregates.comment-count', '评论数'],
    ['market.aggregates.demand-count', '求购数量'],
    ['market.aggregates.demand-participant-count', '求购参与人数'],
    ['market.aggregates.follower-count', '关注人数'],
    ['market.aggregates.forum-count', '讨论数'],
    ['market.aggregates.supply-count', '供应数量'],
    ['market.aggregates.supply-participant-count', '供应参与人数'],
    ['market.pricing.basis-unit-code', '计价单位'],
    ['market.pricing.currency-code', '币种'],
    ['market.pricing.current-amount', '当前参考价格'],
    ['market.pricing.previous-amount', '上一参考价格'],
    ['market.pricing.previous-amount-derivation', '上一价格计算方式'],
    ['market.pricing.ranges.source.maximum-amount', '来源历史最高价格'],
    ['market.pricing.ranges.source.minimum-amount', '来源历史最低价格'],
    ['market.pricing.ranges.week.maximum-amount', '本周最高价格'],
    ['market.pricing.ranges.week.minimum-amount', '本周最低价格'],
    ['market.pricing.ranges.year.maximum-amount', '本年最高价格'],
    ['market.pricing.ranges.year.minimum-amount', '本年最低价格'],
    ['market.pricing.trends.absolute-change-amount', '价格绝对变动'],
    ['market.pricing.trends.display-percent-change', '价格变动百分比'],
    ['market.pricing.trends.period-ratios.half-year', '半年价格比率'],
    ['market.pricing.trends.period-ratios.month', '月度价格比率'],
    ['market.pricing.trends.period-ratios.three-month', '三个月价格比率'],
    ['market.pricing.trends.period-ratios.week', '周价格比率'],
    ['market.pricing.trends.period-ratios.year', '年度价格比率'],
    ['market.source-updated-at', '来源更新时间'],
    ['production-technology', '制作工艺'],
    ['release.amount', '发行金额'],
    ['release.basis-unit-code', '发行计价单位'],
    ['release.currency-code', '发行币种'],
    ['release.kind', '发行信息类型'],
    ['release.quantity', '发行数量'],
    ['release.retail-price', '发行零售价'],
    ['shape', '形态'],
    ['year', '年份数值'],
    ['year-label', '年份'],
]);

const UNIT_LABELS = new Map([
    ['bag', '袋'],
    ['box', '盒'],
    ['brick', '砖'],
    ['bundle', '提'],
    ['cake', '饼'],
    ['case', '件'],
    ['g', '克'],
    ['kg', '千克'],
    ['tuo', '沱'],
]);

const ATTRIBUTE_LABEL_FALLBACKS = new Map([
    ['SPEC-06609725785E48F', '年份'],
    ['SPEC-4304F36A0BF94F7', '压制形态'],
]);

const OPTION_LABEL_FALLBACKS = new Map([
    ['OPT-3FDFAEB0AEB14D52', '砖茶'],
    ['OPT-BF841D77083049E6', '散茶'],
    ['OPT-D902FEC129A64389', '饼茶'],
    ['OPT-E9939A4B758741B3', '沱茶'],
    ['SPEC-TT-OPT-CLASSIFICATION-ORIGIN-TEA-TYPE-PUER', '普洱茶'],
]);

function normalizeText(value) {
    return String(value ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .normalize('NFC')
        .trim();
}

function oneLine(value) {
    return normalizeText(value)
        .replace(/\s+/g, ' ')
        .trim();
}

function assertSafeText(value, file) {
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
        || /<\s*\/?\s*(?:script|iframe|object|embed)\b/i.test(value)
        || /zzctea|找找茶/i.test(value)) {
        throw new Error(`${file} contains unsafe or source-attribution text.`);
    }
}

function assertDocumentValues(document, file) {
    if (document.name.length < 2 || document.name.length > 200
        || document.name.includes('\n')) {
        throw new Error(`${file} name must be one 2-200 character line.`);
    }
    if (document.description.length < 1
        || document.description.length > 4000) {
        throw new Error(`${file} description must contain 1-4000 characters.`);
    }
    assertSafeText(document.name, file);
    assertSafeText(document.description, file);
}

function decimalValue(value) {
    const units = String(value?.units ?? '0');
    const nanos = Number(value?.nanos || 0);
    if (!Number.isSafeInteger(nanos) || nanos < 0 || nanos >= 1_000_000_000
        || !/^-?\d+$/.test(units)) {
        throw new Error('Invalid decimal value in ZZCTea source context.');
    }
    if (nanos === 0) return units;
    return `${units}.${String(nanos).padStart(9, '0').replace(/0+$/, '')}`;
}

function unitLabel(value) {
    const code = String(value || '');
    const label = UNIT_LABELS.get(code);
    if (!label) throw new Error(`Unsupported ZZCTea unit code '${code}'.`);
    return label;
}

function factualValue(attribute) {
    const code = attribute.attributeCode;
    const value = oneLine(attribute.normalizedValue);
    if (code.endsWith('basis-unit-code')) return unitLabel(value);
    if (code.endsWith('currency-code')) {
        if (value !== 'CNY') {
            throw new Error(`Unsupported ZZCTea currency '${value}'.`);
        }
        return '人民币（CNY）';
    }
    if (code === 'market.pricing.previous-amount-derivation') {
        if (value !== 'current-minus-source-absolute-change') {
            throw new Error(
                `Unsupported ZZCTea price derivation '${value}'.`,
            );
        }
        return '当前价格减去来源绝对变动值';
    }
    if (code === 'release.kind') {
        if (value !== 'factory-release-fact') {
            throw new Error(`Unsupported ZZCTea release kind '${value}'.`);
        }
        return '出厂发行信息';
    }
    return value;
}

function factualRows(context, predicate) {
    const rows = context.factualAttributes
        .filter(attribute => predicate(attribute.attributeCode))
        .map(attribute => {
            const label = FACT_LABELS.get(attribute.attributeCode);
            if (!label) {
                throw new Error(
                    `Unsupported ZZCTea factual attribute ` +
                    `'${attribute.attributeCode}'.`,
                );
            }
            return `- ${label}：${factualValue(attribute)}`;
        });
    return rows.length > 0 ? rows : ['- 无'];
}

function packageRows(context) {
    const rows = [];
    if (context.rawPackageText) {
        rows.push(`- 原始包装规格：${oneLine(context.rawPackageText)}`);
    }
    for (const component of context.packageComponents) {
        rows.push(
            `- 包装层级 ${component.ordinal + 1}：` +
            `${decimalValue(component.quantity)}` +
            `${unitLabel(component.containedUnitCode)}/` +
            `${unitLabel(component.containerUnitCode)}`,
        );
    }
    rows.push(`- 包装解析完整：${context.packageComponentsExact ? '是' : '否'}`);
    return rows;
}

function translatedName(record, fallbacks, label) {
    const name = (record?.translations || [])
        .find(translation => translation.lang === SOURCE_LOCALE)?.name;
    const fallback = fallbacks.get(String(record?.code || ''));
    const value = oneLine(name || fallback);
    if (!value) {
        throw new Error(`Missing Chinese label for ${label}.`);
    }
    return value;
}

function specificationValue(specification, attribute, option) {
    if (option) {
        return translatedName(
            option,
            OPTION_LABEL_FALLBACKS,
            `option ${specification.option}`,
        );
    }
    const raw = oneLine(specification.value);
    if (specification.attribute ===
        'SPEC-PUERH-REFERENCE-PRICE-UNIT') {
        return raw.split(',')
            .filter(Boolean)
            .map(unitLabel)
            .join('、');
    }
    if (specification.type === 'Number' && /^-?\d+(?:\.\d+)?$/.test(raw)) {
        const normalized = raw.includes('.')
            ? raw.replace(/\.?0+$/, '')
            : raw;
        return `${normalized}${attribute?.unit
            ? unitLabel(attribute.unit)
            : ''}`;
    }
    return raw;
}

function normalizeSpecifications(product, bundle) {
    const attributes = new Map(
        (bundle.definitions?.attributes || [])
            .map(attribute => [attribute.code, attribute]),
    );
    const options = new Map(
        (bundle.definitions?.options || [])
            .map(option => [option.code, option]),
    );
    return (product.specifications || [])
        .slice()
        .sort((left, right) =>
            Number(left.order || 0) - Number(right.order || 0)
            || String(left.attribute).localeCompare(String(right.attribute)))
        .map(specification => {
            const attribute = attributes.get(specification.attribute);
            const option = options.get(specification.option);
            if (!attribute || (specification.option && !option)) {
                throw new Error(
                    `Incomplete specification definition for ${product.code}.`,
                );
            }
            const value = specificationValue(
                specification,
                attribute,
                option,
            );
            if (!value) {
                throw new Error(
                    `Empty specification value for ${product.code}.`,
                );
            }
            return {
                attributeCode: specification.attribute,
                label: translatedName(
                    attribute,
                    ATTRIBUTE_LABEL_FALLBACKS,
                    `attribute ${specification.attribute}`,
                ),
                order: Number(specification.order || 0),
                value,
            };
        });
}

function specificationRows(context) {
    return context.specifications.length > 0
        ? context.specifications.map(item => `- ${item.label}：${item.value}`)
        : ['- 无'];
}

function referencePriceRows(context) {
    const rows = [];
    context.referencePrices.forEach((price, index) => {
        rows.push(`### 参考价格记录 ${index + 1}`);
        rows.push('');
        rows.push(`- 金额：${decimalValue(price.amount)} 人民币`);
        rows.push(`- 计价单位：${unitLabel(price.basisUnitCode)}`);
        rows.push(`- 记录时间：${price.observedAt}`);
        rows.push(`- 来源更新时间：${price.sourceUpdatedAt}`);
        rows.push(
            `- 计算方式：${price.derivationKind === 1
                ? '来源原始值'
                : price.derivationKind === 2
                    ? '按包装数量换算'
                    : `编号 ${price.derivationKind}`}`,
        );
        rows.push(`- 数据状态：${price.state === 1 ? '有效' : `编号 ${price.state}`}`);
        if (price.derivationDivisor) {
            rows.push(
                `- 换算除数：${decimalValue(price.derivationDivisor)}`,
            );
        }
        if (price.exactFractionNumerator
            && price.exactFractionDenominator) {
            rows.push(
                `- 精确分数：${price.exactFractionNumerator}/` +
                `${price.exactFractionDenominator}`,
            );
        }
        if (price.roundingMode) {
            const rounding = price.roundingMode === 'none'
                ? '不取整'
                : price.roundingMode === 'half-up'
                    ? '四舍五入'
                    : price.roundingMode;
            rows.push(`- 取整方式：${rounding}`);
        }
        if (price.roundingScale !== undefined) {
            rows.push(`- 小数位数：${price.roundingScale}`);
        }
        rows.push('');
    });
    return rows.length > 0 ? rows.slice(0, -1) : ['- 无'];
}

function sourceRows(context) {
    const rows = [
        `- 商品页面：<${context.sourceLinks.observedCanonicalUrl}>`,
        `- 稳定查询链接：<${context.sourceLinks.stableLookupUrl}>`,
        `- 采集时间：${context.sourceDestination.observedAt}`,
        `- 来源更新时间：${context.sourceUpdatedAt}`,
    ];
    if (context.diagnosticCodes.length > 0) {
        rows.push(`- 诊断代码：${context.diagnosticCodes.join('、')}`);
    } else {
        rows.push('- 诊断状态：无异常');
    }
    return rows;
}

function imageRows(context, options) {
    const rows = [];
    context.imageUris.forEach((uri, index) => {
        rows.push(`- 来源图片 ${index + 1}：<${uri}>`);
    });
    context.localImages.forEach((image, index) => {
        const localFile = path.join(
            options.sourceRoot,
            ...image.path.split('/'),
        );
        const markdownFile = path.join(
            options.packageRoot,
            ...options.relativePath.split('/'),
        );
        const relative = path.relative(
            path.dirname(markdownFile),
            localFile,
        ).split(path.sep).join('/');
        rows.push(
            `- 本地图片 ${index + 1}：` +
            `[打开图片](<${relative}>)` +
            `${image.isCover ? '（封面）' : ''}`,
        );
    });
    return rows.length > 0 ? rows : ['- 无'];
}

function markdownSection(title, rows) {
    return [
        `## ${title}`,
        '',
        ...rows,
        '',
    ];
}

function markdownDocument(product, context, options) {
    const translation = sourceTranslation(product);
    const document = {
        name: normalizeText(translation.name),
        description: normalizeText(translation.description),
    };
    assertDocumentValues(document, product.code);
    const basicFacts = factualRows(context, code =>
        !code.startsWith('market.')
        && !code.startsWith('release.'));
    const releaseFacts = factualRows(context, code =>
        code.startsWith('release.'));
    const pricingFacts = factualRows(context, code =>
        code.startsWith('market.pricing.'));
    const marketFacts = factualRows(context, code =>
        code.startsWith('market.aggregates.'));
    return [
        `# ${document.name}`,
        '',
        ...markdownSection('产品描述', [document.description]),
        ...markdownSection('产品资料', basicFacts),
        ...markdownSection('商品规格', specificationRows(context)),
        ...markdownSection('包装信息', packageRows(context)),
        ...markdownSection('发行信息', releaseFacts),
        ...markdownSection('参考价格（非零售价）', referencePriceRows(context)),
        ...markdownSection('市场价格信息', pricingFacts),
        ...markdownSection('市场数据', marketFacts),
        ...markdownSection('来源信息', sourceRows(context)),
        ...markdownSection('图片', imageRows(context, options)),
    ].join('\n');
}

function parseMarkdownDocument(file) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`${file} must be a real Markdown file.`);
    }
    const contents = fs.readFileSync(file, 'utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .normalize('NFC');
    const match =
        /^# ([^\n]+)\n\n## [^\n]+\n\n([\s\S]*?)\n\n## [^\n]+\n[\s\S]*\n$/
            .exec(contents);
    if (!match) {
        throw new Error(
            `${file} must keep the product title and complete section structure.`,
        );
    }
    const document = {
        name: normalizeText(match[1]),
        description: normalizeText(match[2]),
    };
    assertDocumentValues(document, file);
    return document;
}

function packageIdentity(manifest) {
    return sha256(stableJson({
        kind: manifest.kind,
        products: manifest.products,
        schemaVersion: manifest.schemaVersion,
        source: manifest.source,
    }));
}

function expectedRelativePath(item) {
    const parts = String(item.path || '').split('/');
    if (parts.length !== 3 || parts[0] !== '04-products') {
        throw new Error(`Invalid source product path for ${item.code}.`);
    }
    return `products/${parts[1]}/${item.code}.md`;
}

function normalizeContext(mapping, observation, localMedia) {
    const localizedText = (observation.localizedText || [])
        .filter(item => item.languageCode === SOURCE_LOCALE);
    if (localizedText.length !== 1) {
        throw new Error(
            `ZZCTea ${mapping.externalId} must have one Chinese source text.`,
        );
    }
    return {
        diagnosticCodes: [...(observation.diagnosticCodes || [])].map(String),
        externalId: String(mapping.externalId),
        factualAttributes: (observation.factualAttributes || [])
            .map(attribute => ({
                attributeCode: String(attribute.attributeCode || ''),
                normalizedValue: String(attribute.normalizedValue ?? ''),
            })),
        imageUris: [...new Set(
            (observation.imageUris || []).map(String),
        )],
        localImages: (localMedia?.items || []).map(item => ({
            bytes: item.bytes,
            contentType: item.contentType,
            isCover: item.isCover,
            order: item.order,
            path: `${localMedia.path}/${item.file}`,
            role: item.role,
            sha256: item.sha256,
        })),
        localizedText: localizedText[0],
        packageComponents: (observation.packageComponents || [])
            .map(component => ({
                containedUnitCode: String(component.containedUnitCode || ''),
                containerUnitCode: String(component.containerUnitCode || ''),
                ordinal: Number(component.ordinal),
                quantity: component.quantity,
            })),
        packageComponentsExact: observation.packageComponentsExact === true,
        rawPackageText: String(observation.rawPackageText || ''),
        referencePrices: (observation.referencePrices || []).map(price => ({
            amount: price.amount,
            basisUnitCode: String(price.basisUnitCode || ''),
            derivationDivisor: price.derivationDivisor,
            derivationKind: Number(price.derivationKind),
            exactFractionDenominator: price.exactFractionDenominator,
            exactFractionNumerator: price.exactFractionNumerator,
            observedAt: String(price.observedAt || ''),
            roundingMode: price.roundingMode,
            roundingScale: price.roundingScale,
            sourceUpdatedAt: String(price.sourceUpdatedAt || ''),
            state: Number(price.state),
        })),
        sourceDestination: {
            canonicalUri: String(
                observation.sourceDestination?.canonicalUri || '',
            ),
            lookupUri: String(
                observation.sourceDestination?.lookupUri || '',
            ),
            observedAt: String(
                observation.sourceDestination?.observedAt || '',
            ),
        },
        sourceLinks: {
            observedCanonicalUrl: String(
                mapping.sourceLinks?.observedCanonicalUrl || '',
            ),
            stableLookupUrl: String(
                mapping.sourceLinks?.stableLookupUrl || '',
            ),
        },
        specifications: [],
        sourceUpdatedAt: String(observation.sourceUpdatedAt || ''),
    };
}

function contextDigest(context) {
    return sha256(stableJson(context));
}

function assertContextBinding(context, source) {
    const manifest = context.manifest;
    const binding = source.manifest.source || {};
    if (!manifest
        || !DIGEST.test(String(manifest.bundleId || ''))
        || manifest.snapshotId !== source.manifest.snapshotId
        || manifest.sourceId !== 'zzctea'
        || manifest.applyAllowed !== false
        || manifest.productionWrites !== false
        || manifest.inputEvidence?.sourceArtifactSha256 !==
            binding.sourceArtifactSha256
        || manifest.inputEvidence?.projectionSha256 !==
            binding.projectionSha256
        || manifest.inputEvidence?.reconciliationSha256 !==
            binding.reconciliationSha256
        || manifest.inputEvidence?.mappingSha256 !==
            binding.mappingsSha256
        || manifest.inputEvidence?.productPatchesSha256 !==
            binding.productPatchesSha256
        || manifest.inputEvidence?.mediaItemsSha256 !==
            binding.mediaItemsSha256
        || manifest.inputEvidence?.mediaReceiptSha256 !==
            binding.mediaReceiptSha256
        || !(context.products instanceof Map)
        || context.products.size !== source.manifest.counts.products) {
        throw new Error(
            'Chinese Markdown source context does not match the Admin artifact.',
        );
    }
}

function loadVerifiedContextBundle(directory, source) {
    const verified = verifyImportBundle(directory);
    const root = verified.root;
    const mappings = readJson(path.join(
        root,
        'data',
        'source-product-mappings.json',
    ));
    const observationsDocument = readJson(path.join(
        root,
        'data',
        'commerce-observations.json',
    ));
    const localMedia = readJson(path.join(
        source.root,
        '07-media',
        'products',
        'media.json',
    ));
    const observationByExternalId = new Map(
        observationsDocument.items.map(item => [
            String(item.externalId),
            item.observation,
        ]),
    );
    const mediaByProduct = new Map(
        localMedia.map(item => [String(item.product), item]),
    );
    const sourceProductByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    const products = new Map();
    for (const mapping of mappings) {
        const code = String(mapping.productCode || '');
        const observation = observationByExternalId.get(
            String(mapping.externalId),
        );
        if (!code || products.has(code) || !observation) {
            throw new Error(
                `ZZCTea context mapping is incomplete for ${mapping.externalId}.`,
            );
        }
        const sourceProduct = sourceProductByCode.get(code);
        if (!sourceProduct) {
            throw new Error(`ZZCTea source product is missing for ${code}.`);
        }
        const productContext = normalizeContext(
            mapping,
            observation,
            mediaByProduct.get(code),
        );
        productContext.specifications = normalizeSpecifications(
            sourceProduct,
            source.bundle,
        );
        products.set(code, productContext);
    }
    const context = {
        manifest: verified.manifest,
        products,
    };
    assertContextBinding(context, source);
    return context;
}

function contextSourceBinding(context) {
    return {
        bundleId: context.manifest.bundleId,
        inputEvidenceSha256: sha256(stableJson(
            context.manifest.inputEvidence,
        )),
        snapshotId: context.manifest.snapshotId,
        version: context.manifest.version,
    };
}

function writeChineseMarkdownPackage(options) {
    let sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    let sourceArchive = null;
    if (options.sourceArchiveDirectory) {
        sourceArchive = archiveTranslationSource({
            sourceDirectory: sourceRoot,
            outputDirectory: options.sourceArchiveDirectory,
        });
        sourceRoot = sourceArchive.outputDirectory;
    }
    const outputRoot = assertSeparateOutput(sourceRoot, options.outputDirectory);
    const source = verifyAdminConsoleArtifact(sourceRoot);
    const context = options.context || loadVerifiedContextBundle(
        options.contextBundleDirectory,
        source,
    );
    assertContextBinding(context, source);
    const productByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    let manifest;
    withStagedOutput(outputRoot, stagingDirectory => {
        const products = source.manifest.products.map(item => {
            const product = productByCode.get(item.code);
            const productContext = context.products.get(item.code);
            if (!product || !productContext) {
                throw new Error(`Artifact product ${item.code} is unavailable.`);
            }
            const sourceText = sourceTranslation(product);
            if (productContext.localizedText.title !== sourceText.name
                || productContext.localizedText.description !==
                    sourceText.description) {
                throw new Error(
                    `Chinese source text differs for ${item.code}.`,
                );
            }
            const relativePath = expectedRelativePath(item);
            const contents = markdownDocument(product, productContext, {
                packageRoot: stagingDirectory,
                relativePath,
                sourceRoot,
            });
            const file = path.join(
                stagingDirectory,
                ...relativePath.split('/'),
            );
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, contents);
            return {
                code: item.code,
                file: relativePath,
                sourceContextSha256: contextDigest(productContext),
                sourceMarkdownSha256: sha256(contents),
                sourceProductPath: item.path,
                sourceTranslationSha256: sourceTranslationSha256(product),
            };
        });
        manifest = {
            schemaVersion: PACKAGE_SCHEMA_VERSION,
            kind: PACKAGE_KIND,
            source: {
                artifactId: source.manifest.artifactId,
                context: contextSourceBinding(context),
                locale: SOURCE_LOCALE,
                snapshotId: source.manifest.snapshotId,
                version: source.manifest.version,
            },
            productCount: products.length,
            products,
            safety: {
                productionWrites: false,
                sourceArtifactMutation: false,
            },
        };
        manifest.packageId = packageIdentity(manifest);
        writeJsonAtomic(
            path.join(stagingDirectory, 'translation-manifest.json'),
            manifest,
        );
        verifyChineseMarkdownPackage(stagingDirectory, {
            context,
            sourceRoot,
            requireTranslated: false,
        });
        return manifest;
    });
    return {
        manifest,
        outputDirectory: outputRoot,
        sourceArchive,
    };
}

function verifyManifestContext(manifest, context) {
    const binding = manifest.source?.context;
    if (!binding
        || !DIGEST.test(String(binding.bundleId || ''))
        || !DIGEST.test(String(binding.inputEvidenceSha256 || ''))
        || binding.snapshotId !== manifest.source.snapshotId
        || typeof binding.version !== 'string'
        || !binding.version.startsWith(`${binding.snapshotId}.`)) {
        throw new Error('Chinese Markdown context binding is invalid.');
    }
    if (context && stableJson(binding) !==
        stableJson(contextSourceBinding(context))) {
        throw new Error('Chinese Markdown context bundle differs from manifest.');
    }
}

function verifyChineseMarkdownPackage(directory, options = {}) {
    const root = assertRealDirectory(directory, 'Chinese Markdown package');
    const sourceRoot = assertRealDirectory(
        options.sourceRoot,
        'Source Admin Console artifact',
    );
    const source = verifyAdminConsoleArtifact(sourceRoot);
    const context = options.context || null;
    if (context) assertContextBinding(context, source);
    const manifest = readJson(path.join(root, 'translation-manifest.json'));
    if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION
        || manifest.kind !== PACKAGE_KIND
        || manifest.source?.artifactId !== source.manifest.artifactId
        || manifest.source?.version !== source.manifest.version
        || manifest.source?.snapshotId !== source.manifest.snapshotId
        || manifest.source?.locale !== SOURCE_LOCALE
        || manifest.safety?.productionWrites !== false
        || manifest.safety?.sourceArtifactMutation !== false
        || manifest.packageId !== packageIdentity(manifest)) {
        throw new Error('Chinese Markdown package manifest binding is invalid.');
    }
    verifyManifestContext(manifest, context);
    if (!Array.isArray(manifest.products)
        || manifest.productCount !== source.manifest.counts.products
        || manifest.products.length !== source.manifest.counts.products) {
        throw new Error('Chinese Markdown package product count is incomplete.');
    }
    if (options.requireTranslated !== true && !context) {
        throw new Error(
            'Chinese source package verification requires its context bundle.',
        );
    }
    const sourceByCode = new Map(
        source.bundle.products.map(product => [product.code, product]),
    );
    const sourcePathByCode = new Map(
        source.manifest.products.map(item => [item.code, item.path]),
    );
    const expectedFiles = new Set(['translation-manifest.json']);
    const translations = [];
    const seenCodes = new Set();
    for (const item of manifest.products) {
        const product = sourceByCode.get(item.code);
        const sourceProductPath = sourcePathByCode.get(item.code);
        const productContext = context?.products.get(item.code);
        const expectedFile = expectedRelativePath({
            code: item.code,
            path: sourceProductPath,
        });
        let sourceContents = null;
        if (product && productContext) {
            sourceContents = markdownDocument(product, productContext, {
                packageRoot: root,
                relativePath: expectedFile,
                sourceRoot,
            });
        }
        if (!product || seenCodes.has(item.code)
            || item.sourceProductPath !== sourceProductPath
            || item.file !== expectedFile
            || item.sourceTranslationSha256 !==
                sourceTranslationSha256(product)
            || !DIGEST.test(String(item.sourceContextSha256 || ''))
            || !DIGEST.test(String(item.sourceMarkdownSha256 || ''))
            || (productContext
                && item.sourceContextSha256 !== contextDigest(productContext))
            || (sourceContents
                && item.sourceMarkdownSha256 !== sha256(sourceContents))) {
            throw new Error(
                `Chinese Markdown package source drift for ${item.code}.`,
            );
        }
        seenCodes.add(item.code);
        expectedFiles.add(item.file);
        const file = path.join(root, ...item.file.split('/'));
        const document = parseMarkdownDocument(file);
        const contentsSha256 = sha256(fs.readFileSync(file));
        const sourceText = sourceTranslation(product);
        if (options.requireTranslated === true
            && (contentsSha256 === item.sourceMarkdownSha256
                || (document.name === sourceText.name
                    && document.description === sourceText.description))) {
            throw new Error(`${item.file} was not translated.`);
        }
        if (options.requireTranslated !== true
            && contentsSha256 !== item.sourceMarkdownSha256) {
            throw new Error(`${item.file} differs from the Chinese source.`);
        }
        translations.push({
            code: item.code,
            translation: document,
        });
    }
    if (seenCodes.size !== source.manifest.counts.products) {
        throw new Error('Chinese Markdown package product codes are incomplete.');
    }
    const actualFiles = walkFiles(root);
    if (actualFiles.length !== expectedFiles.size
        || actualFiles.some(file => !expectedFiles.has(file))) {
        throw new Error(
            'Chinese Markdown package contains missing or unexpected files.',
        );
    }
    return { manifest, root, source, translations };
}

function importTranslatedChineseMarkdown(options) {
    const sourceRoot = assertRealDirectory(
        options.sourceDirectory,
        'Source Admin Console artifact',
    );
    const outputRoot = assertSeparateOutput(sourceRoot, options.outputDirectory);
    const targetLocale = canonicalLocale(options.targetLocale);
    if (targetLocale === SOURCE_LOCALE) {
        throw new Error(`${SOURCE_LOCALE} is the protected source locale.`);
    }
    const translated = verifyChineseMarkdownPackage(
        options.packageDirectory,
        {
            sourceRoot,
            requireTranslated: true,
        },
    );
    const translationByCode = new Map(
        translated.translations.map(item => [item.code, {
            lang: targetLocale,
            ...item.translation,
        }]),
    );
    const source = verifyAdminConsoleArtifact(sourceRoot);
    let manifest;
    withStagedOutput(outputRoot, stagingDirectory => {
        copyTree(sourceRoot, stagingDirectory);
        for (const item of source.manifest.products) {
            const productFile = path.join(
                stagingDirectory,
                ...item.path.split('/'),
            );
            const records = readJson(productFile);
            if (!Array.isArray(records) || records.length !== 1) {
                throw new Error(
                    `${item.path} must contain exactly one product.`,
                );
            }
            const product = records[0];
            const incoming = translationByCode.get(item.code);
            if (!incoming) {
                throw new Error(`Translation is missing for ${item.code}.`);
            }
            product.translations = [
                ...(product.translations || [])
                    .filter(entry => entry.lang !== targetLocale),
                incoming,
            ].sort((left, right) => left.lang.localeCompare(right.lang));
            product.replaceTranslations = true;
            fs.writeFileSync(
                productFile,
                `${JSON.stringify(records, null, 2)}\n`,
            );
        }
        manifest = readJson(
            path.join(stagingDirectory, 'artifact-manifest.json'),
        );
        manifest.requiredLocales = [...new Set([
            ...(manifest.requiredLocales || []),
            targetLocale,
        ])].sort();
        manifest.localization = {
            ...(manifest.localization || {}),
            humanTranslatedLocales: [...new Set([
                ...(manifest.localization?.humanTranslatedLocales || []),
                targetLocale,
            ])].sort(),
        };
        const translationContent = translated.translations.map(item => ({
            code: item.code,
            translation: {
                lang: targetLocale,
                ...item.translation,
            },
        }));
        manifest.translationInterchange = {
            packages: [{
                packageId: translated.manifest.packageId,
                targetLocales: [targetLocale],
                translationContentSha256: sha256(
                    stableJson(translationContent),
                ),
            }],
            sourceArtifactId: source.manifest.artifactId,
            targetLocales: [targetLocale],
        };
        manifest.files = artifactFiles(stagingDirectory);
        manifest.artifactId = artifactIdentity(manifest);
        manifest.version =
            `${manifest.snapshotId}.${manifest.artifactId.slice(0, 12)}`;
        writeJsonAtomic(
            path.join(stagingDirectory, 'artifact-manifest.json'),
            manifest,
        );
        verifyAdminConsoleArtifact(stagingDirectory);
        return manifest;
    });
    return {
        manifest,
        outputDirectory: outputRoot,
        targetLocale,
    };
}

module.exports = {
    FACT_LABELS,
    PACKAGE_KIND,
    PACKAGE_SCHEMA_VERSION,
    contextDigest,
    importTranslatedChineseMarkdown,
    loadVerifiedContextBundle,
    markdownDocument,
    normalizeContext,
    normalizeSpecifications,
    parseMarkdownDocument,
    verifyChineseMarkdownPackage,
    writeChineseMarkdownPackage,
};
