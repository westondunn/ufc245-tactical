/**
 * lib/validate.js — Input validators for user profiles and picks.
 *
 * Each validator either returns a normalized value or throws ValidationError.
 * Server routes catch ValidationError and map to { error: code } responses.
 */

class ValidationError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
    this.status = 400;
  }
}

const METHOD_PICKS = ['KO/TKO', 'SUB', 'DEC'];
const AVATAR_KEYS = Array.from({ length: 12 }, (_, i) => 'a' + (i + 1));

function validateDisplayName(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (s.length < 1) throw new ValidationError('display_name_empty', 'Display name is required');
  if (s.length > 40) throw new ValidationError('display_name_too_long', 'Display name max 40 characters');
  // Reject control chars (incl newline, tab). Printable characters only.
  if (/[\x00-\x1F\x7F]/.test(s)) throw new ValidationError('display_name_invalid_chars', 'Invalid characters');
  return s;
}

function validateAvatarKey(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (!AVATAR_KEYS.includes(s)) throw new ValidationError('avatar_key_invalid', 'Unknown avatar key');
  return s;
}

function validateConfidence(raw) {
  if (raw == null || raw === '') return 50;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) throw new ValidationError('confidence_invalid', 'Confidence must be a number');
  if (n < 0 || n > 100) throw new ValidationError('confidence_range', 'Confidence must be 0-100');
  return n;
}

function validateMethodPick(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).toUpperCase();
  // Allow 'KO' to map to 'KO/TKO' for UX flexibility
  if (s === 'KO' || s === 'TKO') return 'KO/TKO';
  if (!METHOD_PICKS.includes(s)) throw new ValidationError('method_pick_invalid', 'method_pick must be KO/TKO, SUB, or DEC');
  return s;
}

function validateRoundPick(raw) {
  if (raw == null || raw === '') return null;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n)) throw new ValidationError('round_pick_invalid', 'round_pick must be a number');
  if (n < 1 || n > 5) throw new ValidationError('round_pick_range', 'round_pick must be 1-5');
  return n;
}

function validateNotes(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw);
  if (s.length > 280) throw new ValidationError('notes_too_long', 'Notes max 280 characters');
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s)) throw new ValidationError('notes_invalid_chars', 'Invalid characters in notes');
  return s;
}

function validatePickInput(raw) {
  const body = raw || {};
  const eventId = Math.trunc(Number(body.event_id));
  const fightId = Math.trunc(Number(body.fight_id));
  const pickedFighterId = Math.trunc(Number(body.picked_fighter_id));
  if (!Number.isFinite(eventId) || eventId <= 0) throw new ValidationError('event_id_invalid');
  if (!Number.isFinite(fightId) || fightId <= 0) throw new ValidationError('fight_id_invalid');
  if (!Number.isFinite(pickedFighterId) || pickedFighterId <= 0) throw new ValidationError('picked_fighter_id_invalid');
  return {
    event_id: eventId,
    fight_id: fightId,
    picked_fighter_id: pickedFighterId,
    confidence: validateConfidence(body.confidence),
    method_pick: validateMethodPick(body.method_pick),
    round_pick: validateRoundPick(body.round_pick),
    notes: validateNotes(body.notes)
  };
}

function validateUserInput(raw) {
  const body = raw || {};
  return {
    display_name: validateDisplayName(body.display_name),
    avatar_key: validateAvatarKey(body.avatar_key)
  };
}

module.exports = {
  ValidationError,
  METHOD_PICKS,
  AVATAR_KEYS,
  validateDisplayName,
  validateAvatarKey,
  validateConfidence,
  validateMethodPick,
  validateRoundPick,
  validateNotes,
  validatePickInput,
  validateUserInput
};
