'use strict';

class SourceIngestionError extends Error {
    constructor(code, cause) {
        super(`Catalog source ingestion rejected (${code}).`, cause ? { cause } : undefined);
        this.name = 'SourceIngestionError';
        this.code = code;
    }
}

function reject(code, cause) {
    throw new SourceIngestionError(code, cause);
}

module.exports = {
    SourceIngestionError,
    reject,
};
