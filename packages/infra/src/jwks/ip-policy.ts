/** تصنيف محافظ لعناوين الاتصال بحسب IANA؛ لا DNS ولا اتصال داخل هذه الدالة. */
import { isIP } from "node:net";

const V4_DENY = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const;

function ipv4Number(address: string): bigint {
  return address.split(".").reduce((value, part) => (value << 8n) | BigInt(part), 0n);
}

/** isIP يسبق التحليل؛ المضمن IPv4 وzone ID مرفوضان قبل أي اتصال. */
function ipv6Number(address: string): bigint {
  const [left = "", right = ""] = address.split("::");
  const head = left === "" ? [] : left.split(":");
  const tail = right === "" ? [] : right.split(":");
  const parts = address.includes("::") ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

function inPrefix(value: bigint, base: bigint, prefix: number, bits: number): boolean {
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (base >> shift);
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return !V4_DENY.some(([base, prefix]) => inPrefix(value, ipv4Number(base), prefix, 32));
  }
  if (family !== 6 || address.includes("%") || address.includes(".")) return false;
  const value = ipv6Number(address);
  if (!inPrefix(value, ipv6Number("2000::"), 3, 128)) return false;
  // استبعاد التجارب والتوثيق والأنفاق؛ لا نسمح باستثناءات IANA الفردية في هذه السياسة.
  return !([ ["2001::", 23], ["2001:db8::", 32], ["2002::", 16],
    ["3fff::", 20] ] as const).some(([base, prefix]) => inPrefix(value, ipv6Number(base), prefix, 128));
}
