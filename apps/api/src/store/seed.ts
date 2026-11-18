import { DEMO_MUNICIPALITIES } from "@pista-aberta/shared";
import type {
  Activity,
  ActivityApplication,
  Booking,
  Club,
  Facility,
  MatchSlot,
  Municipality,
  SlotSwap,
  Team,
  TimeSlot,
  Unit,
} from "@pista-aberta/shared";
import { generateLotterySecret, hashSecret } from "./lottery.js";
import {
  DEFAULT_TIMEZONE,
  addDaysIso,
  localDateIso,
  weekendSaturdayIso,
} from "./business-rules.js";

function addDays(iso: string, n: number): string {
  return addDaysIso(iso, n);
}

export interface DemoStore {
  municipalities: Municipality[];
  facilities: Facility[];
  units: Unit[];
  slots: TimeSlot[];
  bookings: Booking[];
  clubs: Club[];
  teams: Team[];
  matches: MatchSlot[];
  swaps: SlotSwap[];
  activities: Activity[];
  applications: ActivityApplication[];
}

export function buildSeed(now: Date = new Date()): DemoStore {
  /* REVISION-43 R1: mesmo sábado que portada /fin-de-semana (domingo = onte). */
  const weekend = weekendSaturdayIso(now, DEFAULT_TIMEZONE);
  const sunday = addDays(weekend, 1);
  const today = localDateIso(now, DEFAULT_TIMEZONE);
  const rollingDates: string[] = [];
  for (let i = 0; i < 14; i++) rollingDates.push(addDays(today, i));

  const municipalities: Municipality[] = DEMO_MUNICIPALITIES.map((m) => ({ ...m }));

  const facilities: Facility[] = [
    {
      id: "fac-exemplo-padel",
      municipalityId: "muni-exemplo",
      name: "Pistas de pádel",
      type: "pista",
      address: "Rúa Maior, 1, 15000 Exemplo",
      lat: 42.785,
      lng: -8.888,
      accessibility: "Aparcadoiro PMR e acceso sen chanzos ao complexo.",
      parkingInfo:
        "Aparcadoiro gratuíto no complexo; praza PMR á esquerda da entrada.",
      publicTransport:
        "Liña urbana «Porto»; parada a 2 min a pé do complexo.",
      entranceInfo:
        "Entrada polo peirao do complexo; conserxaría á dereita.",
      services: ["vestiarios", "auga", "iluminacion"],
      rules: "Máximo 4 persoas por pista de pádel. Cancelar con 2 h de antelación.",
      rulesText: [
        {
          id: "rt-padel-max",
          order: 0,
          gl: "Máximo 4 persoas por pista de pádel.",
          es: "Máximo 4 personas por pista de pádel.",
        },
        {
          id: "rt-padel-calzado",
          order: 1,
          gl: "Calzado axeitado para a superficie da pista.",
          es: "Calzado adecuado para la superficie de la pista.",
        },
      ],
      active: true,
      outdoor: true,
      contactPhone: "981 82 15 10",
      contactEmail: "padel@exemplo.gal",
      contactPerson: "Conserxaría das pistas",
    },
    {
      id: "fac-exemplo-pav",
      municipalityId: "muni-exemplo",
      name: "Pavillón municipal",
      type: "pavillon",
      address: "Rúa das Instalacións, 2, 15000 Exemplo",
      lat: 42.788,
      lng: -8.885,
      accessibility: "Ascensor e baños adaptados no vestíbulo.",
      parkingInfo:
        "Aparcadoiro lateral na Av. da Coruña; praza PMR perante a porta.",
      publicTransport:
        "Parada «Pavillón» das liñas urbanas; 1 min a pé.",
      entranceInfo:
        "Porta principal da Av. da Coruña; conserxaría no vestíbulo.",
      services: ["vestiarios", "marcador", "son", "iluminacion", "aparcadoiro"],
      rules: "Fin de semana prioritario para clubs. Quencemento 15 min.",
      active: true,
      outdoor: false,
      contactPhone: "981 82 15 20",
      contactEmail: "pavillon@exemplo.gal",
      contactPerson: "Conserxaría do pavillón",
    },
    {
      id: "fac-proba-campo",
      municipalityId: "muni-proba",
      name: "Campo de fútbol municipal",
      type: "campo",
      address: "Lugar do Campo, Proba",
      lat: 42.9,
      lng: -8.5,
      accessibility: "Acceso peonil",
      services: ["aparcadoiro", "iluminacion"],
      rules: "Césped artificial. Botas con tacos curtos.",
      active: true,
      outdoor: true,
      contactPhone: null,
      contactEmail: null,
      contactPerson: null,
    },
    {
      id: "fac-proba-sala",
      municipalityId: "muni-proba",
      name: "Sala polideportiva",
      type: "sala",
      address: "Praza Maior 1, Proba",
      lat: 42.901,
      lng: -8.501,
      accessibility: "Rampa de acceso",
      services: ["espellos", "son"],
      rules: "Actividades municipais e reserva veciñal.",
      active: true,
      outdoor: false,
      contactPhone: "981 00 00 11",
      contactEmail: null,
      contactPerson: "Persoa de atención",
    },
  ];

  const units: Unit[] = [
    {
      id: "unit-padel-1",
      facilityId: "fac-exemplo-padel",
      municipalityId: "muni-exemplo",
      name: "Pista pádel 1",
      incompatibleWith: [],
    },
    {
      id: "unit-padel-2",
      facilityId: "fac-exemplo-padel",
      municipalityId: "muni-exemplo",
      name: "Pista pádel 2",
      incompatibleWith: [],
    },
    {
      id: "unit-pav-full",
      facilityId: "fac-exemplo-pav",
      municipalityId: "muni-exemplo",
      name: "Pista completa",
      incompatibleWith: ["unit-pav-a", "unit-pav-b"],
    },
    {
      id: "unit-pav-a",
      facilityId: "fac-exemplo-pav",
      municipalityId: "muni-exemplo",
      name: "Media pista A",
      incompatibleWith: ["unit-pav-full"],
    },
    {
      id: "unit-pav-b",
      facilityId: "fac-exemplo-pav",
      municipalityId: "muni-exemplo",
      name: "Media pista B",
      incompatibleWith: ["unit-pav-full"],
    },
    {
      id: "unit-proba-campo",
      facilityId: "fac-proba-campo",
      municipalityId: "muni-proba",
      name: "Campo completo",
      incompatibleWith: [],
    },
    {
      id: "unit-proba-sala",
      facilityId: "fac-proba-sala",
      municipalityId: "muni-proba",
      name: "Sala",
      incompatibleWith: [],
    },
  ];

  const morning = ["09:00", "10:00", "11:00", "12:00", "13:00"];
  // Ata 22:00 (coherente coa folla do conserxe 08:00–22:00)
  const evening = ["16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
  const slotHours = [...morning, ...evening];
  const slots: TimeSlot[] = [];
  let slotN = 0;
  /** Dedup por (unidade, data, hora) — evita choque historia 28d + semáns previas. */
  const slotKeys = new Set<string>();
  const pushHourSlots = (unitId: string, municipalityId: string, date: string, hours: string[]) => {
    for (let i = 0; i < hours.length - 1; i++) {
      const start = hours[i]!;
      const key = `${unitId}|${date}|${start}`;
      if (slotKeys.has(key)) continue;
      slotKeys.add(key);
      slotN += 1;
      slots.push({
        id: `slot-${slotN}`,
        unitId,
        municipalityId,
        date,
        start,
        end: hours[i + 1]!,
        closed: false,
      });
    }
  };
  for (const date of rollingDates) {
    for (const unit of units.filter((u) => u.municipalityId === "muni-exemplo" && u.facilityId === "fac-exemplo-padel")) {
      pushHourSlots(unit.id, "muni-exemplo", date, morning);
      pushHourSlots(unit.id, "muni-exemplo", date, evening);
    }
    for (const unit of units.filter((u) => u.municipalityId === "muni-proba")) {
      pushHourSlots(unit.id, "muni-proba", date, slotHours.slice(0, 5));
    }
  }
  // Historial 4 semanas → «horas tranquilas» + tendencias (REVISION-11 S5 R5 / Rev24 D10).
  for (let i = 1; i <= 28; i++) {
    const past = addDays(today, -i);
    for (const unit of units.filter(
      (u) => u.municipalityId === "muni-exemplo" && u.facilityId === "fac-exemplo-padel",
    )) {
      pushHourSlots(unit.id, "muni-exemplo", past, morning);
      pushHourSlots(unit.id, "muni-exemplo", past, evening);
    }
    for (const unit of units.filter((u) => u.municipalityId === "muni-proba")) {
      pushHourSlots(unit.id, "muni-proba", past, slotHours.slice(0, 5));
    }
  }
  // REVISION-26 §0: quitouse o bloque REVISION-13 F2 (luns…onte da semana en curso).
  // A historia de 28 días xa cobre esas datas; do martes ao domingo duplicaba e
  // rebentaba o unique (unit_id, date, start).

  // Nomes ficticios do deseño (REVISION-2 §14 — sen clubs reais sen permiso)
  const clubs: Club[] = [
    { id: "club-basquet", municipalityId: "muni-exemplo", name: "Club Deportivo Exemplo", shortName: "CD Exemplo" },
    { id: "club-volei", municipalityId: "muni-exemplo", name: "CV Sarela", shortName: "Sarela" },
    { id: "club-futsal", municipalityId: "muni-exemplo", name: "FS Atlántico", shortName: "Atlántico" },
    { id: "club-patin", municipalityId: "muni-exemplo", name: "HC Costa da Morte", shortName: "Costa" },
    /* REVISION-50 X4 — sen xestores; só etiquetas de visitantes. */
    {
      id: "club-visitante",
      municipalityId: "muni-exemplo",
      name: "Visitante",
      shortName: "Visitante",
    },
  ];

  /* Locais + rivais doutros concellos (Rev24 D9: non club contra si mesmo). */
  const teams: Team[] = [
    { id: "t-b1", clubId: "club-basquet", municipalityId: "muni-exemplo", name: "CD Exemplo Senior", category: "senior" },
    { id: "t-b2", clubId: "club-basquet", municipalityId: "muni-exemplo", name: "CD Exemplo Xuvenil", category: "xuvenil" },
    { id: "t-b3", clubId: "club-basquet", municipalityId: "muni-exemplo", name: "CD Exemplo Cadete", category: "cadete" },
    { id: "t-v1", clubId: "club-volei", municipalityId: "muni-exemplo", name: "Sarela Senior A", category: "senior" },
    { id: "t-v2", clubId: "club-volei", municipalityId: "muni-exemplo", name: "Sarela Senior B", category: "senior" },
    { id: "t-v3", clubId: "club-volei", municipalityId: "muni-exemplo", name: "Sarela Infantil", category: "infantil" },
    { id: "t-f1", clubId: "club-futsal", municipalityId: "muni-exemplo", name: "Atlántico A", category: "senior" },
    { id: "t-f2", clubId: "club-futsal", municipalityId: "muni-exemplo", name: "Atlántico B", category: "senior" },
    { id: "t-f3", clubId: "club-futsal", municipalityId: "muni-exemplo", name: "Atlántico Xuvenil", category: "xuvenil" },
    { id: "t-p1", clubId: "club-patin", municipalityId: "muni-exemplo", name: "Costa Senior", category: "senior" },
    { id: "t-p2", clubId: "club-patin", municipalityId: "muni-exemplo", name: "Costa Xuvenil", category: "xuvenil" },
    { id: "t-p3", clubId: "club-patin", municipalityId: "muni-exemplo", name: "Costa Alevín", category: "alevin" },
    /* REVISION-50 X4: visitantes sen club local (club-visitante). */
    { id: "t-vis-ames", clubId: "club-visitante", municipalityId: "muni-exemplo", name: "CB Ames Senior", category: "senior" },
    { id: "t-vis-out", clubId: "club-visitante", municipalityId: "muni-exemplo", name: "CV Visitante B", category: "senior" },
    { id: "t-vis-rix", clubId: "club-visitante", municipalityId: "muni-exemplo", name: "FS Rianxo", category: "senior" },
    { id: "t-vis-bri", clubId: "club-visitante", municipalityId: "muni-exemplo", name: "HC Brión", category: "xuvenil" },
    { id: "t-vis-por", clubId: "club-visitante", municipalityId: "muni-exemplo", name: "CD Visitante A", category: "cadete" },
    { id: "t-vis-lou", clubId: "club-visitante", municipalityId: "muni-exemplo", name: "CV Lousame", category: "infantil" },
  ];

  /** Rev24 D9: maioría Programado, 1 choque (m1↔m2) para ensinar a función. */
  const matches: MatchSlot[] = [
    {
      id: "m1",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: weekend,
      start: "10:00",
      end: "11:30",
      homeTeamId: "t-b1",
      awayTeamId: "t-vis-ames",
      clubId: "club-basquet",
      status: "conflict",
      conflictWith: ["m2"],
      notes: "Choque: dous partidos na pista completa",
    },
    {
      id: "m2",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: weekend,
      start: "10:15",
      end: "11:45",
      homeTeamId: "t-v1",
      awayTeamId: "t-vis-out",
      clubId: "club-volei",
      status: "conflict",
      conflictWith: ["m1"],
      /* REVISION-47 W7 */
      notes: "Coincide con CD Exemplo Senior",
    },
    /* REVISION-47 W2: sen solapes «Aprobado» incompatíbeis (completa vs medias).
     * Atlántico A tras o Cadete; Costa pola mañá antes do choque. */
    {
      id: "m3",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-a",
      date: weekend,
      start: "13:15",
      end: "14:00",
      homeTeamId: "t-f1",
      awayTeamId: "t-vis-rix",
      clubId: "club-futsal",
      status: "scheduled",
    },
    {
      id: "m4",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-b",
      date: weekend,
      start: "09:00",
      end: "10:00",
      homeTeamId: "t-p1",
      awayTeamId: "t-vis-bri",
      clubId: "club-patin",
      status: "scheduled",
    },
    {
      id: "m5",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: weekend,
      start: "11:45",
      end: "13:15",
      homeTeamId: "t-b3",
      awayTeamId: "t-vis-por",
      clubId: "club-basquet",
      status: "scheduled",
    },
    {
      id: "m6",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-a",
      date: sunday,
      start: "10:00",
      end: "11:15",
      homeTeamId: "t-v3",
      awayTeamId: "t-vis-lou",
      clubId: "club-volei",
      status: "scheduled",
    },
    {
      id: "m7",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: sunday,
      start: "11:30",
      end: "13:00",
      homeTeamId: "t-f2",
      awayTeamId: "t-vis-rix",
      clubId: "club-futsal",
      status: "scheduled",
    },
    /* REVISION-44 S3: domingo pola tarde — «Esta fin de semana no pavillón». */
    {
      id: "m8",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: sunday,
      start: "18:00",
      end: "19:30",
      homeTeamId: "t-b1",
      awayTeamId: "t-vis-por",
      clubId: "club-basquet",
      status: "scheduled",
    },
    /* REVISION-47: fin de semana seguinte (domingo á noite a actual xa pasou). */
    {
      id: "m9",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: addDays(weekend, 7),
      start: "11:00",
      end: "12:30",
      homeTeamId: "t-b3",
      awayTeamId: "t-vis-por",
      clubId: "club-basquet",
      status: "scheduled",
    },
    {
      id: "m10",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-a",
      date: addDays(weekend, 7),
      start: "12:45",
      end: "14:00",
      homeTeamId: "t-f1",
      awayTeamId: "t-vis-rix",
      clubId: "club-futsal",
      status: "scheduled",
    },
    {
      id: "m11",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-b",
      date: addDays(weekend, 8),
      start: "10:00",
      end: "11:15",
      homeTeamId: "t-v3",
      awayTeamId: "t-vis-lou",
      clubId: "club-volei",
      status: "scheduled",
    },
    {
      id: "m12",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-full",
      date: addDays(weekend, 8),
      start: "11:30",
      end: "13:00",
      homeTeamId: "t-b1",
      awayTeamId: "t-vis-ames",
      clubId: "club-basquet",
      status: "scheduled",
    },
  ];

  // Segredo aleatorio por actividade: o hash publícase ao abrir inscricións;
  // o segredo gárdase na BD e só se revela ao sortear (API filtra ata "drawn").
  const lotterySecret = generateLotterySecret();
  const lotterySecretOpen = generateLotterySecret();
  const activities: Activity[] = [
    {
      id: "act-multi",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      name: "Multideporte infantil",
      description: "Iniciación a varios deportes. Sorteo público verificable.",
      days: "Martes e xoves",
      hours: "17:00–18:30",
      places: 12,
      ageMin: 6,
      ageMax: 12,
      method: "lottery",
      deadline: addDays(today, 7),
      lotteryStatus: "closed",
      lotterySeedHash: hashSecret(lotterySecret),
      lotterySecret,
      lotteryResultOrder: null,
    },
    {
      id: "act-padel-iniciacion",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-padel",
      name: "Iniciación ao pádel",
      description: "Inscrición por orde de chegada. Material básico cedido.",
      days: "Luns e mércores",
      hours: "18:00–19:00",
      places: 16,
      ageMin: 14,
      ageMax: 99,
      method: "first_come",
      deadline: addDays(today, 21),
      lotteryStatus: "open",
      lotterySeedHash: null,
      lotterySecret: null,
      lotteryResultOrder: null,
    },
    {
      id: "act-basquet-escola",
      municipalityId: "muni-exemplo",
      facilityId: "fac-exemplo-pav",
      name: "Escola de baloncesto",
      description: "Praza por sorteo público verificable.",
      days: "Martes e xoves",
      hours: "16:30–18:00",
      places: 20,
      ageMin: 8,
      ageMax: 14,
      method: "lottery",
      deadline: addDays(today, 14),
      lotteryStatus: "open",
      lotterySeedHash: hashSecret(lotterySecretOpen),
      lotterySecret: lotterySecretOpen,
      lotteryResultOrder: null,
    },
    {
      id: "act-ex-yoga",
      municipalityId: "muni-proba",
      facilityId: "fac-proba-sala",
      name: "Ioga matinal",
      description: "Praza por orde de chegada.",
      days: "Luns, mércores, venres",
      hours: "09:00–10:00",
      places: 20,
      ageMin: 16,
      ageMax: 99,
      method: "first_come",
      deadline: addDays(today, 14),
      lotteryStatus: "open",
      lotterySeedHash: null,
      lotterySecret: null,
      lotteryResultOrder: null,
    },
  ];

  const applications: ActivityApplication[] = [
    /* REVISION-51 C1: Ana inscrita a Carla (6–12) no Multideporte. */
    mkApp("app-1", "act-multi", "req-1001", "renovacion", "user-cidada", {
      id: "fam-1",
      name: "Carla Familiar",
    }),
    mkApp("app-2", "act-multi", "req-1002", "renovacion", "otp-demo"),
    mkApp("app-3", "act-multi", "req-1003", "sorteo", "u-a"),
    mkApp("app-4", "act-multi", "req-1004", "sorteo", "u-b"),
    mkApp("app-5", "act-multi", "req-1005", "sorteo", "u-c"),
    mkApp("app-6", "act-multi", "req-1006", "sorteo", "u-d"),
    mkApp("app-7", "act-multi", "req-1007", "sorteo", "u-e"),
    mkApp("app-8", "act-multi", "req-1008", "sorteo", "u-f"),
    mkApp("app-9", "act-multi", "req-1009", "sorteo", "u-g"),
    mkApp("app-10", "act-multi", "req-1010", "sorteo", "u-h"),
    mkApp("app-11", "act-multi", "req-1011", "sorteo", "u-i"),
    mkApp("app-12", "act-multi", "req-1012", "sorteo", "u-j"),
    mkApp("app-13", "act-multi", "req-1013", "sorteo", "u-k"),
    mkApp("app-14", "act-multi", "req-1014", "sorteo", "u-l"),
    mkApp("app-15", "act-multi", "req-1015", "sorteo", "u-m"),
    mkApp("app-b1", "act-basquet-escola", "req-2001", "sorteo", "u-a"),
    mkApp("app-b2", "act-basquet-escola", "req-2002", "sorteo", "u-b"),
    mkApp("app-b3", "act-basquet-escola", "req-2003", "sorteo", "u-c"),
    mkApp("app-b4", "act-basquet-escola", "req-2004", "sorteo", "u-d"),
    mkApp("app-b5", "act-basquet-escola", "req-2005", "sorteo", "u-e"),
    mkApp("app-b6", "act-basquet-escola", "req-2006", "sorteo", "u-f"),
  ];

  /* REVISION-47 W2: calcular choques coa mesma regra de solape/unidades
   * incompatíbeis (completa ↔ medias). Os «Aprobado» non deben solapar sen marcar. */
  const annotated = annotateSeedMatchConflicts(matches, units);

  return {
    municipalities,
    facilities,
    units,
    slots,
    bookings: [],
    clubs,
    teams,
    matches: annotated,
    swaps: [],
    activities,
    applications,
  };
}

const APPROVED_MATCH_STATUSES = new Set([
  "scheduled",
  "resolved",
  "swapped",
  "moved",
]);

function hmToMin(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function seedTimesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  return hmToMin(aStart) < hmToMin(bEnd) && hmToMin(bStart) < hmToMin(aEnd);
}

function unitsIncompatible(
  a: Unit | undefined,
  b: Unit | undefined,
  aId: string,
  bId: string,
): boolean {
  if (aId === bId) return true;
  if (a?.incompatibleWith?.includes(bId)) return true;
  if (b?.incompatibleWith?.includes(aId)) return true;
  return false;
}

/** Pares incompatíbeis que se pisan e non están marcados como choque. */
export function unmarkedApprovedOverlaps(
  matches: MatchSlot[],
  units: Unit[],
): Array<{ a: string; b: string }> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const a = matches[i]!;
    if (!APPROVED_MATCH_STATUSES.has(a.status)) continue;
    for (let j = i + 1; j < matches.length; j++) {
      const b = matches[j]!;
      if (!APPROVED_MATCH_STATUSES.has(b.status)) continue;
      if (a.date !== b.date) continue;
      if (
        !unitsIncompatible(byId.get(a.unitId), byId.get(b.unitId), a.unitId, b.unitId)
      ) {
        continue;
      }
      if (!seedTimesOverlap(a.start, a.end, b.start, b.end)) continue;
      out.push({ a: a.id, b: b.id });
    }
  }
  return out;
}

function annotateSeedMatchConflicts(
  matches: MatchSlot[],
  units: Unit[],
): MatchSlot[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const conflictMap = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    let s = conflictMap.get(id);
    if (!s) {
      s = new Set<string>();
      conflictMap.set(id, s);
    }
    return s;
  };

  for (let i = 0; i < matches.length; i++) {
    const a = matches[i]!;
    for (let j = i + 1; j < matches.length; j++) {
      const b = matches[j]!;
      if (a.date !== b.date) continue;
      if (
        !unitsIncompatible(byId.get(a.unitId), byId.get(b.unitId), a.unitId, b.unitId)
      ) {
        continue;
      }
      if (!seedTimesOverlap(a.start, a.end, b.start, b.end)) continue;
      ensure(a.id).add(b.id);
      ensure(b.id).add(a.id);
    }
  }

  return matches.map((m) => {
    const computed = conflictMap.get(m.id);
    const manual = new Set(m.conflictWith ?? []);
    if (computed) for (const id of computed) manual.add(id);
    const conflictWith = [...manual];
    if (conflictWith.length === 0) return { ...m, conflictWith: m.conflictWith ?? [] };
    /* Só forzar «conflict» se xa o era ou se era aprobado e o cálculo detectou choque.
     * (os m1/m2 manuais quedan; un aprobado con choque pasaríase a conflict). */
    if (APPROVED_MATCH_STATUSES.has(m.status) && computed && computed.size > 0) {
      return { ...m, status: "conflict", conflictWith };
    }
    return { ...m, conflictWith };
  });
}

function mkApp(
  id: string,
  activityId: string,
  applicationNumber: string,
  priorityGroup: "renovacion" | "sorteo",
  userId: string,
  forMember?: { id: string; name: string },
): ActivityApplication {
  return {
    id,
    activityId,
    municipalityId: "muni-exemplo",
    userId,
    forMemberId: forMember?.id ?? null,
    forMemberName: forMember?.name ?? null,
    applicationNumber,
    priorityGroup,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

/** @deprecated Eliminado: cada actividade ten segredo aleatorio propio. */
export const DEMO_LOTTERY_SECRET = "";
