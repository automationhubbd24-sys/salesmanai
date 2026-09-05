const PLACEHOLDER_NAMES = new Set([
    'unknown',
    'unknown user',
    'customer',
    'whatsapp user',
    'messenger user',
    'null',
    'undefined'
]);

function normalizeContactName(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isValidContactName(value) {
    const name = normalizeContactName(value);
    return Boolean(name) && !PLACEHOLDER_NAMES.has(name.toLowerCase()) && !/^\d+$/.test(name);
}

module.exports = { normalizeContactName, isValidContactName };
