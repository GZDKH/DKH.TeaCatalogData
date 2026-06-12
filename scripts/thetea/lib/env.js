const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function loadDotEnv(filePath = path.join(REPO_ROOT, '.env')) {
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const idx = trimmed.indexOf('=');
        if (idx < 0) continue;

        const key = trimmed.slice(0, idx).trim();
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (!process.env[key]) {
            process.env[key] = value;
        }
    }
}

function parseArgs(argv = process.argv.slice(2)) {
    const args = { _: [] };
    for (const arg of argv) {
        if (!arg.startsWith('--')) {
            args._.push(arg);
            continue;
        }

        const raw = arg.slice(2);
        const idx = raw.indexOf('=');
        if (idx < 0) {
            args[raw] = true;
            continue;
        }

        args[raw.slice(0, idx)] = raw.slice(idx + 1);
    }

    return args;
}

function csv(value, fallback = []) {
    if (!value) return fallback;
    return String(value)
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function getTheTeaApiKey() {
    return process.env.THETEA_API_KEY || process.env.THE_TEA_API_KEY || '';
}

function requireArg(args, name) {
    const value = args[name];
    if (!value || value === true) {
        throw new Error(`--${name}=... is required`);
    }
    return String(value);
}

module.exports = {
    REPO_ROOT,
    loadDotEnv,
    parseArgs,
    csv,
    getTheTeaApiKey,
    requireArg,
};
