import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type ResolvedRuntimeAddress = { address: string; family: 4 | 6 };

function ipv4IsNonGlobal(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const n = octets[0] * 0x1000000 + octets[1] * 0x10000 + octets[2] * 0x100 + octets[3];
  const inRange = (start: number, end: number) => n >= start && n <= end;
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    inRange(0xa9fe0000, 0xa9feffff) || inRange(0xac100000, 0xac1fffff) ||
    inRange(0xc0000000, 0xc00000ff) || inRange(0xc0000200, 0xc00002ff) ||
    inRange(0xc6336400, 0xc63364ff) || inRange(0xc6120000, 0xc613ffff) || inRange(0xcb007100, 0xcb0071ff) ||
    inRange(0x64400000, 0x647fffff) || inRange(0xc0a80000, 0xc0a8ffff) || octets[0] >= 224;
}

function ipv6IsNonGlobal(value: string): boolean {
  const input = value.toLowerCase().split("%")[0];
  if (!input.includes(":")) return true;
  const halves = input.split("::");
  if (halves.length > 2) return true;
  const parsePart = (part: string) => part ? part.split(":").flatMap((piece) => {
    if (piece.includes(".")) {
      const octets = piece.split(".").map(Number);
      return octets.length === 4 ? [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]] : [];
    }
    return /^[0-9a-f]{1,4}$/.test(piece) ? [parseInt(piece, 16)] : [];
  }) : [];
  const left = parsePart(halves[0]);
  const right = halves.length === 2 ? parsePart(halves[1]) : [];
  const words = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : [...left];
  if (words.length !== 8) return true;
  const first = words[0];
  const isV4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (isV4Mapped) return true;
  return first === 0 || (first & 0xff00) === 0xff00 || (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 || first === 0x3fff || first === 0x5f00 ||
    (first === 0x2001 && (words[1] === 0x0db8 || words[1] === 0x0000 || (words[1] >= 0x0002 && words[1] <= 0x002f)));
}

export function isNonGlobalRuntimeAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return ipv4IsNonGlobal(address);
  if (family === 6) return ipv6IsNonGlobal(address);
  return true;
}

export async function resolveRuntimeHost(hostname: string): Promise<ResolvedRuntimeAddress[]> {
  if (isIP(hostname)) throw new Error("Runtime allowlist must contain DNS hostnames, not IP literals");
  const resolved = await lookup(hostname, { all: true, verbatim: true });
  const addresses = resolved.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
  if (!addresses.length || addresses.some((entry) => isNonGlobalRuntimeAddress(entry.address))) {
    throw new Error("Runtime hostname resolves to a non-global address");
  }
  return addresses;
}