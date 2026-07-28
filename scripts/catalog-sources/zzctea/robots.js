'use strict';

const { reject } = require('../lib/errors');

const MAXIMUM_ROBOTS_BYTES = 64 * 1024;
const MAXIMUM_ROBOTS_LINES = 2_000;
const MAXIMUM_ROBOTS_LINE_LENGTH = 1_000;
const ROBOTS_POLICY_VERSION = 'zzctea-robots-agent-query-v2';
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

function invalid(error) {
    reject('ZZCTEA_ROBOTS_POLICY_INVALID', error);
}

function decodeRobots(response) {
    const body = response?.body;
    if (!Buffer.isBuffer(body) ||
        body.length === 0 ||
        body.length > MAXIMUM_ROBOTS_BYTES) {
        invalid();
    }
    const contentType = response.headers?.get?.('content-type');
    if (typeof contentType !== 'string' ||
        contentType.split(';', 1)[0].trim().toLowerCase() !== 'text/plain') {
        invalid();
    }
    try {
        return strictUtf8.decode(body).replace(/^\uFEFF/u, '');
    } catch (error) {
        invalid(error);
    }
}

function parseGroups(text) {
    const lines = text.split(/\r?\n/u);
    if (lines.length > MAXIMUM_ROBOTS_LINES ||
        lines.some(line => line.length > MAXIMUM_ROBOTS_LINE_LENGTH)) {
        invalid();
    }
    const groups = [];
    let agents = [];
    let rules = [];
    let hasRules = false;

    function finishGroup() {
        if (agents.length > 0) groups.push({ agents, rules });
        agents = [];
        rules = [];
        hasRules = false;
    }

    for (const rawLine of lines) {
        const line = rawLine.replace(/#.*$/u, '').trim();
        if (!line) continue;
        const separator = line.indexOf(':');
        if (separator <= 0) invalid();
        const directive = line.slice(0, separator).trim().toLowerCase();
        const value = line.slice(separator + 1).trim();
        if (!/^[a-z-]+$/u.test(directive)) invalid();

        if (directive === 'user-agent') {
            if (!value || /[\s/]/u.test(value)) invalid();
            if (hasRules) finishGroup();
            agents.push(value.toLowerCase());
            continue;
        }
        if (directive === 'allow' || directive === 'disallow') {
            if (agents.length === 0) invalid();
            hasRules = true;
            if (!value) continue;
            if (!value.startsWith('/') ||
                /[\u0000-\u001f\u007f]/u.test(value)) {
                invalid();
            }
            rules.push({ allow: directive === 'allow', pattern: value });
        }
    }
    finishGroup();
    if (groups.length === 0) invalid();
    return groups;
}

function escapedPattern(pattern) {
    const anchored = pattern.endsWith('$');
    const source = anchored ? pattern.slice(0, -1) : pattern;
    const expression = source
        .split('*')
        .map(part => part.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&'))
        .join('.*');
    return {
        expression: new RegExp(`^${expression}${anchored ? '$' : ''}`, 'u'),
        specificity: source.replace(/\*/gu, '').length,
    };
}

function applicableGroups(groups, productToken) {
    const normalizedToken = productToken.toLowerCase();
    const specific = groups
        .map(group => ({
            group,
            specificity: Math.max(
                -1,
                ...group.agents
                    .filter(agent => agent !== '*' &&
                        normalizedToken.startsWith(agent))
                    .map(agent => agent.length),
            ),
        }))
        .filter(candidate => candidate.specificity >= 0);
    if (specific.length > 0) {
        const longest = Math.max(...specific.map(candidate => candidate.specificity));
        return specific
            .filter(candidate => candidate.specificity === longest)
            .map(candidate => candidate.group);
    }
    return groups.filter(group => group.agents.includes('*'));
}

function explicitlyAllowed(groups, productToken, path) {
    const applicable = applicableGroups(groups, productToken);
    if (applicable.length === 0) invalid();
    const matches = [];
    for (const group of applicable) {
        for (const rule of group.rules) {
            const compiled = escapedPattern(rule.pattern);
            if (compiled.expression.test(path)) {
                matches.push({ ...rule, specificity: compiled.specificity });
            }
        }
    }
    if (matches.length === 0) return false;
    matches.sort((left, right) =>
        right.specificity - left.specificity ||
        Number(right.allow) - Number(left.allow));
    return matches[0].allow;
}

function createRobotsPolicy(response, productToken) {
    if (typeof productToken !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(productToken)) {
        invalid();
    }
    const groups = parseGroups(decodeRobots(response));
    return Object.freeze({
        assertAllows(paths) {
            if (!Array.isArray(paths) ||
                paths.length === 0 ||
                paths.some(path => typeof path !== 'string' ||
                    !path.startsWith('/') ||
                    !explicitlyAllowed(groups, productToken, path))) {
                reject('ZZCTEA_ROBOTS_ROUTE_DISALLOWED');
            }
        },
    });
}

module.exports = {
    MAXIMUM_ROBOTS_BYTES,
    ROBOTS_POLICY_VERSION,
    createRobotsPolicy,
};
