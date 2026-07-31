#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    buildPhotoMapping,
    matchPhotoFolder,
    materializePhotoMedia,
    parsePhotoFolderName,
    selectPhotoAssets,
} = require('./lib/photo-media');

function product(code, russian, native, transcription) {
    return {
        code,
        translations: [
            { lang: 'ru-RU', name: russian, transcription },
            { lang: 'zh-CN', name: native, transcription },
        ],
    };
}

function jpeg(file, marker = 0) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, marker]));
}

function writeProduct(artifactDir, record) {
    const dir = path.join(artifactDir, '04-products', 'TEST');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${record.code}.json`), JSON.stringify([record]));
}

const parsed = parsePhotoFolderName(
    '乌龙茶-13.Да Ю Лин Улун (大禹嶺烏龍, dà yǔ lǐng wūlóng)');
assert.strictEqual(parsed.family, '乌龙茶');
assert.strictEqual(parsed.index, 13);
assert.strictEqual(parsed.russian, 'Да Ю Лин Улун');
assert.strictEqual(parsed.native, '大禹嶺烏龍');

const products = [
    product('TEA-CN-DA-YU-LING-WULONG', 'Да Ю Лин Улун', '大禹岭乌龙', 'dà yǔ lǐng wūlóng'),
    product('TEA-CN-BILUOCHUN', 'Билочунь', '碧螺春', 'bìluóchūn'),
    product('TEA-CN-BILUOCHUN-FENJI', 'Би Ло Чунь', '碧螺春', 'bìluóchūn'),
];
const traditional = matchPhotoFolder(parsed, products);
assert.strictEqual(traditional.code, 'TEA-CN-DA-YU-LING-WULONG');
assert.strictEqual(traditional.method, 'transcription');

const biluochun = matchPhotoFolder(
    parsePhotoFolderName('绿茶-12.Билочунь (碧螺春, bìluóchūn)'),
    products);
assert.strictEqual(biluochun.code, 'TEA-CN-BILUOCHUN');
assert.strictEqual(biluochun.method, 'transcription+russian');

assert.throws(
    () => matchPhotoFolder(
        parsePhotoFolderName('绿茶-12.Билочунь (碧螺春, bìluóchūn)'),
        [
            product('TEA-1', 'Билочунь', '碧螺春', 'bìluóchūn'),
            product('TEA-2', 'Билочунь', '碧螺春', 'bìluóchūn'),
        ]),
    /Ambiguous transcription match/);
assert.throws(
    () => matchPhotoFolder(
        parsePhotoFolderName('绿茶-99.Нет такого чая (不存在, bù cúnzài)'),
        products),
    /No transcription match/);
assert.throws(
    () => matchPhotoFolder(
        parsePhotoFolderName('绿茶-99.Билочунь (碧螺春, bù cúnzài)'),
        products),
    /No transcription match/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thetea-photo-media-'));
try {
    const photoRoot = path.join(tempRoot, 'foto');
    const artifactDir = path.join(tempRoot, 'artifact');
    const outputDir = path.join(tempRoot, 'prepared');
    const folderName = '绿茶-12.Билочунь (碧螺春, bìluóchūn)';
    const selectedDir = path.join(photoRoot, '1 photo ready', folderName);
    const galleryDir = path.join(photoRoot, folderName, 'готовые', 'jpg');
    jpeg(path.join(selectedDir, 'DSC0002.jpg'), 2);
    fs.writeFileSync(path.join(selectedDir, 'DSC0002.png'), 'ignored');
    jpeg(path.join(galleryDir, 'DSC0001.jpg'), 1);
    jpeg(path.join(galleryDir, 'DSC0002.jpg'), 2);
    fs.writeFileSync(path.join(photoRoot, 'archive.zip'), 'ignored');
    writeProduct(artifactDir, products[1]);
    writeProduct(artifactDir, product('TEA-OTHER', 'Другой чай', '其他茶', 'qítā chá'));

    const selected = selectPhotoAssets(photoRoot, folderName);
    assert.strictEqual(selected.kind, 'gallery');
    assert.deepStrictEqual(
        selected.assets.map(item => item.outputName),
        ['00-cover.jpg', '01-DSC0001.jpg']);

    const mapping = buildPhotoMapping({ artifactDir, photoRoot });
    assert.deepStrictEqual(mapping.summary, {
        productsTotal: 2,
        matchedProducts: 1,
        unmatchedProducts: 1,
        galleries: 1,
        coverOnly: 0,
        imageCount: 2,
        uniqueContentHashes: 2,
        bytes: 8,
    });
    assert.deepStrictEqual(mapping.unmatchedProductCodes, ['TEA-OTHER']);

    const report = materializePhotoMedia(
        mapping,
        { outputDir, artifactDir, photoRoot });
    assert.strictEqual(report.records[0].productCode, 'TEA-CN-BILUOCHUN');
    assert.ok(fs.existsSync(path.join(
        outputDir,
        'TEA-CN-BILUOCHUN',
        '00-cover.jpg')));
    assert.ok(fs.existsSync(path.join(outputDir, 'photo-mapping.json')));
    assert.throws(
        () => materializePhotoMedia(mapping, { outputDir, artifactDir, photoRoot }),
        /refusing to replace/);

    fs.writeFileSync(path.join(selectedDir, 'DSC0002.jpg'), 'not-a-jpeg');
    assert.throws(
        () => selectPhotoAssets(photoRoot, folderName),
        /Invalid JPEG signature/);
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('test-photo-media: OK');
