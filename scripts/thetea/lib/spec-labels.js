const { toProductLocale } = require('./locales');

const CANONICAL_LOCALE = 'en-US';
const CURATED_LOCALES = ['ru-RU', 'zh-CN'];

// English is the canonical identity of a label. Russian and Chinese are
// deliberately curated here; unsupported locales must keep the supplied
// English label instead of receiving a synthetic, title-cased translation.
const LABEL_ENTRIES = [
    // Groups
    ['group', 'classification_origin', 'Classification and Origin', 'Классификация и происхождение', '分类与产地'],
    ['group', 'atomic', 'Core Tea Facts', 'Основные характеристики чая', '茶叶核心信息'],
    ['group', 'botany_material', 'Botany and Raw Material', 'Ботаника и сырьё', '植物学与原料'],
    ['group', 'terroir', 'Terroir', 'Терруар', '风土'],
    ['group', 'production', 'Production', 'Производство', '生产工艺'],
    ['group', 'organoleptic', 'Organoleptic Profile', 'Органолептический профиль', '感官特征'],
    ['group', 'chemistry', 'Chemical Composition', 'Химический состав', '化学成分'],
    ['group', 'brewing', 'Brewing', 'Заваривание', '冲泡'],
    ['group', 'storage', 'Storage', 'Хранение', '储存'],
    ['group', 'harvest', 'Harvest', 'Сбор урожая', '采摘'],
    ['group', 'recipe', 'Brewing Recipe', 'Рецепт заваривания', '冲泡配方'],
    ['group', 'sensory', 'Sensory Intensity', 'Интенсивность вкуса и аромата', '感官强度'],
    ['group', 'enrichment', 'Enrichment', 'Дополнительные сведения', '补充信息'],
    ['group', 'source', 'Source Metadata', 'Метаданные источника', '来源元数据'],
    ['group', 'facts', 'Facts', 'Факты', '基本信息'],
    ['group', 'comparison', 'Comparison', 'Сравнение', '对比'],
    ['group', 'health', 'Health Notes', 'Полезные свойства', '健康信息'],
    ['group', 'contraindications', 'Contraindications', 'Противопоказания', '禁忌'],
    ['group', 'conclusion', 'Conclusion', 'Заключение', '总结'],
    ['group', 'history_culture', 'History and Culture', 'История и культура', '历史与文化'],
    ['group', 'price_counterfeit', 'Price and Authenticity', 'Цена и подлинность', '价格与真伪'],

    // Classification, source, and core attributes
    ['attribute', 'classification_origin.tea_type', 'Tea Type', 'Тип чая', '茶类'],
    ['attribute', 'classification_origin.type', 'Type', 'Тип', '类型'],
    ['attribute', 'classification_origin.origin', 'Origin', 'Происхождение', '产地'],
    ['attribute', 'classification_origin.origin_country', 'Origin Country', 'Страна происхождения', '原产国'],
    ['attribute', 'classification_origin.province', 'Province', 'Провинция', '省份'],
    ['attribute', 'classification_origin.city', 'City', 'Город', '城市'],
    ['attribute', 'classification_origin.county', 'County', 'Уезд', '县区'],
    ['attribute', 'classification_origin.gi_status', 'Geographical Indication Status', 'Статус географического указания', '地理标志状态'],
    ['attribute', 'classification_origin.gi_standard', 'Geographical Indication Standard', 'Стандарт географического указания', '地理标志标准'],
    ['attribute', 'source.category_code', 'TheTea Category', 'Категория TheTea', 'TheTea 分类'],
    ['attribute', 'source.version', 'TheTea Version', 'Версия TheTea', 'TheTea 版本'],
    ['attribute', 'source.last_updated', 'TheTea Last Updated', 'Дата обновления в TheTea', 'TheTea 最后更新'],
    ['attribute', 'source.review_status', 'TheTea Review Status', 'Статус проверки в TheTea', 'TheTea 审核状态'],
    ['attribute', 'atomic.oxidation', 'Oxidation', 'Окисление', '氧化程度'],
    ['attribute', 'atomic.shape', 'Leaf Shape', 'Форма листа', '叶形'],
    ['attribute', 'atomic.processing', 'Processing', 'Обработка', '加工工艺'],
    ['attribute', 'atomic.roast_level', 'Roast Level', 'Степень обжарки', '焙火程度'],

    // Terroir, material, sensory, and brewing attributes
    ['attribute', 'terroir.altitude', 'Altitude', 'Высота произрастания', '海拔'],
    ['attribute', 'terroir.climate', 'Climate', 'Климат', '气候'],
    ['attribute', 'terroir.soil', 'Soil', 'Почва', '土壤'],
    ['attribute', 'botany_material.cultivar', 'Cultivar', 'Культивар', '茶树品种'],
    ['attribute', 'botany_material.picking', 'Picking', 'Сбор', '采摘方式'],
    ['attribute', 'botany_material.pluck_standard', 'Pluck Standard', 'Стандарт сбора', '采摘标准'],
    ['attribute', 'botany_material.raw_material', 'Raw Material', 'Сырьё', '原料'],
    ['attribute', 'organoleptic.taste', 'Taste', 'Вкус', '滋味'],
    ['attribute', 'organoleptic.liquor_color', 'Liquor Color', 'Цвет настоя', '茶汤颜色'],
    ['attribute', 'organoleptic.liquor_aroma', 'Liquor Aroma', 'Аромат настоя', '茶汤香气'],
    ['attribute', 'organoleptic.dry_leaf_aroma', 'Dry Leaf Aroma', 'Аромат сухого листа', '干茶香气'],
    ['attribute', 'organoleptic.dry_leaf_appearance', 'Dry Leaf Appearance', 'Внешний вид сухого листа', '干茶外形'],
    ['attribute', 'organoleptic.spent_leaves', 'Spent Leaves', 'Спитой лист', '叶底'],
    ['attribute', 'brewing.brew_temp', 'Brewing Temperature', 'Температура заваривания', '冲泡温度'],
    ['attribute', 'brewing.water_temp', 'Water Temperature', 'Температура воды', '水温'],
    ['attribute', 'brewing.tea_amount', 'Tea Amount', 'Количество чая', '投茶量'],
    ['attribute', 'brewing.teaware', 'Teaware', 'Посуда для заваривания', '茶具'],

    // Enrichment attributes
    ['attribute', 'enrichment.caffeine_level', 'Caffeine Level', 'Уровень кофеина', '咖啡因含量'],
    ['attribute', 'enrichment.difficulty', 'Brewing Difficulty', 'Сложность заваривания', '冲泡难度'],
    ['attribute', 'enrichment.price_tier', 'Price Tier', 'Ценовой уровень', '价格档位'],
    ['attribute', 'enrichment.best_season', 'Best Season', 'Лучший сезон', '适宜季节'],
    ['attribute', 'enrichment.occasion', 'Occasion', 'Подходящий случай', '适用场景'],
    ['attribute', 'enrichment.flavor_tags', 'Flavor Tag', 'Вкусоароматическая характеристика', '风味标签'],
    ['attribute', 'enrichment.food_pairings', 'Food Pairings', 'Сочетания с едой', '食物搭配'],
    ['attribute', 'enrichment.tasting_note', 'Tasting Note', 'Дегустационная заметка', '品鉴笔记'],
    ['attribute', 'enrichment.similar_teas', 'Similar Teas', 'Похожие чаи', '相似茶品'],
    ['attribute', 'harvest.phase', 'Phase', 'Период сбора', '采摘阶段'],

    // Curated narrative attributes (synthetic source fields are consolidated here)
    ['attribute', 'atomic.notes', 'Core Tea Notes', 'Основные сведения о чае', '茶叶核心说明'],
    ['attribute', 'botany_material.notes', 'Botany and Raw Material Notes', 'Сведения о ботанике и сырье', '植物学与原料说明'],
    ['attribute', 'brewing.notes', 'Brewing Notes', 'Примечания по завариванию', '冲泡说明'],
    ['attribute', 'chemical_composition.notes', 'Chemical Composition Notes', 'Сведения о химическом составе', '化学成分说明'],
    ['attribute', 'chemistry.notes', 'Chemical Composition Notes', 'Сведения о химическом составе', '化学成分说明'],
    ['attribute', 'classification_origin.notes', 'Classification and Origin Notes', 'Сведения о классификации и происхождении', '分类与产地说明'],
    ['attribute', 'comparison.notes', 'Comparison Notes', 'Сравнение', '对比说明'],
    ['attribute', 'conclusion.notes', 'Conclusion', 'Заключение', '总结'],
    ['attribute', 'contraindications.notes', 'Contraindications', 'Противопоказания', '禁忌'],
    ['attribute', 'facts.notes', 'Facts', 'Факты', '基本信息'],
    ['attribute', 'health.notes', 'Health Notes', 'Полезные свойства', '健康说明'],
    ['attribute', 'history_culture.notes', 'History and Culture Notes', 'Сведения об истории и культуре', '历史与文化说明'],
    ['attribute', 'organoleptic.notes', 'Organoleptic Profile Notes', 'Сведения об органолептическом профиле', '感官特征说明'],
    ['attribute', 'price_counterfeit.notes', 'Price and Authenticity Notes', 'Сведения о цене и подлинности', '价格与真伪说明'],
    ['attribute', 'production.notes', 'Production Notes', 'Сведения о производстве', '生产工艺说明'],
    ['attribute', 'storage.notes', 'Storage Notes', 'Примечания по хранению', '储存说明'],
    ['attribute', 'terroir.notes', 'Terroir Notes', 'Сведения о терруаре', '风土说明'],

    // Tea type options
    ['option', 'classification_origin.tea_type.green', 'Green', 'Зелёный чай', '绿茶'],
    ['option', 'classification_origin.tea_type.white', 'White', 'Белый чай', '白茶'],
    ['option', 'classification_origin.tea_type.yellow', 'Yellow', 'Жёлтый чай', '黄茶'],
    ['option', 'classification_origin.tea_type.oolong', 'Oolong', 'Улун', '乌龙茶'],
    ['option', 'classification_origin.tea_type.black', 'Black', 'Чёрный чай', '红茶'],
    ['option', 'classification_origin.tea_type.dark', 'Dark', 'Тёмный чай', '黑茶'],
    ['option', 'classification_origin.tea_type.puerh', 'Puerh', 'Пуэр', '普洱茶'],
    ['option', 'classification_origin.tea_type.pu_erh', 'Pu Erh', 'Пуэр', '普洱茶'],

    // Core processing and shape options
    ['option', 'atomic.roast_level.none', 'None', 'Без обжарки', '不焙火'],
    ['option', 'atomic.roast_level.light', 'Light', 'Лёгкая', '轻焙火'],
    ['option', 'atomic.roast_level.medium', 'Medium', 'Средняя', '中焙火'],
    ['option', 'atomic.roast_level.heavy', 'Heavy', 'Сильная', '重焙火'],
    ['option', 'atomic.processing.chaoqing', 'Chaoqing', 'Чаоцин (прожаривание)', '炒青'],
    ['option', 'atomic.processing.shaiqing', 'Shaiqing', 'Шайцин (сушка на солнце)', '晒青'],
    ['option', 'atomic.processing.hongqing', 'Hongqing', 'Хунцин (сушка горячим воздухом)', '烘青'],
    ['option', 'atomic.processing.zhengqing', 'Zhengqing', 'Чжэнцин (обработка паром)', '蒸青'],
    ['option', 'atomic.processing.steamed', 'Steamed', 'Обработка паром', '蒸青'],
    ['option', 'atomic.processing.pan_fired', 'Pan Fired', 'Прожаривание в котле', '炒青'],
    ['option', 'atomic.processing.sun_dried', 'Sun Dried', 'Сушка на солнце', '晒干'],
    ['option', 'atomic.processing.rolled', 'Rolled', 'Скручивание', '揉捻'],
    ['option', 'atomic.processing.fermented', 'Fermented', 'Ферментация', '发酵'],
    ['option', 'atomic.shape.flat', 'Flat', 'Плоский лист', '扁平形'],
    ['option', 'atomic.shape.needle', 'Needle', 'Игла', '针形'],
    ['option', 'atomic.shape.twisted', 'Twisted', 'Скрученный лист', '条索形'],
    ['option', 'atomic.shape.rolled', 'Rolled', 'Скрученный лист', '卷曲形'],
    ['option', 'atomic.shape.ball', 'Ball', 'Шарик', '球形'],
    ['option', 'atomic.shape.cake', 'Cake', 'Блин', '饼茶'],
    ['option', 'atomic.shape.brick', 'Brick', 'Кирпич', '砖茶'],
    ['option', 'atomic.shape.loose', 'Loose', 'Рассыпной', '散茶'],

    // Enrichment and lifecycle options
    ['option', 'source.review_status.published', 'Published', 'Опубликовано', '已发布'],
    ['option', 'source.review_status.draft', 'Draft', 'Черновик', '草稿'],
    ['option', 'source.review_status.reviewed', 'Reviewed', 'Проверено', '已审核'],
    ['option', 'enrichment.caffeine_level.low', 'Low', 'Низкий', '低'],
    ['option', 'enrichment.caffeine_level.medium', 'Medium', 'Средний', '中'],
    ['option', 'enrichment.caffeine_level.high', 'High', 'Высокий', '高'],
    ['option', 'enrichment.difficulty.beginner', 'Beginner', 'Для начинающих', '入门'],
    ['option', 'enrichment.difficulty.intermediate', 'Intermediate', 'Средняя сложность', '中等'],
    ['option', 'enrichment.difficulty.advanced', 'Advanced', 'Для опытных', '进阶'],
    ['option', 'enrichment.price_tier.budget', 'Budget', 'Бюджетный', '经济型'],
    ['option', 'enrichment.price_tier.standard', 'Standard', 'Стандартный', '标准型'],
    ['option', 'enrichment.price_tier.premium', 'Premium', 'Премиальный', '高端'],
    ['option', 'enrichment.price_tier.luxury', 'Luxury', 'Люкс', '奢华型'],
    ['option', 'enrichment.best_season.spring', 'Spring', 'Весна', '春季'],
    ['option', 'enrichment.best_season.summer', 'Summer', 'Лето', '夏季'],
    ['option', 'enrichment.best_season.autumn', 'Autumn', 'Осень', '秋季'],
    ['option', 'enrichment.best_season.winter', 'Winter', 'Зима', '冬季'],
    ['option', 'enrichment.occasion.morning', 'Morning', 'Утро', '早晨'],
    ['option', 'enrichment.occasion.evening', 'Evening', 'Вечер', '夜晚'],
    ['option', 'enrichment.occasion.focus', 'Focus', 'Концентрация', '专注'],
    ['option', 'enrichment.occasion.meditation', 'Meditation', 'Медитация', '冥想'],
    ['option', 'enrichment.occasion.everyday', 'Everyday', 'На каждый день', '日常'],
    ['option', 'harvest.phase.early', 'Early', 'Ранний сбор', '早期采摘'],
    ['option', 'harvest.phase.peak', 'Peak', 'Основной сбор', '盛采期'],
    ['option', 'harvest.phase.late', 'Late', 'Поздний сбор', '晚期采摘'],
];

const SEMANTIC_ALIASES = {
    group: {
        chemical_composition: 'chemistry',
    },
    attribute: {
        tea_type: 'classification_origin.tea_type',
        origin: 'classification_origin.origin',
        origin_country: 'classification_origin.origin_country',
        province: 'classification_origin.province',
        city: 'classification_origin.city',
        county: 'classification_origin.county',
        gi_status: 'classification_origin.gi_status',
        gi_standard: 'classification_origin.gi_standard',
        category_code: 'source.category_code',
        oxidation: 'atomic.oxidation',
        shape: 'atomic.shape',
        processing: 'atomic.processing',
        roast_level: 'atomic.roast_level',
        brew_temp: 'brewing.brew_temp',
        water_temp: 'brewing.water_temp',
        altitude: 'terroir.altitude',
        caffeine_level: 'enrichment.caffeine_level',
        difficulty: 'enrichment.difficulty',
        price_tier: 'enrichment.price_tier',
    },
    option: {
        green: 'classification_origin.tea_type.green',
        white: 'classification_origin.tea_type.white',
        yellow: 'classification_origin.tea_type.yellow',
        oolong: 'classification_origin.tea_type.oolong',
        black: 'classification_origin.tea_type.black',
        dark: 'classification_origin.tea_type.dark',
        puerh: 'classification_origin.tea_type.puerh',
        pu_erh: 'classification_origin.tea_type.pu_erh',
    },
};

function normalizeKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const aliases = {
        group: 'group',
        groups: 'group',
        attribute: 'attribute',
        attributes: 'attribute',
        field: 'attribute',
        fields: 'attribute',
        option: 'option',
        options: 'option',
        value: 'option',
        values: 'option',
    };
    const kind = aliases[normalized];
    if (!kind) throw new Error(`Unsupported specification label kind: ${value || '<empty>'}`);
    return kind;
}

function normalizeSemanticKey(value) {
    const raw = String(value || '').normalize('NFKC').trim().toLowerCase();
    if (!raw) throw new Error('Specification semanticKey must not be empty.');

    const normalized = raw
        .replace(/[/:]+/g, '.')
        .split('.')
        .map(part => part
            .replace(/[\s-]+/g, '_')
            .replace(/^_+|_+$/g, ''))
        .filter(Boolean)
        .join('.');

    if (!normalized) throw new Error('Specification semanticKey must not be empty.');
    return normalized;
}

function normalizeLocale(value) {
    const locale = toProductLocale(value);
    if (!locale) throw new Error('Specification label locale must not be empty.');
    if (locale.toLowerCase() === 'all') {
        throw new Error('Specification label locales must be resolved before localization; "all" is not a locale.');
    }
    return locale;
}

function normalizeFallbackName(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Specification label fallbackName must be a non-empty English label.');
    }
    return value.trim();
}

function registryKey(kind, semanticKey) {
    return `${kind}:${semanticKey}`;
}

function compileRegistry(entries) {
    const registry = new Map();

    for (const [rawKind, rawKey, english, russian, chinese] of entries) {
        const kind = normalizeKind(rawKind);
        const semanticKey = normalizeSemanticKey(rawKey);
        const labels = {
            [CANONICAL_LOCALE]: normalizeFallbackName(english),
            'ru-RU': normalizeFallbackName(russian),
            'zh-CN': normalizeFallbackName(chinese),
        };
        const key = registryKey(kind, semanticKey);
        const existing = registry.get(key);

        if (existing) {
            for (const locale of [CANONICAL_LOCALE, ...CURATED_LOCALES]) {
                if (existing[locale] !== labels[locale]) {
                    throw new Error(`Conflicting curated label for ${key} (${locale}).`);
                }
            }
            continue;
        }

        registry.set(key, Object.freeze(labels));
    }

    return registry;
}

function compileAliases(rawAliases) {
    const aliases = new Map();

    for (const [rawKind, entries] of Object.entries(rawAliases)) {
        const kind = normalizeKind(rawKind);
        for (const [rawAlias, rawTarget] of Object.entries(entries)) {
            const alias = normalizeSemanticKey(rawAlias);
            const target = normalizeSemanticKey(rawTarget);
            const key = registryKey(kind, alias);
            const existing = aliases.get(key);
            if (existing && existing !== target) {
                throw new Error(`Conflicting specification label alias for ${key}.`);
            }
            aliases.set(key, target);
        }
    }

    return aliases;
}

const LABEL_REGISTRY = compileRegistry(LABEL_ENTRIES);
const LABEL_ALIASES = compileAliases(SEMANTIC_ALIASES);

function resolveSemanticKey(kind, semanticKey) {
    const normalized = normalizeSemanticKey(semanticKey);
    return LABEL_ALIASES.get(registryKey(kind, normalized)) || normalized;
}

function sameCanonicalEnglish(left, right) {
    const normalize = value => value.replace(/\s+/g, ' ').trim();
    return normalize(left) === normalize(right);
}

function dynamicLabels(kind, semanticKey) {
    if (kind !== 'attribute') return null;
    const match = /^sensory\.source_descriptor_([a-z0-9_]+)_intensity$/.exec(semanticKey);
    if (!match) return null;
    const normalizedCode = match[1].replace(/_/g, '-');
    const code = normalizedCode[0].toUpperCase() + normalizedCode.slice(1);
    return {
        [CANONICAL_LOCALE]: `Sensory Source Descriptor ${code} Intensity`,
        'ru-RU': `Интенсивность исходного сенсорного дескриптора ${code}`,
        'zh-CN': `源感官描述符 ${code} 强度`,
    };
}

function localizeSpecLabel(kind, semanticKey, locale, fallbackName) {
    const normalizedKind = normalizeKind(kind);
    const normalizedKey = resolveSemanticKey(normalizedKind, semanticKey);
    const normalizedLocale = normalizeLocale(locale);
    const fallback = normalizeFallbackName(fallbackName);
    const curated = LABEL_REGISTRY.get(registryKey(normalizedKind, normalizedKey))
        || dynamicLabels(normalizedKind, normalizedKey);

    if (!curated) return { name: fallback, source: 'fallback' };

    if (!sameCanonicalEnglish(curated[CANONICAL_LOCALE], fallback)) {
        throw new Error(
            `Conflicting English fallback for ${normalizedKind}:${normalizedKey}: `
            + `expected "${curated[CANONICAL_LOCALE]}", received "${fallback}".`);
    }

    if (normalizedLocale === CANONICAL_LOCALE) {
        return { name: curated[CANONICAL_LOCALE], source: 'canonical' };
    }

    if (CURATED_LOCALES.includes(normalizedLocale)) {
        return { name: curated[normalizedLocale], source: 'curated' };
    }

    return { name: fallback, source: 'fallback' };
}

function compareLocales(left, right) {
    const priority = {
        'en-US': 0,
        'ru-RU': 1,
        'zh-CN': 2,
    };
    const leftPriority = priority[left] ?? 3;
    const rightPriority = priority[right] ?? 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left < right ? -1 : left > right ? 1 : 0;
}

function buildLocalizedTranslations({ kind, semanticKey, fallbackName, locales } = {}) {
    if (!Array.isArray(locales) || locales.length === 0) {
        throw new Error('Specification label locales must be a non-empty array.');
    }

    const rowsByLocale = new Map();

    for (const requestedLocale of locales) {
        const lang = normalizeLocale(requestedLocale);
        const localized = localizeSpecLabel(kind, semanticKey, lang, fallbackName);
        const existing = rowsByLocale.get(lang);

        if (existing && (existing.name !== localized.name || existing.source !== localized.source)) {
            throw new Error(`Conflicting specification translation for locale ${lang}.`);
        }

        rowsByLocale.set(lang, localized);
    }

    const orderedLocales = [...rowsByLocale.keys()].sort(compareLocales);
    return {
        translations: orderedLocales.map(lang => ({
            lang,
            name: rowsByLocale.get(lang).name,
        })),
        fallbackLocales: orderedLocales.filter(lang => rowsByLocale.get(lang).source === 'fallback'),
    };
}

module.exports = {
    localizeSpecLabel,
    buildLocalizedTranslations,
};
