/**
 * UI do IdP mock: selector de persoa (simula Cl@ve de probas).
 * Detalles SAML só con ?tech=1 — ocultos na demo para o xurado.
 * REVISION-27 E2: cores e tipografías actuais (Atkinson + marca azul).
 * Demo multi-concello: TODAS as contas de DEMO_USERS_FILE agrupadas;
 * o grupo do RelayState vai primeiro; Deputación ao final.
 */
import { homePathForRole } from "@pista-aberta/shared";
import {
  findDemoFileUser,
  getLoadedDemoFileUsers,
  hasDemoUsersFile,
  toDemoFileSamlPersona,
} from "./demo-users-file.js";
import { demoUsersForSlug, type SamlDemoUser } from "./saml-users.js";

const ROLE_LABEL: Record<string, { title: string; blurb: string }> = {
  citizen: { title: "Veciñanza", blurb: "Reservar pistas e ver as túas reservas" },
  admin: { title: "Persoal", blurb: "Administración do concello" },
  club_manager: { title: "Club", blurb: "Conta do club · tempada e partidos" },
  staff: { title: "Conserxaría", blurb: "Control de acceso e folla do día" },
  superadmin: { title: "Deputación", blurb: "Vista comparativa de concellos" },
};

const ROLE_ORDER = ["citizen", "admin", "club_manager", "staff", "superadmin"] as const;

/** Nome curto amigable a partir do slug (sen chamar á DB). */
export function muniShortName(slug: string): string {
  const known: Record<string, string> = {
    exemplo: "Exemplo",
    "secundario": "Concello Secundario",
    proba: "Proba",
  };
  if (known[slug]) return known[slug]!;
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function muniHeaderTitle(slug: string): string {
  return `Concello de ${muniShortName(slug)}`;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Destino tras elixir persoa: portal do SEU concello/rol,
 * non o RelayState doutro concello.
 */
export function personaDest(
  u: SamlDemoUser,
  relayState: string,
  fromFile: boolean,
): string {
  if (u.role === "superadmin") {
    return /^\/(deputacion|alta-concello)(\/|$|\?)/.test(relayState)
      ? relayState
      : "/deputacion";
  }
  if (!fromFile || !u.municipalitySlug) {
    return relayState;
  }
  const slugPrefix = `/c/${u.municipalitySlug}`;
  const inSameSlug =
    relayState === slugPrefix ||
    relayState.startsWith(`${slugPrefix}/`) ||
    relayState.startsWith(`${slugPrefix}?`);
  if (inSameSlug && u.role === "citizen") {
    return relayState;
  }
  if (inSameSlug && relayState !== slugPrefix) {
    return relayState;
  }
  return homePathForRole(u.role, u.municipalitySlug, u.clubId);
}

function personaBlurb(
  u: SamlDemoUser,
  defaultBlurb: string,
  fromFile: boolean,
): string {
  if (!fromFile) return defaultBlurb;
  if (u.demoFileRole === "club" && u.clubName) {
    const place = u.municipalitySlug
      ? muniShortName(u.municipalitySlug)
      : "";
    return place
      ? `${u.clubName} · ${place} · ${defaultBlurb}`
      : `${u.clubName} · ${defaultBlurb}`;
  }
  if (u.municipalitySlug) {
    return `${muniShortName(u.municipalitySlug)} · ${defaultBlurb}`;
  }
  return defaultBlurb;
}

function personaRow(
  u: SamlDemoUser,
  relayState: string,
  prefer: string,
  fromFile: boolean,
): string {
  const meta = ROLE_LABEL[u.role] ?? { title: u.role, blurb: "" };
  const selected = prefer === u.key ? " selected" : "";
  const dest = personaDest(u, relayState, fromFile);
  const blurb = personaBlurb(u, meta.blurb, fromFile);
  const place =
    fromFile && u.municipalitySlug
      ? `<span class="persona-muni">${escapeHtml(muniShortName(u.municipalitySlug))}</span>`
      : fromFile && u.role === "superadmin"
        ? `<span class="persona-muni">Deputación</span>`
        : "";
  return `<li class="persona${selected}">
  <form method="post" action="/auth/saml/mock-idp/sso">
    <input type="hidden" name="user" value="${escapeAttr(u.key)}"/>
    <input type="hidden" name="RelayState" value="${escapeAttr(dest)}"/>
    <button type="submit" class="persona-btn">
      <span class="persona-role">${escapeHtml(meta.title)}</span>
      <span class="persona-name">${escapeHtml(u.displayName)}</span>
      ${place}
      <span class="persona-blurb">${escapeHtml(blurb)}</span>
    </button>
  </form>
</li>`;
}

function groupHeader(slug: string | null): string {
  if (!slug) {
    return `<div class="muni-head" role="presentation">
  <span class="muni-mark" aria-hidden="true">D</span>
  <strong class="muni-title">Deputación</strong>
</div>`;
  }
  const title = muniHeaderTitle(slug);
  const initial = escapeHtml(muniShortName(slug).charAt(0) || "?");
  return `<div class="muni-head" role="presentation">
  <img class="muni-logo" src="/api/c/${escapeAttr(slug)}/logo" width="28" height="28" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"/>
  <span class="muni-mark" style="display:none" aria-hidden="true">${initial}</span>
  <strong class="muni-title">${escapeHtml(title)}</strong>
</div>`;
}

/** Ordena grupos: RelayState primeiro, resto alfabético, Deputación ao final. */
export function orderMuniGroups(
  slugs: string[],
  relaySlug: string | null,
): Array<string | null> {
  const unique = [...new Set(slugs.filter(Boolean))];
  const rest = unique
    .filter((s) => s !== relaySlug)
    .sort((a, b) => a.localeCompare(b, "gl"));
  const ordered: Array<string | null> = [];
  if (relaySlug && unique.includes(relaySlug)) ordered.push(relaySlug);
  ordered.push(...rest);
  ordered.push(null);
  return ordered;
}

const SHARED_CSS = `
    @font-face {
      font-family: "Atkinson Hyperlegible";
      src: url("/fonts/AtkinsonHyperlegible-Regular.woff2") format("woff2");
      font-weight: 400; font-style: normal; font-display: swap;
    }
    @font-face {
      font-family: "Atkinson Hyperlegible";
      src: url("/fonts/AtkinsonHyperlegible-Bold.woff2") format("woff2");
      font-weight: 700; font-style: normal; font-display: swap;
    }
    :root {
      --pa-bg: #F4F7FA;
      --pa-surface: #FFFFFF;
      --pa-line: #D8E3EC;
      --pa-ink: #0F1E2C;
      --pa-graphite: #4A5B6B;
      --pa-azul: #007BC4;
      --pa-azul-700: #005A93;
      --pa-marino: #002B4A;
      --pa-radius-btn: 12px;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
      background:
        radial-gradient(ellipse 80% 50% at 10% -10%, rgba(0, 123, 196, 0.12), transparent 55%),
        radial-gradient(ellipse 55% 40% at 100% 0%, rgba(0, 43, 74, 0.06), transparent 50%),
        var(--pa-bg);
      color: var(--pa-ink);
      padding: 2.25rem 1.15rem 3rem;
    }
    .wrap { max-width: 26rem; margin: 0 auto; }
    .brand {
      margin: 0 0 0.75rem;
      font-weight: 700;
      font-size: clamp(1.65rem, 4vw, 2rem);
      letter-spacing: -0.02em;
      line-height: 1.15;
      color: var(--pa-marino);
    }
    .demo-banner {
      margin: 0 0 1.35rem;
      padding: 0.75rem 0.9rem;
      border: 1.5px solid var(--pa-line);
      border-radius: var(--pa-radius-btn);
      background: var(--pa-surface);
      font-size: 0.86rem;
      line-height: 1.4;
      color: var(--pa-graphite);
    }
    .demo-banner strong { color: var(--pa-marino); }
    h1 {
      margin: 0 0 0.4rem;
      font-size: 1.2rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.3;
    }
    .lead {
      margin: 0 0 1.35rem;
      color: var(--pa-graphite);
      font-size: 1rem;
      line-height: 1.4;
    }
    .muni-group { margin: 0 0 1.25rem; }
    .muni-head {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      margin: 0 0 0.55rem;
    }
    .muni-logo {
      width: 28px;
      height: 28px;
      object-fit: contain;
      flex-shrink: 0;
      border-radius: 4px;
      background: #fff;
      border: 1px solid var(--pa-line);
    }
    .muni-mark {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      border-radius: 4px;
      background: var(--pa-azul);
      color: #fff;
      font-weight: 700;
      font-size: 0.85rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .muni-title {
      font-size: 0.95rem;
      color: var(--pa-marino);
      letter-spacing: -0.01em;
    }
    .personas {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.55rem;
    }
    .persona form { margin: 0; }
    .persona-btn {
      width: 100%;
      text-align: left;
      cursor: pointer;
      font: inherit;
      color: inherit;
      background: var(--pa-surface);
      border: 1.5px solid var(--pa-line);
      border-radius: var(--pa-radius-btn);
      padding: 0.85rem 1rem;
      display: grid;
      gap: 0.12rem;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .persona-btn:hover {
      border-color: var(--pa-azul);
      background: #E6F2FA;
    }
    .persona-btn:focus-visible {
      outline: 2px solid var(--pa-azul);
      outline-offset: 2px;
    }
    .persona.selected .persona-btn {
      border-color: var(--pa-azul);
      box-shadow: inset 3px 0 0 var(--pa-azul);
    }
    .persona-role {
      font-weight: 700;
      font-size: 1.02rem;
      color: var(--pa-azul-700);
    }
    .persona-name { font-weight: 700; font-size: 0.98rem; }
    .persona-muni {
      font-size: 0.82rem;
      font-weight: 700;
      color: var(--pa-marino);
    }
    .persona-blurb {
      font-size: 0.86rem;
      color: var(--pa-graphite);
      line-height: 1.35;
    }
    .note {
      margin: 1.35rem 0 0;
      font-size: 0.82rem;
      color: var(--pa-graphite);
      line-height: 1.4;
    }
    .tech {
      margin-top: 1.25rem;
      border-top: 1px solid var(--pa-line);
      padding-top: 0.75rem;
      font-size: 0.8rem;
      color: var(--pa-graphite);
    }
    .tech summary {
      cursor: pointer;
      font-weight: 700;
      color: var(--pa-graphite);
      list-style: none;
    }
    .tech summary::-webkit-details-marker { display: none; }
    .tech summary::before { content: "▸ "; }
    .tech[open] summary::before { content: "▾ "; }
    .tech dl { margin: 0.65rem 0 0; display: grid; gap: 0.45rem; }
    .tech dt { font-weight: 700; margin: 0; }
    .tech dd { margin: 0.15rem 0 0; }
    .tech code {
      font-size: 0.72rem;
      word-break: break-all;
      background: #E6F2FA;
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
    }
    @media (prefers-reduced-motion: reduce) {
      .persona-btn { transition: none; }
    }
`;

function sortByRole(users: SamlDemoUser[]): SamlDemoUser[] {
  return [...users].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.role as (typeof ROLE_ORDER)[number]) -
      ROLE_ORDER.indexOf(b.role as (typeof ROLE_ORDER)[number]),
  );
}

export function renderMockIdpSelectHtml(opts: {
  relayState: string;
  samlRequest: string;
  prefer?: string;
  showTech?: boolean;
}): string {
  const relaySlug = opts.relayState.match(/^\/c\/([^/]+)/)?.[1] ?? null;
  const fromFile = hasDemoUsersFile();

  let users: SamlDemoUser[];
  if (fromFile) {
    /* TODAS as contas do ficheiro, agrupadas máis abaixo. */
    users = (getLoadedDemoFileUsers() ?? []).map(toDemoFileSamlPersona);
  } else {
    users = demoUsersForSlug(relaySlug);
    const entidadeOnly = /\/(admin|clubs|conserxeria)(\/|$|\?)/.test(
      opts.relayState,
    );
    const deputacionDest = /^\/deputacion(\/|$)/.test(opts.relayState);
    if (entidadeOnly) {
      users = users.filter((u) =>
        ["admin", "club_manager", "staff", "monitor", "superadmin"].includes(
          u.role,
        ),
      );
    } else if (!deputacionDest) {
      users = users.filter((u) => u.role !== "superadmin");
    }
  }

  const preferRaw = opts.prefer ?? users[0]?.key ?? "cidada";
  const preferFromFile = fromFile
    ? findDemoFileUser(preferRaw, opts.relayState)?.key
    : null;
  const prefer = preferFromFile ?? preferRaw;

  let bodyHtml: string;
  if (fromFile) {
    const bySlug = new Map<string | null, SamlDemoUser[]>();
    for (const u of users) {
      const key = u.role === "superadmin" ? null : (u.municipalitySlug ?? null);
      const list = bySlug.get(key) ?? [];
      list.push(u);
      bySlug.set(key, list);
    }
    const muniSlugs = [...bySlug.keys()].filter((k): k is string => k != null);
    const order = orderMuniGroups(muniSlugs, relaySlug).filter(
      (k) => bySlug.has(k),
    );
    bodyHtml = order
      .map((slugKey) => {
        const groupUsers = sortByRole(bySlug.get(slugKey) ?? []);
        const rows = groupUsers
          .map((u) => personaRow(u, opts.relayState, prefer, true))
          .join("\n");
        return `<section class="muni-group" data-muni="${escapeAttr(slugKey ?? "deputacion")}">
  ${groupHeader(slugKey)}
  <ul class="personas">${rows}</ul>
</section>`;
      })
      .join("\n");
  } else {
    const rows = sortByRole(users)
      .map((u) => personaRow(u, opts.relayState, prefer, false))
      .join("\n");
    bodyHtml = `<ul class="personas">${rows}</ul>`;
  }

  const techBlock =
    opts.showTech === true
      ? `<details class="tech">
  <summary>Detalles técnicos</summary>
  <dl>
    <dt>RelayState</dt><dd><code>${escapeHtml(opts.relayState)}</code></dd>
    <dt>SAMLRequest</dt><dd>${
      opts.samlRequest.length
        ? `<code>recibido (${opts.samlRequest.length} chars)</code>`
        : `<code>non presente</code>`
    }</dd>
    <dt>Fluxo</dt><dd>AuthnResponse SAML 2.0 asinada → ACS</dd>
  </dl>
</details>`
      : "";

  return `<!doctype html>
<html lang="gl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pista Aberta — identificación</title>
  <style>${SHARED_CSS}</style>
</head>
<body>
  <div class="wrap">
    <p class="brand">Pista Aberta</p>
    <p class="demo-banner"><strong>Cl@ve de proba (só demo).</strong> Nun concello real aquí abriríase a páxina oficial de Cl@ve.</p>
    <h1>Elixe quen es</h1>
    <p class="lead">Continúa coa identidade de demo. Podes elixir persoa doutro concello.</p>
    ${bodyHtml}
    <p class="note">Simula Cl@ve. Non é a pasarela real.</p>
    ${techBlock}
  </div>
</body>
</html>`;
}
