/**
 * OpenAPI 3.1 document (Rev4 certame).
 * Documenta as rutas principais; os body schemas refleten os zod da API.
 */
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Pista Aberta API",
    version: "0.1.0",
    description:
      "API da plataforma libre de reserva de instalacións deportivas municipais (EUPL-1.2).",
    license: { name: "EUPL-1.2", identifier: "EUPL-1.2" },
  },
  servers: [{ url: "/", description: "Mesma orixe (demo / autoaloxamento)" }],
  tags: [
    { name: "public" },
    { name: "auth" },
    { name: "citizen" },
    { name: "admin" },
    { name: "staff" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["public"],
        summary: "Healthcheck",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    service: { type: "string" },
                    db: { type: "string" },
                    ts: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/municipalities": {
      get: {
        tags: ["public"],
        summary: "Lista de concellos",
        responses: { "200": { description: "Lista" } },
      },
    },
    "/api/c/{slug}/facilities": {
      get: {
        tags: ["public"],
        summary: "Instalacións do concello",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Instalacións" } },
      },
    },
    "/api/c/{slug}/meteo": {
      get: {
        tags: ["public"],
        summary: "Previsión MeteoGalicia do concello (INE)",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "lang", in: "query", schema: { type: "string", enum: ["gl", "es"] } },
        ],
        responses: { "200": { description: "Previsión ou null" } },
      },
    },
    "/api/c/{slug}/facilities/{id}/meteo": {
      get: {
        tags: ["public"],
        summary: "Previsión MeteoGalicia dunha instalación outdoor",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Aviso de choiva se procede" } },
      },
    },
    "/api/c/{slug}/widget-data": {
      get: {
        tags: ["public"],
        summary: "Horas libres hoxe/mañá para o widget iframe",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "facilityId", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Datos do widget" } },
      },
    },
    "/api/c/{slug}/availability": {
      get: {
        tags: ["public"],
        summary: "Dispoñibilidade / franxas",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "facilityId", in: "query", schema: { type: "string" } },
          { name: "date", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Franxas" } },
      },
    },
    "/api/c/{slug}/reservas": {
      post: {
        tags: ["citizen"],
        summary: "Crear reserva",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["slotId"],
                properties: {
                  slotId: { type: "string" },
                  forMemberId: { type: "string" },
                  acceptedRulesVersion: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Reserva creada" },
          "400": { description: "Erro de negocio" },
          "401": { description: "Sen sesión" },
        },
      },
    },
    "/api/c/{slug}/reservas/{id}/estou-aqui": {
      post: {
        tags: ["citizen"],
        summary: "Self check-in (±15 min)",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Check-in OK" },
          "400": { description: "too_early | too_late | invalid_status" },
        },
      },
    },
    "/api/c/{slug}/lista-espera": {
      post: {
        tags: ["citizen"],
        summary: "Engadir á lista de espera",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["slotId"],
                properties: { slotId: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": { description: "En cola" } },
      },
    },
    "/api/c/{slug}/incidencias": {
      post: {
        tags: ["citizen"],
        summary: "Comunicar incidencia",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["body"],
                properties: {
                  facilityId: { type: "string" },
                  body: { type: "string", minLength: 5 },
                  photoDataUrl: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Creada" } },
      },
    },
    "/api/c/{slug}/admin/dashboard": {
      get: {
        tags: ["admin"],
        summary: "Indicadores do panel",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Stats" }, "401": { description: "Auth" } },
      },
    },
    "/api/c/{slug}/admin/reservas-dia": {
      get: {
        tags: ["admin", "staff"],
        summary: "Reservas do día",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "date", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Lista" } },
      },
    },
    "/api/c/{slug}/admin/persoas": {
      get: {
        tags: ["admin"],
        summary: "Busca de persoas",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } },
        ],
        responses: { "200": { description: "Resultados" } },
      },
    },
    "/api/c/{slug}/admin/informe-mensual": {
      get: {
        tags: ["admin"],
        summary: "Informe mensual (JSON ou CSV)",
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "ano", in: "query", schema: { type: "integer" } },
          { name: "mes", in: "query", schema: { type: "integer" } },
          {
            name: "formato",
            in: "query",
            schema: { type: "string", enum: ["json", "csv"] },
          },
        ],
        responses: { "200": { description: "Informe" } },
      },
    },
    "/api/demo/reset": {
      post: {
        tags: ["admin"],
        summary: "Restaurar datos de demo (só PA_DEMO)",
        responses: {
          "200": { description: "Reseed OK" },
          "403": { description: "demo_only ou rol" },
        },
      },
    },
    "/api/openapi.json": {
      get: {
        tags: ["public"],
        summary: "Este documento OpenAPI 3.1",
        responses: { "200": { description: "OpenAPI JSON" } },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "pa_sesion",
      },
    },
  },
} as const;
