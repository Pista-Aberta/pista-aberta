import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** PRNG determinista sfc32 (SPEC §6). */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function () {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Segredo aleatorio por actividade (publicado só o hash ata o sorteo). */
export function generateLotterySecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Seeds 4 uint32 desde un string (segredo revelado). */
export function seedsFromSecret(secret: string): [number, number, number, number] {
  const h = createHash("sha256").update(secret, "utf8").digest();
  return [
    h.readUInt32BE(0),
    h.readUInt32BE(4),
    h.readUInt32BE(8),
    h.readUInt32BE(12),
  ];
}

export type LotteryDrawItem = {
  /** Nº de solicitude público (orde do sorteo; nunca o id interno). */
  applicationNumber: string;
  priorityGroup: "renovacion" | "sorteo";
};

/**
 * Ordea nºs de solicitude: primeiro renovación (shuffle), despois sorteo (shuffle).
 * Resultado determinista co mesmo segredo.
 */
export function drawOrder(secret: string, items: LotteryDrawItem[]): string[] {
  const rng = sfc32(...seedsFromSecret(secret));
  const reno = items
    .filter((i) => i.priorityGroup === "renovacion")
    .map((i) => i.applicationNumber)
    .sort((a, b) => a.localeCompare(b));
  const sort = items
    .filter((i) => i.priorityGroup === "sorteo")
    .map((i) => i.applicationNumber)
    .sort((a, b) => a.localeCompare(b));
  return [...shuffle(reno, rng), ...shuffle(sort, rng)];
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Comparación constant-time de hashes hex (ou strings da mesma lonxitude). */
export function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Recalcula no cliente ou API para «Verificar». */
export function verifyDraw(
  secret: string,
  seedHash: string,
  items: LotteryDrawItem[],
  expectedOrder: string[],
): { ok: boolean; order: string[]; hashMatches: boolean } {
  const hashMatches = safeEqualString(hashSecret(secret), seedHash);
  const order = drawOrder(secret, items);
  const ok =
    hashMatches &&
    order.length === expectedOrder.length &&
    order.every((n, i) => n === expectedOrder[i]);
  return { ok, order, hashMatches };
}
