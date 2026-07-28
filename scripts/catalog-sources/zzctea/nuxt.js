'use strict';

const { reject } = require('../lib/errors');
const { assertPublicCatalogPayload } = require('./policy');
const { SANITIZED_ENVELOPE_SCHEMA } = require('./sanitized-envelope');

const MAXIMUM_HTML_BYTES = 4 * 1024 * 1024;
const MAXIMUM_NUXT_DEPTH = 64;
const MAXIMUM_NUXT_NODES = 100_000;
const MAXIMUM_NUXT_STRING_LENGTH = 256_000;
const MAXIMUM_NUXT_ARRAY_ITEMS = 10_000;
const MAXIMUM_NUXT_OBJECT_PROPERTIES = 2_000;
const MAXIMUM_NUXT_FUNCTION_PARAMETERS = 4_096;
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const referenceSymbol = Symbol('nuxt-parameter-reference');
const productFields = Object.freeze([
    'id',
    'name',
    'year',
    'yearInt',
    'teaId',
    'batch',
    'productionTechnology',
    'shape',
    'specification',
    'img1',
    'img2',
    'imageUrl1',
    'imgUrl',
    'price',
    'lastWeekPrice',
    'maxPrice',
    'minPrice',
    'thisWeekMaxPrice',
    'thisWeekMinPrice',
    'thisYearMaxPrice',
    'thisYearMinPrice',
    'rise',
    'risePercent',
    'halfYearPercent',
    'monthPercent',
    'threeMonthPercent',
    'weekPercent',
    'yearPercent',
    'priceDisplayStatus',
    'arrivalTime',
    'date',
    'createdAt',
    'updatedAt',
    'unit',
    'brandId',
    'brand',
    'distributionPrice',
    'distributionCount',
    'marketStatus',
]);

function fail(code = 'ZZCTEA_NUXT_SERIALIZATION_INVALID') {
    reject(code);
}

function parser(text) {
    let index = 0;
    let nodes = 0;
    const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]*/uy;
    const numberPattern =
        /-?(?:(?:0|[1-9]\d*)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/uy;

    function countNode(depth) {
        nodes += 1;
        if (nodes > MAXIMUM_NUXT_NODES || depth > MAXIMUM_NUXT_DEPTH) fail();
    }

    function whitespace() {
        while (/\s/u.test(text[index] || '')) index += 1;
    }

    function keyword(value) {
        whitespace();
        if (!text.startsWith(value, index) ||
            /[A-Za-z0-9_$]/u.test(text[index + value.length] || '')) {
            fail();
        }
        index += value.length;
    }

    function expect(value) {
        whitespace();
        if (!text.startsWith(value, index)) fail();
        index += value.length;
    }

    function identifier() {
        whitespace();
        identifierPattern.lastIndex = index;
        const match = identifierPattern.exec(text);
        if (!match) fail();
        index += match[0].length;
        return match[0];
    }

    function string() {
        whitespace();
        const quote = text[index];
        if (quote !== '"' && quote !== '\'') fail();
        index += 1;
        let result = '';
        while (index < text.length) {
            const character = text[index++];
            if (character === quote) {
                if (result.length > MAXIMUM_NUXT_STRING_LENGTH) fail();
                return result;
            }
            if (character === '\n' || character === '\r' ||
                character.charCodeAt(0) < 0x20) {
                fail();
            }
            if (character !== '\\') {
                result += character;
                continue;
            }
            const escaped = text[index++];
            const simple = {
                '"': '"',
                '\'': '\'',
                '\\': '\\',
                '/': '/',
                b: '\b',
                f: '\f',
                n: '\n',
                r: '\r',
                t: '\t',
                v: '\v',
                0: '\0',
            };
            if (Object.prototype.hasOwnProperty.call(simple, escaped)) {
                result += simple[escaped];
                continue;
            }
            if (escaped === 'x') {
                const hex = text.slice(index, index + 2);
                if (!/^[0-9a-f]{2}$/iu.test(hex)) fail();
                result += String.fromCharCode(Number.parseInt(hex, 16));
                index += 2;
                continue;
            }
            if (escaped === 'u') {
                const hex = text.slice(index, index + 4);
                if (!/^[0-9a-f]{4}$/iu.test(hex)) fail();
                result += String.fromCharCode(Number.parseInt(hex, 16));
                index += 4;
                continue;
            }
            fail();
        }
        fail();
    }

    function number() {
        whitespace();
        numberPattern.lastIndex = index;
        const match = numberPattern.exec(text);
        if (!match) fail();
        index += match[0].length;
        return match[0];
    }

    function array(depth) {
        countNode(depth);
        expect('[');
        const result = [];
        whitespace();
        if (text[index] === ']') {
            index += 1;
            return result;
        }
        while (index < text.length) {
            if (result.length >= MAXIMUM_NUXT_ARRAY_ITEMS) fail();
            result.push(value(depth + 1));
            whitespace();
            if (text[index] === ']') {
                index += 1;
                return result;
            }
            expect(',');
        }
        fail();
    }

    function object(depth) {
        countNode(depth);
        expect('{');
        const result = Object.create(null);
        whitespace();
        if (text[index] === '}') {
            index += 1;
            return result;
        }
        let propertyCount = 0;
        while (index < text.length) {
            propertyCount += 1;
            if (propertyCount > MAXIMUM_NUXT_OBJECT_PROPERTIES) fail();
            whitespace();
            const key = text[index] === '"' || text[index] === '\''
                ? string()
                : identifier();
            if (['__proto__', 'prototype', 'constructor'].includes(key) ||
                Object.prototype.hasOwnProperty.call(result, key)) {
                fail();
            }
            expect(':');
            result[key] = value(depth + 1);
            whitespace();
            if (text[index] === '}') {
                index += 1;
                return result;
            }
            expect(',');
        }
        fail();
    }

    function primitiveIdentifier(depth) {
        countNode(depth);
        const name = identifier();
        if (name === 'true') return true;
        if (name === 'false') return false;
        if (name === 'null' || name === 'undefined') return null;
        return { [referenceSymbol]: name };
    }

    function value(depth = 0) {
        whitespace();
        const token = text[index];
        if (token === '{') return object(depth);
        if (token === '[') return array(depth);
        if (token === '"' || token === '\'') {
            countNode(depth);
            return string();
        }
        if (token === '-' ||
            (token === '.' && /\d/u.test(text[index + 1] || '')) ||
            /\d/u.test(token || '')) {
            countNode(depth);
            return number();
        }
        if (text.startsWith('void', index) &&
            !/[A-Za-z0-9_$]/u.test(text[index + 4] || '')) {
            keyword('void');
            const operand = value(depth + 1);
            if (operand !== '0') fail();
            return null;
        }
        return primitiveIdentifier(depth);
    }

    function functionCall() {
        expect('(');
        keyword('function');
        expect('(');
        const parameters = [];
        const parameterNames = new Set();
        whitespace();
        if (text[index] !== ')') {
            while (true) {
                const name = identifier();
                if (parameterNames.has(name) ||
                    parameters.length >= MAXIMUM_NUXT_FUNCTION_PARAMETERS) {
                    fail();
                }
                parameters.push(name);
                parameterNames.add(name);
                whitespace();
                if (text[index] === ')') break;
                expect(',');
            }
        }
        expect(')');
        expect('{');
        keyword('return');
        const returned = value(0);
        whitespace();
        if (text[index] === ';') index += 1;
        expect('}');
        whitespace();
        const invocationInsideGroup = text[index] === '(';
        if (!invocationInsideGroup) {
            expect(')');
        }
        expect('(');
        const argumentsList = [];
        whitespace();
        if (text[index] !== ')') {
            while (true) {
                if (argumentsList.length >= MAXIMUM_NUXT_FUNCTION_PARAMETERS) {
                    fail();
                }
                argumentsList.push(value(0));
                whitespace();
                if (text[index] === ')') break;
                expect(',');
            }
        }
        expect(')');
        if (invocationInsideGroup) {
            expect(')');
        }
        if (argumentsList.length !== parameters.length) fail();
        const bindings = new Map(parameters.map((name, offset) => [
            name,
            argumentsList[offset],
        ]));
        return resolve(returned, bindings, 0);
    }

    function resolve(current, bindings, depth) {
        countNode(depth);
        if (!current || typeof current !== 'object') return current;
        if (Object.prototype.hasOwnProperty.call(current, referenceSymbol)) {
            if (!bindings.has(current[referenceSymbol])) fail();
            const bound = bindings.get(current[referenceSymbol]);
            if (bound && typeof bound === 'object' &&
                Object.prototype.hasOwnProperty.call(bound, referenceSymbol)) {
                fail();
            }
            return bound;
        }
        if (Array.isArray(current)) {
            return current.map(item => resolve(item, bindings, depth + 1));
        }
        const result = Object.create(null);
        for (const [key, child] of Object.entries(current)) {
            result[key] = resolve(child, bindings, depth + 1);
        }
        return result;
    }

    return {
        parse() {
            whitespace();
            const result = text[index] === '('
                ? functionCall()
                : value(0);
            whitespace();
            if (text[index] === ';') index += 1;
            whitespace();
            if (index !== text.length) fail();
            return result;
        },
    };
}

function decodeHtml(responseBody) {
    if (!Buffer.isBuffer(responseBody)) responseBody = Buffer.from(responseBody);
    if (responseBody.length === 0 || responseBody.length > MAXIMUM_HTML_BYTES) {
        fail('ZZCTEA_HTML_SIZE_INVALID');
    }
    try {
        return strictUtf8.decode(responseBody);
    } catch (error) {
        reject('ZZCTEA_HTML_UTF8_INVALID', error);
    }
}

function extractNuxtState(responseBody) {
    const html = decodeHtml(responseBody);
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script\s*>/giu)]
        .map(match => match[1])
        .filter(script => script.includes('window.__NUXT__'));
    if (scripts.length !== 1) fail('ZZCTEA_NUXT_ASSIGNMENT_INVALID');
    const script = scripts[0];
    const marker = 'window.__NUXT__';
    if (script.indexOf(marker) !== script.lastIndexOf(marker)) {
        fail('ZZCTEA_NUXT_ASSIGNMENT_INVALID');
    }
    let offset = script.indexOf(marker) + marker.length;
    while (/\s/u.test(script[offset] || '')) offset += 1;
    if (script[offset] !== '=') fail('ZZCTEA_NUXT_ASSIGNMENT_INVALID');
    return parser(script.slice(offset + 1)).parse();
}

function firstDataEntry(state) {
    if (!state || Array.isArray(state) || typeof state !== 'object' ||
        !Array.isArray(state.data) || state.data.length !== 1 ||
        !state.data[0] || Array.isArray(state.data[0]) ||
        typeof state.data[0] !== 'object') {
        fail('ZZCTEA_NUXT_DATA_SHAPE_INVALID');
    }
    return state.data[0];
}

function canonicalPositiveInteger(value, code) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value)) reject(code);
    const numberValue = Number(value);
    if (!Number.isSafeInteger(numberValue)) reject(code);
    return { text: value, number: numberValue };
}

function sanitizeProduct(source) {
    if (!source || Array.isArray(source) || typeof source !== 'object') {
        fail('ZZCTEA_NUXT_PRODUCT_SHAPE_INVALID');
    }
    assertPublicCatalogPayload(source);
    const result = Object.create(null);
    for (const key of productFields) {
        const current = source[key];
        if (current === undefined || current === null) continue;
        if (typeof current !== 'string' && typeof current !== 'boolean') {
            fail('ZZCTEA_NUXT_PRODUCT_FIELD_INVALID');
        }
        result[key] = current;
    }
    canonicalPositiveInteger(result.id, 'ZZCTEA_PRODUCT_ID_INVALID');
    if (result.teaId !== undefined && result.teaId !== result.id) {
        fail('ZZCTEA_PRODUCT_ID_INVALID');
    }
    if (typeof result.name !== 'string' || !result.name.trim()) {
        fail('ZZCTEA_PRODUCT_NAME_INVALID');
    }
    return result;
}

function serializeSanitizedEnvelope(envelope) {
    assertPublicCatalogPayload(envelope);
    const serialized = Buffer.from(JSON.stringify(envelope));
    if (serialized.length > MAXIMUM_HTML_BYTES) {
        fail('ZZCTEA_SANITIZED_ENVELOPE_SIZE_INVALID');
    }
    return serialized;
}

function sanitizeListHtml(responseBody, expectedPage, expectedPageSize) {
    const data = firstDataEntry(extractNuxtState(responseBody));
    if (!Array.isArray(data.initialHotTea) ||
        !data.initialSearch || Array.isArray(data.initialSearch) ||
        typeof data.initialSearch !== 'object') {
        fail('ZZCTEA_NUXT_LIST_SHAPE_INVALID');
    }
    const page = canonicalPositiveInteger(
        data.initialSearch.page,
        'ZZCTEA_NUXT_LIST_PAGE_INVALID',
    );
    const pageSize = canonicalPositiveInteger(
        data.initialSearch.pageSize,
        'ZZCTEA_NUXT_LIST_PAGE_SIZE_INVALID',
    );
    const totalPages = canonicalPositiveInteger(
        data.totalPages,
        'ZZCTEA_NUXT_LIST_TOTAL_PAGES_INVALID',
    );
    if (page.number !== expectedPage ||
        pageSize.number !== expectedPageSize ||
        totalPages.number > 10_000 ||
        page.number > totalPages.number) {
        fail('ZZCTEA_NUXT_LIST_PAGING_MISMATCH');
    }
    const products = data.initialHotTea.map(sanitizeProduct);
    if (products.length === 0 || products.length > expectedPageSize ||
        (page.number < totalPages.number && products.length !== expectedPageSize) ||
        new Set(products.map(product => product.id)).size !== products.length) {
        fail('ZZCTEA_NUXT_LIST_COUNT_INVALID');
    }
    return serializeSanitizedEnvelope({
        schemaVersion: SANITIZED_ENVELOPE_SCHEMA,
        kind: 'list',
        page: page.text,
        pageSize: pageSize.text,
        totalPages: totalPages.text,
        data: products,
    });
}

function sanitizeDetailHtml(responseBody, expectedExternalId) {
    const data = firstDataEntry(extractNuxtState(responseBody));
    const product = sanitizeProduct(data.teaDetail);
    if (product.id !== String(expectedExternalId)) {
        fail('ZZCTEA_NUXT_DETAIL_ID_MISMATCH');
    }
    return serializeSanitizedEnvelope({
        schemaVersion: SANITIZED_ENVELOPE_SCHEMA,
        kind: 'detail',
        data: product,
    });
}

function sanitizeTerminalProbeHtml(
    responseBody,
    requestedPage,
    expectedPageSize,
    expectedTotalPages,
) {
    const data = firstDataEntry(extractNuxtState(responseBody));
    if (!Array.isArray(data.initialHotTea) ||
        !data.initialSearch || Array.isArray(data.initialSearch) ||
        typeof data.initialSearch !== 'object') {
        fail('ZZCTEA_NUXT_LIST_SHAPE_INVALID');
    }
    const reportedPage = canonicalPositiveInteger(
        data.initialSearch.page,
        'ZZCTEA_NUXT_LIST_PAGE_INVALID',
    );
    const pageSize = canonicalPositiveInteger(
        data.initialSearch.pageSize,
        'ZZCTEA_NUXT_LIST_PAGE_SIZE_INVALID',
    );
    const totalPages = canonicalPositiveInteger(
        data.totalPages,
        'ZZCTEA_NUXT_LIST_TOTAL_PAGES_INVALID',
    );
    if (requestedPage !== expectedTotalPages + 1 ||
        pageSize.number !== expectedPageSize ||
        totalPages.number !== expectedTotalPages ||
        ![requestedPage, expectedTotalPages].includes(reportedPage.number)) {
        fail('ZZCTEA_NUXT_TERMINAL_PROBE_PAGING_MISMATCH');
    }
    const products = data.initialHotTea.map(sanitizeProduct);
    if (products.length > expectedPageSize ||
        new Set(products.map(product => product.id)).size !== products.length) {
        fail('ZZCTEA_NUXT_TERMINAL_PROBE_COUNT_INVALID');
    }
    return serializeSanitizedEnvelope({
        schemaVersion: SANITIZED_ENVELOPE_SCHEMA,
        kind: 'terminal-probe',
        requestedPage: String(requestedPage),
        reportedPage: reportedPage.text,
        pageSize: pageSize.text,
        totalPages: totalPages.text,
        data: products,
    });
}

module.exports = {
    MAXIMUM_HTML_BYTES,
    PRODUCT_FIELDS: productFields,
    extractNuxtState,
    sanitizeDetailHtml,
    sanitizeListHtml,
    sanitizeTerminalProbeHtml,
};
