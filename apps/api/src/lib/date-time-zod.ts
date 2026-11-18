import { z } from "zod";

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_START_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HHMM_END_RE = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

export function isValidIsoDate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function isValidHhmm(value: string, allow24End = false): boolean {
  return (allow24End ? HHMM_END_RE : HHMM_START_RE).test(value);
}

export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: "invalid_date" });

export const hhmmStartSchema = z
  .string()
  .refine((v) => isValidHhmm(v, false), { message: "invalid_time" });

export const hhmmEndSchema = z
  .string()
  .refine((v) => isValidHhmm(v, true), { message: "invalid_time" });
