const crypto = require('crypto');

const DEFAULT_MIN_SECRET_LENGTH = 12;
const PRODUCTION_MIN_SECRET_LENGTH = 24;

function asSingleHeader(value) {
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function timingSafeEqualSecret(actual, expected, { minLength = DEFAULT_MIN_SECRET_LENGTH } = {}) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  if (expected.length < minLength || actual.length < minLength) return false;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function secretStrengthError(name, value, { minLength = PRODUCTION_MIN_SECRET_LENGTH } = {}) {
  if (!value) return `${name} is required`;
  if (String(value).length < minLength) return `${name} must be at least ${minLength} characters`;
  return null;
}

module.exports = {
  DEFAULT_MIN_SECRET_LENGTH,
  PRODUCTION_MIN_SECRET_LENGTH,
  asSingleHeader,
  timingSafeEqualSecret,
  secretStrengthError,
};
