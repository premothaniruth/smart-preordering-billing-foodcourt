import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import {
  fetchOrders,
  markOrderReady,
  fetchMenu,
  extendOrderPrep,
  markOrderPicked,
  revokeOrderExtension,
  fetchBulkOrders,
  postBulkOrderVendorMessage,
  confirmBulkOrderSlot,
  fetchInterestSummary,
  updateInterestThreshold,
} from "../api";

const DEFAULT_PREP_MINUTES = 5;
const MAX_LOAD_MULTIPLIER = 3;

const coerceNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const formatCountdown = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
};

const formatMinutes = (minutes) => {
  const rounded = Math.round(minutes * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}m` : `${rounded.toFixed(1)}m`;
};

const computeCustomizationExtraMinutes = (customization) => {
  if (!customization) return 0;
  let extra = 0;
  if (customization.extraPrepMinutes != null) {
    extra += coerceNumber(customization.extraPrepMinutes, 0);
  }
  const cookLevel = String(customization.cookLevel || "").toLowerCase();
  if (cookLevel === "well-done" || cookLevel === "extra-crispy") {
    extra += 2;
  }
  const notes = String(customization.notes || "").toLowerCase();
  if (notes.includes("extra")) {
    extra += 1;
  }
  if (notes.includes("very hot") || notes.includes("very spicy")) {
    extra += 1;
  }
  return extra;
};

const buildPrepTimesByShop = (menu) => {
  const map = new Map();
  const addItem = (shopMap, item) => {
    if (!item || item.id == null) return;
    const itemId = String(item.id);
    const prep = coerceNumber(item.prepTime, DEFAULT_PREP_MINUTES);
    if (!shopMap.has(itemId)) {
      shopMap.set(itemId, prep);
    }
  };
  (menu || []).forEach((shop) => {
    if (!shop) return;
    const shopMap = new Map();
    if (Array.isArray(shop.items)) {
      shop.items.forEach((item) => addItem(shopMap, item));
    }
    if (Array.isArray(shop.categories)) {
      shop.categories.forEach((category) => {
        if (!Array.isArray(category?.items)) return;
        category.items.forEach((item) => addItem(shopMap, item));
      });
    }
    map.set(String(shop.shopId), shopMap);
  });
  return map;
};

const computeItemPrepMinutes = (item, orderShopId, prepTimesByShop) => {
  const quantity = Math.max(1, coerceNumber(item?.quantity, 1));
  const shopPrepMap = prepTimesByShop.get(String(orderShopId));
  const lookupPrep = shopPrepMap?.get(String(item?.id));
  const basePrep = coerceNumber(item?.prepTime, lookupPrep ?? DEFAULT_PREP_MINUTES);
  const extra = computeCustomizationExtraMinutes(item?.customization);
  const perUnit = Math.max(basePrep + extra, DEFAULT_PREP_MINUTES);
  return perUnit * quantity;
};

const computeVendorLoadMultiplier = ({ order, pendingOrdersCount, now }) => {
  if (order?.vendorLoadMultiplier != null) {
    const direct = coerceNumber(order.vendorLoadMultiplier, 1);
    return Math.min(Math.max(direct, 0.5), MAX_LOAD_MULTIPLIER);
  }

  let multiplier = 1;

  if (pendingOrdersCount > 0) {
    const queuePressure = Math.min(0.75, pendingOrdersCount * 0.05);
    multiplier += queuePressure;
  }

  const referenceTime = order?.scheduledTime ? Date.parse(order.scheduledTime) : now;
  const date = new Date(Number.isNaN(referenceTime) ? now : referenceTime);
  const hour = date.getHours();
  if ((hour >= 7 && hour < 9) || (hour >= 12 && hour < 15) || (hour >= 19 && hour < 21)) {
    multiplier += 0.2;
  }

  if (order?.loadTags && Array.isArray(order.loadTags)) {
    if (order.loadTags.includes("high-traffic")) multiplier += 0.15;
    if (order.loadTags.includes("staff-shortage")) multiplier += 0.1;
  }

  if (order?.loadMultiplierOverride != null) {
    multiplier = coerceNumber(order.loadMultiplierOverride, multiplier);
  }

  return Math.min(Math.max(multiplier, 0.5), MAX_LOAD_MULTIPLIER);
};

const computeOrderCountdown = (order, { now, pendingOrdersCount, prepTimesByShop }) => {
  if (!order) return null;

  const info = deriveOrderCountdownInfo(order, { now, pendingOrdersCount, prepTimesByShop });
  if (!info) return null;

  const {
    orderId,
    countdownMs,
    displayCountdownMs,
    startTime,
    targetTime,
    status,
    label,
    prefix,
    message,
    helperText,
    domId,
  } = info;

  return {
    orderId,
    countdownMs,
    displayCountdownMs,
    startTime,
    targetTime,
    status,
    label,
    prefix,
    message,
    helperText,
    domId,
  };
};

const deriveOrderCountdownInfo = (order, { now, pendingOrdersCount, prepTimesByShop }) => {
  const items = Array.isArray(order.items) ? order.items : [];
  let maxItemPrepMinutes = 0;
  items.forEach((item) => {
    maxItemPrepMinutes = Math.max(maxItemPrepMinutes, computeItemPrepMinutes(item, order.shopId, prepTimesByShop));
  });

  const derivedPrep = Math.max(maxItemPrepMinutes, DEFAULT_PREP_MINUTES);
  const basePrepMinutes = order?.basePrepTime != null
    ? Math.max(coerceNumber(order.basePrepTime, DEFAULT_PREP_MINUTES), DEFAULT_PREP_MINUTES)
    : derivedPrep;
  const effectivePrepMinutes = order?.prepTime != null
    ? Math.max(coerceNumber(order.prepTime, basePrepMinutes), basePrepMinutes)
    : basePrepMinutes;

  const vendorLoadMultiplier = computeVendorLoadMultiplier({ order, pendingOrdersCount, now });
  const estimatedReady = order?.estimatedReadyTime ? Date.parse(order.estimatedReadyTime) : NaN;
  const scheduledTimeValue = order?.scheduledTime ? Date.parse(order.scheduledTime) : NaN;
  const createdAtValue = order?.createdAt ? Date.parse(order.createdAt) : NaN;

  const orderTypeRaw = order?.orderType ? String(order.orderType).toLowerCase() : null;
  const inferredType = orderTypeRaw || (!Number.isNaN(scheduledTimeValue) ? "pre-order" : "live");
  const orderType = inferredType === "pre-order" ? "pre-order" : "live";

  let targetTime = !Number.isNaN(estimatedReady)
    ? estimatedReady
    : (() => {
        const baseStart = !Number.isNaN(createdAtValue) ? createdAtValue : now;
        const adjustedPrepMinutes = effectivePrepMinutes * vendorLoadMultiplier;
        return baseStart + adjustedPrepMinutes * 60000;
      })();

  if (orderType === "pre-order" && !Number.isNaN(scheduledTimeValue)) {
    targetTime = Math.max(targetTime, scheduledTimeValue);
  }

  const prepDurationMs = effectivePrepMinutes * 60000;
  let startTime = targetTime - prepDurationMs;
  if (Number.isNaN(startTime) || !Number.isFinite(startTime)) {
    startTime = !Number.isNaN(createdAtValue) ? createdAtValue : now;
  }

  const timeUntilReady = targetTime - now;
  const timeUntilStart = startTime - now;

  let status = "in-progress";
  let prefix = "Ready in";
  let message = "Serve by";

  if (timeUntilStart > 0) {
    status = "waiting";
    prefix = "Prep starts in";
  } else if (timeUntilReady <= 0) {
    status = "overdue";
    prefix = "Prep window elapsed";
    message = "Expected ready";
  }

  const displayCountdownMs = status === "waiting" ? timeUntilStart : timeUntilReady;

  const helperParts = [];
  helperParts.push(`Prep ${formatMinutes(effectivePrepMinutes)}`);
  const extensionMinutes = coerceNumber(order?.etaExtensionMinutes, 0);
  if (extensionMinutes > 0) {
    helperParts.push(`Extended +${extensionMinutes}m`);
  }
  if (Number.isFinite(vendorLoadMultiplier) && !Number.isNaN(vendorLoadMultiplier) && vendorLoadMultiplier !== 1 && Number.isNaN(estimatedReady)) {
    helperParts.push(`Load ×${vendorLoadMultiplier.toFixed(2)}`);
  }
  if (!Number.isNaN(targetTime)) {
    helperParts.push(`ETA ${new Date(targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`);
  }

  return {
    orderId: order.id,
    orderType,
    basePrepMinutes,
    adjustedPrepMinutes: effectivePrepMinutes,
    vendorLoadMultiplier,
    countdownMs: timeUntilReady,
    displayCountdownMs,
    startTime,
    targetTime,
    status,
    label: formatCountdown(Math.max(displayCountdownMs, 0)),
    prefix,
    message,
    helperText: helperParts.join(" · "),
    domId: `order-countdown-${order.id}`
  };
};

const formatInrCurrency = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return typeof value === "string" && value.trim() ? value : "₹0.00";
  }
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(num);
  } catch {
    return `₹${num.toFixed(2)}`;
  }
};

const buildPrintTicketPayload = (order, { vendorShopName, vendorShopId }) => {
  const createdAt = order?.createdAt ? new Date(order.createdAt) : new Date();
  const scheduledFor = order?.scheduledTime ? new Date(order.scheduledTime) : null;
  const items = Array.isArray(order?.items)
    ? order.items.map((item) => {
        const quantity = Math.max(1, Number(item?.quantity) || 1);
        const unitPrice = Number(item?.price ?? item?.finalPrice ?? item?.amount ?? 0);
        const lineTotal = Number.isFinite(unitPrice) ? unitPrice * quantity : 0;
        return {
          name: item?.name || "Item",
          option: item?.option || item?.selectedOption?.name || null,
          quantity,
          unitPrice,
          lineTotal,
        };
      })
    : [];
  const subtotal = items.reduce((sum, entry) => sum + (Number.isFinite(entry.lineTotal) ? entry.lineTotal : 0), 0);
  const discount = Number(order?.discountTotal ?? order?.offerSummary?.discountTotal ?? 0) || 0;
  const total = (() => {
    const explicit = Number(order?.total ?? order?.totalPayable ?? order?.grandTotal);
    if (Number.isFinite(explicit)) return explicit;
    return Math.max(subtotal - discount, 0);
  })();

  return {
    version: "1.0",
    metadata: {
      orderId: order?.id,
      billingId: order?.billingId,
      createdAt: createdAt.toISOString(),
      scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
      vendor: {
        shopId: vendorShopId,
        name: vendorShopName || "Vendor",
      },
      customer: {
        name: order?.user || order?.employeeName || order?.customerName || "Employee",
        mobile: order?.mobile || order?.userMobile || null,
        desk: order?.desk || null,
      },
      paymentMethod: order?.paymentMethod || order?.payment_mode || null,
      notes: order?.notes || order?.specialInstructions || null,
    },
    items,
    totals: {
      subtotal,
      discount,
      total,
      subtotalFormatted: formatInrCurrency(subtotal),
      discountFormatted: formatInrCurrency(discount),
      totalFormatted: formatInrCurrency(total),
    },
    rawOrder: order,
  };
};

const trySendToVendorPrinter = async (ticket) => {
  if (typeof window === "undefined") return false;
  const bridge = window.vendorPrinterBridge || window.vendorPrinter || window.infyPrinter;
  if (!bridge) return false;

  const sendFn =
    typeof bridge.printOrderTicket === "function"
      ? bridge.printOrderTicket
      : typeof bridge.printTicket === "function"
      ? bridge.printTicket
      : typeof bridge.print === "function"
      ? bridge.print
      : null;

  if (!sendFn) return false;

  try {
    const result = sendFn.call(bridge, ticket);
    if (result && typeof result.then === "function") {
      const awaited = await result;
      return awaited !== false;
    }
    return result !== false;
  } catch (error) {
    console.error("Vendor printer bridge failed", error);
    return false;
  }
};

const openBrowserPrintPreview = (ticket) => {
  if (typeof window === "undefined") return;
  try {
    const popup = window.open("", "print-order", "width=720,height=900,noopener,noreferrer");
    if (!popup) {
      toast.info("Please allow pop-ups to preview the order printout.");
      return;
    }
    const { metadata, items, totals } = ticket;
    const createdAtDisplay = metadata?.createdAt
      ? new Date(metadata.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "";
    const scheduledDisplay = metadata?.scheduledFor
      ? new Date(metadata.scheduledFor).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
      : "Immediate";

    const itemsRows = items
      .map(
        (item) => `
          <tr>
            <td>${item.name}${item.option ? ` <small>(${item.option})</small>` : ""}</td>
            <td style="text-align:center;">${item.quantity}</td>
            <td style="text-align:right;">${formatInrCurrency(item.unitPrice)}</td>
            <td style="text-align:right;">${formatInrCurrency(item.lineTotal)}</td>
          </tr>
        `
      )
      .join("");

    popup.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Order #${metadata?.billingId || metadata?.orderId}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 16px; color: #111; }
            h1 { font-size: 20px; margin-bottom: 6px; }
            h2 { font-size: 16px; margin: 16px 0 8px; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #ddd; padding: 6px; font-size: 13px; }
            th { background: #f5f5f5; text-align: left; }
            .totals { margin-top: 16px; width: 100%; }
            .totals td { border: none; font-size: 14px; padding: 4px 0; }
            .totals tr:last-child td { font-weight: bold; font-size: 16px; border-top: 1px solid #ccc; padding-top: 8px; }
            .meta { font-size: 13px; margin-bottom: 4px; }
          </style>
        </head>
        <body>
          <h1>${metadata?.vendor?.name || "Vendor"}</h1>
          <div class="meta">Billing ID: <strong>${metadata?.billingId || "N/A"}</strong></div>
          <div class="meta">Employee: ${metadata?.customer?.name || "Employee"}${metadata?.customer?.mobile ? ` · ${metadata.customer.mobile}` : ""}</div>
          <div class="meta">Created: ${createdAtDisplay}</div>
          <div class="meta">Scheduled: ${scheduledDisplay}</div>
          <div class="meta">Payment: ${metadata?.paymentMethod || "--"}</div>
          ${metadata?.notes ? `<div class="meta">Notes: ${metadata.notes}</div>` : ""}
          <h2>Items</h2>
          <table>
            <thead>
              <tr>
                <th style="width: 45%;">Item</th>
                <th style="width: 15%; text-align:center;">Qty</th>
                <th style="width: 20%; text-align:right;">Unit</th>
                <th style="width: 20%; text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows || "<tr><td colspan=4 style='text-align:center;'>No items</td></tr>"}
            </tbody>
          </table>
          <table class="totals">
            <tbody>
              <tr>
                <td style="text-align:right;">Subtotal:</td>
                <td style="text-align:right;">${totals?.subtotalFormatted || formatInrCurrency(totals?.subtotal || 0)}</td>
              </tr>
              <tr>
                <td style="text-align:right;">Discount:</td>
                <td style="text-align:right;">${totals?.discountFormatted || formatInrCurrency(totals?.discount || 0)}</td>
              </tr>
              <tr>
                <td style="text-align:right;">Grand Total:</td>
                <td style="text-align:right;">${totals?.totalFormatted || formatInrCurrency(totals?.total || 0)}</td>
              </tr>
            </tbody>
          </table>
          <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 250); };</script>
        </body>
      </html>
    `);
    popup.document.close();
  } catch (error) {
    console.error("Failed to open print preview", error);
  }
};

const CountdownDisplay = ({ info }) => {
  if (!info) {
    return <span style={{ color: "#999" }}>—</span>;
  }

  const color = info.status === "overdue" ? "#e74c3c" : info.status === "waiting" ? "#2980b9" : "#2c3e50";
  const timerStyle = {
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    fontSize: 18,
    letterSpacing: 1,
    color,
  };
  const primaryText = `${info.prefix}:`;
  const secondaryPrefix = info.status === "overdue" && info.message ? `${info.message}: ` : "ETA: ";
  const secondaryValue = !Number.isNaN(info.targetTime)
    ? new Date(info.targetTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div id={info.domId} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }} aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, color }}>{primaryText}</span>
        <span style={timerStyle}>{info.label}</span>
      </div>
      {secondaryValue && (
        <span style={{ fontSize: 11, color: "#8e44ad" }}>{secondaryPrefix}{secondaryValue}</span>
      )}
      <span style={{ fontSize: 11, color: "#7f8c8d" }}>{info.helperText}</span>
    </div>
  );
};

/**
 * AdminDashboard
 * Displays vendor's live orders with tabs (Current/Ready/Completed), sorting and actions.
 * @param {{ token: string }} props
 */

const BULK_STATUS_OPTIONS = [
  { value: 'pending_vendor', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' }
];

const normalizeBulkStatusClient = (value) => (typeof value === 'string' ? value.toLowerCase() : '');

const AdminDashboard = ({ token, onOpenPrinterSetup }) => {
  const [orders, setOrders] = useState([]);
  const [menu, setMenu] = useState([]);
  const [tab, setTab] = useState("current");
  const [bulkOrders, setBulkOrders] = useState([]);
  const [bulkStatusFilter, setBulkStatusFilter] = useState("pending_vendor");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState(null);
  const [bulkLastFetchedAt, setBulkLastFetchedAt] = useState(null);
  const [muted, setMuted] = useState(false);
  const [interestSummary, setInterestSummary] = useState(null);
  const [interestLoading, setInterestLoading] = useState(false);
  const [interestError, setInterestError] = useState(null);
  const [interestVisible, setInterestVisible] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("");
  const OVERDUE_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
  // Low stock toggle
  const [showLowStock, setShowLowStock] = useState(false);
  const [lowStockThreshold] = useState(10);
  const overdueNotifiedRef = useRef(new Set());
  const vendorShopId = (() => {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.shopId || null;
    } catch { return null; }
  })();

  const loadOrders = useCallback(() => {
    fetchOrders(token).then(setOrders);
  }, [token]);

  const loadInterest = useCallback(async () => {
    if (!token) return;
    try {
      setInterestLoading(true);
      setInterestError(null);
      const summary = await fetchInterestSummary(token);
      setInterestSummary(summary);
      if (summary?.threshold != null) {
        setThresholdDraft(String(summary.threshold));
      }
    } catch (error) {
      console.error("Failed to load interest summary", error);
      setInterestError("Failed to load interest summary");
    } finally {
      setInterestLoading(false);
    }
  }, [token]);

  const getShopName = useCallback(
    (shopId) => menu.find((s) => s.shopId === shopId)?.shopName || shopId,
    [menu]
  );

  const vendorShopName = useMemo(
    () => (vendorShopId != null ? getShopName(vendorShopId) : null),
    [getShopName, vendorShopId]
  );

  const handlePrintOrder = useCallback(
    async (order, { previewFallback = false } = {}) => {
      if (!order) return;
      const ticket = buildPrintTicketPayload(order, { vendorShopName, vendorShopId });
      const sent = await trySendToVendorPrinter(ticket);
      if (!sent || previewFallback) {
        openBrowserPrintPreview(ticket);
      }
    },
    [vendorShopId, vendorShopName]
  );

  useEffect(() => {
    loadOrders();
    fetchMenu().then(setMenu);
    if (!localStorage.getItem('vendorSoundFirstLoginDone')) {
      try { localStorage.setItem('vendorSoundFirstLoginDone', '1'); } catch {}
    }
    const interval = setInterval(() => loadOrders(), 5000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  // tick every second for countdown rendering
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // per-item restock handled via Menu Editor; see low-stock table button below

  const prepTimesByShop = useMemo(() => buildPrepTimesByShop(menu), [menu]);

  const pendingOrdersCount = useMemo(
    () => orders.filter((o) => o.status === 'pending').length,
    [orders]
  );

  const countdownMap = useMemo(() => {
    const now = Date.now();
    const map = new Map();
    orders.forEach((order) => {
      const info = computeOrderCountdown(order, { now, pendingOrdersCount, prepTimesByShop });
      if (info) {
        map.set(order.id, info);
      }
    });
    return map;
  }, [orders, pendingOrdersCount, prepTimesByShop, tick]);

  const remainingTime = useCallback(
    (order) => {
      const info = countdownMap?.get(order.id);
      return info ? info.countdownMs : null;
    },
    [countdownMap]
  );

  const isOrderOverdue = useCallback(
    (order) => {
      if (order?.status !== 'pending') return false;
      const info = countdownMap.get(order.id);
      if (!info) return false;
      return info.status === 'overdue' && info.countdownMs != null && info.countdownMs < 0;
    },
    [countdownMap]
  );

  // Play overdue sound once when an order first becomes overdue
  useEffect(() => {
    const overduePending = orders.filter((o) => isOrderOverdue(o));
    overduePending.forEach(o => {
      if (!overdueNotifiedRef.current.has(o.id)) {
        overdueNotifiedRef.current.add(o.id);
        if (!muted) {
          try { new Audio(OVERDUE_SOUND).play(); } catch {}
        }
        const ticketId = o.billingId || o.id;
        toast.error(`Prep window elapsed for order ${ticketId}. Serve immediately.`, {
          toastId: `order-overdue-${o.id}`,
        });
      }
    });
  }, [orders, isOrderOverdue, muted]);

  const handleBulkExtend = async (mins) => {
    const targets = orders.filter(o => o.status === 'pending');
    if (targets.length === 0) return;
    const ok = window.confirm(`Extend all ${targets.length} pending orders by ${mins} minutes?`);
    if (!ok) return;
    await Promise.all(targets.map(o => extendOrderPrep(o.id, mins, token)));
    loadOrders();
  };

  const [bulkMins, setBulkMins] = useState(5);
  const lowStockItems = useMemo(() => {
    const shop = menu.find(s => s.shopId === vendorShopId);
    if (!shop || !Array.isArray(shop.items)) return [];
    return shop.items.filter(it => Number(it.inventory ?? 100) <= Number(lowStockThreshold));
  }, [menu, vendorShopId, lowStockThreshold]);

  const markReady = (id) => {
    markOrderReady(id, token).then(() => loadOrders());
  };

  // derive visible orders based on current tab with sort priorities
  const visibleOrders = useMemo(() => {
    const list = orders.slice();
    if (tab === 'current') {
      // only pending
      const pending = list.filter(o => o.status === 'pending');
      // sort: overdue first, then by remaining time ascending
      return pending.sort((a,b) => {
        const ra = remainingTime(a);
        const rb = remainingTime(b);
        const oa = (ra !== null && ra < 0) ? 1 : 0;
        const ob = (rb !== null && rb < 0) ? 1 : 0;
        if (oa !== ob) return ob - oa; // overdue first
        const va = ra == null ? Number.POSITIVE_INFINITY : ra;
        const vb = rb == null ? Number.POSITIVE_INFINITY : rb;
        return va - vb;
      });
    } else if (tab === 'ready') {
      // ready tab
      return list.filter(o => o.status === 'ready').sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      return list.filter(o => o.status === 'completed').sort((a,b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
    }
  }, [orders, tab, remainingTime]);

  const loadBulkOrders = useCallback(async (statusOverride = bulkStatusFilter) => {
    if (!token) return;
    try {
      setBulkLoading(true);
      setBulkError(null);
      const params = {};
      if (statusOverride === 'pending_vendor') {
        params.status = 'pending_vendor';
      }
      const res = await fetchBulkOrders(token, params);
      if (res?.status === "ok" && Array.isArray(res.orders)) {
        setBulkOrders(res.orders);
        setBulkLastFetchedAt(new Date());
      } else {
        setBulkError(res?.message || "Failed to load bulk orders");
        setBulkLastFetchedAt(new Date());
      }
    } catch (error) {
      console.error("Failed to load bulk orders", error);
      setBulkError("Failed to load bulk orders");
      setBulkLastFetchedAt(new Date());
    } finally {
      setBulkLoading(false);
    }
  }, [token, bulkStatusFilter]);

  useEffect(() => {
    loadBulkOrders();
  }, [loadBulkOrders]);

  useEffect(() => {
    if (!token) return undefined;
    const interval = setInterval(() => {
      if (tab === 'bulk') {
        loadBulkOrders();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [token, tab, loadBulkOrders]);

  const handleBulkStatusChange = useCallback((event) => {
    const nextStatus = event.target.value;
    setBulkStatusFilter(nextStatus);
    loadBulkOrders(nextStatus);
  }, [loadBulkOrders]);

  const filteredBulkOrders = useMemo(() => {
    if (!Array.isArray(bulkOrders)) return [];
    if (bulkStatusFilter === 'all') {
      return bulkOrders;
    }
    if (bulkStatusFilter === 'pending_vendor') {
      return bulkOrders.filter((order) => normalizeBulkStatusClient(order?.status) === 'pending_vendor');
    }
    if (bulkStatusFilter === 'completed') {
      const allowed = new Set(['completed', 'confirmed']);
      return bulkOrders.filter((order) => allowed.has(normalizeBulkStatusClient(order?.status)));
    }
    return bulkOrders;
  }, [bulkOrders, bulkStatusFilter]);

  const bulkOrdersByStatus = useMemo(() => {
    const grouped = new Map();
    filteredBulkOrders.forEach((order) => {
      const status = order?.status || "unknown";
      if (!grouped.has(status)) {
        grouped.set(status, []);
      }
      grouped.get(status).push(order);
    });
    return grouped;
  }, [filteredBulkOrders]);

  const handleBulkMessage = useCallback(
    async (orderId, message) => {
      if (!token || !message) return;
      try {
        const res = await postBulkOrderVendorMessage(token, orderId, message);
        if (res?.status === "ok" && res.order) {
          setBulkOrders((prev) => prev.map((order) => (order.id === orderId ? res.order : order)));
        }
      } catch (error) {
        console.error("Failed to post bulk message", error);
      }
    },
    [token]
  );

  const handleBulkConfirm = useCallback(
    async (orderId, payload) => {
      if (!token) return;
      try {
        const res = await confirmBulkOrderSlot(token, orderId, payload);
        if (res?.status === "ok" && res.order) {
          setBulkOrders((prev) => prev.map((order) => (order.id === orderId ? res.order : order)));
        }
      } catch (error) {
        console.error("Failed to confirm bulk order slot", error);
      }
    },
    [token]
  );

  const handleThresholdSave = useCallback(async () => {
    if (!token) return;
    const value = Number(thresholdDraft);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Threshold must be a positive number');
      return;
    }
    try {
      await updateInterestThreshold(token, value);
      toast.success('Threshold updated');
      loadInterest();
    } catch (error) {
      console.error('Failed to update threshold', error);
      toast.error('Failed to update threshold');
    }
  }, [token, thresholdDraft, loadInterest]);

  return (
    <div>
      <h2>{vendorShopName || 'Vendor'} Dashboard</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>
        Total Orders: {orders.length} | Pending: {orders.filter(o => o.status === 'pending').length}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setMuted(m => !m)}>{muted ? 'Unmute Alerts' : 'Mute Alerts'}</button>
        <span style={{ fontSize: 12, color: '#777' }}>(Overdue sound alerts)</span>
        <button onClick={() => setShowLowStock(v => !v)}>
          {showLowStock ? 'Hide Low Stock' : `Low Stock Items (${lowStockItems.length})`}
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof onOpenPrinterSetup === 'function') {
              onOpenPrinterSetup();
            } else {
              window.dispatchEvent(new CustomEvent('navigate:menu-editor', { detail: { to: 'printer-setup' } }));
            }
          }}>
          Printer Setup Help
        </button>
        <button
          onClick={() => {
            if (!interestVisible) {
              loadInterest();
            }
            setInterestVisible((visible) => !visible);
          }}
        >
          {interestVisible ? 'Hide Interest Details' : 'Show Interest Details'}
        </button>
      </div>
      {interestVisible && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>Interest Tracking</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="number"
                min="1"
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                style={{ width: 80 }}
                placeholder="Threshold"
              />
              <button onClick={handleThresholdSave} disabled={interestLoading}>Save Threshold</button>
              <button onClick={loadInterest} disabled={interestLoading}>
                {interestLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          {interestError && (
            <div style={{ padding: 10, color: '#e74c3c', fontSize: 13 }}>{interestError}</div>
          )}
          {!interestError && !interestSummary && (
            <div style={{ padding: 10, color: '#666', fontSize: 13 }}>
              {interestLoading ? 'Loading interest summary…' : 'No interest data yet.'}
            </div>
          )}
          {interestSummary && (
            <div style={{ padding: 10, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div className="card" style={{ padding: 12, flex: '1 1 180px' }}>
                  <div style={{ fontSize: 12, color: '#666' }}>Threshold</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{(interestSummary.threshold ?? thresholdDraft) || '--'}</div>
                </div>
                <div className="card" style={{ padding: 12, flex: '1 1 180px' }}>
                  <div style={{ fontSize: 12, color: '#666' }}>Unique Employees</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{interestSummary.totals?.uniqueEmployees ?? 0}</div>
                </div>
                <div className="card" style={{ padding: 12, flex: '1 1 180px' }}>
                  <div style={{ fontSize: 12, color: '#666' }}>Restock Suggestions</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#7c3aed' }}>{interestSummary.totals?.restockSuggestions ?? 0}</div>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table border="1" cellPadding="8" width="100%">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Shop</th>
                      <th>Interested Employees</th>
                      <th>Status</th>
                      <th>Last Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(interestSummary.items) && interestSummary.items.length > 0 ? (
                      interestSummary.items.map((item) => (
                        <tr key={`${item.shopId}:${item.itemId}`} style={{ background: item.restockSuggested ? '#f5f3ff' : undefined }}>
                          <td>
                            <strong>{item.metadata?.itemName || `Item ${item.itemId}`}</strong>
                            <div style={{ fontSize: 11, color: '#666' }}>ID: {item.itemId}</div>
                          </td>
                          <td>{item.metadata?.shopName || item.shopId}</td>
                          <td style={{ fontWeight: 600 }}>{item.uniqueEmployees ?? 0}</td>
                          <td>
                            {item.restockSuggested ? (
                              <span style={{ color: '#7c3aed', fontWeight: 600 }}>Threshold reached</span>
                            ) : item.soldOut ? (
                              <span style={{ color: '#e74c3c' }}>Sold out</span>
                            ) : item.lowStock ? (
                              <span style={{ color: '#e67e22' }}>Low stock</span>
                            ) : (
                              <span style={{ color: '#2c3e50' }}>Monitoring</span>
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: '#555' }}>
                            {item.lastExpressedAt ? new Date(item.lastExpressedAt).toLocaleString('en-IN', { hour12: true }) : '—'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: 16, color: '#777' }}>No interest recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {showLowStock && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-header">Low Stock Items (≤ {lowStockThreshold})</div>
          {lowStockItems.length === 0 ? (
            <div style={{ padding: 10, fontSize: 13, color: '#666' }}>No low stock items.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table border="1" cellPadding="8" width="100%">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Inventory</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockItems.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.name}</td>
                      <td style={{ color: '#e67e22', fontWeight: 700 }}>{Number(it.inventory ?? 0)}</td>
                      <td>
                        <button onClick={()=>window.dispatchEvent(new CustomEvent('navigate:menu-editor', { detail: { to: 'menu-editor', itemId: it.id } }))}>Restock</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setTab('current')} className={tab==='current' ? 'active' : ''}>Current</button>
        <button onClick={() => setTab('ready')} className={tab==='ready' ? 'active' : ''}>Ready</button>
        <button onClick={() => setTab('completed')} className={tab==='completed' ? 'active' : ''}>Completed</button>
        <button onClick={() => setTab('bulk')} className={tab==='bulk' ? 'active' : ''}>Bulk Orders</button>
      </div>
      {tab === 'current' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#555' }}>Bulk extend pending by</span>
          <input type="number" min="1" value={bulkMins} onChange={(e)=>setBulkMins(Number(e.target.value)||0)} style={{ width: 80 }} />
          <span>mins</span>
          <button onClick={() => bulkMins>0 && handleBulkExtend(bulkMins)}>Extend All</button>
        </div>
      )}
      
      <div style={{ overflowX: "auto" }}>
        {tab !== "bulk" && (
          <table border="1" cellPadding="10" width="100%">
            <thead>
              <tr>
                <th>Billing ID</th>
                <th>User</th>
                <th>Items</th>
                {tab !== 'completed' && <th>Remarks</th>}
                {tab !== 'completed' && <th>Scheduled For</th>}
                {tab === 'current' && <th>Prep Time</th>}
                {tab === 'current' && <th>Countdown</th>}
                {tab === 'current' && <th>Extend</th>}
                <th>Status</th>
                <th>Print</th>
                {tab !== 'completed' && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: 30, color: "#999" }}>
                    No orders to display
                  </td>
                </tr>
              )}
              {visibleOrders.map((o) => (
                <tr key={o.id} style={{ background: o.status === 'pending' ? '#fff3cd' : (o.status === 'ready' ? '#d4edda' : '#f8f9fa') }}>
                  <td><strong>{o.billingId}</strong></td>
                  <td>{o.user}</td>
                  <td>
                    {o.items.map((it, idx) => (
                      <div key={idx} style={{ fontSize: 12, marginBottom: 4 }}>
                        {it.name} {it.option && `(${it.option})`} x{it.quantity}
                      </div>
                    ))}
                  </td>
                  {tab !== 'completed' && (
                    <td style={{ fontSize: 11 }}>
                      {o.items.map((it, idx) => (
                        it.customization && it.customization.notes ? (
                          <div key={idx} style={{ marginBottom: 8, padding: 4, background: "#f8f9fa", borderRadius: 4 }}>
                            <strong>{it.name}:</strong>
                            <div>📝 {it.customization.notes}</div>
                          </div>
                        ) : null
                      ))}
                    </td>
                  )}
                  {tab !== 'completed' && (
                    <td style={{ fontSize: 12 }}>
                      {o.scheduledTime ? new Date(o.scheduledTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
                    </td>
                  )}
                  {tab === 'current' && <td>{o.prepTime} mins</td>}
                  {tab === 'current' && (
                    <td>
                      <CountdownDisplay info={countdownMap.get(o.id)} />
                    </td>
                  )}
                  {tab === 'current' && (
                    <td>
                      {o.status === 'pending' && (
                        <ExtendControl order={o} token={token} onExtended={loadOrders} />
                      )}
                      {o.status === 'pending' && (o.etaExtensionMinutes || 0) > 0 && (remainingTime(o) === null || remainingTime(o) >= 0) && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            style={{ background: '#e74c3c' }}
                            onClick={async () => {
                              const ok = window.confirm('Revoke extended time and restore previous ETA?');
                              if (!ok) return;
                              await revokeOrderExtension(o.id, token);
                              loadOrders();
                            }}
                          >Revoke Extension</button>
                        </div>
                      )}
                    </td>
                  )}
                  <td>
                    {isOrderOverdue(o) ? (
                      <span style={{
                        display: 'inline-block',
                        background: '#e74c3c',
                        color: '#fff',
                        borderRadius: 12,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 700
                      }}>
                        OVERDUE
                      </span>
                    ) : (
                      <span className={`badge badge-${o.status === 'ready' ? 'success' : 'warning'}`}>
                        {o.status.toUpperCase()}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => handlePrintOrder(o)}
                      style={{ background: '#2c3e50', color: '#fff' }}
                    >
                      Print Ticket
                    </button>
                    <div style={{ marginTop: 6 }}>
                      <button
                        onClick={() => handlePrintOrder(o, { previewFallback: true })}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        Preview Only
                      </button>
                    </div>
                  </td>
                  {tab !== 'completed' && (
                    <td>
                      {o.status === "pending" && (
                        <button onClick={() => markReady(o.id)} style={{ background: "#27ae60" }}>
                          Mark Ready
                        </button>
                      )}
                      {o.status === "ready" && (
                        <>
                          <span style={{ color: "#27ae60", marginRight: 8 }}>✓ Ready</span>
                          <button onClick={async () => { await markOrderPicked(o.id, token); loadOrders(); }} style={{ background: "#2c3e50" }}>Mark Picked</button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {tab === "bulk" && (
        <div className="bulk-orders-wrapper">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <label style={{ fontSize: 13, color: '#555', marginRight: 8 }}>Filter bulk orders</label>
              <select value={bulkStatusFilter} onChange={handleBulkStatusChange}>
                {BULK_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="secondary-button" onClick={() => loadBulkOrders()} disabled={bulkLoading}>
              Refresh
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#6b7a8b', marginBottom: 8 }}>
            Last updated: {bulkLastFetchedAt ? new Date(bulkLastFetchedAt).toLocaleTimeString() : '--'}
          </div>
          {bulkLoading ? (
            <div style={{ padding: 16 }}>Loading bulk orders…</div>
          ) : bulkError ? (
            <div className="error" style={{ padding: 16 }}>{bulkError}</div>
          ) : bulkOrders.length === 0 ? (
            <div style={{ padding: 16 }}>No bulk orders yet.</div>
          ) : (
            Array.from(bulkOrdersByStatus.entries()).map(([status, list]) => (
              <div key={status} className="bulk-section">
                <h3 style={{ marginTop: 24 }}>{status.toUpperCase()} ({list.length})</h3>
                <div className="bulk-list">
                  {list.map((order) => (
                    <BulkOrderCard
                      key={order.id}
                      order={order}
                      onPostMessage={handleBulkMessage}
                      onConfirm={handleBulkConfirm}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const ExtendControl = ({ order, token, onExtended }) => {
  const [minutes, setMinutes] = useState(() => {
    const base = Number(order?.etaExtensionMinutes) || 0;
    return base > 0 ? base : 5;
  });
  const [submitting, setSubmitting] = useState(false);

  const handleExtend = async () => {
    const mins = Number(minutes) || 0;
    if (mins <= 0 || !order?.id) return;
    try {
      setSubmitting(true);
      await extendOrderPrep(order.id, mins, token);
      onExtended?.();
    } catch (error) {
      console.error("Failed to extend order", error);
      window.alert("Could not extend order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="number"
        min="1"
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value) || 0)}
        style={{ width: 70 }}
        disabled={submitting}
      />
      <span style={{ fontSize: 12 }}>mins</span>
      <button onClick={handleExtend} disabled={submitting}>
        {submitting ? "Extending…" : "Extend"}
      </button>
    </div>
  );
};

const formatDateTime = (value, options = {}) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const { withTime = true } = options;
  const config = withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" };
  return date.toLocaleString("en-IN", config);
};

const BulkOrderCard = ({ order, onPostMessage, onConfirm }) => {
  const [message, setMessage] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState(() => {
    const slots = Array.isArray(order?.deliverySlots) ? order.deliverySlots : [];
    return slots.length > 0 ? String(slots[0].id) : "";
  });
  const [responseStatus, setResponseStatus] = useState("confirmed");
  const [capacity, setCapacity] = useState("");

  const slots = Array.isArray(order.deliverySlots) ? order.deliverySlots : [];
  const itemGroups = Array.isArray(order.itemGroups) ? order.itemGroups : [];
  const attendees = Array.isArray(order.attendeeGroups) ? order.attendeeGroups : [];
  const vendorResponses = Array.isArray(order.vendorResponses) ? order.vendorResponses : [];
  const vendorMessages = Array.isArray(order.vendorMessages) ? order.vendorMessages : [];
  const requestedVendors = Array.isArray(order.requestedVendors)
    ? order.requestedVendors
    : typeof order.requestedVendorsText === "string" && order.requestedVendorsText.trim().length > 0
      ? order.requestedVendorsText.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)
      : [];
  const normalizedStatus = normalizeBulkStatusClient(order?.status);
  const isClosed = ["completed", "cancelled", "admin_rejected"].includes(normalizedStatus);

  const formatCurrency = (value) => {
    if (value == null || value === "") return "—";
    const num = Number(value);
    return Number.isNaN(num) ? String(value) : `₹${num.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  };

  const handleSendMessage = () => {
    if (!message.trim()) return;
    onPostMessage?.(order.id, message.trim());
    setMessage("");
  };

  const handleConfirm = () => {
    if (!selectedSlotId && slots.length > 0) return;
    onConfirm?.(order.id, {
      slotId: selectedSlotId || (slots[0] && slots[0].id),
      status: responseStatus,
      capacity: capacity ? Number(capacity) : undefined,
      message,
    });
    setMessage("");
    setCapacity("");
  };

  return (
    <div className="bulk-card">
      <div className="bulk-card-header">
        <div>
          <strong>#{order.id}</strong> · {order.eventName || "Untitled Event"}
        </div>
        <div>Status: <strong>{(order.status || '').toUpperCase()}</strong></div>
      </div>
      <div className="bulk-card-body">
        <div className="bulk-meta">
          <div>Organizer: {order.organizerContact?.name || order.organizer?.name || '—'}</div>
          <div>Guests: {order.expectedHeadcount || order.expectedGuests || 'n/a'}</div>
          <div>Location: {order.location || '—'}</div>
          <div>Event type: {order.eventType || '—'}</div>
          <div>Theme: {order.eventTheme || '—'}</div>
          <div>Event date: {formatDateTime(order.eventDate, { withTime: false })}</div>
          <div>Start: {formatDateTime(order.eventStartTime)}</div>
          <div>End: {formatDateTime(order.eventEndTime)}</div>
          <div>Campus / Building / Floor: {[order.campus, order.building, order.floor].filter(Boolean).join(' · ') || '—'}</div>
          <div>Pricing mode: {order.pricing?.pricingType || order.pricing?.pricing_type || order.pricingType || 'vendor_rate'}</div>
          <div>Bulk discount: {order.pricing?.bulkDiscountPercent != null ? `${order.pricing.bulkDiscountPercent}%` : '—'}</div>
          <div>Flat rate: {order.pricing?.bulkFlatRate != null ? formatCurrency(order.pricing.bulkFlatRate) : '—'}</div>
          <div>Notes: {order.specialInstructions || order.notes || 'None'}</div>
        </div>
        <div className="bulk-section" style={{ marginTop: 12 }}>
          <h4>Organizer Contact</h4>
          <div>Email: {order.organizerContact?.email || order.organizer?.email || '—'}</div>
          <div>Mobile: {order.organizerContact?.mobile || order.organizer?.mobile || '—'}</div>
          {requestedVendors.length > 0 && (
            <div style={{ marginTop: 6 }}>
              Preferred vendors:
              <ul>
                {requestedVendors.map((vendor) => (
                  <li key={vendor}>{vendor}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {itemGroups.length > 0 && (
          <div className="bulk-section" style={{ marginTop: 16 }}>
            <h4>Menu Plan</h4>
            <table className="bulk-items" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Item / Group</th>
                  <th style={{ textAlign: "center" }}>Quantity</th>
                  <th style={{ textAlign: "center" }}>Unit price</th>
                  <th style={{ textAlign: "left" }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {itemGroups.map((item) => (
                  <tr key={item.id || item.name}>
                    <td>{item.name || item.itemName || item.category || "—"}</td>
                    <td style={{ textAlign: "center" }}>{item.quantity ?? "—"}</td>
                    <td style={{ textAlign: "center" }}>{formatCurrency(item.unitPrice ?? item.price)}</td>
                    <td>{item.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="bulk-slots">
          <h4>Delivery Slots</h4>
          {slots.length === 0 ? (
            <div>Not specified</div>
          ) : (
            <ul>
              {slots.map((slot) => (
                <li key={slot.id}>
                  <label>
                    <input
                      type="radio"
                      name={`slot-${order.id}`}
                      checked={String(selectedSlotId) === String(slot.id)}
                      onChange={() => setSelectedSlotId(String(slot.id))}
                    />
                    {slot.label || slot.startTime} · {new Date(slot.startTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    {slot.vendorConfirmation ? ` (${slot.vendorConfirmation})` : ""}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        {attendees.length > 0 && (
          <div className="bulk-attendees">
            <h4>Attendee Groups</h4>
            <ul>
              {attendees.map((group) => (
                <li key={group.id}>
                  {group.label}: {group.count} {group.notes ? `– ${group.notes}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="bulk-actions">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Share updates or ask questions"
            disabled={isClosed}
          />
          <div className="bulk-action-row">
            <select value={responseStatus} onChange={(e) => setResponseStatus(e.target.value)} disabled={isClosed}>
              <option value="confirmed">Confirm slot</option>
              <option value="pending">Need clarification</option>
              <option value="rejected">Cannot fulfill</option>
            </select>
            <input
              type="number"
              min="0"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Capacity"
              style={{ width: 120 }}
              disabled={isClosed}
            />
          </div>
          <div className="bulk-button-row">
            <button onClick={handleConfirm} className="primary-button" disabled={isClosed}>Submit Response</button>
            <button onClick={handleSendMessage} className="secondary-button" disabled={isClosed || !message.trim()}>Post Message</button>
          </div>
        </div>
        <div className="bulk-history">
          <h4>Recent Vendor Responses</h4>
          {vendorResponses.length === 0 ? (
            <div>No confirmations yet.</div>
          ) : (
            <ul>
              {vendorResponses.slice(0, 3).map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.status?.toUpperCase()}</strong> · {new Date(entry.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                  {entry.capacity != null ? ` · capacity ${entry.capacity}` : ""}
                  {entry.message ? ` – ${entry.message}` : ""}
                </li>
              ))}
            </ul>
          )}
          {vendorMessages.length > 0 && (
            <div className="bulk-messages">
              <h4>Message Thread</h4>
              <ul>
                {vendorMessages.slice(0, 3).map((entry) => (
                  <li key={entry.id}>
                    {new Date(entry.timestamp).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}: {entry.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;