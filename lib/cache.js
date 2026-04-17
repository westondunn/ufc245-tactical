/**
 * lib/cache.js — Zero-dependency in-memory response cache
 *
 * Data is static at runtime (mutations only via admin/save or restart),
 * so no TTL is needed — cache lives until explicitly invalidated.
 */
const store = new Map();
let globalVersion = Date.now();

function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

module.exports = {
  get:   (key) => store.get(key),
  set:   (key, value) => { store.set(key, value); return value; },
  has:   (key) => store.has(key),
  size:  () => store.size,

  /** Clear all entries and bump global version (forces ETag mismatch) */
  invalidateAll() { store.clear(); globalVersion = Date.now(); },

  /** Weak ETag from a pre-serialized JSON string */
  computeETag(jsonStr) { return `W/"${djb2(jsonStr)}"`; },

  /** Global version ETag (changes on invalidation) */
  globalETag() { return `W/"g-${globalVersion.toString(16)}"`; },
};
