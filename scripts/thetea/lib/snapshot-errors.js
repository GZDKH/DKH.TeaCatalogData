function classifyFetchIssue(issue) {
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
