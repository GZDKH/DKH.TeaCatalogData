const PROVINCES = [
    'Anhui',
    'Beijing',
    'Chongqing',
    'Fujian',
    'Gansu',
    'Guangdong',
    'Guangxi',
    'Guizhou',
    'Hainan',
    'Hebei',
    'Heilongjiang',
    'Henan',
    'Hubei',
    'Hunan',
    'Inner Mongolia',
    'Jiangsu',
    'Jiangxi',
    'Jilin',
    'Liaoning',
    'Ningxia',
    'Qinghai',
    'Shaanxi',
    'Shandong',
    'Shanghai',
    'Shanxi',
    'Sichuan',
    'Taiwan',
    'Tianjin',
    'Tibet',
    'Xinjiang',
    'Yunnan',
    'Zhejiang',
];

const SHAPE_RULES = {
    needle: [/\bneedle(?:-shaped)?\b/u, /\bpine needle\b/u, /\bzh[eē]nx[ií]ng\b/u],
    flat: [/\bflat(?:tened)?(?:\s+(?:leaf|leaves|form|shape|tea))?\b/u, /\bbi[aǎ]nx[ií]ng\b/u],
    strip: [/\bstrip-shaped\b/u, /\bstrip leaf\b/u, /\blong strips?\b/u, /\bti[aá]ox[ií]ng\b/u],
    spiral: [/\bspiral(?:-shaped)?\b/u, /\bcurled into (?:a )?spiral\b/u, /\blu[oó]x[ií]ng\b/u],
    brick: [/\bbrick(?:-shaped)?\b/u, /\bzhu[aā]n(?: cha| tea)?\b/u],
    pearl: [/\bpearl(?:-shaped)?\b/u, /\bzh[uū]x[ií]ng\b/u],
    cake: [/\bcake-shaped\b/u, /\bcompressed (?:tea )?cake\b/u, /\btea cake\b/u],
    bud: [/\bbud-only\b/u, /\bpure buds?\b/u, /\bsingle buds?\b/u],
    powder: [/\bpowder(?:ed)?\b/u, /\bstone-ground\b/u],
    tuo: [/\btuocha\b/u, /\btu[oó]\b/u, /\bnest-shaped\b/u],
    compressed: [/\bcompressed tea\b/u, /\bpressed tea\b/u],
    blooming: [/\bblooming tea\b/u, /\bflowering tea\b/u, /\bhand-tied\b/u],
};

const PROCESSING_RULES = {
    chaoqing: [/\bpan[- ]?fired\b/u, /\bwok[- ]?fired\b/u, /\bstir[- ]?fried\b/u, /\bch[aǎ]oq[iī]ng\b/u],
    hongqing: [/\b(?:oven[- ]?dried|baked processing)\b/u, /\bh[oō]ngq[iī]ng\b/u],
    zhengqing: [/\bsteamed (?:green )?tea\b/u, /\bsteam[- ]?fixed\b/u, /\bzh[eē]ngq[iī]ng\b/u],
    shaiqing: [/\bsun[- ]?dried green tea\b/u, /\bsh[aà]iq[iī]ng\b/u],
    shai_hong: [/\bsun[- ]?dried red tea\b/u, /\bsh[aà]i h[oó]ng\b/u],
    tanbei: [/\bcharcoal[- ]?roast(?:ed|ing)?\b/u, /\bt[aà]nb[eā]i\b/u],
    wodui: [/\bwet pil(?:e|ing)\b/u, /\bw[oò]\s*du[iī]\b/u],
    smoked: [/\bpine[- ]?smoked\b/u, /\bsmoked tea\b/u],
    ctc: [/\bcut[- ]tear[- ]curl\b/u, /\bctc\b/u],
    orthodox: [/\borthodox process(?:ing)?\b/u],
    shaded: [/\bshade[- ]grown\b/u, /\bshaded growing\b/u],
    cha_gao: [/\btea paste\b/u, /\bcha gao\b/u, /\bch[aá] g[aā]o\b/u],
    gan_jie: [/\baged inside citrus\b/u, /\bcitrus peel tea\b/u, /\bgan jie cha\b/u],
};

const NAMED_CATEGORY_RULES = [
    rule('CAT-GREEN-LONGJING', /\blongjing\b/u, /\bl[oó]ngj[iǐ]ng\b/u),
    rule('CAT-FAMILY-1', /\blongjing\b/u, /\bl[oó]ngj[iǐ]ng\b/u),
    rule('CAT-GREEN-BILUOCHUN', /\bbiluochun\b/u, /\bb[iì]lu[oó]ch[uū]n\b/u),
    rule('CAT-GREEN-MAOFENG', /\bmao[- ]?feng\b/u, /\bm[aá]of[eē]ng\b/u),
    rule('CAT-GREEN-MAOJIAN', /\bmao[- ]?jian\b/u, /\bm[aá]oji[aān]\b/u),
    rule('CAT-GREEN-GUAPIAN', /\bgua[- ]?pian\b/u, /\bgu[aā]pi[aà]n\b/u),
    rule('CAT-GREEN-SONGZHEN', /\bsong[- ]?zhen\b/u, /\bs[oō]ng zh[eē]n\b/u),
    rule('CAT-GREEN-XUEYA', /\bxue[- ]?ya\b/u, /\bxu[eě] y[aá]\b/u),
    rule('CAT-GREEN-QUESHE', /\bque[- ]?she\b/u, /\bqu[eè]sh[eé]\b/u),
    rule('CAT-OOLONG-TIEGUANYIN', /\btie[- ]?guan[- ]?yin\b/u, /\bti[eě]gu[aā]ny[iī]n\b/u),
    rule('CAT-OOLONG-MINNAN', /\btie[- ]?guan[- ]?yin\b/u, /\bminnan oolong\b/u),
    rule('CAT-FAMILY-5', /\btie[- ]?guan[- ]?yin\b/u, /\bminnan oolong\b/u),
    rule('CAT-OOLONG-DANCONG', /\bdan[- ]?cong\b/u, /\bd[aā]nc[oó]ng\b/u),
    rule('CAT-OOLONG-GUANGDONG', /\bdan[- ]?cong\b/u, /\bd[aā]nc[oó]ng\b/u),
    rule('CAT-FAMILY-9', /\bdan[- ]?cong\b/u, /\bd[aā]nc[oó]ng\b/u),
    rule('CAT-OOLONG-ROCK', /\byan[- ]?cha\b/u, /\bwuyi rock tea\b/u, /\bdahongpao\b/u),
    rule('CAT-FAMILY-3', /\byan[- ]?cha\b/u, /\bwuyi rock tea\b/u, /\bdahongpao\b/u),
    rule('CAT-CULT-DAHONGPAO', /\bda[- ]?hong[- ]?pao\b/u, /\bd[aà]h[oó]ngp[aá]o\b/u),
    rule('CAT-CULT-ROUGUI', /\brou[- ]?gui\b/u, /\br[oò]ugu[iì]\b/u),
    rule('CAT-CULT-SHUIXIAN', /\bshui[- ]?xian\b/u, /\bshu[iǐ]xi[aān]\b/u),
    rule('CAT-CULT-JINXUAN', /\bjin[- ]?xuan\b/u, /\bj[iī]nxu[aā]n\b/u),
    rule('CAT-CULT-QINGXIN', /\bqing[- ]?xin\b/u, /\bq[iī]ngx[iī]n\b/u),
    rule('CAT-CULT-SIJICHUN', /\bsi[- ]?ji[- ]?chun\b/u, /\bs[iì]j[iì]ch[uū]n\b/u),
    rule('CAT-PUER-YUEGUANG', /\byue[- ]?guang\b/u, /\byu[eè]gu[aā]ng\b/u),
    rule('CAT-WHITE-YINZHEN', /\byin[- ]?zhen\b/u, /\by[ií]nzh[eē]n\b/u),
    rule('CAT-WHITE-BAIMUDAN', /\bbai[- ]?mu[- ]?dan\b/u, /\bb[aá]im[uǔ]d[aā]n\b/u),
    rule('CAT-WHITE-SHOUMEI', /\bshou[- ]?mei\b/u, /\bsh[oò]um[eé]i\b/u),
    rule('CAT-RED-KEEMUN', /\bkeemun\b/u, /\bqimen\b/u, /\bq[ií]m[eé]n\b/u),
    rule('CAT-RED-DIANHONG', /\bdian[- ]?hong\b/u, /\bdi[aā]nh[oó]ng\b/u),
    rule('CAT-RED-LAPSANG', /\blapsang\b/u),
    rule('CAT-RED-XIAOZHONG', /\bxiao[- ]?zhong\b/u, /\bxi[aǎ]ozh[oǒ]ng\b/u),
    rule('CAT-RED-JINJUNMEI', /\bjin[- ]?jun[- ]?mei\b/u, /\bj[iī]nj[uù]nm[eé]i\b/u),
    rule('CAT-RED-YINGDE', /\byingde\b/u, /\by[iī]ngd[eé]\b/u),
    rule('CAT-DARK-LIUBAO', /\bliu[- ]?bao\b/u, /\bli[uù]b[aǎ]o\b/u),
    rule('CAT-DARK-FUZHUAN', /\bfu[- ]?zhuan\b/u, /\bf[uú]zhu[aā]n\b/u),
    rule('CAT-DARK-ANHUA', /\banhua\b/u, /\b[aā]nhu[aà]\b/u),
    rule('CAT-DARK-ANHUA', /\b(?:bai|shi)liang\b/u, /\bhua[- ]?juan\b/u, /\bhuazhuan\b/u),
    rule('CAT-JASMINE-TEA', /\bjasmine\b/u, /\bmoli\b/u, /\bm[oò]li\b/u),
    rule('CAT-FAMILY-7', /\bjasmine\b/u, /\bmoli\b/u, /\bm[oò]li\b/u),
    rule('CAT-OOLONG-TAIWAN', /\btaiwan(?:ese)? oolong\b/u),
    rule('CAT-FAMILY-8', /\btaiwan(?:ese)? (?:high mountain )?oolong\b/u, /\bgaoshan oolong\b/u),
    rule('CAT-RED-GONGFU', /\bgongfu red tea\b/u, /\bgongfu hong\b/u),
    rule('CAT-FAMILY-10', /\byingde\b/u, /\by[iī]ngd[eé]\b/u),
    rule('CAT-SHAPE-BRICK', /\bzhuan\b/u, /\bzhu[aā]n\b/u),
    rule('CAT-SHAPE-CAKE', /\b(?:qing|shu)[- ]?bing\b/u, /\bbing cha\b/u),
    rule('CAT-SHAPE-TUO', /\btuo(?:cha)?\b/u),
    rule('CAT-PURPLE-TEA', /\bpurple pu[- ]?erh\b/u, /\bziya\b/u, /\bzijuan\b/u),
    rule('CAT-OOLONG-ROCK', /\bniu[- ]?rou\b/u, /\bma[- ]?rou\b/u, /\bniurou\b/u),
    rule('CAT-FAMILY-3', /\bniu[- ]?rou\b/u, /\bma[- ]?rou\b/u, /\bniurou\b/u),
    rule('CAT-CULT-ROUGUI', /\bniu[- ]?rou\b/u, /\bma[- ]?rou\b/u, /\bniurou\b/u),
];

const DANCONG_SUBTYPE_RULES = [
    rule('CAT-DANCONG-MILAN', /\bmi[- ]?lan[- ]?xiang\b/u, /\bm[iì] l[aá]n xi[aā]ng\b/u),
    rule('CAT-DANCONG-YASHI', /\bya[- ]?shi[- ]?xiang\b/u, /\by[aā] sh[iǐ] xi[aā]ng\b/u),
    rule('CAT-DANCONG-ZHILAN', /\bzhi[- ]?lan[- ]?xiang\b/u, /\bzh[iī] l[aá]n xi[aā]ng\b/u),
    rule('CAT-DANCONG-GUIHUA', /\bguihua[- ]?xiang\b/u, /\bgu[iī] hu[aā] xi[aā]ng\b/u),
    rule('CAT-DANCONG-XINGREN', /\bxing[- ]?ren[- ]?xiang\b/u, /\bx[iì]ng r[eé]n xi[aā]ng\b/u),
    rule('CAT-DANCONG-HUANGZHI', /\bhuang[- ]?zhi[- ]?xiang\b/u, /\bhu[aá]ng zh[iī] xi[aā]ng\b/u),
    rule('CAT-DANCONG-YULAN', /\byulan[- ]?xiang\b/u, /\by[uù] l[aá]n xi[aā]ng\b/u),
];

const HERBAL_BY_SLUG = {
    'bailan-hua-cha': ['CAT-HERBAL-TEA', 'CAT-HERBAL-FLOWER'],
    'daidai-hua-cha': ['CAT-HERBAL-TEA', 'CAT-HERBAL-FLOWER'],
    'kugua-cha': ['CAT-HERBAL-TEA', 'CAT-HERBAL-BITTER'],
    kuqiaomai: ['CAT-HERBAL-TEA', 'CAT-HERBAL-GRAIN'],
    'meigui-hua-cha': ['CAT-HERBAL-TEA', 'CAT-HERBAL-FLOWER', 'CAT-HERBAL-ROSE'],
    'xinhui-chenpi': ['CAT-HERBAL-TEA'],
    'zhu-lan-hua-cha': ['CAT-HERBAL-TEA', 'CAT-HERBAL-FLOWER'],
};

function rule(code, ...patterns) {
    return { code, patterns };
}

function inferTaxonomy(card) {
    const meta = card?.meta || {};
    const slug = normalizeText(card?.slug);
    const name = normalizeText(card?.name);
    const originText = fieldText(card, 'classification_origin', 'origin');
    const typeText = stripContrastClauses(fieldText(card, 'classification_origin', 'type'));
    const cultivarText = fieldText(card, 'botany_material', 'cultivar');
    const teawareText = fieldText(card, 'brewing', 'teaware');
    const warnings = [];

    const provinceResult = meta.province
        ? { value: String(meta.province).trim(), ambiguous: [], evidence: 'meta.province' }
        : inferProvince(originText);
    if (provinceResult.ambiguous.length) {
        warnings.push(
            `Ambiguous inferred province for ${card?.slug}: ${provinceResult.ambiguous.join(', ')}; region category and ProductOrigin state were omitted.`);
    }

    const shapes = meta.shape
        ? [String(meta.shape)]
        : matchValues(typeText, SHAPE_RULES);
    const processing = meta.processing
        ? [String(meta.processing)]
        : matchValues(typeText, PROCESSING_RULES);
    const namedText = [slug, name, typeText].filter(Boolean).join(' ');
    const namedCategories = NAMED_CATEGORY_RULES
        .filter(item => item.patterns.some(pattern => pattern.test(namedText)))
        .map(item => item.code);

    const province = String(meta.province || '').trim() || provinceResult.value;
    const categoryCodes = [
        ...namedCategories,
        ...inferDancongSubtypeCategories(namedText),
        ...(HERBAL_BY_SLUG[slug] || []),
        ...inferPuerCategories(meta, namedText),
        ...inferBrewingCategories(card, teawareText),
        ...inferCultivarCategories(cultivarText),
        ...inferSpecialtyCategories(namedText),
        ...inferCrossFacetCategories(meta, province),
    ];

    return {
        province,
        provinceEvidence: provinceResult.evidence,
        shapes: unique(shapes),
        processing: unique(processing),
        categoryCodes: unique(categoryCodes),
        warnings,
    };
}

function inferDancongSubtypeCategories(text) {
    if (!/\bdan[- ]?cong\b/u.test(text) && !/\bd[aā]nc[oó]ng\b/u.test(text)) return [];
    return DANCONG_SUBTYPE_RULES
        .filter(item => item.patterns.some(pattern => pattern.test(text)))
        .map(item => item.code);
}

function inferCrossFacetCategories(meta, province) {
    const type = String(meta?.tea_type || '').toLowerCase();
    const codes = [];
    if (type === 'green' && province === 'Zhejiang') codes.push('CAT-FAMILY-2');
    if (type === 'white' && province === 'Fujian') codes.push('CAT-FAMILY-4');
    if (type === 'red' && province === 'Fujian') codes.push('CAT-FAMILY-6');
    if (type === 'oolong' && province === 'Taiwan') {
        codes.push('CAT-OOLONG-TAIWAN', 'CAT-FAMILY-8');
    }
    if (type === 'oolong' && province === 'Guangdong') codes.push('CAT-OOLONG-GUANGDONG');
    return codes;
}

function inferProvince(originText) {
    const firstSentence = normalizeText(String(originText || '').split(/(?<=[.!?])\s+/u)[0]);
    if (!firstSentence) return { value: undefined, ambiguous: [], evidence: undefined };

    const explicit = PROVINCES.filter(province =>
        new RegExp(`\\b${escapeRegExp(normalizeText(province))}\\s+province\\b`, 'u').test(firstSentence));
    if (explicit.length === 1) {
        return { value: explicit[0], ambiguous: [], evidence: 'classification_origin.origin:province' };
    }
    if (explicit.length > 1) {
        return { value: undefined, ambiguous: explicit, evidence: 'classification_origin.origin:province' };
    }

    const mentioned = PROVINCES.filter(province =>
        new RegExp(`\\b${escapeRegExp(normalizeText(province))}\\b`, 'u').test(firstSentence));
    return mentioned.length === 1
        ? { value: mentioned[0], ambiguous: [], evidence: 'classification_origin.origin:first-sentence' }
        : {
            value: undefined,
            ambiguous: mentioned,
            evidence: mentioned.length ? 'classification_origin.origin:first-sentence' : undefined,
        };
}

function inferPuerCategories(meta, text) {
    if (String(meta?.tea_type || '').toLowerCase() !== 'puer') return [];
    const codes = [];
    if (/\b(?:shu|ripe|cooked)\b/u.test(text)) codes.push('CAT-PUER-SHU');
    if (/\b(?:sheng|raw)\b/u.test(text)) codes.push('CAT-PUER-SHENG');
    return codes;
}

function inferBrewingCategories(card, teawareText) {
    const codes = [];
    if ((card?.recipe || []).some(item => normalizeText(item?.style) === 'gongfu')) {
        codes.push('CAT-BREW-GONGFU');
    }
    if (/\bgaiwan\b/u.test(teawareText)) codes.push('CAT-BREW-GAIWAN');
    if (/\b(?:yixing|purple clay|zisha)\b/u.test(teawareText)) {
        codes.push('CAT-BREW-YIXING', 'CAT-BREW-ZISHA');
    }
    if (/\bglass (?:cup|tumbler)\b/u.test(teawareText)) codes.push('CAT-BREW-GLASS');
    return codes;
}

function inferCultivarCategories(text) {
    const codes = [];
    if (/\bcamellia sinensis var\.?\s+assamica\b/u.test(text)) codes.push('CAT-LEAF-LARGE');
    if (/\bcamellia sinensis var\.?\s+sinensis\b/u.test(text)) codes.push('CAT-LEAF-SMALL');
    return codes;
}

function inferSpecialtyCategories(text) {
    const codes = [];
    if (/\b(?:ancient tree|gushu|g[uǔ]sh[uù])\b/u.test(text)) codes.push('CAT-SPEC-GUSHU');
    if (/\b(?:wild tea|yesheng|y[eě]sh[eē]ng)\b/u.test(text)) codes.push('CAT-SPEC-YESHENG');
    if (/\b(?:high mountain tea|gaoshan|g[aā]osh[aā]n)\b/u.test(text)) codes.push('CAT-SPEC-GAOSHAN');
    if (/\b(?:handmade tea|hand-processed tea|shougong|sh[oǒ]ug[oō]ng)\b/u.test(text)) {
        codes.push('CAT-SPEC-SHOUGONG');
    }
    if (/\b(?:blooming tea|flowering tea|hand-tied)\b/u.test(text)) codes.push('CAT-SPEC-GONGYI');
    if (/\b(?:lao cong|old bush)\b/u.test(text)) codes.push('CAT-SPEC-LAOCONG');
    if (/\b(?:ya bao|y[aá] b[aā]o)\b/u.test(text)) codes.push('CAT-SPEC-YABAO');
    if (/\b(?:aged tea|lao cha|l[aǎ]o ch[aá])\b/u.test(text)) codes.push('CAT-AGING-LAOCAH');
    return codes;
}

function matchValues(text, rules) {
    return Object.entries(rules)
        .filter(([, patterns]) => patterns.some(pattern => pattern.test(text)))
        .map(([value]) => value);
}

function fieldText(card, section, field) {
    return normalizeText(card?.sections?.[section]?.[field]?.value);
}

function stripContrastClauses(value) {
    return String(value || '').split(
        /\b(?:unlike|as opposed to|in contrast to|rather than)\b/u)[0].trim();
}

function normalizeText(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[*_`]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function unique(values) {
    return [...new Set((values || []).filter(Boolean))];
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    inferProvince,
    inferTaxonomy,
    normalizeText,
};
