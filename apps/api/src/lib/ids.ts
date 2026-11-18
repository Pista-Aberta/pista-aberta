import { randomUUID } from "node:crypto";

/** Identificador único con prefixo (evita colisións de Date.now no mesmo ms). */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
