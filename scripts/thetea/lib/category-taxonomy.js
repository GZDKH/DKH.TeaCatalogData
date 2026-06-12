const { normalizeCodePart } = require('./spec-registry');

const TEA_TYPE_CATEGORY = {
    green: 'CAT-GREEN-TEA',
    white: 'CAT-WHITE-TEA',
    yellow: 'CAT-YELLOW-TEA',
    oolong: 'CAT-OOLONG-TEA',
    red: 'CAT-RED-TEA',
    dark: 'CAT-DARK-TEA',
    puer: 'CAT-PUER-TEA',
};

const PROVINCE_CATEGORY = {
    Anhui: 'CAT-REGION-ANHUI',
    Chongqing: 'CAT-REGION-CHONGQING',
    Fujian: 'CAT-REGION-FUJIAN',
    Guangdong: 'CAT-REGION-GUANGDONG',
    Guangxi: 'CAT-REGION-GUANGXI',
    Guizhou: 'CAT-REGION-GUIZHOU',
    Hainan: 'CAT-REGION-HAINAN',
    Henan: 'CAT-REGION-HENAN',
    Hubei: 'CAT-REGION-HUBEI',
    Hunan: 'CAT-REGION-HUNAN',
    Jiangsu: 'CAT-REGION-JIANGSU',
    Jiangxi: 'CAT-REGION-JIANGXI',
    Jilin: 'CAT-REGION-JILIN',
    Shaanxi: 'CAT-REGION-SHAANXI',
    Shandong: 'CAT-REGION-SHANDONG',
    Sichuan: 'CAT-REGION-SICHUAN',
    Taiwan: 'CAT-REGION-TAIWAN',
    Tibet: 'CAT-REGION-TIBET',
    Xinjiang: 'CAT-REGION-XINJIANG',
    Yunnan: 'CAT-REGION-YUNNAN',
    Zhejiang: 'CAT-REGION-ZHEJIANG',
};

const TYPE_DETAILS = {
    green: names('Green Tea', 'Зеленый чай', '绿茶', 'green-tea'),
    white: names('White Tea', 'Белый чай', '白茶', 'white-tea'),
    yellow: names('Yellow Tea', 'Желтый чай', '黄茶', 'yellow-tea'),
    oolong: names('Oolong Tea', 'Улун', '乌龙茶', 'oolong-tea'),
    red: names('Red Tea', 'Красный чай', '红茶', 'red-tea'),
    dark: names('Dark Tea', 'Темный чай', '黑茶', 'dark-tea'),
    puer: names('Pu-erh Tea', 'Пуэр', '普洱茶', 'puer-tea'),
};

const PROVINCE_DETAILS = {
    Anhui: names('Anhui', 'Аньхой', '安徽', 'anhui'),
    Chongqing: names('Chongqing', 'Чунцин', '重庆', 'chongqing'),
    Fujian: names('Fujian', 'Фуцзянь', '福建', 'fujian'),
    Guangdong: names('Guangdong', 'Гуандун', '广东', 'guangdong'),
    Guangxi: names('Guangxi', 'Гуанси', '广西', 'guangxi'),
    Guizhou: names('Guizhou', 'Гуйчжоу', '贵州', 'guizhou'),
    Hainan: names('Hainan', 'Хайнань', '海南', 'hainan'),
    Henan: names('Henan', 'Хэнань', '河南', 'henan'),
    Hubei: names('Hubei', 'Хубэй', '湖北', 'hubei'),
    Hunan: names('Hunan', 'Хунань', '湖南', 'hunan'),
    Jiangsu: names('Jiangsu', 'Цзянсу', '江苏', 'jiangsu'),
    Jiangxi: names('Jiangxi', 'Цзянси', '江西', 'jiangxi'),
    Jilin: names('Jilin', 'Цзилинь', '吉林', 'jilin'),
    Shaanxi: names('Shaanxi', 'Шэньси', '陕西', 'shaanxi'),
    Shandong: names('Shandong', 'Шаньдун', '山东', 'shandong'),
    Sichuan: names('Sichuan', 'Сычуань', '四川', 'sichuan'),
    Taiwan: names('Taiwan', 'Тайвань', '台灣', 'taiwan'),
    Tibet: names('Tibet', 'Тибет', '西藏', 'tibet'),
    Xinjiang: names('Xinjiang', 'Синьцзян', '新疆', 'xinjiang'),
    Yunnan: names('Yunnan', 'Юньнань', '云南', 'yunnan'),
    Zhejiang: names('Zhejiang', 'Чжэцзян', '浙江', 'zhejiang'),
};

const SHAPE_CATEGORY = {
    needle: 'CAT-SHAPE-NEEDLE',
    flat: 'CAT-SHAPE-FLAT',
    strip: 'CAT-SHAPE-STRIP',
    spiral: 'CAT-SHAPE-SPIRAL',
    brick: 'CAT-SHAPE-BRICK',
    pearl: 'CAT-SHAPE-PEARL',
    cake: 'CAT-SHAPE-CAKE',
};

const SHAPE_DETAILS = {
    needle: names('Needle Leaf', 'Иглы', '针形', 'needle-leaf'),
    flat: names('Flat Leaf', 'Плоский лист', '扁形', 'flat-leaf'),
    strip: names('Strip Leaf', 'Полосовой лист', '条索形', 'strip-leaf'),
    spiral: names('Spiral Leaf', 'Спираль', '螺形', 'spiral-leaf'),
    brick: names('Brick Tea', 'Кирпич', '砖形', 'brick-tea'),
    pearl: names('Pearl Tea', 'Жемчужина', '珠形', 'pearl-tea'),
    cake: names('Cake Tea', 'Блин', '饼形', 'cake-tea'),
};

const PROCESSING_CATEGORY = {
    chaoqing: 'CAT-PROC-CHAOQING',
    hongqing: 'CAT-PROC-HONGQING',
    zhengqing: 'CAT-PROC-ZHENGQING',
};

const PROCESSING_DETAILS = {
    chaoqing: names('Pan-Fired Processing', 'Обжарка на сковороде', '炒青', 'pan-fired-processing'),
    hongqing: names('Baked Processing', 'Сушка пропеканием', '烘青', 'baked-processing'),
    zhengqing: names('Steamed Processing', 'Паровая обработка', '蒸青', 'steamed-processing'),
};

const ROAST_CATEGORY = {
    none: 'CAT-ROAST-NONE',
    light: 'CAT-ROAST-LIGHT',
    medium: 'CAT-ROAST-MEDIUM',
    heavy: 'CAT-ROAST-HEAVY',
};

const ROAST_DETAILS = {
    none: names('No Roast', 'Без прожарки', '无焙火', 'no-roast'),
    light: names('Light Roast', 'Легкая прожарка', '轻焙火', 'light-roast'),
    medium: names('Medium Roast', 'Средняя прожарка', '中焙火', 'medium-roast'),
    heavy: names('Heavy Roast', 'Сильная прожарка', '重焙火', 'heavy-roast'),
};

const SPECIALTY_TAG_CATEGORY = {
    gi: 'CAT-SPEC-GI',
    'unesco-ich': 'CAT-SPEC-UNESCO-ICH',
    'ten-famous-teas': 'CAT-SPEC-TEN-FAMOUS-TEAS',
    'three-needles': 'CAT-SPEC-THREE-NEEDLES',
    'needle-shape': 'CAT-SPEC-NEEDLE-SHAPE',
};

const SPECIALTY_DETAILS = {
    gi: names('Geographical Indication', 'Географическое указание', '地理标志', 'geographical-indication'),
    'unesco-ich': names('UNESCO Intangible Heritage', 'Нематериальное наследие UNESCO', '联合国教科文组织非遗', 'unesco-intangible-heritage'),
    'ten-famous-teas': names('Ten Famous Teas', 'Десять знаменитых чаев', '十大名茶', 'ten-famous-teas'),
    'three-needles': names('Three Needles', 'Три иглы', '三针', 'three-needles'),
    'needle-shape': names('Needle Shape', 'Форма иглы', '针形茶', 'needle-shape'),
};

const FAMILY_EN = {
    1: 'Longjing System',
    2: 'Zhejiang Green Teas',
    3: 'Wuyi Rock Teas',
    4: 'Fujian White Teas',
    5: 'Southern Fujian Oolongs',
    6: 'Fujian Red Teas',
    7: 'Jasmine Teas',
    8: 'High Mountain Oolongs',
    9: 'Phoenix Dancongs',
    10: 'Yingde Red Teas',
};

const TEA_TYPE_TAGS = new Set(Object.keys(TEA_TYPE_CATEGORY));
const REGION_TAGS = new Set(Object.keys(PROVINCE_CATEGORY).map(x => x.toLowerCase()));

function names(en, ru, zh, seo) {
    return { en, ru, zh, seo };
}

function translation(lang, name, seo, description) {
    return {
        lang,
        name,
        ...(description ? { description } : {}),
        seo,
    };
}

function category(code, parent, order, detail, description, extra = {}) {
    return {
        code,
        parent,
        order,
        published: true,
        ...extra,
        translations: [
            translation('en-US', detail.en, detail.seo, description?.en),
            translation('ru-RU', detail.ru, detail.seo, description?.ru),
            translation('zh-CN', detail.zh, detail.seo, description?.zh),
        ],
    };
}

function buildCategoryAssignments(card, warnings = []) {
    const meta = card.meta || {};
    const codes = [];

    addMapped(codes, TEA_TYPE_CATEGORY, meta.tea_type, 'tea_type', card, warnings);

    const provinceCategory = PROVINCE_CATEGORY[meta.province];
    if (provinceCategory) codes.push(provinceCategory);
    else if (meta.province) {
        codes.push('CAT-REGION-CHINA');
        warnings.push(`No DKH region category mapping for province '${meta.province}' (${card.slug}); used CAT-REGION-CHINA.`);
    }

    addMapped(codes, SHAPE_CATEGORY, meta.shape, 'shape', card, warnings);
    addMapped(codes, PROCESSING_CATEGORY, meta.processing, 'processing', card, warnings);
    addMapped(codes, ROAST_CATEGORY, meta.roast_level, 'roast_level', card, warnings);

    if (meta.family_id !== undefined && meta.family_id !== null && meta.family_id !== '') {
        codes.push(`CAT-FAMILY-${normalizeCodePart(meta.family_id)}`);
    }

    for (const tag of card.tags || []) {
        const normalized = String(tag || '').toLowerCase();
        if (TEA_TYPE_TAGS.has(normalized) || REGION_TAGS.has(normalized)) continue;
        const categoryCode = SPECIALTY_TAG_CATEGORY[normalized];
        if (categoryCode) codes.push(categoryCode);
    }

    return [...new Set(codes)];
}

function addMapped(codes, map, value, field, card, warnings) {
    if (value === undefined || value === null || value === '') return;
    const normalized = String(value);
    const code = map[normalized];
    if (code) codes.push(code);
    else warnings.push(`No DKH category mapping for TheTea ${field} '${value}' (${card.slug}).`);
}

function buildTheTeaCategories(cards = [], options = {}) {
    const observed = collectObserved(cards);
    const all = [
        category('CAT-ROOT', null, 0, names('Tea Catalog', 'Каталог чая', '茶叶目录', 'tea')),
        category('CAT-BY-TYPE', 'CAT-ROOT', 1, names('By Type', 'По типу', '按类型', 'by-type')),
        ...orderedEntries(TEA_TYPE_CATEGORY, observed.teaTypes)
            .map(([value, code], index) => category(code, 'CAT-BY-TYPE', index + 1, TYPE_DETAILS[value])),
        category('CAT-BY-REGION', 'CAT-ROOT', 2, names('By Region', 'По региону', '按地区', 'by-region')),
        category('CAT-REGION-CHINA', 'CAT-BY-REGION', 1, names('China', 'Китай', '中国', 'china')),
        ...orderedEntries(PROVINCE_CATEGORY, observed.provinces)
            .map(([value, code], index) => category(code, 'CAT-REGION-CHINA', index + 1, PROVINCE_DETAILS[value])),
        category('CAT-BY-SHAPE', 'CAT-ROOT', 3, names('By Leaf Shape', 'По форме листа', '按叶形', 'by-leaf-shape')),
        ...orderedEntries(SHAPE_CATEGORY, observed.shapes)
            .map(([value, code], index) => category(code, 'CAT-BY-SHAPE', index + 1, SHAPE_DETAILS[value])),
        category('CAT-BY-PROCESSING', 'CAT-ROOT', 4, names('By Processing', 'По обработке', '按工艺', 'by-processing')),
        ...orderedEntries(PROCESSING_CATEGORY, observed.processing)
            .map(([value, code], index) => category(code, 'CAT-BY-PROCESSING', index + 1, PROCESSING_DETAILS[value])),
        category('CAT-BY-ROAST', 'CAT-ROOT', 5, names('By Roast Level', 'По уровню прожарки', '按焙火', 'by-roast-level')),
        ...orderedEntries(ROAST_CATEGORY, observed.roasts)
            .map(([value, code], index) => category(code, 'CAT-BY-ROAST', index + 1, ROAST_DETAILS[value])),
        category('CAT-BY-SPECIALTY', 'CAT-ROOT', 6, names('By Specialty', 'По особенностям', '按特色', 'by-specialty')),
        ...orderedEntries(SPECIALTY_TAG_CATEGORY, observed.specialtyTags)
            .map(([value, code], index) => category(code, 'CAT-BY-SPECIALTY', index + 1, SPECIALTY_DETAILS[value])),
        ...buildFamilyCategories(options.family),
    ];

    return filterExisting(all.filter(Boolean), options.existingCategoryCodes);
}

function orderedEntries(map, observed) {
    return Object.entries(map).filter(([value]) => observed.has(value));
}

function collectObserved(cards) {
    const result = {
        teaTypes: new Set(),
        provinces: new Set(),
        shapes: new Set(),
        processing: new Set(),
        roasts: new Set(),
        specialtyTags: new Set(),
    };

    for (const card of cards || []) {
        const meta = card.meta || {};
        if (TEA_TYPE_CATEGORY[meta.tea_type]) result.teaTypes.add(meta.tea_type);
        if (PROVINCE_CATEGORY[meta.province]) result.provinces.add(meta.province);
        if (SHAPE_CATEGORY[meta.shape]) result.shapes.add(meta.shape);
        if (PROCESSING_CATEGORY[meta.processing]) result.processing.add(meta.processing);
        if (ROAST_CATEGORY[meta.roast_level]) result.roasts.add(meta.roast_level);
        for (const tag of card.tags || []) {
            const normalized = String(tag || '').toLowerCase();
            if (SPECIALTY_TAG_CATEGORY[normalized]) result.specialtyTags.add(normalized);
        }
    }

    return result;
}

function buildFamilyCategories(family) {
    const families = family?.families || [];
    if (!families.length) return [];

    return [
        category('CAT-BY-FAMILY', 'CAT-ROOT', 7, names('By Tea Family', 'По семейству чая', '按茶系', 'by-tea-family')),
        ...families
            .filter(item => item.family_id !== undefined && item.family_id !== null)
            .sort((a, b) => Number(a.family_id) - Number(b.family_id))
            .map((item, index) => {
                const id = normalizeCodePart(item.family_id);
                const detail = names(
                    FAMILY_EN[Number(item.family_id)] || `Tea Family ${item.family_id}`,
                    titleCase(item.name_ru || FAMILY_EN[Number(item.family_id)] || `Family ${item.family_id}`),
                    item.name_zh || FAMILY_EN[Number(item.family_id)] || `Family ${item.family_id}`,
                    `tea-family-${id.toLowerCase()}`);
                return category(`CAT-FAMILY-${id}`, 'CAT-BY-FAMILY', index + 1, detail, {
                    en: item.province_en ? `TheTea family from ${item.province_en}.` : undefined,
                    ru: item.province_en ? `TheTea family: ${item.province_en}.` : undefined,
                    zh: item.province_zh ? `TheTea 茶系：${item.province_zh}` : undefined,
                });
            }),
    ];
}

function filterExisting(categories, existingCategoryCodes) {
    if (!existingCategoryCodes) return categories;

    const existing = new Set([...existingCategoryCodes].map(code => String(code || '').toUpperCase()));
    const byCode = new Map(categories.map(item => [item.code, item]));
    const include = new Set();

    for (const item of categories) {
        if (!existing.has(item.code)) includeWithMissingParents(item, byCode, existing, include);
    }

    return categories.filter(item => include.has(item.code));
}

function includeWithMissingParents(item, byCode, existing, include) {
    if (!item || existing.has(item.code) || include.has(item.code)) return;
    if (item.parent && !existing.has(item.parent)) {
        includeWithMissingParents(byCode.get(item.parent), byCode, existing, include);
    }
    include.add(item.code);
}

function titleCase(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/(^|\s)\S/g, s => s.toUpperCase());
}

module.exports = {
    TEA_TYPE_CATEGORY,
    PROVINCE_CATEGORY,
    SHAPE_CATEGORY,
    PROCESSING_CATEGORY,
    ROAST_CATEGORY,
    SPECIALTY_TAG_CATEGORY,
    buildCategoryAssignments,
    buildTheTeaCategories,
};
