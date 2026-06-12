function classifyFetchIssue(issue) {
    if (issue?.endpoint === 'field' && issue.status === 404) {
        return { kind: 'missing-field-detail' };
    }

    return { kind: 'fatal' };
}

module.exports = {
    classifyFetchIssue,
};
