function classifyFetchIssue(issue) {
    if (issue?.endpoint === 'similar' && issue.status === 404) {
        try {
            const body = typeof issue.body === 'string' ? JSON.parse(issue.body) : issue.body;
            if (body?.error === 'no vector for that slug') return { kind: 'missing-similarity-vector' };
        } catch { /* An unrelated/malformed 404 remains fatal. */ }
    }
    if (issue?.endpoint === 'field' && issue.status === 404) {
        return { kind: 'missing-field-detail' };
    }

    if (issue?.endpoint === 'card' && issue.entityKind !== 'tea' && issue.status === 404) {
        return { kind: 'missing-entity-card' };
    }

    if (issue?.status === 402) return { kind: 'language-not-entitled' };
    if (issue?.status === 429) return { kind: 'rate-limited' };

    return { kind: 'fatal' };
}

module.exports = {
    classifyFetchIssue,
};
