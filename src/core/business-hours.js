// Horario de atención de Mia por día de la semana.
//
// Formato de AI_SCHEDULE: bloques "días=inicio-fin" separados por ";".
// Días: 0 = domingo … 6 = sábado; se aceptan rangos ("1-5") y listas ("1,3").
// Las horas son enteras en formato 24 h y el fin es exclusivo (18 = hasta las 17:59).
// Un día que no aparece está cerrado.
// Ejemplo (default): "1-5=9-18;6=10-15" → lunes a viernes 9-18, sábado 10-15, domingo cerrado.

export const DEFAULT_SCHEDULE = "1-5=9-18;6=10-15";
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function expandDays(spec) {
  const days = new Set();
  for (const part of String(spec).split(",").map(v => v.trim()).filter(Boolean)) {
    const [a, b = a] = part.split("-").map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > 6 || a > b) throw new Error(`Días inválidos en AI_SCHEDULE: "${part}"`);
    for (let d = a; d <= b; d++) days.add(d);
  }
  return [...days];
}

// Devuelve un arreglo de 7 posiciones (domingo..sábado) con {start, end} o null si cierra.
export function parseSchedule(text = DEFAULT_SCHEDULE) {
  const week = Array(7).fill(null);
  for (const block of String(text).split(";").map(v => v.trim()).filter(Boolean)) {
    const [daysSpec, hours] = block.split("=").map(v => v?.trim());
    const [start, end] = String(hours || "").split("-").map(Number);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) throw new Error(`Horas inválidas en AI_SCHEDULE: "${block}"`);
    for (const day of expandDays(daysSpec)) week[day] = { start, end };
  }
  return week;
}

// Día de la semana, fecha y hora local en la zona horaria indicada.
export function localClock(now = new Date(), timezone = "America/Mexico_City") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now).map(p => [p.type, p.value]));
  return { weekday: WEEKDAYS[parts.weekday], hour: Number(parts.hour) % 24, date: `${parts.year}-${parts.month}-${parts.day}` };
}

export function isOpen(week, now = new Date(), timezone) {
  const clock = localClock(now, timezone);
  const today = week[clock.weekday];
  return Boolean(today && clock.hour >= today.start && clock.hour < today.end);
}

// Fecha local (AAAA-MM-DD) de la siguiente apertura; sirve para avisar una sola vez por periodo cerrado.
export function nextOpeningDate(week, now = new Date(), timezone) {
  for (let h = 0; h <= 8 * 24; h++) {
    const t = new Date(now.getTime() + h * 3600 * 1000);
    if (isOpen(week, t, timezone)) return localClock(t, timezone).date;
  }
  return "sin-horario";
}

function hourLabel(hour) { return `${hour % 12 || 12}:00 ${hour < 12 ? "a.m." : "p.m."}`; }

function dayRange(days) {
  if (days.length === 1) return `${DAY_NAMES[days[0]]}`;
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (consecutive) return `${DAY_NAMES[days[0]]} a ${DAY_NAMES[days.at(-1)]}`;
  return `${days.slice(0, -1).map(d => DAY_NAMES[d]).join(", ")} y ${DAY_NAMES[days.at(-1)]}`;
}

// Texto legible: "lunes a viernes de 9:00 a.m. a 6:00 p.m. y sábado de 10:00 a.m. a 3:00 p.m.".
export function describeSchedule(week) {
  const groups = [];
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const slot = week[day];
    if (!slot) continue;
    const last = groups.at(-1);
    if (last && last.start === slot.start && last.end === slot.end && last.days.at(-1) === day - 1) last.days.push(day);
    else groups.push({ ...slot, days: [day] });
  }
  const parts = groups.map(g => `${dayRange(g.days)} de ${hourLabel(g.start)} a ${hourLabel(g.end)}`);
  if (!parts.length) return "sin horario configurado";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

export function outOfScheduleMessage(week) {
  const text = describeSchedule(week);
  return `¡Gracias por escribir a MARTCOM! Nuestro horario de atención es de ${text}${text.endsWith(".") ? "" : "."} Recibimos tu mensaje y te respondemos en cuanto abramos.`;
}
