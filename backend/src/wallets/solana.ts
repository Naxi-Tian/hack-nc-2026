// Solana wallet primitives with node:crypto only: base58 (Bitcoin alphabet, as Solana uses) and
// ed25519 signature checks for wallet binding (M§12, BACKEND_STACK §7). No key material is ever held.
import { createPublicKey, verify } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((char, i) => [char, BigInt(i)]));

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let out = "";
  while (value > 0n) {
    out = ALPHABET[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function base58Decode(text: string): Uint8Array | null {
  if (text.length === 0 || text.length > 128) return null;
  let value = 0n;
  for (const char of text) {
    const digit = INDEX.get(char);
    if (digit === undefined) return null;
    value = value * 58n + digit;
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of text) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** A Solana address is the base58 form of a 32-byte ed25519 public key. */
export function isSolanaAddress(address: string): boolean {
  return base58Decode(address)?.length === 32;
}

/** Verifies a wallet's ed25519 signature (base58, as wallets return it) over the exact message bytes. */
export function verifyWalletSignature(address: string, message: string, signatureBase58: string): boolean {
  const publicKey = base58Decode(address);
  const signature = base58Decode(signatureBase58);
  if (publicKey?.length !== 32 || signature?.length !== 64) return false;
  try {
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(message, "utf8"), key, signature);
  } catch {
    return false;
  }
}

/** BACKEND_STACK §7 challenge text. The wallet signs exactly these bytes. */
export function challengeMessage(address: string, nonce: string, issuedAt: Date, expiresAt: Date): string {
  return [
    "Prospecto wants you to sign in with your Solana account:",
    address,
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join("\n");
}
