import { FormEvent, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Body, PairLongitude, SiderealTime, SunPosition } from "astronomy-engine";
import tzLookup from "tz-lookup";

type PlanetPosition = {
  key: string;
  label: string;
  symbol: string;
  color: string;
  longitude: number;
  retrograde: boolean;
};

type Aspect = {
  pair: string;
  fromLabel: string;
  toLabel: string;
  type: string;
  targetAngle: number;
  separation: number;
  orb: number;
  orbLimit: number;
  trend: "Applying" | "Separating";
  color: string;
  from: string;
  to: string;
};

type House = {
  house: number;
  cusp: number;
  signName: string;
};

type ChartData = {
  utcDate: Date;
  timezoneId: string | null;
  timezoneOffset: number;
  locationLabel: string;
  latitude: number;
  longitude: number;
  moonPhase: string;
  ascendant: number;
  descendant: number;
  midheaven: number;
  imumCoeli: number;
  houses: House[];
  planets: PlanetPosition[];
  aspects: Aspect[];
};

type TimeBuildResult = {
  utcDate: Date;
  resolvedOffset: number;
};

type GeocodeResult = {
  latitude: number;
  longitude: number;
  label: string;
  timezoneId: string | null;
  provider: "nominatim" | "open-meteo";
};

const ZODIAC_SIGNS = [
  { name: "Bạch Dương", symbol: "Ar" },
  { name: "Kim Ngưu", symbol: "Ta" },
  { name: "Song Tử", symbol: "Ge" },
  { name: "Cự Giải", symbol: "Ca" },
  { name: "Sư Tử", symbol: "Le" },
  { name: "Xử Nữ", symbol: "Vi" },
  { name: "Thiên Bình", symbol: "Li" },
  { name: "Bọ Cạp", symbol: "Sc" },
  { name: "Nhân Mã", symbol: "Sg" },
  { name: "Ma Kết", symbol: "Cp" },
  { name: "Bảo Bình", symbol: "Aq" },
  { name: "Song Ngư", symbol: "Pi" }
];

const PLANETS: Array<Omit<PlanetPosition, "longitude" | "retrograde"> & { body: Body }> = [
  { key: "sun", label: "Mặt Trời", symbol: "Sun", body: Body.Sun, color: "#f59e0b" },
  { key: "moon", label: "Mặt Trăng", symbol: "Moon", body: Body.Moon, color: "#cbd5e1" },
  { key: "mercury", label: "Thủy Tinh", symbol: "Me", body: Body.Mercury, color: "#93c5fd" },
  { key: "venus", label: "Kim Tinh", symbol: "Ve", body: Body.Venus, color: "#f9a8d4" },
  { key: "mars", label: "Hỏa Tinh", symbol: "Ma", body: Body.Mars, color: "#f87171" },
  { key: "jupiter", label: "Mộc Tinh", symbol: "Ju", body: Body.Jupiter, color: "#fb923c" },
  { key: "saturn", label: "Thổ Tinh", symbol: "Sa", body: Body.Saturn, color: "#fde68a" },
  { key: "uranus", label: "Thiên Vương", symbol: "Ur", body: Body.Uranus, color: "#67e8f9" },
  { key: "neptune", label: "Hải Vương", symbol: "Ne", body: Body.Neptune, color: "#a5b4fc" },
  { key: "pluto", label: "Diêm Vương", symbol: "Pl", body: Body.Pluto, color: "#d8b4fe" }
];

const ASPECTS = [
  { type: "Conjunction", angle: 0, orb: 8, color: "#f8fafc" },
  { type: "Sextile", angle: 60, orb: 4, color: "#22d3ee" },
  { type: "Square", angle: 90, orb: 6, color: "#fb7185" },
  { type: "Trine", angle: 120, orb: 6, color: "#4ade80" },
  { type: "Opposition", angle: 180, orb: 8, color: "#f97316" }
];

const normalizeDegree = (value: number) => {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const signedSeparation = (a: number, b: number) => {
  return ((b - a + 540) % 360) - 180;
};

const formatLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const formatLocalTime = (date: Date) => {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

const getOffsetHours = (date: Date, timeZoneId: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZoneId,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const part = formatter.formatToParts(date).find((item) => item.type === "timeZoneName")?.value ?? "UTC+0";
  const match = part.match(/(?:GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?/i);

  if (!match) return 0;

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const sign = hour >= 0 ? 1 : -1;
  return hour + sign * minute / 60;
};

const formatOffset = (offset: number) => {
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const hours = Math.floor(absolute);
  const minutes = Math.round((absolute - hours) * 60);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
};

const parseDateTimeInput = (dateValue: string, timeValue: string) => {
  const [year, month, day] = dateValue.split("-").map(Number);
  const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

  if (!timePattern.test(timeValue)) {
    throw new Error("Giờ sinh phải theo định dạng 24h HH:mm (00:00 - 23:59).");
  }

  const [hour, minute] = timeValue.split(":").map(Number);

  if ([year, month, day, hour, minute].some((value) => Number.isNaN(value))) {
    throw new Error("Ngày giờ không hợp lệ.");
  }

  return { year, month, day, hour, minute };
};

const buildUtcDate = (
  dateValue: string,
  timeValue: string,
  manualOffset: number,
  timeZoneId: string | null
): TimeBuildResult => {
  const { year, month, day, hour, minute } = parseDateTimeInput(dateValue, timeValue);
  const localMillis = Date.UTC(year, month - 1, day, hour, minute);

  if (!timeZoneId) {
    return {
      utcDate: new Date(localMillis - manualOffset * 60 * 60 * 1000),
      resolvedOffset: manualOffset
    };
  }

  // Iterate offset because historical DST can change around the target instant.
  let candidateUtc = localMillis - manualOffset * 60 * 60 * 1000;
  for (let i = 0; i < 4; i += 1) {
    const offset = getOffsetHours(new Date(candidateUtc), timeZoneId);
    const refined = localMillis - offset * 60 * 60 * 1000;
    if (Math.abs(refined - candidateUtc) < 1000) {
      candidateUtc = refined;
      break;
    }
    candidateUtc = refined;
  }

  return {
    utcDate: new Date(candidateUtc),
    resolvedOffset: getOffsetHours(new Date(candidateUtc), timeZoneId)
  };
};

const getSignBreakdown = (longitude: number) => {
  const safeLongitude = normalizeDegree(longitude);
  const signIndex = Math.floor(safeLongitude / 30);
  const inSign = safeLongitude - signIndex * 30;
  const degree = Math.floor(inSign);
  const minutes = Math.floor((inSign - degree) * 60);

  return {
    signIndex,
    sign: ZODIAC_SIGNS[signIndex],
    degree,
    minutes
  };
};

const moonPhaseFromPair = (moonRelativeSun: number) => {
  const phase = normalizeDegree(moonRelativeSun);
  if (phase < 22.5 || phase >= 337.5) return "Trăng mới";
  if (phase < 67.5) return "Trăng lưỡi liềm đầu tháng";
  if (phase < 112.5) return "Thượng huyền";
  if (phase < 157.5) return "Trăng khuyết đầu";
  if (phase < 202.5) return "Trăng tròn";
  if (phase < 247.5) return "Trăng khuyết cuối";
  if (phase < 292.5) return "Hạ huyền";
  return "Trăng lưỡi liềm cuối tháng";
};

const calcObliquity = (date: Date) => {
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  const T = (julianDay - 2451545) / 36525;
  return 23 + 26 / 60 + 21.448 / 3600 - (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
};

const calcAngles = (utcDate: Date, latitude: number, longitude: number) => {
  const epsilon = (calcObliquity(utcDate) * Math.PI) / 180;
  const lstDegrees = normalizeDegree(SiderealTime(utcDate) * 15 + longitude);
  const lst = (lstDegrees * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;

  const ascendant = normalizeDegree(
    (Math.atan2(Math.cos(lst), -(Math.sin(lst) * Math.cos(epsilon) + Math.tan(lat) * Math.sin(epsilon))) * 180) /
      Math.PI
  );

  const midheaven = normalizeDegree((Math.atan2(Math.sin(lst) * Math.cos(epsilon), Math.cos(lst)) * 180) / Math.PI);
  const descendant = normalizeDegree(ascendant + 180);
  const imumCoeli = normalizeDegree(midheaven + 180);

  return { ascendant, descendant, midheaven, imumCoeli };
};

const buildWholeSignHouses = (ascendant: number) => {
  const ascSign = Math.floor(normalizeDegree(ascendant) / 30);
  const houses: House[] = [];

  for (let i = 0; i < 12; i += 1) {
    const cusp = normalizeDegree((ascSign + i) * 30);
    const sign = ZODIAC_SIGNS[Math.floor(cusp / 30)];
    houses.push({
      house: i + 1,
      cusp,
      signName: sign.name
    });
  }

  return houses;
};

const calculateChart = (
  utcDate: Date,
  latitude: number,
  longitude: number,
  locationLabel: string,
  timezoneId: string | null,
  timezoneOffset: number
): ChartData => {
  const sunLongitude = normalizeDegree(SunPosition(utcDate).elon);
  const angles = calcAngles(utcDate, latitude, longitude);
  const nextDate = new Date(utcDate.getTime() + 24 * 60 * 60 * 1000);
  const nextSunLongitude = normalizeDegree(SunPosition(nextDate).elon);
  const nextLongitudeMap = new Map<string, number>();

  const planets = PLANETS.map((planet) => {
    const longitudeNow =
      planet.body === Body.Sun
        ? sunLongitude
        : normalizeDegree(sunLongitude + PairLongitude(planet.body, Body.Sun, utcDate));

    const longitudeNext =
      planet.body === Body.Sun
        ? nextSunLongitude
        : normalizeDegree(nextSunLongitude + PairLongitude(planet.body, Body.Sun, nextDate));

    nextLongitudeMap.set(planet.key, longitudeNext);

    return {
      ...planet,
      longitude: longitudeNow,
      retrograde: signedSeparation(longitudeNow, longitudeNext) < 0
    };
  });

  const aspects: Aspect[] = [];
  for (let i = 0; i < planets.length; i += 1) {
    for (let j = i + 1; j < planets.length; j += 1) {
      const separation = Math.abs(signedSeparation(planets[i].longitude, planets[j].longitude));
      for (const aspect of ASPECTS) {
        const orb = Math.abs(separation - aspect.angle);
        if (orb <= aspect.orb) {
          const nextSeparation = Math.abs(
            signedSeparation(nextLongitudeMap.get(planets[i].key) ?? planets[i].longitude, nextLongitudeMap.get(planets[j].key) ?? planets[j].longitude)
          );
          const currentDelta = Math.abs(separation - aspect.angle);
          const nextDelta = Math.abs(nextSeparation - aspect.angle);

          aspects.push({
            pair: `${planets[i].label} - ${planets[j].label}`,
            fromLabel: planets[i].label,
            toLabel: planets[j].label,
            type: aspect.type,
            targetAngle: aspect.angle,
            separation,
            orb,
            orbLimit: aspect.orb,
            trend: nextDelta < currentDelta ? "Applying" : "Separating",
            color: aspect.color,
            from: planets[i].key,
            to: planets[j].key
          });
          break;
        }
      }
    }
  }

  return {
    utcDate,
    timezoneId,
    timezoneOffset,
    locationLabel,
    latitude,
    longitude,
    moonPhase: moonPhaseFromPair(PairLongitude(Body.Moon, Body.Sun, utcDate)),
    ascendant: angles.ascendant,
    descendant: angles.descendant,
    midheaven: angles.midheaven,
    imumCoeli: angles.imumCoeli,
    houses: buildWholeSignHouses(angles.ascendant),
    planets,
    aspects: aspects.sort((a, b) => a.orb - b.orb)
  };
};

const anglePoint = (longitude: number, radius: number) => {
  // Longitude increases counterclockwise in astrology charts.
  const angle = ((longitude + 90) * Math.PI) / 180;
  return {
    x: 250 + radius * Math.cos(angle),
    y: 250 - radius * Math.sin(angle)
  };
};

const zodiacLabelPosition = (index: number, radius: number) => {
  return anglePoint(index * 30 + 15, radius);
};

const buildPlanetRadiusMap = (planets: PlanetPosition[]) => {
  const map = new Map<string, number>();
  const sorted = [...planets].sort((a, b) => a.longitude - b.longitude);
  let stack = 0;

  sorted.forEach((planet, index) => {
    if (index === 0) {
      stack = 0;
    } else {
      const previous = sorted[index - 1];
      const gap = planet.longitude - previous.longitude;
      stack = gap < 8 ? Math.min(stack + 1, 4) : 0;
    }
    map.set(planet.key, 190 - stack * 14);
  });

  return map;
};

const ChartWheel = ({
  planets,
  aspects,
  houses,
  ascendant,
  descendant,
  midheaven,
  imumCoeli
}: {
  planets: PlanetPosition[];
  aspects: Aspect[];
  houses: House[];
  ascendant: number;
  descendant: number;
  midheaven: number;
  imumCoeli: number;
}) => {
  const radiusMap = useMemo(() => buildPlanetRadiusMap(planets), [planets]);
  const byKey = useMemo(() => new Map(planets.map((planet) => [planet.key, planet])), [planets]);

  const ascOuter = anglePoint(ascendant, 232);
  const dcOuter = anglePoint(descendant, 232);
  const mcOuter = anglePoint(midheaven, 232);
  const icOuter = anglePoint(imumCoeli, 232);

  return (
    <svg viewBox="0 0 500 500" className="mx-auto w-full max-w-[560px]">
      <circle cx="250" cy="250" r="230" fill="none" stroke="#475569" strokeWidth="1.5" />
      <circle cx="250" cy="250" r="200" fill="none" stroke="#64748b" strokeWidth="1" strokeDasharray="3 4" />
      <circle cx="250" cy="250" r="145" fill="none" stroke="#334155" strokeWidth="1" />

      {houses.map((house) => {
        const from = anglePoint(house.cusp, 145);
        const to = anglePoint(house.cusp, 230);
        return <line key={`house-${house.house}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#1e293b" strokeWidth="1" />;
      })}

      {ZODIAC_SIGNS.map((sign, index) => {
        const boundaryPoint = anglePoint(index * 30, 230);
        const labelPos = zodiacLabelPosition(index, 214);

        return (
          <g key={sign.name}>
            <line x1="250" y1="250" x2={boundaryPoint.x} y2={boundaryPoint.y} stroke="#334155" strokeWidth="1" />
            <text x={labelPos.x} y={labelPos.y} textAnchor="middle" dominantBaseline="middle" fill="#cbd5e1" fontSize="12">
              {sign.symbol}
            </text>
          </g>
        );
      })}

      {aspects.map((aspect) => {
        const fromPlanet = byKey.get(aspect.from);
        const toPlanet = byKey.get(aspect.to);
        if (!fromPlanet || !toPlanet) return null;

        const from = anglePoint(fromPlanet.longitude, 130);
        const to = anglePoint(toPlanet.longitude, 130);

        return (
          <line
            key={`${aspect.from}-${aspect.to}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={aspect.color}
            strokeWidth="1.2"
            strokeOpacity="0.55"
          />
        );
      })}

      <line x1={ascOuter.x} y1={ascOuter.y} x2={dcOuter.x} y2={dcOuter.y} stroke="#22d3ee" strokeWidth="2" />
      <line x1={mcOuter.x} y1={mcOuter.y} x2={icOuter.x} y2={icOuter.y} stroke="#f59e0b" strokeWidth="2" />

      <text x={ascOuter.x} y={ascOuter.y - 12} textAnchor="middle" fill="#22d3ee" fontSize="11" fontWeight="700">
        AC
      </text>
      <text x={dcOuter.x} y={dcOuter.y - 12} textAnchor="middle" fill="#22d3ee" fontSize="11" fontWeight="700">
        DC
      </text>
      <text x={mcOuter.x} y={mcOuter.y - 12} textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="700">
        MC
      </text>
      <text x={icOuter.x} y={icOuter.y - 12} textAnchor="middle" fill="#f59e0b" fontSize="11" fontWeight="700">
        IC
      </text>

      {planets.map((planet) => {
        const radius = radiusMap.get(planet.key) ?? 190;
        const point = anglePoint(planet.longitude, radius);

        return (
          <g key={planet.key}>
            <circle cx={point.x} cy={point.y} r="12" fill="#0f172a" stroke={planet.color} strokeWidth="1.2" />
            <text
              x={point.x}
              y={point.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={planet.color}
              fontSize="8.5"
              fontWeight="700"
            >
              {planet.symbol}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

const displayAngle = (longitude: number) => {
  const detail = getSignBreakdown(longitude);
  return `${detail.sign.name} ${detail.degree}°${String(detail.minutes).padStart(2, "0")}`;
};

const formatReportTimestamp = (date: Date) => {
  return new Intl.DateTimeFormat("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC"
  }).format(date);
};

const buildChartReport = (chart: ChartData, senderName: string, question: string) => {
  const planetLines = chart.planets
    .map((planet) => `- ${planet.label}: ${displayAngle(planet.longitude)}${planet.retrograde ? " (Nghich hanh)" : ""}`)
    .join("\n");

  const aspectLines = chart.aspects
    .map(
      (aspect) =>
        `- ${aspect.fromLabel} - ${aspect.toLabel}: ${aspect.type} | Goc thuc ${aspect.separation.toFixed(2)}° | Orb ${aspect.orb.toFixed(2)}° | ${aspect.trend}`
    )
    .join("\n");

  return [
    "BAO CAO BAN DO SAO GUI AI LUAN GIAI",
    "",
    `Nguoi yeu cau: ${senderName}`,
    `Dia diem sinh: ${chart.locationLabel}`,
    `Toa do: ${chart.latitude.toFixed(4)}, ${chart.longitude.toFixed(4)}`,
    `Moc thoi gian UTC: ${formatReportTimestamp(chart.utcDate)} UTC`,
    `Mui gio su dung: ${chart.timezoneId ?? "Thu cong"} (${formatOffset(chart.timezoneOffset)})`,
    `Pha Mat Trang: ${chart.moonPhase}`,
    `AC: ${displayAngle(chart.ascendant)}`,
    `DC: ${displayAngle(chart.descendant)}`,
    `MC: ${displayAngle(chart.midheaven)}`,
    `IC: ${displayAngle(chart.imumCoeli)}`,
    "",
    "VI TRI HANH TINH",
    planetLines,
    "",
    "GOC CHIEU NOI BAT",
    aspectLines || "- Khong co goc chieu trong nguong orb.",
    "",
    "CAU HOI CAN AI LUAN GIAI",
    question
  ].join("\n");
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const fetchJson = async <T,>(url: string) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
};

const geocodeWithNominatim = async (query: string): Promise<GeocodeResult> => {
  const encoded = encodeURIComponent(query);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&accept-language=vi&q=${encoded}`;
  const results = await fetchJson<Array<{ lat: string; lon: string; display_name: string }>>(url);
  const first = results[0];

  if (!first) {
    throw new Error("Khong tim thay dia diem nay.");
  }

  const latitude = Number(first.lat);
  const longitude = Number(first.lon);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new Error("Du lieu toa do tu Nominatim khong hop le.");
  }

  return {
    latitude,
    longitude,
    label: first.display_name,
    timezoneId: null,
    provider: "nominatim"
  };
};

const geocodeWithOpenMeteo = async (query: string): Promise<GeocodeResult> => {
  const encoded = encodeURIComponent(query);
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=1&language=vi&format=json`;
  const payload = await fetchJson<{
    results?: Array<{ latitude: number; longitude: number; name: string; country?: string; admin1?: string; timezone?: string }>;
  }>(url);

  const first = payload.results?.[0];
  if (!first) {
    throw new Error("Khong tim thay dia diem nay.");
  }

  const labelParts = [first.name, first.admin1, first.country].filter(Boolean);
  return {
    latitude: first.latitude,
    longitude: first.longitude,
    label: labelParts.join(", "),
    timezoneId: first.timezone ?? null,
    provider: "open-meteo"
  };
};

const fieldClass =
  "w-full rounded-lg border border-slate-600/80 bg-slate-950/90 px-3 py-2.5 text-slate-100 outline-none ring-sky-300 transition placeholder:text-slate-500 focus:border-sky-300 focus:ring";
const labelClass = "text-xs font-medium uppercase tracking-[0.08em] text-slate-300";

export default function App() {
  const now = useMemo(() => new Date(), []);
  const localOffset = useMemo(() => -now.getTimezoneOffset() / 60, [now]);

  const [birthDate, setBirthDate] = useState(formatLocalDate(now));
  const [birthTime, setBirthTime] = useState(formatLocalTime(now));
  const [timezone, setTimezone] = useState(localOffset.toString());
  const [birthPlace, setBirthPlace] = useState("Ha Noi");
  const [latitude, setLatitude] = useState("21.0285");
  const [longitude, setLongitude] = useState("105.8542");
  const [timeZoneId, setTimeZoneId] = useState<string | null>("Asia/Bangkok");
  const [locationLabel, setLocationLabel] = useState("Ha Noi, Viet Nam");
  const [chart, setChart] = useState<ChartData | null>(null);
  const [error, setError] = useState("");
  const [geocodeNote, setGeocodeNote] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [senderName, setSenderName] = useState("Người dùng Astral Chart VN");
  const [question, setQuestion] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Chào bạn, tôi là AI luận giải chiêm tinh. Hãy tạo chart, đặt câu hỏi và tôi sẽ phân tích dựa trên toàn bộ dữ liệu bản đồ sao của bạn."
    }
  ]);
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [shareStatus, setShareStatus] = useState("");

  const resolvePlace = async () => {
    if (!birthPlace.trim()) {
      setError("Vui lòng nhập nơi sinh trước khi tìm vị trí.");
      return;
    }

    setError("");
    setGeocodeNote("");
    setIsGeocoding(true);

    try {
      const query = birthPlace.trim();
      let geo: GeocodeResult;

      try {
        geo = await geocodeWithNominatim(query);
      } catch {
        geo = await geocodeWithOpenMeteo(query);
      }

      const tzId = geo.timezoneId ?? tzLookup(geo.latitude, geo.longitude);
      const previewOffset = getOffsetHours(now, tzId);

      setLatitude(geo.latitude.toFixed(6));
      setLongitude(geo.longitude.toFixed(6));
      setTimeZoneId(tzId);
      setTimezone(previewOffset.toString());
      setLocationLabel(geo.label);
      setGeocodeNote(`Đã tìm vị trí từ ${geo.provider}: ${geo.label}`);
    } catch (reason) {
      const message =
        reason instanceof Error && reason.name === "AbortError"
          ? "Hết thời gian kết nối. Thử lại hoặc nhập tay vĩ độ, kinh độ."
          : "Không thể tìm tọa độ từ API. Bạn vẫn có thể nhập tay vĩ độ, kinh độ và timezone.";
      setError(message);
    } finally {
      setIsGeocoding(false);
    }
  };

  const createChart = (event: FormEvent) => {
    event.preventDefault();
    setError("");

    try {
      const lat = Number(latitude);
      const lon = Number(longitude);
      const offset = Number(timezone);

      if (Number.isNaN(lat) || lat < -90 || lat > 90) {
        throw new Error("Vĩ độ phải nằm trong khoảng -90 đến 90.");
      }

      if (Number.isNaN(lon) || lon < -180 || lon > 180) {
        throw new Error("Kinh độ phải nằm trong khoảng -180 đến 180.");
      }

      if (Number.isNaN(offset) || offset < -12 || offset > 14) {
        throw new Error("UTC offset phải nằm trong khoảng -12 đến +14.");
      }

      const timed = buildUtcDate(birthDate, birthTime, offset, timeZoneId);
      const finalLabel = locationLabel || birthPlace || "Không rõ địa điểm";

      const result = calculateChart(timed.utcDate, lat, lon, finalLabel, timeZoneId, timed.resolvedOffset);
      setChart(result);
      setShareStatus("");
      setChatMessages((prev) =>
        prev.length > 1
          ? [
              prev[0],
              {
                role: "assistant",
                content: "Đã cập nhật chart mới. Bạn có thể đặt câu hỏi để tôi luận giải theo dữ liệu vừa tính."
              }
            ]
          : prev
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Không thể lập bản đồ sao với dữ liệu hiện tại.";
      setError(message);
    }
  };

  const askAi = async (event: FormEvent) => {
    event.preventDefault();

    if (!chart) {
      setShareStatus("Hãy tạo bản đồ sao trước khi trò chuyện với AI.");
      return;
    }

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setShareStatus("Vui lòng nhập câu hỏi trước khi gửi cho AI.");
      return;
    }

    const userMessage: ChatMessage = {
      role: "user",
      content: trimmedQuestion
    };

    const nextMessages = [...chatMessages, userMessage];
    setChatMessages(nextMessages);
    setQuestion("");
    setIsAskingAi(true);
    setShareStatus("");

    try {
      const chartReport = buildChartReport(chart, senderName.trim() || "Người dùng", trimmedQuestion);
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: nextMessages,
          chartReport
        })
      });

      const payload = (await response.json()) as { reply?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Không thể kết nối AI.");
      }

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: payload.reply || "AI chưa trả về nội dung."
        }
      ]);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Có lỗi khi gọi AI.";
      setShareStatus(message);
    } finally {
      setIsAskingAi(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 antialiased">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-3.5 md:px-10">
          <p className="inline-flex items-center rounded-md border border-sky-300/35 bg-sky-300/10 px-3 py-1 text-xs font-semibold tracking-[0.16em] text-sky-200">
            ASTRAL CHART VN
          </p>
          <nav className="flex items-center gap-5 text-sm text-slate-300">
            <a href="#lap-chart" className="transition hover:text-sky-200">
              Lập chart
            </a>
            <a href="#ket-qua" className="transition hover:text-sky-200">
              Kết quả
            </a>
            <a href="#gui-cau-hoi" className="transition hover:text-sky-200">
              Gửi AI
            </a>
          </nav>
        </div>
      </header>

      <section
        className="relative flex min-h-[88vh] items-center overflow-hidden"
        style={{
          backgroundImage:
            "linear-gradient(rgba(2,6,23,0.72), rgba(2,6,23,0.9)), url('/images/astro-night.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center"
        }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_80%_30%,rgba(167,139,250,0.15),transparent_35%)]" />
        <motion.div
          className="pointer-events-none absolute -right-20 top-1/2 hidden h-[38rem] w-[38rem] -translate-y-1/2 lg:block"
          animate={{ rotate: 360 }}
          transition={{ duration: 100, ease: "linear", repeat: Infinity }}
        >
          <div className="h-full w-full rounded-full border border-sky-200/30" />
          <div className="absolute inset-10 rounded-full border border-violet-200/20" />
          <div className="absolute inset-20 rounded-full border border-slate-300/20" />
        </motion.div>

        <div className="relative mx-auto w-full max-w-7xl px-6 py-20 md:px-10">
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="text-xl font-semibold tracking-[0.22em] text-sky-300"
          >
            ASTRAL CHART VN
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mt-4 max-w-4xl text-4xl font-semibold leading-tight sm:text-5xl md:text-6xl"
          >
            Bản đồ sao có tính vị trí sinh, múi giờ lịch sử và ASC chính xác hơn
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-100/90"
          >
            Tìm tọa độ từ địa điểm sinh, tự động xác định timezone ID, sau đó tính vị trí hành tinh, ASC, MC và 12 nhà Whole Sign.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="mt-9 flex flex-wrap gap-4"
          >
            <a
              href="#lap-chart"
              className="inline-flex items-center justify-center rounded-lg bg-sky-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
            >
              Bắt đầu lập chart
            </a>
            <a
              href="#ket-qua"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300/50 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-sky-300 hover:text-sky-200"
            >
              Xem kết quả
            </a>
          </motion.div>
        </div>
      </section>

      <section id="lap-chart" className="mx-auto w-full max-w-7xl px-6 py-16 md:px-10">
        <h2 className="text-3xl font-semibold">Nhập dữ liệu sinh</h2>
        <p className="mt-3 max-w-3xl text-slate-300">
          Để tăng độ chính xác, hệ thống dùng nơi sinh để lấy kinh độ vĩ độ và timezone IANA. Bạn vẫn có thể sửa tay nếu cần.
        </p>

        <form onSubmit={createChart} className="mt-8 grid gap-5 rounded-2xl border border-slate-700/80 bg-slate-900/65 p-6 shadow-[0_20px_80px_-40px_rgba(56,189,248,0.35)] md:grid-cols-2 md:p-8">
          <label className="space-y-2 md:col-span-2">
            <span className={labelClass}>Nơi sinh</span>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={birthPlace}
                onChange={(event) => setBirthPlace(event.target.value)}
                placeholder="VD: Đà Nẵng, Việt Nam"
                className={fieldClass}
                required
              />
              <button
                type="button"
                onClick={resolvePlace}
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-sky-300/60 px-4 py-2.5 text-sm font-semibold text-sky-200 transition hover:border-sky-200 hover:text-sky-100"
                disabled={isGeocoding}
              >
                {isGeocoding ? "Đang tìm..." : "Tìm tọa độ"}
              </button>
            </div>
            {geocodeNote ? <p className="text-xs text-emerald-300">{geocodeNote}</p> : null}
          </label>

          <label className="space-y-2">
            <span className={labelClass}>Ngày sinh</span>
            <input
              type="date"
              value={birthDate}
              onChange={(event) => setBirthDate(event.target.value)}
              className={fieldClass}
              required
            />
          </label>

          <label className="space-y-2">
            <span className={labelClass}>Giờ sinh (24h)</span>
            <input
              type="text"
              value={birthTime}
              onChange={(event) => setBirthTime(event.target.value)}
              placeholder="HH:mm"
              inputMode="numeric"
              pattern="([01][0-9]|2[0-3]):[0-5][0-9]"
              className={fieldClass}
              required
            />
            <p className="text-xs text-slate-400">Nhập theo định dạng 24h: 00:00 đến 23:59.</p>
          </label>

          <label className="space-y-2">
            <span className={labelClass}>Vĩ độ</span>
            <input
              type="number"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              min={-90}
              max={90}
              step="any"
              className={fieldClass}
              required
            />
          </label>

          <label className="space-y-2">
            <span className={labelClass}>Kinh độ</span>
            <input
              type="number"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              min={-180}
              max={180}
              step="any"
              className={fieldClass}
              required
            />
          </label>

          <label className="space-y-2">
            <span className={labelClass}>Timezone ID</span>
            <input
              type="text"
              value={timeZoneId ?? ""}
              onChange={(event) => setTimeZoneId(event.target.value.trim() ? event.target.value : null)}
              placeholder="VD: Asia/Bangkok"
              className={fieldClass}
            />
          </label>

          <label className="space-y-2">
            <span className={labelClass}>Múi giờ thủ công (UTC offset)</span>
            <input
              type="number"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              min={-12}
              max={14}
              step={0.5}
              className={fieldClass}
              required
            />
            <p className="text-xs text-slate-400">Nếu có Timezone ID hợp lệ, giá trị này chỉ dùng làm fallback.</p>
          </label>

          <div className="md:col-span-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              className="inline-flex rounded-lg bg-violet-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-violet-300"
            >
              Tạo bản đồ sao
            </motion.button>
          </div>

          {error ? <p className="md:col-span-2 text-sm text-rose-300">{error}</p> : null}
        </form>
      </section>

      <section id="ket-qua" className="mx-auto w-full max-w-7xl px-6 pb-20 md:px-10">
        <AnimatePresence mode="wait">
          {chart ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.45 }}
            >
              <h2 className="text-3xl font-semibold">Kết quả bản đồ sao</h2>
              <p className="mt-2 text-slate-300">
                {chart.locationLabel} | Lat {chart.latitude.toFixed(4)}, Lon {chart.longitude.toFixed(4)} | {chart.timezoneId ?? "Múi giờ thủ công"} ({formatOffset(chart.timezoneOffset)})
              </p>
              <p className="mt-1 text-sm text-slate-400">UTC tính toán: {chart.utcDate.toUTCString()} | Pha Mặt Trăng: {chart.moonPhase}</p>
              <p className="mt-1 text-xs text-slate-500">Hướng chart đã chỉnh theo chiều chuẩn: kinh độ hoàng đạo tăng ngược chiều kim đồng hồ.</p>

              <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-900/55 p-4 md:p-6">
                <ChartWheel
                  planets={chart.planets}
                  aspects={chart.aspects}
                  houses={chart.houses}
                  ascendant={chart.ascendant}
                  descendant={chart.descendant}
                  midheaven={chart.midheaven}
                  imumCoeli={chart.imumCoeli}
                />
              </div>

              <div className="mt-10 grid gap-8 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 md:p-6">
                  <h3 className="text-xl font-semibold">Góc quan trọng</h3>
                  <div className="mt-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between border-b border-slate-800 py-2">
                      <span className="text-sky-300">AC</span>
                      <span>{displayAngle(chart.ascendant)}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-800 py-2">
                      <span className="text-sky-300">DC</span>
                      <span>{displayAngle(chart.descendant)}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-800 py-2">
                      <span className="text-amber-300">MC</span>
                      <span>{displayAngle(chart.midheaven)}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-800 py-2">
                      <span className="text-amber-300">IC</span>
                      <span>{displayAngle(chart.imumCoeli)}</span>
                    </div>
                  </div>

                  <h3 className="mt-8 text-xl font-semibold">Vị trí hành tinh</h3>
                  <div className="mt-4 space-y-2">
                    {chart.planets.map((planet, index) => (
                      <motion.div
                        key={planet.key}
                        initial={{ opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.05 * index }}
                        className="flex items-center justify-between border-b border-slate-800 py-2"
                      >
                        <span className="font-medium" style={{ color: planet.color }}>
                          {planet.label}
                        </span>
                        <span className="text-right text-sm text-slate-200">
                          {displayAngle(planet.longitude)}
                          {planet.retrograde ? " R" : ""}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 md:p-6">
                  <h3 className="text-xl font-semibold">12 nhà (Whole Sign)</h3>
                  <div className="mt-4 space-y-2 text-sm">
                    {chart.houses.map((house, index) => (
                      <motion.div
                        key={house.house}
                        initial={{ opacity: 0, x: 14 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.04 * index }}
                        className="flex items-center justify-between border-b border-slate-800 py-2"
                      >
                        <span>Nhà {house.house}</span>
                        <span>{displayAngle(house.cusp)} ({house.signName})</span>
                      </motion.div>
                    ))}
                  </div>

                  <h3 className="mt-8 text-xl font-semibold">Bảng góc chiếu đầy đủ</h3>
                  <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
                    {chart.aspects.length === 0 ? <p className="text-sm text-slate-400">Không có góc chiếu nào nằm trong orb đã chọn.</p> : null}
                    {chart.aspects.length > 0 ? (
                      <motion.table
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="min-w-full border-collapse text-left text-sm"
                      >
                        <thead>
                          <tr className="border-b border-slate-700 bg-slate-900/80 text-slate-300">
                            <th className="px-2 py-2 font-medium">Cặp hành tinh</th>
                            <th className="px-2 py-2 font-medium">Loại góc</th>
                            <th className="px-2 py-2 font-medium">Góc thực</th>
                            <th className="px-2 py-2 font-medium">Góc chuẩn</th>
                            <th className="px-2 py-2 font-medium">Orb</th>
                            <th className="px-2 py-2 font-medium">Orb tối đa</th>
                            <th className="px-2 py-2 font-medium">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chart.aspects.map((aspect, index) => (
                            <motion.tr
                              key={`${aspect.pair}-${aspect.type}`}
                              initial={{ opacity: 0, x: 14 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.03 * index }}
                              className="border-b border-slate-800/80 bg-slate-950/55"
                            >
                              <td className="px-2 py-2 text-slate-100">{aspect.fromLabel} - {aspect.toLabel}</td>
                              <td className="px-2 py-2" style={{ color: aspect.color }}>
                                {aspect.type}
                              </td>
                              <td className="px-2 py-2 text-slate-200">{aspect.separation.toFixed(2)}°</td>
                              <td className="px-2 py-2 text-slate-200">{aspect.targetAngle.toFixed(0)}°</td>
                              <td className="px-2 py-2 text-slate-100">{aspect.orb.toFixed(2)}°</td>
                              <td className="px-2 py-2 text-slate-300">{aspect.orbLimit.toFixed(1)}°</td>
                              <td className="px-2 py-2 text-slate-200">{aspect.trend === "Applying" ? "Đang áp sát" : "Đang tách"}</td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </motion.table>
                    ) : null}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="border-t border-slate-800 pt-12"
            >
              <h2 className="text-2xl font-semibold">Kết quả sẽ hiển thị tại đây</h2>
              <p className="mt-3 max-w-2xl text-slate-400">
                Hệ thống sẽ tạo chart gồm hành tinh, ASC, MC và 12 nhà theo vị trí sinh. Khi cần độ chính xác cao, bạn nên kiểm tra lại giờ sinh và tọa độ.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section id="gui-cau-hoi" className="mx-auto w-full max-w-7xl px-6 pb-24 md:px-10">
        <div className="border-t border-slate-800 pt-12">
          <h2 className="text-3xl font-semibold">Chat trực tiếp với AI luận giải bản đồ sao</h2>
          <p className="mt-3 max-w-3xl text-slate-300">
            Bạn sẽ trò chuyện ngay trong app. Mỗi câu hỏi đều được gửi kèm toàn bộ dữ liệu chart để AI có đủ ngữ cảnh luận giải.
          </p>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          <div className="space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6 lg:col-span-1">
            <label className="block space-y-2">
              <span className={labelClass}>Tên người dùng</span>
              <input
                type="text"
                value={senderName}
                onChange={(event) => setSenderName(event.target.value)}
                className={fieldClass}
              />
            </label>

            <p className="text-sm text-slate-300">
              AI sẽ dùng các dữ liệu: vị trí hành tinh, góc chiếu, AC/DC/MC/IC, nhà và câu hỏi hiện tại để trả lời.
            </p>
            <p className="rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
              Yêu cầu triển khai: thêm OPENAI_API_KEY trong Environment Variables trên Vercel.
            </p>
            {shareStatus ? <p className="text-sm text-amber-200">{shareStatus}</p> : null}
          </div>

          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6 lg:col-span-2">
            <h3 className="text-lg font-semibold">Khung chat AI</h3>
            <div className="mt-4 h-[26rem] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/80 p-3 md:p-4">
              <div className="space-y-3">
                {chatMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`max-w-[90%] rounded-xl px-3 py-2.5 text-sm leading-relaxed ${
                      message.role === "user"
                        ? "ml-auto border border-sky-300/30 bg-sky-400/20 text-sky-100"
                        : "mr-auto border border-slate-700 bg-slate-800/90 text-slate-100"
                    }`}
                  >
                    {message.content}
                  </div>
                ))}
                {isAskingAi ? <p className="text-sm text-slate-400">AI đang phân tích bản đồ sao...</p> : null}
              </div>
            </div>

            <form onSubmit={askAi} className="mt-4 space-y-3">
              <label className="block space-y-2">
                <span className={labelClass}>Câu hỏi cho AI</span>
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="VD: Hãy phân tích điểm mạnh nghề nghiệp của tôi trong 12 tháng tới theo bản đồ sao này."
                  rows={4}
                  className={fieldClass}
                  required
                />
              </label>
              <button
                type="submit"
                disabled={isAskingAi}
                className="inline-flex items-center justify-center rounded-lg bg-sky-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAskingAi ? "Đang gửi..." : "Gửi cho AI"}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}