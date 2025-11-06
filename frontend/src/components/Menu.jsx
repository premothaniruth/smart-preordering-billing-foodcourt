import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toggleFavorite, fetchActiveOffers, fetchCombos, fetchMenuSections, fetchSectionsMeta, expressInterest } from "../api";
import { API_URL } from "../config";
import { toast } from "react-toastify";

const toHM = (date = new Date()) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const hmToMinutes = (hm) => {
  if (!hm || typeof hm !== "string") return null;
  const [hours, minutes] = hm.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

const compareHM = (a, b) => {
  const aMinutes = hmToMinutes(a);
  const bMinutes = hmToMinutes(b);
  if (aMinutes == null && bMinutes == null) return 0;
  if (aMinutes == null) return -1;
  if (bMinutes == null) return 1;
  return aMinutes - bMinutes;
};

const windowSpansMidnight = (win) => {
  if (!win || !win.start || !win.end) return false;
  return compareHM(win.start, win.end) > 0;
};

const isHMWithinWindow = (win, hm) => {
  if (!win || !win.start || !win.end || !hm) return true;
  if (win.start === win.end) return true;
  if (!windowSpansMidnight(win)) {
    return compareHM(hm, win.start) >= 0 && compareHM(hm, win.end) <= 0;
  }
  return compareHM(hm, win.start) >= 0 || compareHM(hm, win.end) <= 0;
};

const isBeforeWindow = (win, hm) => {
  if (!win || !win.start || !win.end || !hm) return false;
  if (win.start === win.end) return false;
  if (!windowSpansMidnight(win)) {
    return compareHM(hm, win.start) < 0;
  }
  return compareHM(hm, win.start) < 0 && compareHM(hm, win.end) > 0;
};

const isAfterWindow = (win, hm) => {
  if (!win || !win.start || !win.end || !hm) return false;
  if (win.start === win.end) return false;
  if (!windowSpansMidnight(win)) {
    return compareHM(hm, win.end) > 0;
  }
  return compareHM(hm, win.end) > 0 && compareHM(hm, win.start) < 0;
};

const getDateId = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const diffDateIds = (a, b) => {
  if (!a || !b) return null;
  const parse = (id) => {
    const [y, m, d] = id.split("-").map(Number);
    if ([y, m, d].some((n) => Number.isNaN(n))) return null;
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  };
  const dateA = parse(a);
  const dateB = parse(b);
  if (!dateA || !dateB) return null;
  const diffMs = dateA.getTime() - dateB.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
};

const PREORDER_WINDOW = { start: "08:00", end: "22:30" };
const PREORDER_SECTION_ALIASES = ["pre-order", "pre order", "preorder", "pre-order items", "pre order items"];
const isPreOrderSectionName = (sectionName) => {
  if (!sectionName) return false;
  const normalized = String(sectionName).trim().toLowerCase();
  return PREORDER_SECTION_ALIASES.includes(normalized);
};

const getItemSectionName = (item = {}) =>
  item.sectionName || item.section || item.categoryName || item.category || item.sectionLabel || item.sectionTitle || "";

const formatWindow = (win) => {
  if (!win || !win.start || !win.end) return null;
  return `${win.start}-${win.end}`;
};

const FALLBACK_IMAGE = "https://dummyimage.com/200x150/95a5a6/ffffff&text=No+Image";

const Menu = ({
  menu,
  addToCart,
  cart = [],
  incItemNoOption = () => {},
  decItemNoOption = () => {},
  incItemVariant = () => {},
  decItemVariant = () => {},
  selectedShop,
  setSelectedShop,
  favorites = [],
  cartShopMismatch = false,
  onFavoriteToggle,
  userId,
  hideFavorites = false,
  hideShopSelector = false,
  showInventory = false,
  readOnly = false,
  scheduledTime = '',
  activeSection: activeSectionProp = null,
  onActiveSectionChange,
  employeeToken = null,
  foodCourt,
  onFoodCourtChange,
}) => {
  const [vegOnly, setVegOnly] = useState(false);
  const [nonVegOnly, setNonVegOnly] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [multiOptionQuantities, setMultiOptionQuantities] = useState({});
  const [variantDrafts, setVariantDrafts] = useState({});
  const [offers, setOffers] = useState([]);
  const [combos, setCombos] = useState([]);
  const [sectioned, setSectioned] = useState(null);
  const [activeSection, setActiveSection] = useState(activeSectionProp || null);
  const [sectionWindows, setSectionWindows] = useState({});
  const [currentHm, setCurrentHm] = useState(toHM());
  const [interestSummaries, setInterestSummaries] = useState({});
  const [interestPending, setInterestPending] = useState(false);
  const [expressedInterest, setExpressedInterest] = useState({});
  const interestCooldownsRef = useRef(new Map()); // key -> timestamp
  const shopMenuRef = useRef(null);
  const [shopMenuOpen, setShopMenuOpen] = useState(false);

  const todayDateId = useMemo(() => getDateId(new Date()), [currentHm]);

  const scheduleInfo = useMemo(() => {
    if (!scheduledTime) {
      return {
        enabled: false,
        valid: false,
        hm: null,
        dateId: null,
        dayDiff: null,
        raw: "",
        isToday: false,
        isTomorrow: false
      };
    }

    const parsed = new Date(scheduledTime);
    if (Number.isNaN(parsed.getTime())) {
      return {
        enabled: true,
        valid: false,
        hm: null,
        dateId: null,
        dayDiff: null,
        raw: scheduledTime,
        isToday: false,
        isTomorrow: false
      };
    }

    const dateId = getDateId(parsed);
    const hm = toHM(parsed);
    const dayDiff = dateId && todayDateId ? diffDateIds(dateId, todayDateId) : null;

    return {
      enabled: true,
      valid: true,
      hm,
      dateId,
      dayDiff,
      raw: scheduledTime,
      isToday: dayDiff === 0,
      isTomorrow: dayDiff === 1
    };
  }, [scheduledTime, todayDateId]);

  const getItemImageSrc = useCallback((item) => {
    const raw = item?.image;
    if (!raw || typeof raw !== "string") return null;
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
    const normalized = raw.startsWith("/") ? raw : `/${raw}`;
    return `${API_URL}${normalized}`;
  }, [API_URL]);

  useEffect(() => {
    let ignore = false;

    const loadMeta = async () => {
      try {
        const meta = await fetchSectionsMeta();
        if (!ignore) {
          setSectionWindows(meta?.windows || {});
        }
      } catch (error) {
        console.error("Failed to load section metadata", error);
        if (!ignore) {
          setSectionWindows({});
        }
      }
    };

    loadMeta();

    const ticker = setInterval(() => {
      setCurrentHm(toHM());
    }, 60000);

    return () => {
      ignore = true;
      clearInterval(ticker);
    };
  }, []);

  useEffect(() => {
    if (!selectedShop) {
      setSectioned(null);
      setOffers([]);
      setCombos([]);
      setActiveSection(activeSectionProp || null);
      return;
    }

    let ignore = false;
    const scheduledDate = scheduledTime ? new Date(scheduledTime) : null;
    const at = scheduledDate && !Number.isNaN(scheduledDate.getTime()) ? scheduledDate : null;

    const loadShopData = async () => {
      try {
        const [sectionsData, offersData, combosData] = await Promise.all([
          fetchMenuSections(selectedShop, at || undefined, foodCourt),
          fetchActiveOffers(selectedShop, foodCourt),
          fetchCombos(selectedShop, true, foodCourt),
        ]);

        if (ignore) return;

        setSectioned(sectionsData || null);
        setOffers(Array.isArray(offersData) ? offersData : []);
        setCombos(Array.isArray(combosData) ? combosData : []);

        const sections = Array.isArray(sectionsData?.sections) ? sectionsData.sections : [];
        setActiveSection((prev) => {
          if (activeSectionProp && sections.some((sec) => sec.name === activeSectionProp)) {
            return activeSectionProp;
          }
          if (prev && sections.some((sec) => sec.name === prev)) {
            return prev;
          }
          return sections.length > 0 ? sections[0].name : null;
        });
      } catch (error) {
        console.error("Failed to load menu data for shop", selectedShop, error);
        if (ignore) return;
        setSectioned(null);
        setOffers([]);
        setCombos([]);
        setActiveSection(activeSectionProp || null);
      }
    };

    loadShopData();

    return () => {
      ignore = true;
    };
  }, [selectedShop, scheduledTime, activeSectionProp, foodCourt]);

  useEffect(() => {
    if (activeSectionProp === undefined) return;
    setActiveSection((prev) => {
      if (activeSectionProp == null) {
        return null;
      }
      if (prev === activeSectionProp) {
        return prev;
      }
      return activeSectionProp;
    });
  }, [activeSectionProp]);

  useEffect(() => {
    if (typeof onActiveSectionChange === "function") {
      onActiveSectionChange(activeSection ?? null);
    }
  }, [activeSection, onActiveSectionChange]);

  const currentShop = useMemo(() => {
    if (!menu || !Array.isArray(menu)) return null;
    if (!selectedShop) return null;
    return menu.find((shop) => String(shop.shopId) === String(selectedShop)) || null;
  }, [menu, selectedShop]);

  const availableShops = useMemo(() => {
    if (!Array.isArray(menu)) return [];
    return menu.map((shop) => ({
      shopId: shop.shopId,
      shopName: shop.shopName || shop.name || `Shop ${shop.shopId}`,
    }));
  }, [menu]);

  const interestKey = (item) => `${selectedShop}:${item?.id}`;

  const isLowStockOrSoldOut = (item) => {
    if (!item) return { lowStock: false, soldOut: false };

    const inventory = Number(item.inventory ?? 0);
    if (!Number.isFinite(inventory)) return { lowStock: false, soldOut: false };
    const threshold = Number(item.lowStockThreshold ?? item.lowStockLimit ?? item.lowStock ?? 5);
    const soldOut = inventory <= 0;
    const lowStock = !soldOut && (Number.isFinite(threshold) ? inventory <= threshold : inventory <= 5);
    return { lowStock, soldOut };
  };

  const favoriteIds = useMemo(() => {
    if (!Array.isArray(favorites)) return new Set();
    return new Set(favorites.map((fav) => (typeof fav === 'object' ? fav.id ?? fav : fav)));
  }, [favorites]);

  const isFavorite = useCallback((itemId) => favoriteIds.has(itemId), [favoriteIds]);

  const handleFavoriteClick = useCallback((itemId, event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (typeof onFavoriteToggle === 'function') {
      onFavoriteToggle(itemId);
    }
  }, [onFavoriteToggle]);

  const offersForActiveSection = useMemo(() => {
    if (!Array.isArray(offers)) return [];
    if (!activeSection) return offers;
    return offers.filter((offer) => {
      if (!offer?.sections || !Array.isArray(offer.sections)) return true;
      return offer.sections.includes(activeSection);
    });
  }, [offers, activeSection]);

  const computeAvailabilityState = useCallback((sectionName) => {
    const sectionWindow = sectionWindows[sectionName] || null;
    const isPreOrderSection = isPreOrderSectionName(sectionName);
    const nowHm = currentHm;
    const scheduleHm = scheduleInfo.valid ? scheduleInfo.hm : null;

    const baseWindow = sectionWindow || (isPreOrderSection ? PREORDER_WINDOW : null);
    const activeWindow = baseWindow;

    const preorderWindow = PREORDER_WINDOW;
    const scheduleWithinPreorder = scheduleInfo.enabled
      ? scheduleInfo.valid && isHMWithinWindow(preorderWindow, scheduleInfo.hm) && (scheduleInfo.isToday || scheduleInfo.isTomorrow)
      : false;

    const scheduleWithinSection = scheduleInfo.enabled
      ? scheduleInfo.valid && isHMWithinWindow(activeWindow, scheduleInfo.hm)
      : false;

    const nowWithinSection = isHMWithinWindow(activeWindow, nowHm);
    const nowBeforeSection = isBeforeWindow(activeWindow, nowHm);
    const nowAfterSection = isAfterWindow(activeWindow, nowHm);

    const schedulePermissible = scheduleInfo.enabled
      ? (scheduleInfo.isToday || scheduleInfo.isTomorrow) && scheduleInfo.valid && scheduleWithinPreorder
      : false;

    const allowForSchedule = scheduleInfo.enabled && schedulePermissible && scheduleWithinSection;

    let allowAction = false;
    let lockedToNextDay = false;
    let freezeToNext = false;
    let chosenHm = scheduleInfo.enabled ? scheduleHm : nowHm;

    if (!activeWindow) {
      allowAction = true;
    } else if (scheduleInfo.enabled) {
      if (allowForSchedule) {
        allowAction = true;
      } else if (schedulePermissible) {
        allowAction = false;
        freezeToNext = true;
        lockedToNextDay = scheduleInfo.isToday;
      } else {
        allowAction = false;
      }
    } else if (nowWithinSection) {
      allowAction = true;
    } else if (nowAfterSection) {
      allowAction = false;
      freezeToNext = true;
      lockedToNextDay = true;
    } else if (nowBeforeSection) {
      allowAction = false;
    }

    if (!scheduleInfo.enabled && isPreOrderSection) {
      if (nowWithinSection && isHMWithinWindow(preorderWindow, nowHm)) {
        allowAction = true;
      } else {
        allowAction = false;
        if (nowAfterSection) {
          lockedToNextDay = true;
          freezeToNext = true;
        }
      }
    }

    const reason = (() => {
      if (allowAction) return null;
      if (freezeToNext) return "next-window";
      if (scheduleInfo.enabled) {
        if (!scheduleInfo.valid) return "invalid-schedule";
        if (!scheduleWithinPreorder) return "preorder-window";
        if (!scheduleWithinSection) return "section-window";
      } else {
        if (nowBeforeSection) return "pre-window";
        if (nowAfterSection) return "post-window";
      }
      return "unknown";
    })();

    return {
      allowAction,
      sectionWindow: activeWindow,
      nowWithinSection,
      freezeToNext,
      lockedToNextDay,
      reason,
      chosenHm,
      schedule: scheduleInfo,
      nowBeforeSection,
      nowAfterSection,
      scheduleWithinSection,
      scheduleWithinPreorder,
      schedulePermissible,
      isPreOrderSection,
    };
  }, [currentHm, scheduleInfo, sectionWindows]);

  const computeItemAvailability = useCallback((item) => {
    if (!item) {
      return {
        allowAction: false,
        allowedNow: false,
        sectionWindow: null,
        nextDayOnly: false,
        message: "Unavailable",
        reason: "unknown",
        freezeToNext: false,
        lockedToNextDay: false,
      };
    }

    const sectionName = getItemSectionName(item);
    const sectionState = computeAvailabilityState(sectionName);

    const allowAction = sectionState.allowAction;
    const allowedNow = allowAction && !scheduleInfo.enabled;
    const nextDayOnly = sectionState.lockedToNextDay;

    let message = null;
    if (!allowAction) {
      switch (sectionState.reason) {
        case "invalid-schedule":
          message = "Invalid schedule time";
          break;
        case "preorder-window":
          message = "Outside preorder window";
          break;
        case "section-window":
          message = "Outside section window";
          break;
        case "pre-window":
          message = "Opens later";
          break;
        case "post-window":
          message = "Closed for today";
          break;
        case "next-window":
          message = "Next window";
          break;
        default:
          message = "Unavailable";
      }
    }

    return {
      allowAction,
      allowedNow,
      sectionWindow: sectionState.sectionWindow,
      nextDayOnly,
      message,
      reason: sectionState.reason,
      freezeToNext: sectionState.freezeToNext,
      lockedToNextDay: sectionState.lockedToNextDay,
      sectionState,
    };
  }, [computeAvailabilityState, scheduleInfo.enabled]);

  const filteredItems = useMemo(() => {
    const items = Array.isArray(currentShop?.items) ? currentShop.items : [];
    if (vegOnly) return items.filter((item) => item.isVeg);
    if (nonVegOnly) return items.filter((item) => !item.isVeg);
    return items;
  }, [currentShop, vegOnly, nonVegOnly]);

  const sectionItems = useMemo(() => {
    if (!sectioned || !Array.isArray(sectioned.sections) || !activeSection) return filteredItems;
    const sec = sectioned.sections.find((s) => s.name === activeSection);
    if (!sec) return filteredItems;
    let items = Array.isArray(sec.items) ? sec.items : [];
    if (vegOnly) items = items.filter((item) => item.isVeg);
    else if (nonVegOnly) items = items.filter((item) => !item.isVeg);
    return items;
  }, [sectioned, activeSection, filteredItems, vegOnly, nonVegOnly]);

  const favoriteItems = useMemo(() => sectionItems.filter((item) => isFavorite(item.id)), [sectionItems, isFavorite]);
  const recommended = useMemo(() => sectionItems.filter((item) => item.isRecommended && !isFavorite(item.id)), [sectionItems, isFavorite]);
  const hotSellers = useMemo(
    () => sectionItems.filter((item) => item.isHotSeller && !item.isRecommended && !isFavorite(item.id)),
    [sectionItems, isFavorite]
  );
  const regularItems = useMemo(
    () => sectionItems.filter((item) => !item.isRecommended && !item.isHotSeller && !isFavorite(item.id)),
    [sectionItems, isFavorite]
  );

  const qtyInCart = useCallback(
    (item) => {
      return cart
        .filter((c) => c.shopId === selectedShop && c.item.id === item.id)
        .reduce((sum, c) => sum + c.quantity, 0);
    },
    [cart, selectedShop]
  );

  const qtyNoOption = useCallback(
    (item) => {
      const entry = cart.find((c) => c.shopId === selectedShop && c.item.id === item.id && !c.item.selectedOption);
      return entry ? entry.quantity : 0;
    },
    [cart, selectedShop]
  );

  const getItemPrice = useCallback((item) => {
    if (!item) return '₹0';
    const hasMods = item.hasOptions && Array.isArray(item.options) && item.options.some((o) => Number(o.priceModifier || 0) > 0);
    return `₹${item.price}${hasMods ? '+' : ''}`;
  }, []);

  const computeComboAvailability = useCallback((combo) => {
    if (!combo) {
      return {
        allowAction: false,
        sectionWindow: null,
        nextDayOnly: false,
        message: "Unavailable",
        reason: "unknown",
        freezeToNext: false,
        lockedToNextDay: false,
        sectionState: null,
      };
    }

    const sectionName = getItemSectionName(combo);
    const sectionState = computeAvailabilityState(sectionName);

    const allowAction = sectionState.allowAction;
    const nextDayOnly = sectionState.lockedToNextDay;

    let message = null;
    if (!allowAction) {
      switch (sectionState.reason) {
        case "invalid-schedule":
          message = "Invalid schedule time";
          break;
        case "preorder-window":
          message = "Outside preorder window";
          break;
        case "section-window":
          message = "Outside section window";
          break;
        case "pre-window":
          message = "Opens later";
          break;
        case "post-window":
          message = "Closed for today";
          break;
        case "next-window":
          message = "Next window";
          break;
        default:
          message = "Unavailable";
      }
    }

    return {
      allowAction,
      sectionWindow: sectionState.sectionWindow,
      nextDayOnly,
      message,
      reason: sectionState.reason,
      freezeToNext: sectionState.freezeToNext,
      lockedToNextDay: sectionState.lockedToNextDay,
      sectionState,
    };
  }, [computeAvailabilityState]);

  const handleAddClick = useCallback(
    (item) => {
      if (!item) return;
      if (cartShopMismatch) {
        toast.warn("Cart already has items from another shop. Please place separate orders.");
        return;
      }
      setSelectedItem(item);
      setShowOptionsModal(true);
      const draft = variantDrafts[item.id] || {};
      setMultiOptionQuantities(draft);
    },
    [cartShopMismatch, variantDrafts]
  );

  const canShowInterest = useCallback((item) => {
    if (!item || readOnly) return false;
    if (!employeeToken) return false;
    if (!currentShop || String(item.shopId ?? selectedShop) !== String(selectedShop)) return false;
    const { lowStock, soldOut } = isLowStockOrSoldOut(item);
    return lowStock || soldOut;
  }, [employeeToken, currentShop, selectedShop, isLowStockOrSoldOut, readOnly]);

  const handleExpressInterest = useCallback(async (item) => {
    if (!item || interestPending) return;
    if (!employeeToken) {
      toast.info('Please sign in as an employee to express interest.');
      return;
    }

    const key = interestKey(item);
    const now = Date.now();
    const cooldownUntil = interestCooldownsRef.current.get(key) || 0;
    if (now < cooldownUntil) {
      toast.info('Your interest is already submitted to the vendor.');
      return;
    }

    try {
      setInterestPending(true);
      const response = await expressInterest({ token: employeeToken, shopId: selectedShop, itemId: item.id });
      const status = response?.status;
      const summary = response?.summary;
      const cooldownMs = Number(response?.cooldownMs || 0);
      if (cooldownMs > 0) {
        interestCooldownsRef.current.set(key, now + cooldownMs);
      }

      if (status === 'duplicate') {
        toast.info('Your interest is already submitted to the vendor.');
      } else {
        toast.success('Interest recorded!');
      }

      setExpressedInterest((prev) => ({ ...prev, [key]: true }));

      if (summary) {
        const interestedCount = summary.uniqueEmployees ?? summary.totalClicks ?? 0;
        setInterestSummaries((prev) => ({ ...prev, [key]: summary, lastUpdated: Date.now() }));
        if (interestedCount > 0) {
          toast.info(`${interestedCount} employee${interestedCount === 1 ? '' : 's'} interested in ${summary.metadata?.itemName || item.name}`);
        }
      }
    } catch (error) {
      console.error('Express interest failed', error);
      toast.error('Failed to express interest. Please try again.');
    } finally {
      setInterestPending(false);
    }
  }, [employeeToken, selectedShop, interestKey, interestPending]);

  const renderItem = useCallback(
    (item) => {
      const totalQty = qtyInCart(item);
      const inventory = Number(item.inventory ?? 100);
      const cartRemaining = Math.max(0, inventory - totalQty);
      const stockLeft = Math.max(0, inventory);
      const thisQty = qtyNoOption(item);
      const itemAvail = computeItemAvailability(item);
      const { allowAction, nextDayOnly, message, sectionState } = itemAvail;
      const windowLabel = formatWindow(sectionState?.sectionWindow);
      const scheduleMeta = sectionState?.schedule;
      const showNextBadge = !allowAction;
      const badgeText = nextDayOnly ? 'NEXT DAY' : 'NEXT WINDOW';
      const showInterest = canShowInterest(item);
      const interestKeyValue = interestKey(item);
      const interestSummary = interestKeyValue ? interestSummaries[interestKeyValue] : null;
      const interestCount = Math.max(0, Number(interestSummary?.uniqueEmployees ?? 0));
      const hasExpressedInterest = Boolean(interestKeyValue && expressedInterest[interestKeyValue]);
      return (
        <div key={item.id} className="menu-item-card" style={totalQty > 0 ? { border: '2px solid #111', boxShadow: '0 0 0 3px rgba(0,0,0,0.05)' } : {}}>
          <div style={{ position: "relative" }}>
            <img
              src={getItemImageSrc(item) || FALLBACK_IMAGE}
              alt={item.name}
              className="menu-item-image"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = FALLBACK_IMAGE;
              }}
            />
            {!hideFavorites && (
              <button
                className="favorite-btn"
                onClick={(e) => handleFavoriteClick(item.id, e)}
                style={{ background: 'transparent', border: 'none', padding: 4 }}
              >
                {isFavorite(item.id) ? "❤️" : "🤍"}
              </button>
            )}
            {showInterest && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleExpressInterest(item);
                }}
                disabled={interestPending}
                style={{
                  position: 'absolute',
                  top: hideFavorites ? 8 : 48,
                  right: 8,
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: hasExpressedInterest ? '1px solid #d35400' : '1px solid rgba(0,0,0,0.2)',
                  background: hasExpressedInterest ? '#f39c12' : '#fff',
                  color: hasExpressedInterest ? '#fff' : '#f39c12',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  cursor: interestPending ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  opacity: interestPending ? 0.75 : 1,
                  transition: 'transform 0.15s ease, background 0.15s ease, color 0.15s ease',
                }}
                title={hasExpressedInterest ? 'Interest recorded' : 'Express interest'}
              >
                <span style={{ position: 'relative', lineHeight: 1 }}>
                  👍
                  {interestCount > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -10,
                        background: '#e67e22',
                        color: '#fff',
                        minWidth: 18,
                        height: 18,
                        borderRadius: 999,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '0 4px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
                      }}
                    >
                      {interestCount}
                    </span>
                  )}
                </span>
              </button>
            )}
            {showNextBadge && (
              <div style={{ position: 'absolute', top: 8, left: 8, background: '#7f8c8d', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                {badgeText}
              </div>
            )}
            {stockLeft === 0 && allowAction && (
              <div style={{ position: 'absolute', top: 8, left: 8, background: '#e74c3c', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                SOLD OUT
              </div>
            )}
            {stockLeft > 0 && stockLeft <= 10 && allowAction && (
              <div style={{ position: 'absolute', top: 8, left: 8, background: '#e67e22', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                FEW LEFT
              </div>
            )}
            {(() => {
              if (!item.restockedAt) return null;
              if (stockLeft === 0) return null;
              const d = new Date(item.restockedAt);
              const now = new Date();
              const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
              if (!sameDay) return null;
              return (
                <div style={{ position: 'absolute', top: 8, right: 8, background: '#2ecc71', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
                  RESTOCKED
                </div>
              );
            })()}
          </div>
          <div className="menu-item-content">
            <div className="menu-item-name">{item.name}</div>
            <div className="menu-item-price">
              {getItemPrice(item)}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
              {item.isVeg ? (
                <span className="menu-item-badge" style={{ color: "#27ae60", border: "1px solid #27ae60" }}>🟢</span>
              ) : (
                <span className="menu-item-badge" style={{ color: "#e74c3c", border: "1px solid #e74c3c" }}>🔴</span>
              )}
              {item.calories != null && (
                <span className="menu-item-calories" title="Approximate calories">
                  ~ {item.calories}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: "11px", color: "#666" }}>⏱️ {item.prepTime || 5} mins</span>
              {showInventory && (
                <span style={{ fontSize: 11, color: stockLeft === 0 ? '#e74c3c' : '#666' }}>Left: {stockLeft}</span>
              )}
            </div>
            {item.hasOptions && (
              <div style={{ fontSize: "11px", color: "#666", marginBottom: 4 }}>
                {item.options.length} options available
              </div>
            )}
            {!readOnly && (
              <div className="menu-item-actions" style={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>
                {(!item.hasOptions && thisQty > 0 && allowAction) ? (
                  <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <button
                      className="icon-btn"
                      onClick={() => decItemNoOption(item, selectedShop)}
                      style={{ width: 32, height: 32, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                    >−</button>
                    <span style={{ minWidth: 24, textAlign: 'center', fontWeight: 700 }}>{thisQty}</span>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        if (cartRemaining <= 0) { toast.error('No more items available to order'); return; }
                        if (cartShopMismatch) {
                          toast.warn("Cart already has items from another shop. Please place separate orders.");
                          return;
                        }
                        if (!allowAction) {
                          toast.info(nextDayOnly ? 'Available from next day' : 'Currently unavailable');
                          return;
                        }
                        incItemNoOption(item, selectedShop);
                      }}
                      disabled={cartRemaining <= 0 || cartShopMismatch || !allowAction}
                      style={{ width: 32, height: 32, background: '#fff', color: '#111', border: '1px solid #111', borderRadius: 6 }}
                    >+</button>
                  </div>
                ) : (
                  <button
                    className="icon-btn"
                    onClick={() => {
                      if (!item.hasOptions) {
                        if (cartRemaining <= 0) { toast.error('No more items available to order'); return; }
                        if (cartShopMismatch) {
                          toast.warn("Cart already has items from another shop. Please place separate orders.");
                          return;
                        }
                        if (!allowAction) {
                          toast.info(nextDayOnly ? 'Available from next day' : 'Currently unavailable');
                          return;
                        }
                        incItemNoOption(item, selectedShop);
                        return;
                      }
                      handleAddClick(item);
                    }}
                    disabled={!allowAction || cartRemaining <= 0 || cartShopMismatch}
                    style={{
                      width: "100%",
                      padding: '10px 12px',
                      background: '#fff',
                      color: '#111',
                      border: "1px solid #111",
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {stockLeft === 0 ? 'Sold Out' : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <circle cx="10" cy="20" r="1"/>
                          <circle cx="18" cy="20" r="1"/>
                          <path d="M2 2h2l3.6 7.59a2 2 0 0 0 1.8 1.17H17a2 2 0 0 0 2-1.5l1.38-5.5H6"/>
                        </svg>
                        Add to Cart
                      </>
                    )}
                  </button>
                )}
                {cartRemaining <= 0 && stockLeft > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#e74c3c', textAlign: 'center', width: '100%' }}>
                    No more items available to order
                  </div>
                )}
              </div>
            )}
            {(!message && !allowAction && windowLabel && (
              <div>Available during {windowLabel}</div>
            ))}
          </div>
        </div>
      );
    },
    [qtyInCart, qtyNoOption, getItemPrice, handleAddClick, computeItemAvailability, canShowInterest, interestKey, interestSummaries, handleExpressInterest, interestPending, expressedInterest]
  );

  const renderComboCard = useCallback((combo) => {
    const components = Array.isArray(combo?.components) ? combo.components : [];
    const comboAvail = computeComboAvailability(combo);
    const { allowAction, nextDayOnly, message, sectionState } = comboAvail;
    const windowLabel = formatWindow(sectionState?.sectionWindow);
    const scheduleMeta = sectionState?.schedule;
    const showBadge = !allowAction;
    const badgeText = nextDayOnly ? 'NEXT DAY' : 'NEXT WINDOW';

    const shopItems = Array.isArray(currentShop?.items) ? currentShop.items : [];
    const findItem = (id) => shopItems.find((i) => Number(i.id) === Number(id)) || null;

    const consumedByItemId = (() => {
      const map = new Map();
      for (const line of cart) {
        if (line.item?.comboId && Array.isArray(line.item?.comboComponents)) {
          for (const comp of line.item.comboComponents) {
            const need = Math.max(1, Number(comp.quantity || 1));
            map.set(comp.itemId, (map.get(comp.itemId) || 0) + need * Number(line.quantity || 0));
          }
        } else if (line.item && line.item.id != null) {
          map.set(Number(line.item.id), (map.get(Number(line.item.id)) || 0) + Number(line.quantity || 0));
        }
      }
      return map;
    })();

    const capacity = (() => {
      if (!components.length) return 0;
      let cap = Infinity;
      for (const c of components) {
        const it = findItem(c.itemId);
        const inv = Number(it?.inventory ?? 0);
        const need = Math.max(1, Number(c?.quantity || 1));
        const consumed = Number(consumedByItemId.get(Number(c.itemId)) || 0);
        const remainingUnits = Math.max(0, inv - consumed);
        const possible = Math.floor(remainingUnits / need);
        cap = Math.min(cap, possible);
      }
      return Number.isFinite(cap) ? cap : 0;
    })();

    const inCartCombo = cart.filter(c => c.shopId === selectedShop && c.item?.comboId === combo.id).reduce((s, c) => s + c.quantity, 0);
    const stockLeft = Math.max(0, capacity - inCartCombo);

    const compLines = components.map((c, idx) => {
      const fallbackName = shopItems.find(i => Number(i.id) === Number(c?.itemId))?.name;
      const base = c && (c.name || fallbackName || 'Item');
      const qty = Number(c?.quantity || 1);
      const opt = c?.option ? ` (${c.option})` : '';
      return (
        <div key={idx} style={{ display:'flex', justifyContent:'space-between', gap:8, fontSize:12, color:'#555' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{base}{opt}</span>
          <span style={{ color:'#333' }}>×{qty}</span>
        </div>
      );
    });

    const handleAddCombo = () => {
      if (cartShopMismatch) { toast.warn("Cart already has items from another shop. Please place separate orders."); return; }
      if (stockLeft <= 0) { toast.error('No more combos available to order'); return; }
      if (!allowAction) { toast.info(nextDayOnly ? 'Order opens next day' : 'Next order window not open yet'); return; }
      const synthetic = {
        id: 1000000 + Number(combo.id || 0),
        comboId: combo.id,
        name: combo.name || 'Combo',
        price: Number(combo.price || 0),
        available: stockLeft,
        image: '',
        prepTime: 10,
        inventory: stockLeft,
        comboComponents: components.map(c => ({ itemId: Number(c.itemId)||0, quantity: Number(c.quantity)||1 }))
      };
      addToCart(synthetic, selectedShop, null, {});
      toast.success(`${combo.name} combo added to cart!`);
    };

    return (
      <div key={combo.id} className="menu-item-card" style={{ position: 'relative' }}>
        <div className="menu-item-content">
          <div className="menu-item-name">{combo.name}</div>
          <div className="menu-item-price">
            ₹{combo.price}
            {(sectionState?.sectionWindow?.start && sectionState?.sectionWindow?.end) && (
              <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>({sectionState.sectionWindow.start}-{sectionState.sectionWindow.end})</span>
            )}
          </div>
          {showBadge && (
            <div style={{ position: 'absolute', top: 8, left: 8, background: '#7f8c8d', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
              {badgeText}
            </div>
          )}
          {stockLeft === 0 && allowAction && (
            <div style={{ position: 'absolute', top: 8, left: 8, background: '#e74c3c', color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 700 }}>
              SOLD OUT
            </div>
          )}
          <div style={{ fontSize: 12, color: '#666', margin: '6px 0' }}>Combo Offer</div>
          {components.length > 0 && (
            <div className="card" style={{ background:'#fafafa', border:'1px solid #eee', padding:8, margin:'6px 0' }}>
              <div style={{ fontWeight:600, fontSize:12, color:'#333', marginBottom:6 }}>Includes</div>
              <div style={{ display:'grid', gap:4 }}>
                {compLines}
              </div>
            </div>
          )}
          {showInventory && (
            <div style={{ fontSize: 11, color: stockLeft === 0 ? '#e74c3c' : '#666', marginBottom: 6 }}>Left: {stockLeft}</div>
          )}
          {(!allowAction || scheduleMeta?.enabled) && (
            <div style={{ marginBottom: 8, fontSize: 12, color: allowAction ? '#666' : '#c0392b', lineHeight: 1.4 }}>
              {message && <div>{message}{windowLabel ? ` (${windowLabel})` : ''}</div>}
              {allowAction && scheduleMeta?.enabled && scheduleMeta.valid && (
                <div>
                  Scheduled for {scheduleMeta.isTomorrow ? 'tomorrow' : 'today'} at {scheduleMeta.hm}
                  {windowLabel ? ` (${windowLabel})` : ''}
                </div>
              )}
              {!message && !allowAction && windowLabel && (
                <div>Available during {windowLabel}</div>
              )}
            </div>
          )}
          {!readOnly && (
            <button
              className="icon-btn"
              onClick={handleAddCombo}
              disabled={!allowAction || stockLeft <= 0 || cartShopMismatch}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#fff',
                color: '#111',
                border: "1px solid #111",
                borderRadius: 6,
                opacity: allowAction && stockLeft > 0 ? 1 : 0.6
              }}
            >
              {allowAction ? (stockLeft > 0 ? 'Add Combo' : 'Sold Out') : 'Next order is from tomorrow'}
            </button>
          )}
        </div>
      </div>
    );
  }, [addToCart, cart, cartShopMismatch, computeComboAvailability, currentShop, selectedShop, showInventory]);

  return (
    <div>
      <h2>Menu</h2>
      {offersForActiveSection.length > 0 && (
        <div className="card" style={{ marginBottom: 12, background: '#fff8e6', border: '1px solid #f1c40f' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Special Offers</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {offersForActiveSection.map((o)=> (
              <span key={o.id} className="menu-item-badge" style={{ borderColor: '#f1c40f', color: '#8a6d3b' }}>{o.bannerText || o.title}</span>
            ))}
          </div>
        </div>
      )}
      <div className="filter-section" style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginBottom: 12 }}>
        {typeof onFoodCourtChange === 'function' && (
          <div className="menu-food-court-selector" style={{ display:'flex', alignItems:'center', gap:8 }}>
            <label style={{ fontWeight: 600, fontSize: 13, color: '#2c3e50' }}>Food Court:</label>
            <select
              value={foodCourt}
              onChange={(e) => onFoodCourtChange(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14 }}
            >
              <option value="fc-1">FC‑1</option>
              <option value="fc-2">FC‑2</option>
            </select>
          </div>
        )}
        {!hideShopSelector && (
          <div className="menu-shop-selector">
            <label>Choose Shop:</label>
            <div className="shop-dropdown" ref={shopMenuRef}>
              <button
                type="button"
                className="secondary-button shop-selector-trigger"
                onClick={() => setShopMenuOpen((prev) => !prev)}
              >
                <span className="shop-selector-label compact">
                  <span className="shop-selector-text">{currentShop ? currentShop.shopName : "Select Shop"}</span>
                </span>
              </button>
              {shopMenuOpen && (
                <div className="concern-dropdown" style={{ minWidth: 220 }}>
                  {availableShops.length === 0 && (
                    <div className="dropdown-empty">No shops available</div>
                  )}
                  {availableShops.map((shop) => (
                    <button
                      type="button"
                      key={shop.shopId}
                      onClick={() => {
                        setSelectedShop(Number(shop.shopId));
                        setShopMenuOpen(false);
                        if (typeof onActiveSectionChange === "function") {
                          onActiveSectionChange(null);
                        }
                      }}
                    >
                      <span className="shop-name">{shop.shopName}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div style={{ display:'inline-flex', alignItems:'center', gap:10, background:'#fff', border:'none', borderRadius:12, padding:'6px 12px' }}>
          <span aria-hidden title="Veg only" style={{ color:'#27ae60' }}>🌿</span>
          <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer' }}>
            <span style={{ fontSize: 13 }}>Veg only</span>
            <input
              type="checkbox"
              checked={vegOnly}
              onChange={(e)=>{ const v = e.target.checked; setVegOnly(v); if (v) setNonVegOnly(false); }}
              style={{ display:'none' }}
            />
            <span aria-hidden style={{ width:36, height:20, borderRadius:12, background: vegOnly ? '#27ae60' : '#ccc', position:'relative', transition:'all 0.2s' }}>
              <span style={{ position:'absolute', top:2, left: vegOnly ? 18 : 2, width:16, height:16, background:'#fff', borderRadius:'50%', transition:'left 0.2s' }} />
            </span>
          </label>
        </div>
        <div style={{ display:'inline-flex', alignItems:'center', gap:10, background:'#fff', border:'none', borderRadius:12, padding:'6px 12px' }}>
          <span aria-hidden title="Non-veg only" style={{ color:'#e74c3c' }}>🍗</span>
          <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer' }}>
            <span style={{ fontSize: 13 }}>Non-veg only</span>
            <input
              type="checkbox"
              checked={nonVegOnly}
              onChange={(e)=>{ const v = e.target.checked; setNonVegOnly(v); if (v) setVegOnly(false); }}
              style={{ display:'none' }}
            />
            <span aria-hidden style={{ width:36, height:20, borderRadius:12, background: nonVegOnly ? '#e74c3c' : '#ccc', position:'relative', transition:'all 0.2s' }}>
              <span style={{ position:'absolute', top:2, left: nonVegOnly ? 18 : 2, width:16, height:16, background:'#fff', borderRadius:'50%', transition:'left 0.2s' }} />
            </span>
          </label>
        </div>
      </div>
      {combos && combos.length > 0 && (
        <>
          <h3>🎁 Combo Offers</h3>
          <div className="menu-grid">
            {combos.map(renderComboCard)}
          </div>
        </>
      )}

      {sectioned && Array.isArray(sectioned.sections) && sectioned.sections.length > 0 && (
        <div className="section-tabs">
          {(() => {
            const order = { Breakfast: 1, Lunch: 2, Dinner: 3 };
            return sectioned.sections
              .slice()
              .sort((a, b) => (order[a.name] || 10) - (order[b.name] || 10))
              .map((sec) => (
                <button
                  key={sec.name}
                  type="button"
                  className={`section-tab ${activeSection === sec.name ? 'active' : ''}`}
                  onClick={() => setActiveSection(sec.name)}
                >
                  <span>{sec.name}</span>
                  {(() => {
                    const w = sectionWindows[sec.name];
                    if (!w || !w.start || !w.end) return null;
                    return <small>{w.start}-{w.end}</small>;
                  })()}
                </button>
              ));
          })()}
        </div>
      )}

      {sectionItems && sectionItems.length > 0 && (
        <>
          {favoriteItems.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>❤️ Favorite Picks</h4>
              <div className="menu-grid">{favoriteItems.map(renderItem)}</div>
            </>
          )}
          {hotSellers.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>🔥 Hot Sellers</h4>
              <div className="menu-grid">{hotSellers.map(renderItem)}</div>
            </>
          )}
          {recommended.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>🌟 Recommended</h4>
              <div className="menu-grid">{recommended.map(renderItem)}</div>
            </>
          )}
          {regularItems.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>All Items</h4>
              <div className="menu-grid">{regularItems.map(renderItem)}</div>
            </>
          )}
        </>
      )}

      {sectionItems.length === 0 && (
        <p className="empty-state">No items match the selected filter.</p>
      )}

      {/* Options Modal with multi-variant selection and per-variant steppers */}
      {showOptionsModal && selectedItem && (
        <div className="modal-overlay" onClick={() => setShowOptionsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Select Variants for {selectedItem.name}</h3>
            <div style={{ marginTop: 15, display: 'grid', gap: 10 }}>
              {selectedItem.options.map((option, idx) => {
                const qty = multiOptionQuantities[option.name] || 0;
                const checked = qty > 0;
                const totalSelected = Object.values(multiOptionQuantities).reduce((a,b)=>a+(b||0),0);
                const inventory = Number(selectedItem.inventory ?? 100);
                const remaining = Math.max(0, inventory - qtyInCart(selectedItem) - totalSelected + qty);
                return (
                  <div key={idx} className="card" style={{ padding: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && remaining <= 0}
                        onChange={(e) => {
                          setMultiOptionQuantities(prev => {
                            if (e.target.checked) {
                              const totalSelected = Object.values(prev).reduce((a,b)=>a+(b||0),0);
                              const cap = Number(selectedItem.inventory ?? 100) - qtyInCart(selectedItem);
                              if (totalSelected >= cap && qty === 0) {
                                toast.error('No more inventory available');
                                return prev;
                              }
                            }
                            const next = { ...prev, [option.name]: e.target.checked ? (qty || 1) : 0 };
                            setVariantDrafts(d => ({ ...d, [selectedItem.id]: next }));
                            return next;
                          });
                        }}
                      />
                      <span style={{ flex: 1 }}>
                        {option.name}{option.priceModifier > 0 ? ` (+₹${option.priceModifier})` : ''}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                          onClick={() => setMultiOptionQuantities(prev => {
                            const next = { ...prev, [option.name]: Math.max(0, (prev[option.name] || 0) - 1) };
                            setVariantDrafts(d => ({ ...d, [selectedItem.id]: next }));
                            return next;
                          })}
                          disabled={!checked}
                        >−</button>
                        <span style={{ width: 24, textAlign: 'center' }}>{qty}</span>
                        <button
                          onClick={() => setMultiOptionQuantities(prev => {
                            const total = Object.values(prev).reduce((a,b)=>a+(b||0),0);
                            if (total >= Number(selectedItem.inventory ?? 100) - qtyInCart(selectedItem)) { toast.error('No more inventory available'); return prev; }
                            const next = { ...prev, [option.name]: (prev[option.name] || 0) + 1 };
                            setVariantDrafts(d => ({ ...d, [selectedItem.id]: next }));
                            return next;
                          })}
                          disabled={!checked || (Number(selectedItem.inventory ?? 100) - qtyInCart(selectedItem) - Object.values(multiOptionQuantities).reduce((a,b)=>a+(b||0),0) <= 0)}
                        >+</button>
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  try {
                    const ops = selectedItem.options || [];
                    ops.forEach((opt) => {
                      const qty = multiOptionQuantities[opt.name] || 0;
                      for (let i = 0; i < qty; i++) incItemVariant(selectedItem, selectedShop, opt);
                    });
                    toast.success("Added to cart");
                  } finally {
                    setShowOptionsModal(false);
                    setSelectedItem(null);
                    // DO NOT clear draft; persist until checkout
                  }
                }}
                style={{ flex: 1, background: "#27ae60" }}
              >
                Add Selected Variants
              </button>
              <button onClick={() => setShowOptionsModal(false)} style={{ background: "#95a5a6" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Menu;