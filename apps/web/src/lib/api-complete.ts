/** Cliente API da superficie D completa (complementa api.ts). */
const API = import.meta.env.VITE_API_URL ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const json = (await res.json()) as T & {
    error?: string;
    slug?: string;
    name?: string;
    facilityName?: string;
    start?: string;
    date?: string;
  };
  if (!res.ok) {
    const err = new Error(
      (json as { error?: string }).error ?? `HTTP ${res.status}`,
    ) as Error & {
      payload?: typeof json;
      status?: number;
      facilityName?: string;
      start?: string;
      date?: string;
    };
    err.payload = json;
    err.status = res.status;
    if (typeof json.facilityName === "string") err.facilityName = json.facilityName;
    if (typeof json.start === "string") err.start = json.start;
    if (typeof json.date === "string") err.date = json.date;
    throw err;
  }
  return json;
}

export const apiX = {
  notices: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        type: string;
        title: string;
        body: string;
        read: boolean;
        createdAt: string;
        payload?: Record<string, unknown> | null;
      }>;
    }>(`/api/c/${slug}/avisos`),
  markNotice: (slug: string, id: string) =>
    req(`/api/c/${slug}/avisos/${id}/ler`, { method: "POST" }),
  acceptWaitlistNotice: (slug: string, id: string) =>
    req<{
      data: {
        bookingId: string;
        slotId: string;
        facilityName?: string;
        facilityId?: string;
        date?: string;
        start?: string;
        end?: string;
      };
    }>(`/api/c/${slug}/avisos/${id}/aceptar-praza`, {
      method: "POST",
      body: "{}",
    }),
  family: () =>
    req<{
      data: Array<{ id: string; displayName: string; relation: string; birthYear?: number }>;
      consent: { at: string; version: string } | null;
    }>("/api/me/familia"),
  addFamily: (body: {
    displayName: string;
    relation: "fillo" | "filla" | "dependente" | "outro";
    birthYear?: number;
  }) =>
    req("/api/me/familia", { method: "POST", body: JSON.stringify(body) }),
  /** REVISION-58 K7 */
  updateFamily: (id: string, body: { birthYear: number }) =>
    req<{ data: { id: string; birthYear?: number } }>(`/api/me/familia/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  consent: () => req("/api/me/consentimento", { method: "POST", body: "{}" }),
  weekend: (slug: string) =>
    req<{
      data: {
        weekend: string;
        matches: Array<{
          id: string;
          date: string;
          start: string;
          end: string;
          homeTeam: string;
          awayTeam: string;
          unit: string;
          club: string;
          status: string;
        }>;
      };
    }>(`/api/c/${slug}/fin-de-semana`),
  staffDay: (slug: string, date?: string) =>
    req<{ data: Array<Record<string, unknown>>; date: string }>(
      `/api/c/${slug}/conserxeria/dia${date ? `?date=${date}` : ""}`,
    ),
  checkin: (
    slug: string,
    body: { qrPayload?: string; shortCode?: string },
  ) =>
    req<{ data: { valid: boolean; reason?: string; booking?: { shortCode: string; userDisplayName: string; start: string; end: string } } }>(
      `/api/c/${slug}/checkin`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  normas: (slug: string) =>
    req<{
      data: {
        rules: {
          bookingAntelationDays: number;
          maxActiveBookings: number;
          maxHoursPerWeek: number;
          cancelMinHours: number;
          checkInMarginMinutes: number;
          noShowReleaseMinutes: number;
          anonymizeAfterDays: number;
          noShowPenaltyCount: number;
          noShowPenaltyDays: number;
          whoCanBook?: "vecinhaza" | "clubs" | "ambas";
          approvalRequired?: boolean;
          informativePrice?: string;
        };
        rulesText: Array<{ id: string; order: number; gl: string; es: string }>;
        rulesVersion: string;
        source?: "muni" | "facility";
        rulesOverride?: Partial<{
          bookingAntelationDays: number;
          maxActiveBookings: number;
          maxHoursPerWeek: number;
          cancelMinHours: number;
          checkInMarginMinutes: number;
          noShowReleaseMinutes: number;
          anonymizeAfterDays: number;
          whoCanBook: "vecinhaza" | "clubs" | "ambas";
          approvalRequired: boolean;
          informativePrice: string;
          slotMinutes?: number;
        }> | null;
      };
    }>(`/api/c/${slug}/admin/normas`),
  putNormas: (
    slug: string,
    body: {
      rules?: Partial<{
        bookingAntelationDays: number;
        maxActiveBookings: number;
        maxHoursPerWeek: number;
        cancelMinHours: number;
        checkInMarginMinutes: number;
        noShowReleaseMinutes: number;
        anonymizeAfterDays: number;
        noShowPenaltyCount: number;
        noShowPenaltyDays: number;
      }>;
      rulesText?: Array<{ id: string; order: number; gl: string; es: string }>;
    },
  ) =>
    req(`/api/c/${slug}/admin/normas`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  facilityNormas: (slug: string, facilityId: string) =>
    req<{
      data: {
        rules: {
          bookingAntelationDays: number;
          maxActiveBookings: number;
          maxHoursPerWeek: number;
          cancelMinHours: number;
          checkInMarginMinutes: number;
          noShowReleaseMinutes: number;
          anonymizeAfterDays: number;
          noShowPenaltyCount: number;
          noShowPenaltyDays: number;
          whoCanBook?: "vecinhaza" | "clubs" | "ambas";
          approvalRequired?: boolean;
          informativePrice?: string;
        };
        rulesText: Array<{ id: string; order: number; gl: string; es: string }>;
        rulesVersion: string;
        source: "muni" | "facility";
        rulesGeneral?: {
          bookingAntelationDays: number;
          maxActiveBookings: number;
          maxHoursPerWeek: number;
          cancelMinHours: number;
          checkInMarginMinutes: number;
          noShowReleaseMinutes: number;
          anonymizeAfterDays: number;
          noShowPenaltyCount: number;
          noShowPenaltyDays: number;
        };
        rulesOverride: Partial<{
          bookingAntelationDays: number;
          maxActiveBookings: number;
          maxHoursPerWeek: number;
          cancelMinHours: number;
          checkInMarginMinutes: number;
          noShowReleaseMinutes: number;
          anonymizeAfterDays: number;
          whoCanBook: "vecinhaza" | "clubs" | "ambas";
          approvalRequired: boolean;
          informativePrice: string;
          slotMinutes?: number;
        }> | null;
      };
    }>(`/api/c/${slug}/admin/instalacions/${facilityId}/normas`),
  putFacilityNormas: (
    slug: string,
    facilityId: string,
    body: {
      rulesOverride?: Partial<{
        bookingAntelationDays: number;
        maxActiveBookings: number;
        maxHoursPerWeek: number;
        cancelMinHours: number;
        checkInMarginMinutes: number;
        noShowReleaseMinutes: number;
        anonymizeAfterDays: number;
        whoCanBook: "vecinhaza" | "clubs" | "ambas";
        approvalRequired: boolean;
        informativePrice: string;
      }> | null;
      rulesText?: Array<{ id: string; order: number; gl: string; es: string }> | null;
    },
  ) =>
    req(`/api/c/${slug}/admin/instalacions/${facilityId}/normas`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getBranding: (slug: string) =>
    req<{
      data: {
        deputacionCanViewPersonalData: boolean;
        hasLogo: boolean;
        logoUrl: string | null;
      };
    }>(`/api/c/${slug}/admin/personalizacion`),
  putBranding: (
    slug: string,
    body: {
      name?: string;
      brand?: string;
      accent?: string;
      welcomeGl?: string;
      welcomeEs?: string;
      logoDataUrl?: string | null;
      legal?: {
        titular?: string;
        nif?: string;
        address?: string;
        email?: string;
        dpd?: string;
        sinatura?: string;
      };
      contact?: {
        serviceName?: string;
        phone?: string;
        email?: string;
        address?: string;
        hours?: string;
        web?: string;
      };
      openData?: {
        license?: string;
        dir3?: string;
        catalogPublisher?: string;
      };
      deputacionCanViewPersonalData?: boolean;
    },
  ) =>
    req<{
      data: {
        name: string;
        theme: { brand: string; accent: string };
        welcomeGl: string;
        welcomeEs: string;
        logoDataUrl: string | null;
        legal: Record<string, string>;
        contact: Record<string, string>;
        openData: { license: string; dir3: string; catalogPublisher: string };
        deputacionCanViewPersonalData: boolean;
        contrastOk: boolean;
        contrastRatio: number;
      };
    }>(`/api/c/${slug}/admin/personalizacion`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  patchMe: (body: {
    email?: string;
    locale?: "gl" | "es";
    notifyEmail?: boolean;
    notifyReminders?: boolean;
    notifyPrefs?: import("@pista-aberta/shared").NotifyPrefs;
  }) =>
    req<{
      data: {
        displayName: string;
        email?: string;
        locale: string;
        notifyPrefs?: import("@pista-aberta/shared").NotifyPrefs;
      };
      emailChange?: {
        challengeId: string;
        message: string;
        demoCode?: string;
      };
    }>("/api/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  confirmEmailChange: (body: { challengeId: string; code: string }) =>
    req<{
      data: {
        displayName: string;
        email?: string;
        locale: string;
      };
    }>("/api/me/email/confirmar", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeFamily: (id: string) =>
    req(`/api/me/familia/${id}`, { method: "DELETE" }),
  exportMyData: () => req<{ data: unknown }>("/api/me/datos"),
  closeAccount: () => req("/api/me/pechar", { method: "POST", body: "{}" }),
  updateClub: (
    slug: string,
    id: string,
    body: {
      name?: string;
      shortName?: string;
      active?: boolean;
      reinviteEmail?: string;
    },
  ) =>
    req(`/api/c/${slug}/admin/clubs/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminFacilities: (slug: string) =>
    req<{
      data: Array<
        Record<string, unknown> & {
          id: string;
          name: string;
          active: boolean;
          checkInRequired?: boolean;
          units: Array<{
            id: string;
            name: string;
            active?: boolean;
            slotMinutes?: number;
            bookingKind?: "vecinhaza" | "clubs" | "ambas";
          }>;
        }
      >;
    }>(`/api/c/${slug}/admin/instalacions`),
  createFacility: (
    slug: string,
    body: {
      name: string;
      type: "pista" | "pavillon" | "campo" | "sala";
      address: string;
      lat: number;
      lng: number;
      courtCount?: number;
      halfCourts?: boolean;
      accessibility?: string;
      services?: string[];
      units?: Array<{ name: string; slotMinutes?: number; bookingKind?: string }>;
    },
  ) =>
    req(`/api/c/${slug}/admin/instalacions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  facilityMapCenter: (slug: string) =>
    req<{ data: { lat: number; lng: number; addressHint?: string } }>(
      `/api/c/${slug}/admin/instalacions/mapa-centro`,
    ),
  publishFacility: (slug: string, facilityId: string) =>
    req(`/api/c/${slug}/admin/instalacions/${facilityId}/publicar`, {
      method: "POST",
    }),
  censusFacilitySuggestions: (slug: string) =>
    req<{
      data: Array<{
        key: string;
        name: string;
        type: string;
        osmType: string;
        address: string;
        lat: number;
        lng: number;
        alreadyCreated: boolean;
      }>;
    }>(`/api/c/${slug}/admin/instalacions/censo/suxestions`),
  createFacilitiesFromCensus: (slug: string, keys: string[]) =>
    req<{ data: { createdIds: string[]; count: number } }>(
      `/api/c/${slug}/admin/instalacions/censo/crear`,
      { method: "POST", body: JSON.stringify({ keys }) },
    ),
  facilityDeactivateImpact: (slug: string, facilityId: string) =>
    req<{
      data: {
        cancelledCount: number;
        peopleCount: number;
        matchCount: number;
      };
    }>(`/api/c/${slug}/admin/instalacions/${facilityId}/impacto-desactivar`),
  updateFacility: (
    slug: string,
    id: string,
    body: Record<string, unknown>,
  ) =>
    req<{
      data: {
        needsConfirm?: boolean;
        cancelledCount?: number;
        peopleCount?: number;
        matchCount?: number;
        id?: string;
        active?: boolean;
      };
    }>(`/api/c/${slug}/admin/instalacions/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  createUnit: (
    slug: string,
    facilityId: string,
    body: {
      name: string;
      slotMinutes?: number;
      capacity?: number;
      bookingKind?: "vecinhaza" | "clubs" | "ambas";
    },
  ) =>
    req(`/api/c/${slug}/admin/instalacions/${facilityId}/unidades`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateUnit: (
    slug: string,
    facilityId: string,
    unitId: string,
    body: {
      name?: string;
      slotMinutes?: number;
      capacity?: number;
      bookingKind?: "vecinhaza" | "clubs" | "ambas";
      active?: boolean;
      incompatibleWith?: string[];
    },
  ) =>
    req(`/api/c/${slug}/admin/instalacions/${facilityId}/unidades/${unitId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  setUnitIncompatibles: (
    slug: string,
    facilityId: string,
    unitId: string,
    ids: string[],
  ) =>
    req(`/api/c/${slug}/admin/instalacions/${facilityId}/unidades/${unitId}/incompatibles`, {
      method: "PUT",
      body: JSON.stringify({ ids }),
    }),
  horarios: (slug: string, unitId?: string) =>
    req<{
      data: Array<{
        id: string;
        unitId: string | null;
        weekday: number;
        open: string;
        close: string;
        validFrom?: string | null;
        validTo?: string | null;
      }>;
    }>(`/api/c/${slug}/admin/horarios${unitId ? `?unitId=${unitId}` : ""}`),
  putHorarios: (
    slug: string,
    body: {
      unitId: string;
      facilityId?: string;
      hours: Array<{
        weekday: number;
        open: string;
        close: string;
        validFrom?: string | null;
        validTo?: string | null;
      }>;
    },
  ) =>
    req(`/api/c/${slug}/admin/horarios`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  applyHorariosToAll: (
    slug: string,
    body: { facilityId: string; sourceUnitId: string },
  ) =>
    req<{ data: { applied: number } }>(`/api/c/${slug}/admin/horarios/aplicar`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  peches: (slug: string) =>
    req<{ data: Array<{ id: string; facilityId: string | null; startsAt: string; endsAt: string; reason: string }> }>(
      `/api/c/${slug}/admin/peches`,
    ),
  createPeche: (
    slug: string,
    body: {
      facilityId?: string;
      unitId?: string;
      startsAt: string;
      endsAt: string;
      reason: string;
      confirm?: boolean;
      mode?: "cancel_notify" | "skip_booked_days";
      notifyReason?: string;
      notifyCitizens?: boolean;
    },
  ) =>
    req<{
      data: {
        needsConfirm?: boolean;
        cancelledCount?: number;
        peopleCount?: number;
        matchCount?: number;
        id?: string | null;
        ids?: string[];
      };
    }>(`/api/c/${slug}/admin/peches`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deletePeche: (slug: string, id: string) =>
    req<{ data: { ok: boolean } }>(`/api/c/${slug}/admin/peches/${id}`, {
      method: "DELETE",
    }),
  updatePeche: (
    slug: string,
    id: string,
    body: {
      startsAt?: string;
      endsAt?: string;
      reason?: string;
      confirm?: boolean;
      mode?: "cancel_notify" | "skip_booked_days";
      notifyReason?: string;
      notifyCitizens?: boolean;
    },
  ) =>
    req<{
      data: {
        needsConfirm?: boolean;
        cancelledCount?: number;
        peopleCount?: number;
        matchCount?: number;
        id?: string;
        facilityId?: string | null;
        unitId?: string | null;
        startsAt?: string;
        endsAt?: string;
        reason?: string;
      };
    }>(`/api/c/${slug}/admin/peches/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  searchPeople: (slug: string, q: string) =>
    req<{
      data: Array<{
        id: string;
        displayName: string;
        email: string | null;
        phone: string | null;
        personIdentifier: string | null;
        role: string;
        bookingBlockedUntil: string | null;
        bookings: Array<{
          id: string;
          date: string;
          start: string;
          end: string;
          status: string;
          facilityId: string;
        }>;
      }>;
    }>(`/api/c/${slug}/admin/persoas?q=${encodeURIComponent(q)}`),
  clearBookingBlock: (slug: string, userId: string) =>
    req<{ data: { id: string; bookingBlockedUntil: string | null } }>(
      `/api/c/${slug}/admin/persoas/${userId}/desbloquear-reservas`,
      { method: "POST" },
    ),
  adminExportFull: (slug: string) =>
    req<{ data: unknown }>(`/api/c/${slug}/admin/export?format=full`),
  solicitudes: (slug: string, estado?: string) =>
    req<{
      data: Array<{
        id: string;
        type: string;
        status: string;
        clubName: string;
        payload: Record<string, unknown>;
        note?: string | null;
        createdAt: string;
        rejectReason?: string | null;
      }>;
      pending: number;
    }>(`/api/c/${slug}/admin/solicitudes${estado ? `?estado=${estado}` : ""}`),
  solicitudeConflicts: (slug: string, id: string) =>
    req<{ data: Array<{ kind: string; detail: string }> }>(
      `/api/c/${slug}/admin/solicitudes/${id}/choques`,
    ),
  approveSolicitude: (slug: string, id: string) =>
    req(`/api/c/${slug}/admin/solicitudes/${id}/aprobar`, { method: "POST" }),
  rejectSolicitude: (slug: string, id: string, reason: string) =>
    req(`/api/c/${slug}/admin/solicitudes/${id}/rexeitar`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  moveSolicitude: (
    slug: string,
    id: string,
    body: {
      facilityId?: string;
      unitId?: string;
      weekday?: number;
      date?: string;
      start?: string;
      end?: string;
    },
  ) =>
    req(`/api/c/${slug}/admin/solicitudes/${id}/mover`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** REVISION-38 J4 / REVISION-39 L2 — club acepta/rexeita (con versión). */
  acceptClubCounter: (
    slug: string,
    requestId: string,
    body?: {
      counterVersion?: number;
      start?: string;
      end?: string;
      date?: string;
      weekday?: number;
    },
  ) =>
    req(`/api/c/${slug}/solicitudes/${requestId}/aceptar-contraproposta`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  rejectClubCounter: (
    slug: string,
    requestId: string,
    body?: {
      counterVersion?: number;
      start?: string;
      end?: string;
      date?: string;
      weekday?: number;
    },
  ) =>
    req(`/api/c/${slug}/solicitudes/${requestId}/rexeitar-contraproposta`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  clubs: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        shortName: string;
        seasonSlots: Array<{ id: string; weekday: number; start: string; end: string; unitId: string }>;
      }>;
    }>(`/api/c/${slug}/clubs`),
  club: (slug: string, clubId: string) =>
    req<{ data: Record<string, unknown> }>(`/api/c/${slug}/clubs/${clubId}`),
  requestSeason: (
    slug: string,
    clubId: string,
    body: {
      weekday: number;
      start: string;
      end: string;
      unitId: string;
      facilityId: string;
      note?: string;
    },
  ) =>
    req(`/api/c/${slug}/clubs/${clubId}/solicitar-tempada`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  requestMatch: (
    slug: string,
    clubId: string,
    body: {
      date: string;
      start: string;
      end: string;
      homeTeam: string;
      awayTeam: string;
      unitId: string;
      facilityId: string;
      note?: string;
    },
  ) =>
    req(`/api/c/${slug}/clubs/${clubId}/solicitar-partido`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  requestMatchChange: (
    slug: string,
    clubId: string,
    body: {
      matchId: string;
      date?: string;
      start?: string;
      end?: string;
      unitId?: string;
      facilityId?: string;
      note?: string;
    },
  ) =>
    req(`/api/c/${slug}/clubs/${clubId}/solicitar-cambio-partido`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  moveMatch: (
    slug: string,
    matchId: string,
    body: {
      facilityId: string;
      unitId: string;
      date: string;
      start: string;
      end: string;
    },
  ) =>
    req(`/api/c/${slug}/admin/pavillon/matches/${matchId}/mover`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** REVISION-51 B1 */
  matchFreeHours: (
    slug: string,
    matchId: string,
    opts?: { unitId?: string; facilityId?: string; weekOffset?: number },
  ) => {
    const q = new URLSearchParams();
    if (opts?.unitId) q.set("unitId", opts.unitId);
    if (opts?.facilityId) q.set("facilityId", opts.facilityId);
    if (opts?.weekOffset != null && opts.weekOffset !== 0) {
      q.set("weekOffset", String(opts.weekOffset));
    }
    const qs = q.toString();
    return req<{ data: Array<{ date: string; start: string; end: string }> }>(
      `/api/c/${slug}/admin/pavillon/matches/${matchId}/horas-libres${qs ? `?${qs}` : ""}`,
    );
  },
  adminClubs: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        shortName: string;
        account: {
          id: string;
          displayName: string;
          email?: string;
          active: boolean;
        } | null;
      }>;
    }>(`/api/c/${slug}/admin/clubs`),
  adminCreateClub: (
    slug: string,
    body: {
      name: string;
      shortName?: string;
      accountEmail: string;
      accountDisplayName?: string;
    },
  ) =>
    req(`/api/c/${slug}/admin/clubs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  swapAccept: (slug: string, id: string) =>
    req(`/api/c/${slug}/pavillon/swap/${id}/aceptar`, { method: "POST" }),
  swapReject: (slug: string, id: string) =>
    req(`/api/c/${slug}/pavillon/swap/${id}/rexeitar`, { method: "POST" }),
  dashboard: (slug: string) =>
    req<{
      data: {
        todayCount: number;
        confirmed: number;
        checkedIn: number;
        cancelled: number;
        noShows: number;
        todayNoShows?: number;
        weekOccupancy?: number;
        /** Ocupación semanal das últimas 4 semanas (máis antiga → actual). */
        occupancyWeeks?: number[];
        weekHeat?: Array<{ date: string; start: string; end: string }>;
        openIncidents?: number;
        demandUnmet: number;
        heat: Array<{
          name: string;
          bookings: number;
          hours?: number;
          openHours?: number;
          pct?: number;
        }>;
        lowOccupancy: Array<{ date: string; start: string; unitId: string }>;
        recommendation: string;
        kpis?: {
          bookingsToday: { value: number; delta: number; spark: number[] };
          weekOccupancy: {
            value: number;
            delta: number;
            spark: number[];
            weeks?: number[];
          };
          noShowsToday: { value: number; delta: number; spark: number[] };
          openIncidents: { value: number; delta: number; spark: number[] };
        };
        todos?: {
          pendingRequests: number;
          pendingBookings?: number;
          pendingBookingRows?: Array<{
            id: string;
            userDisplayName: string;
            date: string;
            start: string;
            end: string;
            facilityId: string;
          }>;
          pavilionConflicts: number;
          openIncidents?: number;
          overdueLotteries: Array<{ id: string; name: string; deadline: string }>;
          activeClosures: Array<{ id: string; reason: string; startsAt: string; endsAt: string }>;
        };
        launch?: {
          done: number;
          total: number;
          published: boolean;
          items: Array<{ id: string; done: boolean; href: string }>;
        };
      };
    }>(`/api/c/${slug}/admin/dashboard`),
  adminActivities: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        method: string;
        lotteryStatus: string;
        places: number;
        deadline: string;
        days: string;
        hours: string;
        lotterySeedHash: string | null;
      }>;
    }>(`/api/c/${slug}/admin/actividades`),
  adminActivity: (slug: string, id: string) =>
    req<{
      data: {
        id: string;
        name: string;
        description: string;
        facilityId: string;
        method: string;
        lotteryStatus: string;
        places: number;
        deadline: string;
        days: string;
        hours: string;
        ageMin: number;
        ageMax: number;
        lotterySeedHash: string | null;
        lotterySecret: string | null;
        applications: Array<{
          id: string;
          applicationNumber: string;
          priorityGroup: string;
          status: string;
          displayName: string;
          email: string | null;
        }>;
      };
    }>(`/api/c/${slug}/admin/actividades/${id}`),
  createActivity: (
    slug: string,
    body: {
      name: string;
      description?: string;
      facilityId: string;
      days: string;
      hours: string;
      places: number;
      ageMin: number;
      ageMax: number;
      method: "first_come" | "lottery";
      deadline: string;
    },
  ) =>
    req(`/api/c/${slug}/admin/actividades`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateActivity: (slug: string, id: string, body: Record<string, unknown>) =>
    req(`/api/c/${slug}/admin/actividades/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  adminDrawLottery: (slug: string, id: string) =>
    req<{
      data: {
        secret: string | null;
        accepted: string[];
        waitlist: string[];
        order: string[] | null;
      };
    }>(`/api/c/${slug}/admin/actividades/${id}/sortear`, { method: "POST" }),
  approveBooking: (slug: string, id: string) =>
    req<{ data: unknown }>(`/api/c/${slug}/admin/reservas/${id}/aprobar`, {
      method: "POST",
    }),
  rejectBooking: (slug: string, id: string) =>
    req<{ data: unknown }>(`/api/c/${slug}/admin/reservas/${id}/rexeitar`, {
      method: "POST",
    }),
  adminDay: (slug: string, date?: string) =>
    req<{ data: Array<Record<string, unknown>>; date: string }>(
      `/api/c/${slug}/admin/reservas-dia${date ? `?date=${date}` : ""}`,
    ),
  resetDemo: () =>
    req<{
      data: {
        ok: boolean;
        mode: string;
        at: string;
        restoredFromSnapshot?: boolean;
      };
    }>("/api/demo/reset", {
      method: "POST",
      body: "{}",
    }),
  /** REVISION-33 D2 */
  lastDemoReset: () =>
    req<{ data: { at: string | null } }>("/api/demo/reset"),
  demoSnapshotStatus: () =>
    req<{
      data: {
        configured: boolean;
        exists: boolean;
        at: string | null;
        locked?: boolean;
        lastRestoreError?: { at: string; message: string } | null;
      };
    }>("/api/demo/snapshot"),
  saveDemoSnapshot: () =>
    req<{ data: { ok: boolean; mode: string; at: string } }>(
      "/api/demo/snapshot",
      {
        method: "POST",
        body: "{}",
      },
    ),
  bookFor: (
    slug: string,
    body: {
      slotId: string;
      citizenName: string;
      citizenId?: string;
      phone?: string;
      email?: string;
    },
  ) =>
    req<{
      data: {
        id: string;
        shortCode: string;
        date: string;
        start: string;
        end: string;
        userDisplayName: string;
      };
    }>(`/api/c/${slug}/admin/reservar-nome`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  bookForSendMail: (slug: string, bookingId: string, email?: string) =>
    req<{ data: { ok: boolean; to: string } }>(
      `/api/c/${slug}/admin/reservar-nome/${bookingId}/correo`,
      {
        method: "POST",
        body: JSON.stringify(email ? { email } : {}),
      },
    ),
  adminExportJson: (slug: string) => req<{ data: unknown }>(`/api/c/${slug}/admin/export`),
  audit: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        at: string;
        actor: string;
        action: string;
        detail: string;
        actorLabel?: string;
        actorRole?: string | null;
      }>;
    }>(`/api/c/${slug}/admin/auditoria`),
  season: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        clubId: string;
        weekday: number;
        start: string;
        end: string;
        unitId: string;
        seasonId?: string | null;
        validTo?: string | null;
      }>;
    }>(`/api/c/${slug}/admin/tempada`),
  /** REVISION-58 K3 */
  deleteSeasonSlot: (slug: string, id: string) =>
    req<{ data: { ok: boolean } }>(`/api/c/${slug}/admin/tempada/${id}`, {
      method: "DELETE",
    }),
  /** REVISION-22 B4 */
  seasons: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        startsAt: string;
        endsAt: string;
        facilityIds: string[];
        criteriaGl: string;
        criteriaEs: string;
        published: boolean;
      }>;
    }>(`/api/c/${slug}/admin/tempadas`),
  createSeason: (
    slug: string,
    body: {
      name: string;
      startsAt: string;
      endsAt: string;
      facilityIds?: string[];
      criteriaGl?: string;
      criteriaEs?: string;
      published?: boolean;
    },
  ) =>
    req<{ data: { id: string } }>(`/api/c/${slug}/admin/tempadas`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSeason: (
    slug: string,
    id: string,
    body: Partial<{
      name: string;
      startsAt: string;
      endsAt: string;
      facilityIds: string[];
      criteriaGl: string;
      criteriaEs: string;
      published: boolean;
    }>,
  ) =>
    req<{ data: { id: string; published: boolean } }>(
      `/api/c/${slug}/admin/tempadas/${id}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  deleteSeason: (slug: string, id: string) =>
    req<{ ok: boolean }>(`/api/c/${slug}/admin/tempadas/${id}`, {
      method: "DELETE",
    }),
  /** REVISION-22 B3 */
  clubResponsables: (slug: string, clubId: string) =>
    req<{
      data: Array<{
        id: string;
        displayName: string;
        email: string;
        role: string;
        userId?: string | null;
      }>;
    }>(`/api/c/${slug}/admin/clubs/${clubId}/responsables`),
  addClubResponsable: (
    slug: string,
    clubId: string,
    body: {
      email?: string;
      userId?: string;
      displayName?: string;
      nif?: string;
      role?: string;
    },
  ) =>
    req<{ data: { id: string } }>(
      `/api/c/${slug}/admin/clubs/${clubId}/responsables`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  removeClubResponsable: (slug: string, clubId: string, memberId: string) =>
    req<{ ok: boolean }>(
      `/api/c/${slug}/admin/clubs/${clubId}/responsables/${memberId}`,
      { method: "DELETE" },
    ),
  previewMatchCsv: (
    slug: string,
    body: { csv: string; categoryMinutes?: Record<string, number> },
  ) =>
    req<{
      data: {
        rows: Array<{
          line: number;
          date: string;
          start: string;
          end: string;
          home: string;
          away: string;
          club: string;
          category: string;
          unit: string;
          errors: string[];
          conflicts: string[];
          ok: boolean;
        }>;
        okCount: number;
        errorCount: number;
        conflictCount: number;
        categoryMinutes: Record<string, number>;
        sampleHeaders: string[];
      };
    }>(`/api/c/${slug}/admin/partidos/importar/preview`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  confirmMatchCsv: (
    slug: string,
    body: { csv: string; categoryMinutes?: Record<string, number> },
  ) =>
    req<{
      data: { inserted: number; conflicts: number; skipped: number; matchIds: string[] };
    }>(`/api/c/${slug}/admin/partidos/importar`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  staffList: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        displayName: string;
        email?: string;
        role: string;
        active: boolean;
      }>;
    }>(`/api/c/${slug}/admin/persoal`),
  staffInvite: (
    slug: string,
    body: {
      displayName: string;
      email: string;
      role?: "staff" | "monitor";
      nif?: string;
    },
  ) =>
    req(`/api/c/${slug}/admin/persoal`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  staffRevoke: (slug: string, id: string) =>
    req(`/api/c/${slug}/admin/persoal/${id}/revogar`, { method: "POST" }),
  staffReactivate: (slug: string, id: string) =>
    req(`/api/c/${slug}/admin/persoal/${id}/reactivar`, { method: "POST" }),
  openData: (slug: string) =>
    req<{
      data: {
        license: string;
        catalog: string;
        dir3?: string;
        catalogPublisher?: string;
        geojson: unknown;
        occupancy: unknown[];
        facilities: unknown[];
      };
    }>(`/api/c/${slug}/datos-abertos`),
  wizard: (body: {
    name: string;
    slug: string;
    ine?: string;
    accentColor?: string;
    accent?: string;
    theme?: { brand: string; accent: string };
    dir3?: string;
    markedFacilities?: string[];
    schedule?: Record<string, { open: string; close: string }>;
    norms?: { rule1?: boolean; rule2?: boolean; rule3?: boolean };
    facilityName?: string;
    adminEmail?: string;
    adminDisplayName?: string;
    adminNif?: string;
    /** REVISION-32 C2 — correo xeral do concello (datos legais). */
    legalEmail?: string;
    facilityNames?: Record<string, string>;
  }) =>
    req<{
      data: {
        slug: string;
        name: string;
        id: string;
        invite?: { token: string; url: string; expiresAt: string };
        facilitiesCreated?: number;
        brandColor?: string;
      };
    }>("/api/municipalities/wizard", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  lookupNif: (nif: string) =>
    req<{ data: { exists: boolean } }>(
      `/api/deputacion/nif-lookup?nif=${encodeURIComponent(nif)}`,
    ).catch(() => ({ data: { exists: false } })),
  deputacionConcellos: () =>
    req<{
      data: Array<{
        slug: string;
        name: string;
        portalPublished: boolean;
        checklistDone: number;
        checklistTotal: number;
        adminLabel: string;
        adminUserId?: string;
        facilitiesActive: number;
        facilitiesDraft: number;
        pendingInvite?: { url: string; email?: string | null };
        contact?: {
          serviceName?: string;
          phone?: string;
          email?: string;
        };
      }>;
    }>("/api/deputacion/concellos"),
  deputacionOrg: () =>
    req<{
      data: {
        id: string;
        name: string;
        dir3: string | null;
        logoDataUrl: string | null;
        email?: string | null;
      } | null;
    }>("/api/deputacion/org"),
  /** REVISION-39 L6 */
  patchDeputacionOrg: (body: { email?: string; name?: string }) =>
    req<{
      data: {
        id: string;
        name: string;
        dir3: string | null;
        email?: string | null;
      };
    }>("/api/deputacion/org", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deputacionPersoas: () =>
    req<{
      data: Array<{
        id: string;
        displayName: string;
        email: string | null;
        personIdentifier: string | null;
        active: boolean;
      }>;
    }>("/api/deputacion/persoas"),
  deputacionManagerInvite: (body: { email: string; nif: string; name?: string }) =>
    req("/api/deputacion/persoas/convite", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deputacionManagerRevoke: (userId: string) =>
    req(`/api/deputacion/persoas/${encodeURIComponent(userId)}/revogar`, {
      method: "POST",
      body: "{}",
    }),
  deputacionInvite: (
    slug: string,
    body: { email: string; nif?: string; name?: string },
  ) =>
    req(`/api/deputacion/concellos/${slug}/convite`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deputacionRevokeInvite: (slug: string) =>
    req(`/api/deputacion/concellos/${slug}/convite/revogar`, { method: "POST" }),
  deputacionRetirarAdmin: (slug: string, reason: string) =>
    req(`/api/deputacion/concellos/${slug}/admin/revogar`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  publishPortal: (slug: string) =>
    req(`/api/c/${slug}/admin/publicar`, { method: "POST" }),
  createBookingFor: (slug: string, slotId: string, forMember?: { id: string; name: string }) =>
    req(`/api/c/${slug}/reservas`, {
      method: "POST",
      body: JSON.stringify({
        slotId,
        forMemberId: forMember?.id,
        forMemberName: forMember?.name,
      }),
    }),
  joinWaitlist: (slug: string, slotId: string) =>
    req(`/api/c/${slug}/lista-espera`, {
      method: "POST",
      body: JSON.stringify({ slotId }),
    }),
  myPartidos: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        role: "organizer" | "player";
        title: string;
        date: string;
        start: string;
        end: string;
        spotsTaken: number;
        spotsTotal: number;
        facilityName?: string;
        status: string;
        organizerName?: string;
        bookingId?: string | null;
      }>;
    }>(`/api/c/${slug}/me/partidos`),
  myWaitlist: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        slotId: string;
        status: string;
        createdAt: string;
        offeredUntil?: string | null;
      }>;
    }>(`/api/c/${slug}/lista-espera`),
  leaveWaitlist: (slug: string, slotId: string) =>
    req(`/api/c/${slug}/lista-espera/${encodeURIComponent(slotId)}`, {
      method: "DELETE",
    }),
  createIncident: (
    slug: string,
    body: { facilityId?: string; body: string; photoDataUrl?: string | null },
  ) =>
    req(`/api/c/${slug}/incidencias`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listIncidents: (slug: string, estado?: string) =>
    req<{
      data: Array<{
        id: string;
        facilityId: string | null;
        userDisplayName: string;
        body: string;
        status: string;
        createdAt: string;
      }>;
      open: number;
    }>(`/api/c/${slug}/admin/incidencias${estado ? `?estado=${estado}` : ""}`),
  getIncident: (slug: string, id: string) =>
    req<{
      data: {
        id: string;
        facilityId: string | null;
        userDisplayName: string;
        body: string;
        photoDataUrl: string | null;
        status: string;
        createdAt: string;
      };
    }>(`/api/c/${slug}/admin/incidencias/${encodeURIComponent(id)}`),
  resolveIncident: (slug: string, id: string) =>
    req(`/api/c/${slug}/admin/incidencias/${id}/resolver`, { method: "POST" }),
  setIncidentStatus: (
    slug: string,
    id: string,
    status: "open" | "in_progress" | "done",
  ) =>
    req(`/api/c/${slug}/admin/incidencias/${id}/estado`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  adminCancelBooking: (slug: string, id: string, reason?: string) =>
    req(`/api/c/${slug}/admin/reservas/${id}/cancelar`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? "" }),
    }),
  adminNoShow: (slug: string, id: string) =>
    req(`/api/c/${slug}/admin/reservas/${id}/non-presentado`, { method: "POST" }),
  selfCheckIn: (slug: string, bookingId: string) =>
    req(`/api/c/${slug}/reservas/${bookingId}/estou-aqui`, { method: "POST" }),
  doorCheckIn: (slug: string, facilityId: string, code: string, date: string) =>
    req<{
      data:
        | {
            state: "checked_in";
            facilityName: string;
            start: string;
            end: string;
            bookingId: string;
          }
        | {
            state: "no_reservation";
            facilityName: string;
            nextBooking?: {
              facilityName: string;
              date: string;
              start: string;
              end: string;
            };
          }
        | {
            state: "too_early";
            facilityName: string;
            start: string;
            end: string;
            checkInFrom: string;
            bookingId: string;
          }
        | {
            state: "passed";
            facilityName: string;
            start: string;
            end: string;
            bookingId: string;
          };
    }>(`/api/c/${slug}/porta/${facilityId}/checkin`, {
      method: "POST",
      body: JSON.stringify({ code, date }),
    }),
  monthlyReport: (slug: string, year: number, month: number) =>
    req<{
      data: {
        year: number;
        month: number;
        totals: Record<string, number>;
        byFacility: Array<{
          name: string;
          confirmed: number;
          checkedIn: number;
          noShow: number;
          cancelled: number;
        }>;
        hourHeat: Array<{ start: string; count: number }>;
      };
    }>(`/api/c/${slug}/admin/informe-mensual?ano=${year}&mes=${month}`),
  monthlyReportCsvUrl: (slug: string, year: number, month: number) =>
    `${import.meta.env.VITE_API_URL ?? ""}/api/c/${slug}/admin/informe-mensual?ano=${year}&mes=${month}&formato=csv`,
  monthlyReportXlsxUrl: (slug: string, year: number, month: number) =>
    `${import.meta.env.VITE_API_URL ?? ""}/api/c/${slug}/admin/informe-mensual?ano=${year}&mes=${month}&formato=xlsx`,
  frictionlessZipUrl: (slug: string, persoais = false) =>
    `${import.meta.env.VITE_API_URL ?? ""}/api/c/${slug}/admin/export/frictionless.zip${persoais ? "?persoais=1" : ""}`,
  activityCsvUrl: (slug: string) =>
    `${import.meta.env.VITE_API_URL ?? ""}/api/c/${slug}/admin/auditoria.csv`,
  listFixedGroups: (slug: string) =>
    req<{
      data: Array<{
        id: string;
        name: string;
        facilityId: string;
        unitId: string;
        weekday: number;
        start: string;
        end: string;
        validFrom: string;
        validTo: string;
        active: boolean;
      }>;
    }>(`/api/c/${slug}/admin/grupos-fixos`),
  createFixedGroup: (
    slug: string,
    body: {
      name: string;
      facilityId: string;
      unitId: string;
      weekday: number;
      start: string;
      end: string;
      validFrom: string;
      validTo: string;
      clubId?: string;
      confirm?: boolean;
    },
  ) =>
    req<{
      data: {
        needsConfirm?: boolean;
        cancelledCount?: number;
        peopleCount?: number;
        matchCount?: number;
        id?: string;
        name?: string;
        active?: boolean;
      };
    }>(`/api/c/${slug}/admin/grupos-fixos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deactivateFixedGroup: (slug: string, id: string) =>
    req(`/api/c/${slug}/admin/grupos-fixos/${id}/desactivar`, { method: "POST" }),
  calendarFeed: (slug: string) =>
    req<{
      data: { token: string; httpsUrl: string; webcalUrl: string };
    }>(`/api/c/${slug}/me/calendario-feed`),
  rotateCalendarFeed: (slug: string) =>
    req<{
      data: { token: string; httpsUrl: string; webcalUrl: string };
    }>(`/api/c/${slug}/me/calendario-feed?rotate=1`),
};

export function icsUrl(slug: string) {
  const base = import.meta.env.VITE_API_URL ?? "";
  return `${base}/api/c/${slug}/fin-de-semana.ics`;
}

export function personalCalendarIcsUrl(slug: string, token: string) {
  const base = import.meta.env.VITE_API_URL ?? "";
  return `${base}/api/c/${slug}/me/calendario.ics?token=${encodeURIComponent(token)}`;
}

export function exportCsvUrl(slug: string) {
  const base = import.meta.env.VITE_API_URL ?? "";
  return `${base}/api/c/${slug}/admin/export?format=csv`;
}

export function geoJsonUrl(slug: string) {
  const base = import.meta.env.VITE_API_URL ?? "";
  return `${base}/api/c/${slug}/datos-abertos/instalacions.geojson`;
}
