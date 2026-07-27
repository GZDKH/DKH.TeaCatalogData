'use strict';

const UNIT_MAP = Object.freeze({
    克: 'g',
    千克: 'kg',
    片: 'cake',
    饼: 'cake',
    砖: 'brick',
    沱: 'tuo',
    袋: 'bag',
    盒: 'box',
    提: 'bundle',
    件: 'case',
});

const COMPONENT = /\s*(\d+(?:\.\d+)?)\s*(千克|克|片|饼|砖|沱|袋|盒|提)\s*\/\s*(片|饼|砖|沱|袋|盒|提|件)\s*/y;

function parsePackage(specification) {
    const rawText = typeof specification === 'string' ? specification.trim() : '';
    if (!rawText) {
        return {
            rawText,
            components: [],
            isExact: false,
            diagnosticCode: 'ZZCTEA_PACKAGE_SPECIFICATION_MISSING',
        };
    }

    const components = [];
    let position = 0;
    while (position < rawText.length) {
        COMPONENT.lastIndex = position;
        const match = COMPONENT.exec(rawText);
        if (!match || match.index !== position) {
            return {
                rawText,
                components,
                isExact: false,
                diagnosticCode: 'ZZCTEA_PACKAGE_GRAMMAR_UNSUPPORTED',
            };
        }
        const quantity = normalizeDecimal(match[1]);
        if (quantity === '0') {
            return {
                rawText,
                components,
                isExact: false,
                diagnosticCode: 'ZZCTEA_PACKAGE_QUANTITY_INVALID',
            };
        }
        components.push({
            quantity,
            containedUnitCode: UNIT_MAP[match[2]],
            containerUnitCode: UNIT_MAP[match[3]],
        });
        position = COMPONENT.lastIndex;
    }

    for (let index = 0; index < components.length - 1; index += 1) {
        if (components[index].containerUnitCode !== components[index + 1].containedUnitCode) {
            return {
                rawText,
                components,
                isExact: false,
                diagnosticCode: 'ZZCTEA_PACKAGE_CHAIN_INCONSISTENT',
            };
        }
    }

    const units = new Set([components[0].containedUnitCode]);
    for (const component of components) {
        if (units.has(component.containerUnitCode)) {
            return {
                rawText,
                components,
                isExact: false,
                diagnosticCode: 'ZZCTEA_PACKAGE_CHAIN_CYCLIC',
            };
        }
        units.add(component.containerUnitCode);
    }
    return {
        rawText,
        components,
        isExact: true,
        diagnosticCode: null,
    };
}

function normalizeDecimal(value) {
    const [integer, fraction = ''] = String(value).split('.');
    const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';
    const normalizedFraction = fraction.replace(/0+$/, '');
    return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function normalizeUnit(value) {
    return typeof value === 'string' ? UNIT_MAP[value.trim()] || null : null;
}

module.exports = {
    UNIT_MAP,
    normalizeDecimal,
    normalizeUnit,
    parsePackage,
};
