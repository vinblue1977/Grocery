/** A fresh id for a new item or store: 32 lowercase hex characters, which the server accepts as a client-chosen id. */
export function newId(): string {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
    // Older iOS Safari has getRandomValues but no randomUUID; still cryptographically random.
    if (typeof crypto.getRandomValues === 'function') {
      return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  let id = ''; // no crypto at all: last resort
  while (id.length < 32) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}
