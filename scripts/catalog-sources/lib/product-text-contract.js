'use strict';

const MAXIMUM_PRODUCT_DESCRIPTION_LENGTH = 2000;

function composeProductDescription(sourceDescription, factualDescription) {
    if (!sourceDescription) return factualDescription;
    const separator = ' ';
    const combined = `${sourceDescription}${separator}${factualDescription}`;
    if (combined.length <= MAXIMUM_PRODUCT_DESCRIPTION_LENGTH) return combined;
    const availableSourceLength =
        MAXIMUM_PRODUCT_DESCRIPTION_LENGTH -
        separator.length -
        factualDescription.length -
        1;
    if (availableSourceLength < 1) {
        throw new Error(
            'Factual product description exceeds the ProductCatalog limit.',
        );
    }
    return `${sourceDescription.slice(0, availableSourceLength).trimEnd()}…` +
        `${separator}${factualDescription}`;
}

module.exports = {
    MAXIMUM_PRODUCT_DESCRIPTION_LENGTH,
    composeProductDescription,
};
