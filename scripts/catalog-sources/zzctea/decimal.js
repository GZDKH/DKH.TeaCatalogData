'use strict';

const { normalizeDecimal } = require('./package-parser');

function decimalParts(value) {
    const normalized = normalizeDecimal(value);
    if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
        throw new Error('Decimal value must be unsigned plain notation.');
    }
    const [integer, fraction = ''] = normalized.split('.');
    return {
        integer: BigInt(`${integer}${fraction}`),
        scale: fraction.length,
        normalized,
    };
}

function formatScaled(integer, scale) {
    let digits = integer.toString();
    if (scale === 0) return digits;
    digits = digits.padStart(scale + 1, '0');
    const whole = digits.slice(0, -scale);
    const fraction = digits.slice(-scale).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}

function multiplyDecimal(left, right) {
    const a = decimalParts(left);
    const b = decimalParts(right);
    return formatScaled(a.integer * b.integer, a.scale + b.scale);
}

function greatestCommonDivisor(left, right) {
    while (right !== 0n) {
        [left, right] = [right, left % right];
    }
    return left;
}

function divideDecimal(amount, divisor, scale = 8) {
    const numeratorValue = decimalParts(amount);
    const divisorValue = decimalParts(divisor);
    if (divisorValue.integer === 0n) throw new Error('Divisor must be positive.');

    let numerator = numeratorValue.integer * (10n ** BigInt(divisorValue.scale));
    let denominator = divisorValue.integer * (10n ** BigInt(numeratorValue.scale));
    const gcd = greatestCommonDivisor(numerator, denominator);
    numerator /= gcd;
    denominator /= gcd;

    const scaledNumerator = numerator * (10n ** BigInt(scale));
    let quotient = scaledNumerator / denominator;
    const remainder = scaledNumerator % denominator;
    if (remainder * 2n >= denominator) quotient += 1n;

    return {
        amount: formatScaled(quotient, scale),
        exactFraction: {
            numerator: numerator.toString(),
            denominator: denominator.toString(),
        },
        roundingPolicy: {
            mode: 'half-up',
            scale,
        },
    };
}

module.exports = {
    decimalParts,
    divideDecimal,
    formatScaled,
    multiplyDecimal,
};
