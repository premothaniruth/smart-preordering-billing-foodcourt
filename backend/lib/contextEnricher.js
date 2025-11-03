const fs = require("fs");
const path = require("path");

const CALENDAR_PATH = path.join(__dirname, "..", "data", "vendor_calendar.json");
const WEATHER_PATH = path.join(__dirname, "..", "data", "weather_overrides.json");

const ensureFile = (filePath, defaultContent) => {
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2));
  }
};

const loadJson = (filePath, fallback) => {
  try {
    ensureFile(filePath, fallback);
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch (error) {
    console.warn(`[ContextEnricher] Failed to load ${filePath}`, error);
    return fallback;
  }
};

const holidayLookup = loadJson(CALENDAR_PATH, []);
const weatherOverrides = loadJson(WEATHER_PATH, []);

const normalizeDate = (input) => {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const findVendorHoliday = (vendorId, isoDate) => {
  if (!Array.isArray(holidayLookup)) return null;
  return (
    holidayLookup.find(
      (entry) => String(entry.vendorId) === String(vendorId) && entry.date === isoDate
    ) || null
  );
};

const findWeatherOverride = (shopId, isoDate) => {
  if (!Array.isArray(weatherOverrides)) return null;
  return (
    weatherOverrides.find(
      (entry) => String(entry.shopId || "") === String(shopId || "") && entry.date === isoDate
    ) || null
  );
};

const WEEKEND_NAMES = ["Saturday", "Sunday"];
const DEFAULT_WEATHER = "clear";

const buildContext = ({ timestamp, vendorId, shopId }) => {
  const isoDate = normalizeDate(timestamp);
  if (!isoDate) {
    return {
      holidayFlag: false,
      holidayName: null,
      weatherCode: DEFAULT_WEATHER,
    };
  }

  const dateObj = new Date(timestamp);
  const vendorHoliday = findVendorHoliday(vendorId, isoDate);
  const isWeekend = WEEKEND_NAMES.includes(
    dateObj.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
  );

  const holidayFlag = Boolean(vendorHoliday || isWeekend);
  const holidayName = vendorHoliday ? vendorHoliday.name : isWeekend ? "Weekend" : null;

  const weatherOverride = findWeatherOverride(shopId, isoDate);
  const weatherCode = weatherOverride?.condition || DEFAULT_WEATHER;

  return {
    holidayFlag,
    holidayName,
    weatherCode,
  };
};

module.exports = {
  buildContext,
};
