const THETEA_API_ORIGIN = 'https://api.thetea.app';

function sourceHeaders(url, apiKey) {
    const parsed = new URL(url, THETEA_API_ORIGIN);
    if (parsed.username || parsed.password) throw new Error('Source URLs must not contain credentials.');
    return parsed.origin === THETEA_API_ORIGIN && apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {};
}

module.exports = { THETEA_API_ORIGIN, sourceHeaders };
