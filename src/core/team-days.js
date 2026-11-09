// Días sin equipo (9-nov, punto 5): el domingo 8 llegaron 54 chats y solo 1 aceptó, sin nadie para llamar
// o validar. En esos días Mia deja al interesado con sus documentos enviados para que Captura lo encuentre
// listo el siguiente día hábil. TEAM_OFF_DAYS = días sin equipo (0 = domingo … 6 = sábado), por defecto "0".
const MX_OFFSET_MS = 6 * 3600 * 1000;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function parseOffDays(value = process.env.TEAM_OFF_DAYS ?? "0") {
  return new Set(String(value).split(/[\s,]+/).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6));
}

const mxDate = now => new Date(now.getTime() - MX_OFFSET_MS);
export const mxWeekday = now => mxDate(now).getUTCDay();
export const mxHour = now => mxDate(now).getUTCHours();
export const mxDay = now => mxDate(now).toISOString().slice(0, 10);

export function isTeamOff(now = new Date(), offDays = parseOffDays()) {
  return offDays.has(mxWeekday(now));
}

// "mañana lunes" / "el lunes".
export function nextTeamDay(now = new Date(), offDays = parseOffDays()) {
  const today = mxWeekday(now);
  for (let i = 1; i <= 7; i++) {
    const d = (today + i) % 7;
    if (!offDays.has(d)) return i === 1 ? `mañana ${DAY_NAMES[d]}` : `el ${DAY_NAMES[d]}`;
  }
  return "el siguiente día hábil";
}

export function todayName(now = new Date()) { return DAY_NAMES[mxWeekday(now)]; }
