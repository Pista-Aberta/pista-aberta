/**
 * Compat: a xeración de franxas passou a `ensureSlotsAhead` (REVISION-20 H1).
 * Mantemos este módulo para non romper imports vellos.
 */
export { ensureSlotsAhead as ensureRollingDemoSlots } from "./slots-ahead.js";
export { ensureSlotsAhead } from "./slots-ahead.js";
