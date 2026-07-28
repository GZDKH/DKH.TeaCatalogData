'use strict';

const fs = require('fs');
const path = require('path');
const { sha256, stableJson } = require('./artifacts');

const IMPORT_PATH = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.proto$/;
const BUILT_IN_IMPORTS = new Set([
    'google/protobuf/timestamp.proto',
]);

function requireRealRoot(value, label) {
    const resolved = path.resolve(value);
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`${label} must be a real directory.`);
    }
    return fs.realpathSync(resolved);
}

function validateImportPath(value) {
    if (typeof value !== 'string' ||
        !IMPORT_PATH.test(value) ||
        path.posix.isAbsolute(value) ||
        value.split('/').some(segment => segment === '.' || segment === '..')) {
        throw new Error(`Proto import path '${String(value)}' is unsafe.`);
    }
    return value;
}

function inspectCandidate(root, importPath) {
    let current = root;
    const parts = importPath.split('/');
    for (let index = 0; index < parts.length; index += 1) {
        current = path.join(current, parts[index]);
        let stat;
        try {
            stat = fs.lstatSync(current);
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
        if (stat.isSymbolicLink()) {
            throw new Error(`Proto closure rejects symlinked path '${importPath}'.`);
        }
        if (index < parts.length - 1 && !stat.isDirectory()) {
            return null;
        }
        if (index === parts.length - 1 && !stat.isFile()) {
            return null;
        }
    }
    const real = fs.realpathSync(current);
    const relative = path.relative(root, real);
    if (!relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(`Proto import '${importPath}' escapes an allowlisted root.`);
    }
    return real;
}

function stripComments(value) {
    let result = '';
    let state = 'code';
    for (let index = 0; index < value.length; index += 1) {
        const current = value[index];
        const next = value[index + 1];
        if (state === 'line') {
            if (current === '\n') {
                result += current;
                state = 'code';
            } else {
                result += ' ';
            }
            continue;
        }
        if (state === 'block') {
            if (current === '*' && next === '/') {
                result += '  ';
                index += 1;
                state = 'code';
            } else {
                result += current === '\n' ? '\n' : ' ';
            }
            continue;
        }
        if (state === 'string') {
            result += current;
            if (current === '\\') {
                result += next || '';
                index += 1;
            } else if (current === '"') {
                state = 'code';
            }
            continue;
        }
        if (current === '/' && next === '/') {
            result += '  ';
            index += 1;
            state = 'line';
        } else if (current === '/' && next === '*') {
            result += '  ';
            index += 1;
            state = 'block';
        } else {
            result += current;
            if (current === '"') state = 'string';
        }
    }
    if (state === 'block') {
        throw new Error('Proto file contains an unterminated block comment.');
    }
    if (state === 'string') {
        throw new Error('Proto file contains an unterminated string.');
    }
    return result;
}

function parseImports(contents, importPath) {
    const imports = [];
    const source = stripComments(contents.toString('utf8'));
    const tokens = [];
    const expression =
        /"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_]*|[;={}]/g;
    let match;
    while ((match = expression.exec(source)) !== null) {
        tokens.push(match[0]);
    }
    for (let index = 0; index < tokens.length; index += 1) {
        if (tokens[index] !== 'import') continue;
        let cursor = index + 1;
        if (tokens[cursor] === 'public' || tokens[cursor] === 'weak') {
            cursor += 1;
        }
        const importToken = tokens[cursor];
        if (typeof importToken !== 'string' ||
            !/^"[^"\\]+"$/.test(importToken) ||
            tokens[cursor + 1] !== ';') {
            throw new Error(
                `Proto '${importPath}' contains an unsupported import statement.`,
            );
        }
        imports.push(validateImportPath(importToken.slice(1, -1)));
        index = cursor + 1;
    }
    return [...new Set(imports)].sort();
}

function buildProtoClosure(rootImportPath, allowlistedRoots) {
    const rootPath = validateImportPath(rootImportPath);
    if (!Array.isArray(allowlistedRoots) || allowlistedRoots.length === 0) {
        throw new Error('At least one proto allowlisted root is required.');
    }
    const roots = allowlistedRoots.map((value, index) =>
        requireRealRoot(value, `Proto allowlisted root ${index + 1}`));
    if (new Set(roots).size !== roots.length) {
        throw new Error('Proto allowlisted roots must be unique.');
    }
    const files = new Map();
    const builtInImports = new Set();
    const active = new Set();

    function resolve(importPath) {
        if (BUILT_IN_IMPORTS.has(importPath)) {
            builtInImports.add(importPath);
            return;
        }
        const matches = roots
            .map(root => inspectCandidate(root, importPath))
            .filter(Boolean);
        if (matches.length === 0) {
            throw new Error(`Proto import '${importPath}' is missing from allowlisted roots.`);
        }
        if (matches.length > 1) {
            throw new Error(`Proto import '${importPath}' is ambiguous across allowlisted roots.`);
        }
        if (active.has(importPath)) {
            throw new Error(`Proto import cycle detected at '${importPath}'.`);
        }
        if (files.has(importPath)) return;
        active.add(importPath);
        const contents = fs.readFileSync(matches[0]);
        const imports = parseImports(contents, importPath);
        files.set(importPath, {
            path: importPath,
            sha256: sha256(contents),
        });
        for (const dependency of imports) resolve(dependency);
        active.delete(importPath);
    }

    resolve(rootPath);
    const entries = [...files.values()]
        .sort((left, right) => left.path.localeCompare(right.path));
    const builtIns = [...builtInImports].sort();
    const fileListSha256 = sha256(stableJson(entries.map(entry => entry.path)));
    const closureSha256 = sha256(stableJson({
        schemaVersion: 'catalog-source-proto-closure-v1',
        rootImportPath: rootPath,
        files: entries,
        builtInImports: builtIns,
    }));
    return {
        rootImportPath: rootPath,
        rootProtoSha256: files.get(rootPath).sha256,
        fileCount: entries.length,
        fileListSha256,
        closureSha256,
        entries,
        builtInImports: builtIns,
    };
}

module.exports = {
    BUILT_IN_IMPORTS,
    buildProtoClosure,
    parseImports,
};
