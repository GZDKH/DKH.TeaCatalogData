'use strict';

const zlib = require('zlib');

const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x0021;

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < table.length; index++) {
        let value = index;
        for (let bit = 0; bit < 8; bit++) {
            value = (value & 1) === 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let value = 0xFFFFFFFF;
    for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
    return (value ^ 0xFFFFFFFF) >>> 0;
}

function xml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function columnName(index) {
    let current = index + 1;
    let result = '';
    while (current > 0) {
        current--;
        result = String.fromCharCode(65 + (current % 26)) + result;
        current = Math.floor(current / 26);
    }
    return result;
}

function worksheetXml(headers, rows) {
    const allRows = [headers, ...rows];
    const lastCell = `${columnName(headers.length - 1)}${allRows.length}`;
    const body = allRows.map((row, rowIndex) => {
        const rowNumber = rowIndex + 1;
        const cells = row.map((value, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowNumber}`;
            if (rowIndex > 0 && (columnIndex === 6 || columnIndex === 8) && value !== '') {
                return `<c r="${reference}"><v>${xml(value)}</v></c>`;
            }
            return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
        }).join('');
        return `<row r="${rowNumber}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<dimension ref="A1:${lastCell}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData>` +
        `<autoFilter ref="A1:${columnName(headers.length - 1)}1"/>` +
        `</worksheet>\n`;
}

function workbookEntries(headers, rows, sheetName) {
    return new Map([
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>\n`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>\n`],
        ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>\n`],
        ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>\n`],
        ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>\n`],
        ['xl/worksheets/sheet1.xml', worksheetXml(headers, rows)],
    ]);
}

function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const [name, source] of entries) {
        const nameBuffer = Buffer.from(name, 'utf8');
        const contents = Buffer.isBuffer(source) ? source : Buffer.from(source, 'utf8');
        const compressed = zlib.deflateRawSync(contents, { level: 9 });
        const checksum = crc32(contents);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034B50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
        localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(contents.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);
        localParts.push(localHeader, nameBuffer, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014B50, 0);
        centralHeader.writeUInt16LE(0x0314, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
        centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(contents.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);
        offset += localHeader.length + nameBuffer.length + compressed.length;
    }

    const central = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054B50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.size, 8);
    end.writeUInt16LE(entries.size, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, central, end]);
}

function createXlsx(headers, rows, sheetName = 'Exact sellables') {
    return createZip(workbookEntries(headers, rows, sheetName));
}

function readZipEntries(buffer) {
    let endOffset = -1;
    for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index--) {
        if (buffer.readUInt32LE(index) === 0x06054B50) {
            endOffset = index;
            break;
        }
    }
    if (endOffset < 0) throw new Error('XLSX_ZIP_END_MISSING');
    const count = buffer.readUInt16LE(endOffset + 10);
    let cursor = buffer.readUInt32LE(endOffset + 16);
    const result = new Map();
    for (let index = 0; index < count; index++) {
        if (buffer.readUInt32LE(cursor) !== 0x02014B50) throw new Error('XLSX_ZIP_CENTRAL_INVALID');
        const method = buffer.readUInt16LE(cursor + 10);
        const checksum = buffer.readUInt32LE(cursor + 16);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const nameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localOffset = buffer.readUInt32LE(cursor + 42);
        const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        if (buffer.readUInt32LE(localOffset) !== 0x04034B50) throw new Error('XLSX_ZIP_LOCAL_INVALID');
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.subarray(start, start + compressedSize);
        const contents = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);
        if (crc32(contents) !== checksum) throw new Error('XLSX_ZIP_CRC_MISMATCH');
        result.set(name, contents);
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    return result;
}

module.exports = {
    createXlsx,
    readZipEntries,
};
