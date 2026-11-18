import type { AuthUser, Municipality } from "@pista-aberta/shared";

const API = import.meta.env.VITE_API_URL ?? "";

export type ApiError = Error & {
  facilityName?: string;
  start?: string;
  date?: string;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const json = (await res.json()) as T & {
    error?: string;
    facilityName?: string;
    start?: string;
    date?: string;
  };
  if (!res.ok) {
    const err = new Error(json.error ?? `HTTP ${res.status}`) as ApiError;
    if (typeof json.facilityName === "string") err.facilityName = json.facilityName;
    if (typeof json.start === "string") err.start = json.start;
    if (typeof json.date === "string") err.date = json.date;
    throw err;
  }
  return json;
}

export const api = {
  me: () =>
    req<{ user: AuthUser | null; sessionExpiresAt?: string | null }>("/auth/me").catch(
      () => ({ user: null, sessionExpiresAt: null }),
    ),
  renewSession: () =>
    req<{ user: AuthUser; sessionExpiresAt: string }>("/auth/renovar", {
      method: "POST",
      body: "{}",
    }),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  /** REVISION-22 B3 — conmutador club / conta persoal. */
  setActiveClub: (clubId: string | null) =>
    req<{ user: AuthUser }>("/api/me/club-activo", {
      method: "POST",
      body: JSON.stringify({ clubId }),
    }),
  setActiveMuniRole: (role: AuthUser["role"] | null) =>
    req<{ user: AuthUser }>("/api/me/rol-activo", {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
  conviteInfo: (token: string) =>
    req<{ data: {
      token: string;
      municipalityName: string;
      municipalitySlug: string;
      role: AuthUser["role"];
      expiresAt: string;
      used: boolean;
      expired: boolean;
    } }>(`/api/convite/${encodeURIComponent(token)}`),
  conviteAccept: (token: string) =>
    req<{ user: AuthUser }>(`/api/convite/${encodeURIComponent(token)}/aceptar`, {
      method: "POST",
      body: "{}",
    }),
  conviteDemoAccept: (token: string) =>
    req<{ user: AuthUser }>(`/api/convite/${encodeURIComponent(token)}/demo-aceptar`, {
      method: "POST",
      body: "{}",
    }),
  municipalities: () => req<{ data: Municipality[] }>("/api/municipalities"),
  createMunicipality: (body: { name: string; slug: string; accentColor?: string }) =>
    req<{ data: Municipality }>("/api/municipalities", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  info: (slug: string) => req<{ data: Municipality }>(`/api/c/${slug}/info`),
  facilities: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        type: string;
        address: string;
        accessibility: string;
        services: string[];
        rules: string;
        imageDataUrl?: string | null;
        imageUrl?: string | null;
        imageAlt?: string | null;
        units: Array<{ id: string; name: string }>;
        upcomingClosures?: Array<{
          id: string;
          startsAt: string;
          endsAt: string;
          reason: string;
          facilityId?: string | null;
          unitId?: string | null;
        }>;
      }>;
    }>(`/api/c/${slug}/facilities`),
  facility: (slug: string, id: string) =>
    req<{
      data: {
        id: string;
        name: string;
        type: string;
        address: string;
        accessibility: string;
        services: string[];
        rules: string;
        outdoor?: boolean;
        lat?: number;
        lng?: number;
        contactPhone?: string | null;
        contactEmail?: string | null;
        contactPerson?: string | null;
        parkingInfo?: string | null;
        publicTransport?: string | null;
        entranceInfo?: string | null;
        imageUrl?: string | null;
        imageAlt?: string | null;
        units: Array<{ id: string; name: string }>;
        rulesApplied: {
          bookingAntelationDays: number;
          maxActiveBookings: number;
          maxHoursPerWeek: number;
          cancelMinHours: number;
          checkInMarginMinutes: number;
          noShowReleaseMinutes: number;
          anonymizeAfterDays: number;
          whoCanBook?: "ambas" | "clubs" | "vecinhaza";
          approvalRequired?: boolean;
        };
        rulesText: Array<{ id: string; order: number; gl: string; es: string }>;
        rulesVersion: string;
        publishedSeasons?: Array<{
          id: string;
          name: string;
          startsAt: string;
          endsAt: string;
          criteriaGl: string;
          criteriaEs: string;
        }>;
        upcomingClosures?: Array<{
          id: string;
          startsAt: string;
          endsAt: string;
          reason: string;
          facilityId: string | null;
          unitId: string | null;
        }>;
      };
    }>(`/api/c/${slug}/facilities/${id}`),
  horasTranquilas: (slug: string, facilityId?: string, date?: string) => {
    const params = new URLSearchParams();
    if (facilityId) params.set("facilityId", facilityId);
    if (date) params.set("date", date);
    const q = params.toString();
    return req<{
      data: {
        hours: string[];
        date?: string;
        weeks: number;
        maxOccupancyPct: number;
      };
    }>(`/api/c/${slug}/horas-tranquilas${q ? `?${q}` : ""}`);
  },
  availability: (
    slug: string,
    q: { facilityId?: string; unitId?: string; date?: string; deporte?: string },
  ) => {
    const params = new URLSearchParams();
    if (q.facilityId) params.set("facilityId", q.facilityId);
    if (q.unitId) params.set("unitId", q.unitId);
    if (q.date) params.set("date", q.date);
    if (q.deporte) params.set("deporte", q.deporte);
    return req<{
      data: Array<{
        id: string;
        unitId: string;
        facilityId?: string;
        date: string;
        start: string;
        end: string;
        closed: boolean;
        status: "free" | "occupied" | "closed" | "mine";
        mine?: boolean;
        bookingId?: string;
      }>;
      meta?: { freeToday: number; date: string };
    }>(`/api/c/${slug}/availability?${params}`);
  },
  myBookings: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        date: string;
        start: string;
        end: string;
        status: string;
        shortCode: string;
        facilityId: string;
        facilityName?: string;
        checkInRequired?: boolean;
        slotId: string;
      }>;
    }>(`/api/c/${slug}/reservas`),
  myBookingsAll: () =>
    req<{
      data: Array<{
        id: string;
        date: string;
        start: string;
        end: string;
        status: string;
        shortCode: string;
        facilityId: string;
        facilityName?: string;
        checkInRequired?: boolean;
        slotId: string;
        municipalitySlug: string;
        municipalityName: string;
        municipalityLogoDataUrl?: string | null;
      }>;
    }>("/api/me/reservas"),
  createBooking: (
    slug: string,
    slotId: string,
    opts?: {
      rulesAccepted?: boolean;
      rulesVersion?: string;
      /** REVISION-40 P2 — reserva + partido na mesma petición. */
      openMatch?: {
        title: string;
        sport?: string;
        spotsTotal?: number;
        level?: string;
        notes?: string;
        nameDisplayConsent?: boolean;
        /** REVISION-42 Q6 — nome real se o da sesión é o do correo. */
        displayName?: string;
      };
    },
  ) =>
    req<{
      data: {
        id: string;
        shortCode: string;
        qrPayload: string;
        date: string;
        start: string;
        end: string;
        facilityId: string;
      };
      openMatch?: { id: string };
    }>(`/api/c/${slug}/reservas`, {
      method: "POST",
      body: JSON.stringify({
        slotId,
        rulesAccepted: opts?.rulesAccepted ?? true,
        rulesVersion: opts?.rulesVersion,
        ...(opts?.openMatch?.title ? { openMatch: opts.openMatch } : {}),
      }),
    }),
  booking: (slug: string, id: string) =>
    req<{
      data: {
        id: string;
        shortCode: string;
        qrPayload: string;
        date: string;
        start: string;
        end: string;
        status: string;
        facilityId: string;
        slotId?: string;
        facilityName?: string;
        facilityAddress?: string;
        facilityLat?: string | number | null;
        facilityLng?: string | number | null;
        icsSequence?: number;
        cancelReason?: string | null;
        openMatchId?: string | null;
      };
    }>(`/api/c/${slug}/reservas/${id}`),
  cancelBooking: (slug: string, id: string) =>
    req<{ data: { id: string; status: string }; offeredTo?: number }>(
      `/api/c/${slug}/reservas/${id}/cancel`,
      {
        method: "POST",
      },
    ),
  modifyBooking: (slug: string, id: string, slotId: string) =>
    req<{
      data: {
        id: string;
        shortCode: string;
        qrPayload: string;
        date: string;
        start: string;
        end: string;
        status: string;
        facilityId: string;
        facilityName?: string;
        icsSequence?: number;
        previousSlotId?: string;
      };
    }>(`/api/c/${slug}/reservas/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ slotId }),
    }),
  pavilion: (slug: string, opts?: { weekOffset?: number }) => {
    const q =
      opts?.weekOffset != null && opts.weekOffset !== 0
        ? `?weekOffset=${encodeURIComponent(String(opts.weekOffset))}`
        : "";
    return req<{
      data: {
        weekend: string;
        weekendEnd?: string;
        conflicts: number;
        matches: Array<{
          id: string;
          date: string;
          start: string;
          end: string;
          homeTeam: string;
          awayTeam: string;
          club: string;
          unit: string;
          unitId?: string;
          status: string;
          notes?: string;
          conflictWith?: string[];
        }>;
        clubs: Array<{ id: string; name: string; shortName: string }>;
        swaps: Array<{ id: string; fromMatchId: string; toMatchId: string; status: string }>;
        units?: Array<{
          id: string;
          name: string;
          facilityId: string;
          incompatibleWith: string[];
        }>;
        openingHours?: Array<{
          unitId: string | null;
          weekday: number;
          open: string;
          close: string;
          validFrom: string | null;
          validTo: string | null;
        }>;
        neighborBookings?: Array<{
          id: string;
          date: string;
          start: string;
          end: string;
          unitId: string;
          unit: string;
        }>;
      };
    }>(`/api/c/${slug}/pavillon${q}`);
  },
  proposeSwap: (slug: string, fromMatchId: string, toMatchId: string) =>
    req<{ data: { id: string } }>(`/api/c/${slug}/pavillon/swap`, {
      method: "POST",
      body: JSON.stringify({ fromMatchId, toMatchId }),
    }),
  resolveConflict: (
    slug: string,
    body: { matchId: string; action: "move_media" | "accept_swap" | "clear"; swapId?: string },
  ) =>
    req<{ data: unknown; pavilion: unknown }>(`/api/c/${slug}/pavillon/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  activities: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        description: string;
        days: string;
        hours: string;
        places: number;
        method: string;
        lotteryStatus: string;
        lotterySeedHash: string | null;
        ageMin?: number;
        ageMax?: number;
        deadline?: string;
        facilityId?: string;
        facilityName?: string;
      }>;
    }>(`/api/c/${slug}/actividades`),
  activity: (slug: string, id: string) =>
    req<{
      data: {
        id: string;
        name: string;
        description: string;
        places: number;
        method: string;
        lotteryStatus: string;
        lotterySeedHash: string | null;
        lotterySecret: string | null;
        lotteryResultOrder: string[] | null;
        days?: string;
        hours?: string;
        ageMin?: number;
        ageMax?: number;
        deadline?: string;
        facilityId?: string;
        facilityName?: string;
        applications: Array<{
          applicationNumber: string;
          priorityGroup: string;
          status: string;
        }>;
        mine: {
          applicationNumber: string;
          status: string;
          priorityGroup: string;
        } | null;
      };
    }>(`/api/c/${slug}/actividades/${id}`),
  drawLottery: (slug: string, id: string) =>
    req<{
      data: {
        seedHash: string;
        secret: string;
        accepted: string[];
        waitlist: string[];
      };
    }>(`/api/c/${slug}/actividades/${id}/sortear`, { method: "POST" }),
  verifyLottery: (slug: string, id: string, secret: string) =>
    req<{
      data: { ok: boolean; hashMatches: boolean; accepted: string[]; order: string[] };
    }>(`/api/c/${slug}/actividades/${id}/verificar`, {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),
};
