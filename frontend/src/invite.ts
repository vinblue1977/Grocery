const PARAM = 'join=';

/** Invite links look like https://host/Grocery/#join=CODE; the code stays out of server logs because it is in the hash. */
export function parseJoinCode(hash: string): string | null {
  const raw = hash.replace(/^#/, '');
  if (!raw.startsWith(PARAM)) return null;
  let code: string;
  try {
    code = decodeURIComponent(raw.slice(PARAM.length));
  } catch {
    return null; // a mangled link falls back to the normal welcome screen
  }
  return /^[\w-]{8,100}$/.test(code) ? code : null;
}

export function buildInviteLink(pageUrl: string, code: string): string {
  const base = pageUrl.split('#')[0] ?? pageUrl;
  return `${base}#${PARAM}${encodeURIComponent(code)}`;
}

/** Accepts what a person pastes: the whole invite link, or just the code. */
export function parseInviteInput(input: string): string | null {
  const text = input.trim();
  const hashAt = text.indexOf('#');
  if (hashAt >= 0) return parseJoinCode(text.slice(hashAt));
  return /^[\w-]{8,100}$/.test(text) ? text : null;
}
