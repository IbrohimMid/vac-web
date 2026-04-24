// Crockford base32 ULID (tiny inline impl — avoids dep).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(): string {
  const time = Date.now();
  const timeBytes = new Uint8Array(6);
  let t = time;
  for (let i = 5; i >= 0; i--) {
    timeBytes[i] = t & 0xff;
    t = Math.floor(t / 256);
  }
  const randBytes = new Uint8Array(10);
  crypto.getRandomValues(randBytes);
  return encode(timeBytes) + encode(randBytes);
}

function encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 0x1f];
  return out;
}
