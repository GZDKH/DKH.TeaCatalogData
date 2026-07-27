const CJK_RE = /[\u3400-\u9fff]/u;
const COMPOSITE_ANNOTATION_RE =
    /[（(][^()（）]*[\u3400-\u9fff][^()（）]*[,，、][^()（）]*[)）]/u;
const EDITORIAL_DELIMITER_RE = /(?:——|：)/u;

function decomposeTeaName(value) {
    const original = normalizeText(value);
    if (!original) {
        return {
            displayName: original,
            nativeName: undefined,
            transcription: undefined,
            editorialTitle: undefined,
        };
    }

    let displayName = original;
    let nativeName;
    let transcription;
    let editorialTitle;
    const annotation = findNameAnnotation(original);

    if (annotation) {
        const before = normalizeText(original.slice(0, annotation.index));
        const after = normalizeEditorialSuffix(
            original.slice(annotation.index + annotation.full.length));
        const parsed = parseAnnotation(annotation.content, before);

        if (before) displayName = before;
        nativeName = parsed.nativeName;
        transcription = parsed.transcription;
        if (after) editorialTitle = original;
    }

    const editorialSplit = splitEditorialDisplayName(displayName, {
        hasNameAnnotation: Boolean(annotation),
    });
    if (editorialSplit) {
        displayName = editorialSplit;
        editorialTitle = editorialTitle || original;
    }

    return {
        displayName: normalizeText(displayName),
        nativeName: normalizeText(nativeName) || undefined,
        transcription: normalizeRomanization(transcription) || undefined,
        editorialTitle,
    };
}

function findNameAnnotation(value) {
    const brackets = /[（(]([^()（）]*)[)）]/gu;
    for (const match of value.matchAll(brackets)) {
        const content = normalizeText(match[1]);
        const before = normalizeText(value.slice(0, match.index));
        if (!content) continue;
        if (CJK_RE.test(content) || (CJK_RE.test(before) && looksLikeRomanization(content))) {
            return {
                index: match.index,
                full: match[0],
                content,
            };
        }
    }
    return null;
}

function parseAnnotation(content, before) {
    const parts = String(content)
        .split(/[,，、]/u)
        .map(normalizeText)
        .filter(Boolean);
    const nativeParts = [];
    const transcriptionParts = [];

    for (const part of parts) {
        if (CJK_RE.test(part)) nativeParts.push(part);
        else if (looksLikeRomanization(part)) transcriptionParts.push(part);
    }

    if (nativeParts.length === 0 && CJK_RE.test(before)) {
        nativeParts.push(before);
    }

    return {
        nativeName: nativeParts.length ? nativeParts.join(' · ') : undefined,
        transcription: transcriptionParts[0],
    };
}

function splitEditorialDisplayName(value, options = {}) {
    const text = normalizeText(value);
    if (!text) return text;

    const fullWidthColon = text.indexOf('：');
    if (fullWidthColon > 0) {
        return normalizeText(text.slice(0, fullWidthColon));
    }

    const doubleDash = text.indexOf('——');
    if (doubleDash > 0) {
        return chooseDashSegment(
            text.slice(0, doubleDash),
            text.slice(doubleDash + 2));
    }

    const emDash = text.indexOf(' — ');
    if (emDash > 0) {
        const left = normalizeText(text.slice(0, emDash));
        const right = normalizeText(text.slice(emDash + 3));
        if (/^[0-9A-Z][0-9A-Z._-]*$/u.test(left || '')) return left;
        return options.hasNameAnnotation ? right : null;
    }

    return null;
}

function chooseDashSegment(leftValue, rightValue) {
    const left = normalizeText(leftValue);
    const right = normalizeText(rightValue);
    if (!left || !right) return left || right;
    return /^[0-9A-Z][0-9A-Z._-]*$/u.test(left) ? left : right;
}

function auditProductNaming(products) {
    const errors = [];
    const warnings = [];
    const duplicateEnglishNames = [];
    const englishNames = new Map();
    const counts = {
        products: Array.isArray(products) ? products.length : 0,
        translationRows: 0,
        compositeTranslationRows: 0,
        compositeNativeNames: 0,
        cjkTranscriptions: 0,
        editorialDisplayNames: 0,
        duplicateEnglishNames: 0,
    };

    for (const product of products || []) {
        const code = normalizeText(product?.code) || '<product>';
        const translations = Array.isArray(product?.translations) ? product.translations : [];
        counts.translationRows += translations.length;

        if (hasCompositeNativeName(product?.nativeName)) {
            counts.compositeNativeNames += 1;
            errors.push(`${code}: nativeName still contains transcription or editorial text.`);
        }
        if (containsCjk(product?.transcription)) {
            counts.cjkTranscriptions += 1;
            errors.push(`${code}: transcription contains native-script characters.`);
        }

        for (const translation of translations) {
            const locale = normalizeText(translation?.lang) || '<locale>';
            const name = normalizeText(translation?.name);
            if (hasCompositeTranslationName(name)) {
                counts.compositeTranslationRows += 1;
                errors.push(`${code}: ${locale} name still combines display, native, or transcription text.`);
            }
            if (EDITORIAL_DELIMITER_RE.test(name || '')) {
                counts.editorialDisplayNames += 1;
                errors.push(`${code}: ${locale} name still contains an editorial title delimiter.`);
            }
            if (containsCjk(translation?.transcription)) {
                counts.cjkTranscriptions += 1;
                errors.push(`${code}: ${locale} transcription contains native-script characters.`);
            }
        }

        const englishName = normalizeText(
            translations.find(translation =>
                String(translation?.lang || '').toLowerCase() === 'en-us')?.name);
        const englishKey = canonicalNameKey(englishName);
        if (englishKey) {
            const entry = englishNames.get(englishKey) || { name: englishName, codes: [] };
            entry.codes.push(code);
            englishNames.set(englishKey, entry);
        }
    }

    for (const { name, codes } of englishNames.values()) {
        if (codes.length < 2) continue;
        duplicateEnglishNames.push({ name, codes });
        warnings.push(`Duplicate en-US product name '${name}': ${codes.join(', ')}.`);
    }
    counts.duplicateEnglishNames = duplicateEnglishNames.length;

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        counts,
        duplicateEnglishNames,
    };
}

function hasCompositeTranslationName(value) {
    const text = normalizeText(value);
    if (!text) return false;
    if (COMPOSITE_ANNOTATION_RE.test(text)) return true;
    const annotation = findNameAnnotation(text);
    return Boolean(annotation);
}

function hasCompositeNativeName(value) {
    const text = normalizeText(value);
    if (!text) return false;
    return Boolean(findNameAnnotation(text)) || EDITORIAL_DELIMITER_RE.test(text);
}

function normalizeEditorialSuffix(value) {
    return normalizeText(String(value || '').replace(/^[\s:：—–-]+/u, ''));
}

function normalizeRomanization(value) {
    return normalizeText(String(value || '').replace(/[*_]/gu, ''));
}

function looksLikeRomanization(value) {
    const text = normalizeRomanization(value);
    return Boolean(text) && !CJK_RE.test(text) && /\p{L}/u.test(text);
}

function containsCjk(value) {
    return CJK_RE.test(String(value || ''));
}

function normalizeText(value) {
    const text = String(value ?? '')
        .replace(/\s+/gu, ' ')
        .trim();
    return text || undefined;
}

function canonicalNameKey(value) {
    return normalizeText(value)
        ?.toLocaleLowerCase('en-US')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

module.exports = {
    auditProductNaming,
    decomposeTeaName,
    hasCompositeNativeName,
    hasCompositeTranslationName,
};
