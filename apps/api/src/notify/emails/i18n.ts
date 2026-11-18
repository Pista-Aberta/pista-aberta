import type { Locale } from "@pista-aberta/shared";

type Dict = Record<string, string>;

const GL: Dict = {
  "header.reservas": "Reservas deportivas",
  "header.clubs": "Clubs e pavillón",
  "header.panel": "Panel do concello",
  "header.platform": "Pista Aberta",
  "header.deputacion": "Deputación",
  "pill.confirmed": "Confirmada",
  "pill.pending": "Pendente",
  "pill.free": "Libre para ti",
  "pill.reminder": "Recordatorio",
  "pill.invite": "Convite",
  "pill.warning": "Aviso",
  "pill.closure": "Peche",
  "pill.cancelled": "Cancelada",
  "pill.pause": "Pausa",
  "pill.changed": "Cambiada",
  "pill.code": "Código",
  "pill.pause_lifted": "Pausa retirada",
  "pill.season_ok": "Tempada",
  "pill.season_no": "Tempada",
  "hello": "Ola, {name}",
  "helloBare": "Ola!",
  "cta.viewBooking": "Ver a reserva",
  "cta.change": "Cambiar hora",
  "cta.cancel": "Cancelar reserva",
  "cta.addToCalendar": "Engadir ao calendario",
  "cta.howToGet": "Como chegar",
  "cta.acceptInvite": "Aceptar convite",
  "cta.declineOffer": "Xa non a quero",
  "cta.takeOffer": "Reservar esta hora",
  "cta.manageNotices": "Xestionar avisos",
  "cta.privacy": "Privacidade",
  "footer.doubts": "Dúbidas? Responde a este correo ou escribe a {email}",
  "footer.A": "Recibes este aviso porque o activaches en Conta › Avisos.",
  "footer.T": "Este correo é transaccional (non podes darte de baixa).",
  "footer.P": "Este correo é persoal (convite).",
  "footer.unsub": "Non quero recibir estes avisos",
  "footer.sentWith":
    "Enviado con Pista Aberta, software libre (EUPL-1.2) · Privacidade",
  "card.facility": "Instalación",
  "card.court": "Pista",
  "card.address": "Enderezo",
  "card.when": "Cando",
  "card.code": "Código",
  "card.before": "Antes",
  "card.now": "Agora",
  "card.reason": "Motivo",
  "card.rival": "Rival",
  "card.schedules": "Horarios",
  "card.note": "Nota",
  "help.cancelHint":
    "Non podes ir? Cancela e a hora pasa a outra persoa.",
  "otp.expires": "Caduca en 10 minutos.",
  "invite.expires": "Caduca o {date}.",
  "nif.masked": "NIF ···{tail}",
  "meteo.rain": "Aviso de choiva ({chance} %) pola {period}. Datos: MeteoGalicia.",
  "meteo.period.manha": "mañá",
  "meteo.period.tarde": "tarde",
  "meteo.period.noite": "noite",
};

const ES: Dict = {
  "header.reservas": "Reservas deportivas",
  "header.clubs": "Clubs y pabellón",
  "header.panel": "Panel del ayuntamiento",
  "header.platform": "Pista Aberta",
  "header.deputacion": "Diputación",
  "pill.confirmed": "Confirmada",
  "pill.pending": "Pendiente",
  "pill.free": "Libre para ti",
  "pill.reminder": "Recordatorio",
  "pill.invite": "Invitación",
  "pill.warning": "Aviso",
  "pill.closure": "Cierre",
  "pill.cancelled": "Cancelada",
  "pill.pause": "Pausa",
  "pill.changed": "Cambiada",
  "pill.code": "Código",
  "pill.pause_lifted": "Pausa retirada",
  "pill.season_ok": "Temporada",
  "pill.season_no": "Temporada",
  "hello": "Hola, {name}",
  "helloBare": "¡Hola!",
  "cta.viewBooking": "Ver la reserva",
  "cta.change": "Cambiar hora",
  "cta.cancel": "Cancelar reserva",
  "cta.addToCalendar": "Añadir al calendario",
  "cta.howToGet": "Cómo llegar",
  "cta.acceptInvite": "Aceptar invitación",
  "cta.declineOffer": "Ya no la quiero",
  "cta.takeOffer": "Reservar esta hora",
  "cta.manageNotices": "Gestionar avisos",
  "cta.privacy": "Privacidad",
  "footer.doubts": "¿Dudas? Responde a este correo o escribe a {email}",
  "footer.A": "Recibes este aviso porque lo activaste en Cuenta › Avisos.",
  "footer.T": "Este correo es transaccional (no puedes darte de baja).",
  "footer.P": "Este correo es personal (invitación).",
  "footer.unsub": "No quiero recibir estos avisos",
  "footer.sentWith":
    "Enviado con Pista Aberta, software libre (EUPL-1.2) · Privacidad",
  "card.facility": "Instalación",
  "card.court": "Pista",
  "card.address": "Dirección",
  "card.when": "Cuándo",
  "card.code": "Código",
  "card.before": "Antes",
  "card.now": "Ahora",
  "card.reason": "Motivo",
  "card.rival": "Rival",
  "card.schedules": "Horarios",
  "card.note": "Nota",
  "help.cancelHint":
    "¿No puedes ir? Cancela y la hora pasa a otra persona.",
  "otp.expires": "Caduca en 10 minutos.",
  "invite.expires": "Caduca el {date}.",
  "nif.masked": "NIF ···{tail}",
  "meteo.rain": "Aviso de lluvia ({chance} %) por la {period}. Datos: MeteoGalicia.",
  "meteo.period.manha": "mañana",
  "meteo.period.tarde": "tarde",
  "meteo.period.noite": "noche",
};

export function emailT(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const dict = locale === "es" ? ES : GL;
  let s = dict[key] ?? GL[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export function maskNif(nif: string | null | undefined): string {
  const s = (nif ?? "").replace(/\s+/g, "").toUpperCase();
  if (s.length <= 4) return s ? `···${s}` : "····";
  return `···${s.slice(-4)}`;
}
