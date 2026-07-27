'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function ensureDirectory(directory) {
    fs.mkdirSync(directory, { recursive: true });
}

function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonicalize(value[key])]),
        );
    }
    return value;
}

function stableJson(value) {
    return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function atomicWrite(file, contents) {
    ensureDirectory(path.dirname(file));
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, contents);
    fs.renameSync(temporary, file);
}

function writeJsonAtomic(file, value) {
    atomicWrite(file, stableJson(value));
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function readJsonIfExists(file) {
    return fs.existsSync(file) ? readJson(file) : null;
}

function safeSegment(value, label) {
    const segment = String(value || '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(segment)) {
        throw new Error(`${label} must contain only letters, numbers, dot, underscore, or dash.`);
    }
    return segment;
}

module.exports = {
    atomicWrite,
    canonicalize,
    ensureDirectory,
    readJson,
    readJsonIfExists,
    safeSegment,
    sha256,
    stableJson,
    writeJsonAtomic,
};
