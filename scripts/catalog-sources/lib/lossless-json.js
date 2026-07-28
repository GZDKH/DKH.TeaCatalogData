'use strict';

const { reject } = require('./errors');

function parseLosslessJson(text) {
    let index = 0;
    const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

    function whitespace() {
        while (/\s/.test(text[index] || '')) index += 1;
    }

    function value() {
        whitespace();
        const token = text[index];
        if (token === '{') return object();
        if (token === '[') return array();
        if (token === '"') return string();
        if (token === '-' || /\d/.test(token || '')) return number();
        if (text.startsWith('true', index)) {
            index += 4;
            return true;
        }
        if (text.startsWith('false', index)) {
            index += 5;
            return false;
        }
        if (text.startsWith('null', index)) {
            index += 4;
            return null;
        }
        reject('SOURCE_DECRYPTED_JSON_INVALID');
    }

    function object() {
        const result = {};
        index += 1;
        whitespace();
        if (text[index] === '}') {
            index += 1;
            return result;
        }
        while (index < text.length) {
            whitespace();
            if (text[index] !== '"') reject('SOURCE_DECRYPTED_JSON_INVALID');
            const key = string();
            if (Object.prototype.hasOwnProperty.call(result, key)) {
                reject('SOURCE_DECRYPTED_JSON_INVALID');
            }
            whitespace();
            if (text[index] !== ':') reject('SOURCE_DECRYPTED_JSON_INVALID');
            index += 1;
            result[key] = value();
            whitespace();
            if (text[index] === '}') {
                index += 1;
                return result;
            }
            if (text[index] !== ',') reject('SOURCE_DECRYPTED_JSON_INVALID');
            index += 1;
        }
        reject('SOURCE_DECRYPTED_JSON_INVALID');
    }

    function array() {
        const result = [];
        index += 1;
        whitespace();
        if (text[index] === ']') {
            index += 1;
            return result;
        }
        while (index < text.length) {
            result.push(value());
            whitespace();
            if (text[index] === ']') {
                index += 1;
                return result;
            }
            if (text[index] !== ',') reject('SOURCE_DECRYPTED_JSON_INVALID');
            index += 1;
        }
        reject('SOURCE_DECRYPTED_JSON_INVALID');
    }

    function string() {
        const start = index;
        index += 1;
        while (index < text.length) {
            if (text[index] === '\\') {
                index += 2;
                continue;
            }
            if (text[index] === '"') {
                index += 1;
                try {
                    return JSON.parse(text.slice(start, index));
                } catch (error) {
                    reject('SOURCE_DECRYPTED_JSON_INVALID', error);
                }
            }
            if (text.charCodeAt(index) < 0x20) reject('SOURCE_DECRYPTED_JSON_INVALID');
            index += 1;
        }
        reject('SOURCE_DECRYPTED_JSON_INVALID');
    }

    function number() {
        numberPattern.lastIndex = index;
        const match = numberPattern.exec(text);
        if (!match) reject('SOURCE_DECRYPTED_JSON_INVALID');
        index += match[0].length;
        return match[0];
    }

    const result = value();
    whitespace();
    if (index !== text.length) reject('SOURCE_DECRYPTED_JSON_INVALID');
    return result;
}

module.exports = {
    parseLosslessJson,
};
