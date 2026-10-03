const encoder = new TextEncoder();

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? encoder.encode(input) : input;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return fnv1aHex(data);
  }
  const digest = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  const bytes = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] as number).toString(16).padStart(2, '0');
  }
  return out;
}

export function fnv1aHex(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i] as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a-${h.toString(16).padStart(8, '0')}-${data.length.toString(16)}`;
}

export function shortHash(hash: string, len = 8): string {
  return hash.slice(0, len);
}
