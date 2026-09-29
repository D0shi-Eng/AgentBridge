/** مصفوفة IPv4/IPv6 والتطبيع: الرفض قبل النقل، بلا فحص أي شبكة حقيقية. */
import { describe, expect, it } from "vitest";
import { isPublicAddress } from "./ip-policy.js";
import { allowedJwksUrl, JwksHostsSchema } from "./policy.js";

export const BLOCKED_ADDRESSES = [
  "0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1",
  "169.254.169.254", "169.254.170.2", "172.16.0.1", "172.31.255.255", "192.0.0.1",
  "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.255",
  "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.1.2.3", "240.0.0.1", "255.255.255.255",
  "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8", "fc00::1",
  "fd00:ec2::254", "fe80::1", "fe80::1%eth0", "ff02::1", "64:ff9b::7f00:1",
  "2001::1", "2001:2::1", "2001:db8::1", "2002:7f00:1::", "3fff::1", "bad-ip",
];

describe("سياسة العنوان", () => {
  it.each(BLOCKED_ADDRESSES)("يرفض %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"])(
    "يسمح بالعام %s", (ip) => expect(isPublicAddress(ip)).toBe(true),
  );
  it.each(["http://idp.example/jwks", "https://user:pass@idp.example/jwks", "https://idp.example:8443/",
    "https://idp.example/#fragment", "https://other.example/", "https://127.1/", "https://2130706433/",
    "https://0x7f000001/", "https://0177.0.0.1/", "https://[::ffff:127.0.0.1]/"])(
    "يرفض عنوان URL %s", (url) => expect(() => allowedJwksUrl(url, ["idp.example", "127.0.0.1"])).toThrow(),
  );
  it("القائمة فارغة fail-closed والتطبيع يحفظ المضيف فقط", () => {
    expect(JwksHostsSchema.parse(undefined)).toEqual([]);
    expect(() => allowedJwksUrl("https://idp.example/", [])).toThrow();
    expect(JwksHostsSchema.parse(" IDP.EXAMPLE ")).toEqual(["idp.example"]);
    expect(allowedJwksUrl("https://IDP.example:443/keys", ["idp.example"]).port).toBe("");
  });
  it.each(["*", "*.example.com", "https://idp.example", "idp.example,", "localhost", "127.0.0.1"])(
    "يرفض إعدادًا غير آمن %s", (value) => expect(JwksHostsSchema.safeParse(value).success).toBe(false),
  );
});
