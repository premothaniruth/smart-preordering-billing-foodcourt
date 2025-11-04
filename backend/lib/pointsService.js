const fs = require('fs');
const path = require('path');

const pointsSummaryFile = path.join(__dirname, '..', 'data', 'employee_points.json');
const pointsLedgerFile = path.join(__dirname, '..', 'data', 'points_ledger.json');
const pointsStreaksFile = path.join(__dirname, '..', 'data', 'points_streaks.json');
const pointsNotificationsFile = path.join(__dirname, '..', 'data', 'points_notifications.json');

const POINTS_CONVERSION_RATE = 0.1; // 1 point = ₹0.10
const POINTS_CONVERSION_BLOCK = 30;
const ORDER_POINTS_PER_BLOCK = 2; // 2 points per 3 items
const ORDER_ITEM_BLOCK = 3;
const ORDER_POINTS_CAP = 15;
const STREAK_THRESHOLD = 3; // orders per day to earn streak
const STREAK_MAX_BONUS = 2; // max streak bonus per day
const STREAK_BONUS_POINTS = 1;
const POINT_EXPIRY_DAYS = 60;
const POINT_EXPIRY_REMINDER_DAYS = 7;
const MAX_POINTS_LEDGER_ENTRIES = 5000;

const ensureFile = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    }
  } catch (error) {
    console.warn('[PointsService] Failed to ensure file', filePath, error);
  }
};

const ensurePointsDataFiles = () => {
  ensureFile(pointsSummaryFile, {});
  ensureFile(pointsLedgerFile, []);
  ensureFile(pointsStreaksFile, {});
  ensureFile(pointsNotificationsFile, []);
};

const getPointsSummaryMap = () => {
  ensureFile(pointsSummaryFile, {});
  try {
    const raw = fs.readFileSync(pointsSummaryFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[PointsService] Failed to read points summary map', error);
    return {};
  }
};

const savePointsSummaryMap = (map) => {
  const payload = map && typeof map === 'object' ? map : {};
  fs.writeFileSync(pointsSummaryFile, JSON.stringify(payload, null, 2));
};

const getPointsLedger = () => {
  ensureFile(pointsLedgerFile, []);
  try {
    const raw = fs.readFileSync(pointsLedgerFile, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[PointsService] Failed to read points ledger', error);
    return [];
  }
};

const savePointsLedger = (entries) => {
  const list = Array.isArray(entries) ? entries : [];
  fs.writeFileSync(pointsLedgerFile, JSON.stringify(list, null, 2));
};

const ensurePointsLedgerCapacity = (entries) => {
  if (!Array.isArray(entries)) return;
  if (entries.length <= MAX_POINTS_LEDGER_ENTRIES) return;
  const excess = entries.length - MAX_POINTS_LEDGER_ENTRIES;
  entries.splice(0, excess);
};

const getPointsStreaks = () => {
  ensureFile(pointsStreaksFile, {});
  try {
    const raw = fs.readFileSync(pointsStreaksFile, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[PointsService] Failed to read streaks file', error);
    return {};
  }
};

const savePointsStreaks = (map) => {
  const payload = map && typeof map === 'object' ? map : {};
  fs.writeFileSync(pointsStreaksFile, JSON.stringify(payload, null, 2));
};

const getPointsNotifications = () => {
  ensureFile(pointsNotificationsFile, []);
  try {
    const raw = fs.readFileSync(pointsNotificationsFile, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('[PointsService] Failed to read notifications file', error);
    return [];
  }
};

const savePointsNotifications = (entries) => {
  const list = Array.isArray(entries) ? entries : [];
  fs.writeFileSync(pointsNotificationsFile, JSON.stringify(list, null, 2));
};

const buildPointsLedgerEntry = ({
  employeeId,
  type,
  subType = null,
  points,
  rupees = null,
  orderId = null,
  itemCount = null,
  streakDate = null,
  metadata = null,
  expiresAt = null,
  walletTxId = null,
}) => ({
  id: `pts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  employeeId: employeeId != null ? String(employeeId) : null,
  type,
  subType,
  points,
  rupees,
  orderId,
  itemCount,
  streakDate,
  metadata,
  expiresAt,
  walletTxId,
  createdAt: new Date().toISOString(),
});

const initializePointsSummary = (summaryMap, employeeId) => {
  const key = String(employeeId);
  if (!summaryMap[key]) {
    summaryMap[key] = {
      activePoints: 0,
      lifetimePoints: 0,
      lifetimeConvertedPoints: 0,
      lifetimeExpiredPoints: 0,
      lastEarnedAt: null,
      lastConvertedAt: null,
    };
  }
  return summaryMap[key];
};

const toDateKey = (date = new Date()) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const addPointsLedgerEntry = ({ entry, summaryMap = null, ledger = null }) => {
  const list = Array.isArray(ledger) ? ledger : getPointsLedger();
  list.push(entry);
  ensurePointsLedgerCapacity(list);
  savePointsLedger(list);

  const summaries = summaryMap && typeof summaryMap === 'object' ? summaryMap : getPointsSummaryMap();
  const summary = initializePointsSummary(summaries, entry.employeeId);
  if (entry.type === 'earn' || entry.type === 'bonus') {
    summary.activePoints += entry.points;
    summary.lifetimePoints += entry.points;
    summary.lastEarnedAt = entry.createdAt;
  } else if (entry.type === 'convert') {
    summary.activePoints += entry.points; // negative value
    summary.lifetimeConvertedPoints += Math.abs(entry.points);
    summary.lastConvertedAt = entry.createdAt;
  } else if (entry.type === 'expiry') {
    summary.activePoints += entry.points; // negative value
    summary.lifetimeExpiredPoints += Math.abs(entry.points);
  }
  if (summary.activePoints < 0) summary.activePoints = 0;
  savePointsSummaryMap(summaries);

  return { entry, summaryMap: summaries, ledger: list, summary };
};

const updateLedgerEntry = (updatedEntry) => {
  if (!updatedEntry || !updatedEntry.id) return;
  const ledger = getPointsLedger();
  const idx = ledger.findIndex((entry) => entry.id === updatedEntry.id);
  if (idx >= 0) {
    ledger[idx] = { ...ledger[idx], ...updatedEntry };
    savePointsLedger(ledger);
  }
};

const calculateOrderPoints = (itemCount) => {
  const count = Number(itemCount || 0);
  if (!Number.isFinite(count) || count <= 0) return 0;
  const blocks = Math.floor(count / ORDER_ITEM_BLOCK);
  const points = blocks * ORDER_POINTS_PER_BLOCK;
  return Math.min(points, ORDER_POINTS_CAP);
};

const recordOrderPoints = ({ employeeId, orderId, itemCount }) => {
  const points = calculateOrderPoints(itemCount);
  if (points <= 0) return null;
  const expiresAt = new Date(Date.now() + POINT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const entry = buildPointsLedgerEntry({
    employeeId,
    type: 'earn',
    subType: 'order',
    points,
    orderId,
    itemCount,
    expiresAt,
  });
  addPointsLedgerEntry({ entry });
  return entry;
};

const issueStreakBonusPoints = ({ employeeId, dateKey }) => {
  const expiresAt = new Date(Date.now() + POINT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const entry = buildPointsLedgerEntry({
    employeeId,
    type: 'bonus',
    subType: 'streak',
    points: STREAK_BONUS_POINTS,
    streakDate: dateKey,
    expiresAt,
  });
  addPointsLedgerEntry({ entry });
  return entry;
};

const recordStreakBonuses = ({ employeeId, date }) => {
  const dateKey = toDateKey(date);
  const streaks = getPointsStreaks();
  const key = String(employeeId);
  if (!streaks[key]) streaks[key] = {};
  if (!streaks[key][dateKey]) {
    streaks[key][dateKey] = { orders: 0, bonusIssued: 0 };
  }
  const streak = streaks[key][dateKey];
  streak.orders += 1;
  savePointsStreaks(streaks);

  const bonusesAvailable = Math.min(Math.floor(streak.orders / STREAK_THRESHOLD), STREAK_MAX_BONUS);
  if (streak.bonusIssued >= bonusesAvailable) {
    return { issued: 0, entries: [], streak };
  }

  const entries = [];
  const bonusCount = bonusesAvailable - streak.bonusIssued;
  for (let i = 0; i < bonusCount; i += 1) {
    const entry = issueStreakBonusPoints({ employeeId, dateKey });
    entries.push(entry);
  }
  streak.bonusIssued += bonusCount;
  savePointsStreaks(streaks);
  return { issued: bonusCount, entries, streak };
};

const countOrderItems = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const qty = Number(item?.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) return sum;
    return sum + qty;
  }, 0);
};

const processOrderPoints = ({ employeeId, orderItems, orderId, orderDate, onConvert }) => {
  const itemCount = countOrderItems(orderItems);
  const result = {
    itemCount,
    earnEntry: null,
    streakEntries: [],
    streakIssued: 0,
    conversion: { converted: 0, summary: null, entry: null, walletHookResult: null },
  };

  if (itemCount > 0) {
    const entry = recordOrderPoints({ employeeId, orderId, itemCount });
    if (entry) {
      scheduleExpiryReminder({ entry });
      result.earnEntry = entry;
    }
  }

  const streakOutcome = recordStreakBonuses({ employeeId, date: orderDate || new Date() });
  if (streakOutcome?.issued > 0) {
    streakOutcome.entries.forEach((entry) => scheduleExpiryReminder({ entry }));
    result.streakEntries = streakOutcome.entries;
    result.streakIssued = streakOutcome.issued;
  }

  result.conversion = processAutomaticConversion({ employeeId, onConvert });
  return result;
};

const scheduleExpiryReminder = ({ entry }) => {
  if (!entry || !entry.expiresAt) return;
  const expiresAt = new Date(entry.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return;
  const remindAt = expiresAt - POINT_EXPIRY_REMINDER_DAYS * 24 * 60 * 60 * 1000;
  if (remindAt <= Date.now()) return;
  const notifications = getPointsNotifications();
  notifications.push({
    id: `pts_rem_${entry.id}`,
    employeeId: entry.employeeId,
    ledgerId: entry.id,
    remindAt,
    expiresAt,
    sent: false,
    createdAt: new Date().toISOString(),
  });
  savePointsNotifications(notifications);
};

const processAutomaticConversion = ({ employeeId, onConvert }) => {
  const summaries = getPointsSummaryMap();
  const summary = initializePointsSummary(summaries, employeeId);
  const activePoints = Number(summary.activePoints || 0);
  const convertible = Math.floor(activePoints / POINTS_CONVERSION_BLOCK) * POINTS_CONVERSION_BLOCK;
  if (convertible <= 0) {
    return { converted: 0, summary };
  }

  const rupees = convertible * POINTS_CONVERSION_RATE;
  const entry = buildPointsLedgerEntry({
    employeeId,
    type: 'convert',
    points: -convertible,
    rupees,
  });
  addPointsLedgerEntry({ entry, summaryMap: summaries });

  let walletHookResult = null;
  if (typeof onConvert === 'function') {
    try {
      walletHookResult = onConvert({ points: convertible, rupees, ledgerEntryId: entry.id }) || null;
      if (walletHookResult && walletHookResult.walletTxId) {
        entry.walletTxId = walletHookResult.walletTxId;
        updateLedgerEntry(entry);
      }
    } catch (error) {
      console.warn('[PointsService] Wallet credit hook failed', error);
    }
  }

  return {
    converted: convertible,
    summary: initializePointsSummary(getPointsSummaryMap(), employeeId),
    entry,
    walletHookResult,
  };
};

const PROTECTED_POINTS_TYPES = new Set(['earn', 'bonus']);

const handlePointsExpirySweep = () => {
  const now = Date.now();
  const summaries = getPointsSummaryMap();
  const ledger = getPointsLedger();
  let mutated = false;
  for (const entry of ledger) {
    if (!entry || !entry.expiresAt) continue;
    if (!PROTECTED_POINTS_TYPES.has(entry.type)) continue;
    const expiresAt = new Date(entry.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) continue;
    if (expiresAt > now) continue;
    const summary = initializePointsSummary(summaries, entry.employeeId);
    if ((summary.activePoints || 0) <= 0) continue;
    const expiryEntry = buildPointsLedgerEntry({
      employeeId: entry.employeeId,
      type: 'expiry',
      points: -Math.min(entry.points, summary.activePoints),
      metadata: { expiredLedgerId: entry.id },
    });
    addPointsLedgerEntry({ entry: expiryEntry, summaryMap: summaries, ledger });
    mutated = true;
  }
  if (mutated) {
    savePointsSummaryMap(summaries);
  }
};

const handlePointsReminderSweep = () => {
  const now = Date.now();
  const notifications = getPointsNotifications();
  let mutated = false;
  for (const entry of notifications) {
    if (entry.sent) continue;
    if (entry.remindAt > now) continue;
    entry.sent = true;
    entry.sentAt = new Date().toISOString();
    mutated = true;
  }
  if (mutated) {
    savePointsNotifications(notifications);
  }
};

const getEmployeePointsSummary = (employeeId) => {
  const summaries = getPointsSummaryMap();
  const summary = initializePointsSummary(summaries, employeeId);
  const ledger = getPointsLedger().filter((entry) => String(entry.employeeId) === String(employeeId));
  const conversionHistory = ledger.filter((entry) => entry.type === 'convert').slice(-20).reverse();
  const expiryPreview = ledger
    .filter((entry) => PROTECTED_POINTS_TYPES.has(entry.type) && entry.expiresAt)
    .map((entry) => ({
      ledgerId: entry.id,
      points: entry.points,
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
    }))
    .filter((entry) => new Date(entry.expiresAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())
    .slice(0, 10);
  const streakBadges = ledger
    .filter((entry) => entry.type === 'bonus' && entry.subType === 'streak')
    .reduce((map, entry) => {
      const key = entry.streakDate || toDateKey(entry.createdAt);
      map.set(key, (map.get(key) || 0) + entry.points);
      return map;
    }, new Map());
  const streakAchievements = Array.from(streakBadges.entries())
    .map(([date, points]) => ({ date, points }))
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .slice(0, 30);
  return {
    summary,
    conversionHistory,
    expiryPreview,
    streakAchievements,
  };
};

const getPointsAdminReport = ({ date } = {}) => {
  const target = date ? new Date(date) : new Date();
  const dateKey = toDateKey(target);
  const ledger = getPointsLedger();
  const topEarnersMap = new Map();
  const conversionTotals = new Map();
  let outstandingPoints = 0;
  const summaries = getPointsSummaryMap();
  Object.values(summaries).forEach((summary) => {
    outstandingPoints += Number(summary.activePoints || 0);
  });

  ledger.forEach((entry) => {
    const createdKey = toDateKey(entry.createdAt);
    if (entry.type === 'earn' || entry.type === 'bonus') {
      if (createdKey === dateKey) {
        const slot = topEarnersMap.get(entry.employeeId) || { points: 0, entries: [] };
        slot.points += entry.points;
        slot.entries.push(entry);
        topEarnersMap.set(entry.employeeId, slot);
      }
    } else if (entry.type === 'convert') {
      if (createdKey === dateKey) {
        conversionTotals.set(
          entry.employeeId,
          (conversionTotals.get(entry.employeeId) || 0) + Math.abs(entry.points)
        );
      }
    }
  });

  const topEarners = Array.from(topEarnersMap.entries())
    .map(([employeeId, data]) => ({ employeeId, points: data.points, entries: data.entries }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 10);

  const conversionBreakdown = Array.from(conversionTotals.entries())
    .map(([employeeId, points]) => ({ employeeId, points, rupees: points * POINTS_CONVERSION_RATE }))
    .sort((a, b) => b.points - a.points);

  return {
    date: dateKey,
    topEarners,
    conversionBreakdown,
    outstandingPoints,
  };
};

module.exports = {
  calculateOrderPoints,
  recordOrderPoints,
  recordStreakBonuses,
  processAutomaticConversion,
  processOrderPoints,
  scheduleExpiryReminder,
  getEmployeePointsSummary,
  getPointsAdminReport,
  handlePointsExpirySweep,
  handlePointsReminderSweep,
  ensurePointsDataFiles,
};

ensurePointsDataFiles();
