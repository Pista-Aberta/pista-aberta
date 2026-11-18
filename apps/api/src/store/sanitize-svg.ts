/**
 * Sanear SVG de escudo: quita script, event handlers e urls perigosas.
 * Máx. ~500 kB no corpo da petición (validado no route).
 */
export function sanitizeSvg(raw: string): string {
  let s = raw.trim();
  if (!s.toLowerCase().includes("<svg")) {
    throw new Error("not_svg");
  }
  // Strip scripts / foreignObject / handlers / javascript: URLs
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/javascript\s*:/gi, "");
  s = s.replace(/data:text\/html/gi, "");
  // Drop xlink:href to external except #fragments
  s = s.replace(
    /\s(xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi,
    "",
  );
  if (!/^[\s\S]*<\/svg>\s*$/i.test(s) && !/<svg[\s\S]*\/>/i.test(s)) {
    // ensure it still looks like svg
    if (!/<svg/i.test(s)) throw new Error("not_svg");
  }
  return s;
}

/** Accept PNG/JPEG/SVG data URLs or raw SVG; return safe data URL. */
export function normalizeLogoPayload(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("data:image/svg+xml")) {
    const comma = trimmed.indexOf(",");
    if (comma < 0) throw new Error("bad_logo");
    const meta = trimmed.slice(0, comma);
    const payload = trimmed.slice(comma + 1);
    const decoded = meta.includes(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
    const clean = sanitizeSvg(decoded);
    return `data:image/svg+xml;base64,${Buffer.from(clean, "utf8").toString("base64")}`;
  }
  if (
    trimmed.startsWith("data:image/png") ||
    trimmed.startsWith("data:image/jpeg") ||
    trimmed.startsWith("data:image/webp")
  ) {
    if (trimmed.length > 700_000) throw new Error("logo_too_large");
    return trimmed;
  }
  if (trimmed.includes("<svg")) {
    const clean = sanitizeSvg(trimmed);
    return `data:image/svg+xml;base64,${Buffer.from(clean, "utf8").toString("base64")}`;
  }
  throw new Error("bad_logo");
}
