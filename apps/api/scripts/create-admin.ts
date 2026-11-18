/**
 * REVISION-23 R2 / REVISION-26 G1 — primeira persoa administradora dun concello.
 * REVISION-29 Y13 — `--deputacion --invite` para xestores da Deputación.
 * REVISION-33 — NIF obrigatorio na Deputación; `--list`; sen superadmin xenérica.
 *
 *   docker compose exec api npm run admin -- --email persoa@concello.gal [--slug exemplo] [--nif 12345678Z]
 *   docker compose exec api npm run admin -- --deputacion --invite --email … --nif …
 *   docker compose exec api npm run admin -- --deputacion --list
 *
 * Remata pechando a base. Require DATABASE_URL en produción.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { toPersonIdentifier } from "../src/lib/nif.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function usage(): void {
  console.error(
    "Uso: npm run admin -- --email persoa@concello.gal [--slug exemplo] [--name \"Admin\"] [--nif 12345678Z] [--invite]",
  );
  console.error(
    "     npm run admin -- --deputacion --invite --email … --nif … [--org-name \"Deputación …\"] [--org-email contacto@…]",
  );
  console.error("     npm run admin -- --deputacion --list");
  console.error(
    "     npm run admin -- --deputacion --org-email contacto@deputacion.gal",
  );
}

function requireDatabaseUrl(): void {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
  const prodLike = nodeEnv === "production" || process.env.FORCE_POSTGRES === "1";
  if (prodLike && !url.startsWith("postgres")) {
    console.error(
      "DATABASE_URL de Postgres é obrigatorio en produción. " +
        "Executa este script co contedor da API: docker compose exec api npm run admin -- …",
    );
    process.exit(1);
  }
}

async function main() {
  const deputacionFlag = process.argv.includes("--deputacion");
  const inviteFlag = process.argv.includes("--invite");
  const listFlag = process.argv.includes("--list");

  /* REVISION-33: --list non require --email. */
  if (deputacionFlag && listFlag) {
    requireDatabaseUrl();
    process.chdir(API_ROOT);
    const { initDb, closeDb } = await import("../src/db/client.js");
    const { migrateSchema } = await import("../src/db/migrate.js");
    await initDb();
    await migrateSchema();
    try {
      const { listDeputacionManagers, getDeputacionOrganization } = await import(
        "../src/store/deputacion-org.js"
      );
      const org = await getDeputacionOrganization();
      if (!org) {
        console.log("Sen entidade Deputación. Crea unha con --deputacion --invite --nif …");
        return;
      }
      const managers = await listDeputacionManagers();
      console.log(`Deputación: ${org.name} (${org.id})`);
      if (managers.length === 0) {
        console.log("Sen xestoras activas.");
        return;
      }
      for (const m of managers) {
        const nif = m.personIdentifier ? ` NIF=${m.personIdentifier}` : " sen NIF";
        const st = m.active ? "activa" : "inactiva";
        console.log(`- ${m.displayName} <${m.email ?? "—"}> (${m.id}) ${st}${nif}`);
      }
      if (managers.filter((m) => m.active).length === 1) {
        console.log(
          "Aviso: hai 1 xestora activa. Recoméndase ter polo menos dúas para non perder o acceso.",
        );
      }
    } finally {
      await closeDb();
    }
    return;
  }

  const emailRaw = arg("--email");
  if (!emailRaw?.trim() || !emailRaw.includes("@")) {
    usage();
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();
  const envSlug =
    process.env.PA_SINGLE_MUNI?.trim() ||
    process.env.VITE_PA_SINGLE_MUNI?.trim() ||
    "";
  const slug = (
    arg("--slug") ||
    envSlug ||
    ""
  )
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  const displayName = arg("--name")?.trim() || `Admin ${slug || "Deputación"}`;
  const nifRaw = arg("--nif")?.trim();
  let personIdentifier: string | null = null;
  if (nifRaw) {
    try {
      personIdentifier = toPersonIdentifier(nifRaw);
    } catch {
      console.error(`NIF/NIE inválido (letra incorrecta): ${nifRaw}`);
      process.exit(1);
    }
  }

  requireDatabaseUrl();
  process.chdir(API_ROOT);

  const { initDb, closeDb, getDb } = await import("../src/db/client.js");
  const { migrateSchema } = await import("../src/db/migrate.js");
  const { getMunicipalityBySlug } = await import("../src/store/db.js");
  const t = await import("../src/db/schema.js");

  await initDb();
  await migrateSchema();

  try {
    if (deputacionFlag) {
      const orgName =
        arg("--org-name")?.trim() ||
        process.env.DEPUTACION_NAME?.trim() ||
        "Deputación";
      const orgEmail =
        arg("--org-email")?.trim() ||
        process.env.DEPUTACION_EMAIL?.trim() ||
        undefined;
      const {
        createDeputacionOrganization,
        updateDeputacionOrganization,
        inviteDeputacionManager,
        listDeputacionManagers,
      } = await import("../src/store/deputacion-org.js");
      await createDeputacionOrganization({ name: orgName, email: orgEmail });
      /* REVISION-39 L6: só actualizar correo (sen --invite). */
      if (orgEmail && !inviteFlag && !listFlag) {
        const updated = await updateDeputacionOrganization({ email: orgEmail });
        console.log(`Deputación correo: ${updated.email ?? "(baleiro)"}`);
        return;
      }
      if (inviteFlag) {
        /* REVISION-33: NIF obrigatorio — sen superadmin xenérica sen identidade. */
        if (!nifRaw || !personIdentifier) {
          console.error(
            "Con --deputacion --invite o NIF é obrigatorio: --nif 12345678Z",
          );
          process.exitCode = 2;
          return;
        }
        const managers = await listDeputacionManagers();
        const active = managers.filter((m) => m.active).length;
        if (active === 0) {
          console.log(
            "Aviso: será a 1ª xestora. Recoméndase convidar unha segunda cando poidas.",
          );
        } else if (active === 1) {
          console.log(
            "Aviso: xa hai 1 xestora activa; este convite engade outra.",
          );
        }
        const inv = await inviteDeputacionManager({
          email,
          nif: nifRaw,
          name: displayName,
          createdBy: "cli-admin",
        });
        console.log(`Convite Deputación: ${inv.url}`);
        console.log(`Token: ${inv.token} · caduca ${inv.expiresAt.toISOString()}`);
        return;
      }
      console.error(
        "Con --deputacion usa --invite (con --nif) ou --list. Non se crea unha superadmin xenérica.",
      );
      process.exitCode = 2;
      return;
    }

    if (!slug) {
      console.error("Falta --slug (ou PA_SINGLE_MUNI).");
      process.exit(1);
    }

    const muni = await getMunicipalityBySlug(slug);
    if (!muni) {
      console.error(
        `Non hai concello /c/${slug}. Executa antes: npm run setup -- --concello … --slug ${slug} --ine …`,
      );
      process.exitCode = 2;
      return;
    }

    const db = getDb();
    if (inviteFlag) {
      const { createInvitation } = await import("../src/store/invitations.js");
      const { token, url, expiresAt } = await createInvitation({
        municipalityId: muni.id,
        role: "admin",
        email,
        nif: nifRaw,
        displayName,
        createdBy: "cli-admin",
      });
      console.log(`Convite admin (${muni.slug}): ${url}`);
      console.log(`Token: ${token} · caduca ${expiresAt.toISOString()}`);
      return;
    }

    const existing = await db
      .select()
      .from(t.users)
      .where(eq(t.users.email, email))
      .limit(1);
    if (personIdentifier) {
      const clash = await db
        .select()
        .from(t.users)
        .where(eq(t.users.personIdentifier, personIdentifier))
        .limit(1);
      if (clash[0] && clash[0].email !== email) {
        console.error(
          `O NIF ${personIdentifier} xa está ligado a outra conta (${clash[0].email ?? clash[0].id}).`,
        );
        process.exitCode = 4;
        return;
      }
    }

    if (existing[0]) {
      const u = existing[0];
      if (u.municipalityId !== muni.id) {
        console.error(`O correo xa existe noutro concello (${u.municipalityId}).`);
        process.exitCode = 3;
        return;
      }
      await db
        .update(t.users)
        .set({
          role: "admin",
          displayName,
          active: true,
          ...(personIdentifier ? { personIdentifier } : {}),
        })
        .where(eq(t.users.id, u.id));
      console.log(
        `Actualizada a admin: ${displayName} <${email}> (${u.id})${personIdentifier ? ` NIF=${personIdentifier}` : ""}`,
      );
      return;
    }

    const id = `admin-${slug}-${randomUUID().slice(0, 6)}`;
    await db.insert(t.users).values({
      id,
      municipalityId: muni.id,
      role: "admin",
      displayName,
      email,
      personIdentifier,
      locale: "gl",
      active: true,
    });
    const { grantUserRole } = await import("../src/store/user-roles.js");
    await grantUserRole({
      userId: id,
      municipalityId: muni.id,
      role: "admin",
    });
    console.log(
      `Admin creada: ${displayName} <${email}> (${id})${personIdentifier ? ` NIF=${personIdentifier}` : ""}`,
    );
    console.log(
      personIdentifier
        ? `Entra en /c/${slug}/acceso con certificado ou Cl@ve (NIF xa vinculado).`
        : `Entra en /c/${slug}/acceso con Cl@ve, certificado ou código por correo. Sen --nif o certificado creará unha conta de veciña nova.`,
    );
  } finally {
    await closeDb();
  }
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { closeDb } = await import("../src/db/client.js");
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
