#!/usr/bin/env node
const assert = require('assert');
const { classifyFetchIssue } = require('./lib/snapshot-errors');

assert.strictEqual(
    classifyFetchIssue({ endpoint: 'field', status: 404 }).kind,
    'missing-field-detail');

assert.strictEqual(
    classifyFetchIssue({ endpoint: 'field', status: 500 }).kind,
    'fatal');

assert.strictEqual(
    classifyFetchIssue({ endpoint: 'similar', status: 404 }).kind,
    'fatal');

assert.strictEqual(
    classifyFetchIssue({ endpoint: 'glossary', message: 'socket disconnected' }).kind,
    'fatal');

console.log('test-snapshot-errors: OK');
