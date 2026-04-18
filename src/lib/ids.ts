const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export function id(prefix: string, bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) out += ALPHABET[b & 31];
  return `${prefix}_${out}`;
}

export const ids = {
  workspace: () => id('ws'),
  user: () => id('usr'),
  mailbox: () => id('mb'),
  ticket: () => id('tkt'),
  message: () => id('msg'),
  approval: () => id('apr'),
  audit: () => id('aud'),
  webhook: () => id('hook'),
  macro: () => id('mac'),
  session: () => id('sess'),
  knowledge: () => id('kb'),
};
