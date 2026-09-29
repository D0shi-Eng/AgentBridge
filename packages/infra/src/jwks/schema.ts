/** مفاتيح RSA علنية فقط؛ لا أسرار خاصة ولا حقول أو أعداد بلا سقف قبل crypto.
 *  AB-B05 (IdP حقيقي): Keycloak وما يشبهه يرسل مفاتيح enc إلى جانب sig —
 *  الحاوية تقبل عائلة RSA كاملة ببنية سليمة، والانتقاء لsig/RS256 موقع
 *  في oidc-verifier (selectKey) لا هنا، فلا يرفض IdP حقيقي ظلماً. */
import { z } from "zod";

const Base64Url = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/u);
const RsaAlg = z.enum(["RS256", "PS256", "RSA-OAEP", "RSA-OAEP-256"]);
const PublicKey = z.object({
  kty: z.literal("RSA"), kid: z.string().min(1).max(128).optional(),
  n: Base64Url.min(342).max(1366), e: Base64Url.max(16),
  alg: RsaAlg.optional(), use: z.enum(["sig", "enc"]).optional(),
  key_ops: z.array(z.enum(["verify", "encrypt", "wrapKey"])).max(2).optional(),
  x5c: z.array(z.string().max(8192)).max(4).optional(),
  x5t: z.string().max(128).optional(), "x5t#S256": z.string().max(128).optional(),
}).strict();

export const JwksSchema = z.object({ keys: z.array(PublicKey).min(1).max(32) }).strict()
  .refine(({ keys }) => {
    const kids = keys.flatMap((key) => key.kid === undefined ? [] : [key.kid]);
    return new Set(kids).size === kids.length;
  });
export type JwksResponse = z.infer<typeof JwksSchema>;
export type JwkPublicKey = JwksResponse["keys"][number];
