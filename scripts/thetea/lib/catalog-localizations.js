const { toProductLocale } = require('./locales');

const DEFAULT_CATALOG_LOCALES = ['en-US', 'ru-RU', 'zh-CN'];

const CHINESE_TEA_NAMES = Object.freeze({
    af: 'Chinese tee',
    am: 'የቻይና ሻይ',
    ar: 'الشاي الصيني',
    az: 'Çin çayı',
    be: 'Кітайская гарбата',
    bg: 'Китайски чай',
    bho: 'चीनी चाय',
    bn: 'চীনা চা',
    bo: 'ཀྲུང་གོའི་ཇ་',
    ca: 'Te xinès',
    cs: 'Čínský čaj',
    da: 'Kinesisk te',
    de: 'Chinesischer Tee',
    el: 'Κινεζικό τσάι',
    'en-US': 'Chinese Tea',
    es: 'Té chino',
    et: 'Hiina tee',
    fa: 'چای چینی',
    fi: 'Kiinalainen tee',
    fr: 'Thé chinois',
    gu: 'ચાઇનીઝ ચા',
    he: 'תה סיני',
    hi: 'चीनी चाय',
    hr: 'Kineski čaj',
    hu: 'Kínai tea',
    id: 'Teh Tiongkok',
    is: 'Kínverskt te',
    it: 'Tè cinese',
    ja: '中国茶',
    ka: 'ჩინური ჩაი',
    kk: 'Қытай шайы',
    km: 'តែចិន',
    kn: 'ಚೀನೀ ಚಹಾ',
    ko: '중국차',
    lo: 'ຊາຈີນ',
    lt: 'Kiniška arbata',
    lv: 'Ķīnas tēja',
    mg: 'Dite sinoa',
    ml: 'ചൈനീസ് ചായ',
    mn: 'Хятад цай',
    mr: 'चिनी चहा',
    ms: 'Teh Cina',
    my: 'တရုတ်လက်ဖက်ရည်',
    nb: 'Kinesisk te',
    ne: 'चिनियाँ चिया',
    nl: 'Chinese thee',
    ny: 'Tiyi wa ku China',
    or: 'ଚୀନା ଚା',
    pa: 'ਚੀਨੀ ਚਾਹ',
    pl: 'Chińska herbata',
    pt: 'Chá chinês',
    ro: 'Ceai chinezesc',
    'ru-RU': 'Китайский чай',
    si: 'චීන තේ',
    sk: 'Čínsky čaj',
    sl: 'Kitajski čaj',
    sr: 'Кинески чај',
    sv: 'Kinesiskt te',
    sw: 'Chai ya Kichina',
    ta: 'சீனத் தேநீர்',
    te: 'చైనీస్ టీ',
    th: 'ชาจีน',
    tl: 'Tsinong Tsaa',
    tr: 'Çin çayı',
    uk: 'Китайський чай',
    ur: 'چینی چائے',
    uz: 'Xitoy choyi',
    vi: 'Trà Trung Quốc',
    'zh-CN': '中国茶',
    'zh-HK': '中國茶',
    'zh-TW': '中國茶',
    zu: 'Itiye laseShayina',
});

const DESCRIPTION_OVERRIDES = Object.freeze({
    'en-US': 'TheTea Chinese tea catalog',
    'ru-RU': 'Каталог китайского чая TheTea',
    ja: 'TheTea 中国茶カタログ',
    ko: 'TheTea 중국차 카탈로그',
    'zh-CN': 'TheTea 中国茶目录',
    'zh-HK': 'TheTea 中國茶目錄',
    'zh-TW': 'TheTea 中國茶目錄',
});

const SEO_OVERRIDES = Object.freeze({
    'en-US': 'chinese-tea',
    'ru-RU': 'kitayskiy-chay',
    'zh-CN': 'zhong-guo-cha',
    'zh-HK': 'zhong-guo-cha',
    'zh-TW': 'zhong-guo-cha',
});

function catalogTranslationsForLocales(locales = DEFAULT_CATALOG_LOCALES) {
    const requested = Array.isArray(locales) && locales.length
        ? locales
        : DEFAULT_CATALOG_LOCALES;
    const seen = new Set();
    const translations = [];

    for (const rawLocale of requested) {
        const locale = toProductLocale(rawLocale);
        const key = locale.toLowerCase();
        if (!locale || seen.has(key)) continue;
        seen.add(key);

        const name = CHINESE_TEA_NAMES[locale];
        if (!name) {
            throw new Error(
                `CATALOG-CHINESE-TEA has no maintained translation for required locale ${locale}.`);
        }
        translations.push({
            lang: locale,
            name,
            description: DESCRIPTION_OVERRIDES[locale] || `${name} · TheTea`,
            seo: SEO_OVERRIDES[locale] || 'chinese-tea',
        });
    }

    return translations;
}

module.exports = {
    CHINESE_TEA_NAMES,
    catalogTranslationsForLocales,
};
