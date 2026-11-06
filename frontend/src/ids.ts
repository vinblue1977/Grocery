/** A fresh id for a new item or store: 32 lowercase hex characters, which the server accepts as a client-chosen id. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, '');
  // Older iOS Safari has no crypto.randomUUID.
  let id = '';
  while (id.length < 32) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}
