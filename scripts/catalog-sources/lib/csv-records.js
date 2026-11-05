'use strict';

function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
}

function parseCsv(value) {
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
    const records = [];
    let record = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                field += '"';
                index++;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ',') {
            record.push(field);
            field = '';
        } else if (character === '\n') {
            if (field.endsWith('\r')) field = field.slice(0, -1);
            record.push(field);
            records.push(record);
            record = [];
            field = '';
        } else {
            field += character;
        }
    }

    if (quoted) fail('CSV_UNCLOSED_QUOTE');
    if (field.length > 0 || record.length > 0) {
        if (field.endsWith('\r')) field = field.slice(0, -1);
        record.push(field);
        records.push(record);
    }
    return records;
}

module.exports = { parseCsv };
