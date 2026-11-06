#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, parseArgs, csv, requireArg } = require('./lib/env');
const { readArtifactBundle, sha256, writeJson } = require('./lib/artifact-bundle');
const { assertScopedPath, withStagedOutput } = require('./lib/generated-output');
const { articleDto, faqEntryDto, FAQ_DEFINITION } = require('./lib/routed-content');
const { verifyApplyInputs } = require('./import-routed-content');

function prepareRecords(bundle, args = {}, contentReference) {
    const selected = new Set(csv(args.only).map(value => value.toLowerCase()));
    const matches = value => !selected.size || [value.code, value.slug, value.product]
        .some(key => key && selected.has(String(key).toLowerCase()));
    const topics = (bundle.routedContent.topics || []).filter(matches);
    const articles = args['topics-only'] ? [] : bundle.routedContent.articles.filter(matches);
    const faqs = args['topics-only'] ? [] : bundle.routedContent.metaobjects.filter(matches);
    const records = [...articles, ...topics].map(article => {
        const dto = articleDto(article);
        const references = contentReference?.articles?.filter(item => item.slug === dto.slug);
        if (contentReference && references?.length !== 1) throw new Error(`Missing or duplicate content reference for ${dto.slug}.`);
        const existing = references?.[0]?.post;
        if (contentReference && existing !== null) {
            if (!existing || existing.slug !== dto.slug || typeof existing.isDraft !== 'boolean'
                || !Array.isArray(existing.translations) || !Object.hasOwn(existing, 'coverImageAttachmentId')
                || (existing.coverImageAttachmentId !== null && (typeof existing.coverImageAttachmentId !== 'string' || !existing.coverImageAttachmentId.trim()))) {
                throw new Error(`Incomplete content reference for ${dto.slug}.`);
            }
            const translations = new Map(existing.translations.map(item => [item.languageCode.toLowerCase(), item]));
            for (const item of dto.translations) translations.set(item.languageCode.toLowerCase(), item);
            dto.translations = [...translations.values()];
            dto.coverImageAttachmentId = existing.coverImageAttachmentId;
        }
        return { recordKey: `ARTICLE:${dto.slug}`, blogPost: { ...dto,
            publish: existing ? !existing.isDraft : args.publish === true } };
    });
    if (faqs.length) {
        records.unshift({
            recordKey: `DEFINITION:${FAQ_DEFINITION.key}`,
            metaobjectDefinition: {
                key: FAQ_DEFINITION.key,
                name: FAQ_DEFINITION.name,
                description: FAQ_DEFINITION.description,
                schemaJson: JSON.stringify(FAQ_DEFINITION.schema),
            },
        });
        for (const faq of faqs) {
            const dto = faqEntryDto(faq);
            records.push({ recordKey: `FAQ:${dto.handle}`, metaobjectEntry: { ...dto, definitionKey: FAQ_DEFINITION.key } });
        }
    }
    if (!records.length) throw new Error('No exact routed-content identities selected.');
    if (new Set(records.map(record => record.recordKey)).size !== records.length) throw new Error('Duplicate routed-content identity.');
    return records;
}

function main() {
    const args = parseArgs();
    if (args.apply || args.yes) throw new Error('This command only prepares files; apply through SetupTool.');
    const root = path.resolve(REPO_ROOT, requireArg(args, 'dir'));
    const bundle = readArtifactBundle(root);
    if (!bundle.valid) throw new Error(bundle.errors.join('\n'));
    verifyApplyInputs(bundle, args);
    const contentReferencePath = path.resolve(REPO_ROOT, requireArg(args, 'content-ref'));
    const contentReferenceBytes = fs.readFileSync(contentReferencePath);
    const contentReference = JSON.parse(contentReferenceBytes);
    const storefrontId = requireArg(args, 'storefront-id');
    if (contentReference.storefrontId !== storefrontId || !Array.isArray(contentReference.articles)
        || contentReference.articles.some(item => !Object.hasOwn(item, 'post') || (item.post && item.post.storefrontId !== storefrontId))) {
        throw new Error('Content reference must contain exact scoped GET results or explicit absent posts.');
    }
    const records = prepareRecords(bundle, args, contentReference);
    const target = assertScopedPath(path.resolve(REPO_ROOT, requireArg(args, 'out')), {
        repoRoot: REPO_ROOT,
        allowedRoot: path.join(REPO_ROOT, 'reports', 'thetea'),
        label: 'SetupTool content preparation',
    });
    withStagedOutput(target, staged => {
        writeJson(path.join(staged, 'records.json'), records);
        writeJson(path.join(staged, 'preparation.json'), {
            storefrontId,
            contentReferenceSha256: sha256(contentReferenceBytes),
            sourceArtifactManifestSha256: sha256(fs.readFileSync(path.join(root, 'artifact-manifest.json'))),
            recordsSha256: sha256(fs.readFileSync(path.join(staged, 'records.json'))),
            recordKeys: records.map(record => record.recordKey),
            publishRequested: args.publish === true,
        });
    });
    console.log(`Prepared ${records.length} records for SetupTool: ${target}`);
}

if (require.main === module) main();
module.exports = { prepareRecords };
