const PARAM = 'join=';

/** Invite links look like https://host/Grocery/#join=CODE; the code stays out of server logs because it is in the hash. */
export function parseJoinCode(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw.startsWith(PARAM)) return null;
  const code = decodeURIComponent(raw.slice(PARAM.length));
  return /^[\w-]{8,100}$/.test(code) ? code : null;
}

export function buildInviteLink(pageUrl: string, code: string): string {
  const base = pageUrl.split('#')[0] ?? pageUrl;
  return `${base}#${PARAM}${encodeURIComponent(code)}`;
}
