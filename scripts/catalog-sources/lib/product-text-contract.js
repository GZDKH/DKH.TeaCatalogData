'use strict';

const MAXIMUM_PRODUCT_DESCRIPTION_LENGTH = 2000;

function truncateProductText(value, maximumLength) {
    if (value.length <= maximumLength) return value;
    if (maximumLength < 1) return '';
    if (maximumLength === 1) return '…';
    let prefix = value.slice(0, maximumLength - 1);
    if (/[\uD800-\uDBFF]$/u.test(prefix)) {
        prefix = prefix.slice(0, -1);
    }
    return `${prefix.trimEnd()}…`;
}

function composeProductDescription(sourceDescription, factualDescription) {
    const fittedFactualDescription = truncateProductText(
        factualDescription,
        MAXIMUM_PRODUCT_DESCRIPTION_LENGTH,
    );
    if (!sourceDescription ||
        fittedFactualDescription.length >= MAXIMUM_PRODUCT_DESCRIPTION_LENGTH) {
        return fittedFactualDescription;
    }
    const separator = ' ';
    const combined =
        `${sourceDescription}${separator}${fittedFactualDescription}`;
    if (combined.length <= MAXIMUM_PRODUCT_DESCRIPTION_LENGTH) return combined;
    const availableSourceLength =
        MAXIMUM_PRODUCT_DESCRIPTION_LENGTH -
        separator.length -
        fittedFactualDescription.length;
    const fittedSourceDescription = truncateProductText(
        sourceDescription,
        availableSourceLength,
    );
    return fittedSourceDescription
        ? `${fittedSourceDescription}${separator}${fittedFactualDescription}`
        : fittedFactualDescription;
}

module.exports = {
    MAXIMUM_PRODUCT_DESCRIPTION_LENGTH,
    composeProductDescription,
    truncateProductText,
};
