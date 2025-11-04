import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { fetchMenu, placeOrder, fetchUserOrders, fetchFavorites, submitRating, cancelOrder, employeeProfile, triggerSosAlert, resolveSosAlert, fetchSosStatus, previewOffers, createVendor, updateVendor, fetchAdminVendors } from "./api";
import Menu from "./components/Menu.jsx";
import Cart from "./components/Cart.jsx";
import Login from "./components/Login.jsx";
import EmployeeLogin from "./components/EmployeeLogin.jsx";
import EmployeeProfile from "./components/EmployeeProfile.jsx";
import MenuEditor from "./components/MenuEditor.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";
import VendorCombos from "./components/VendorCombos.jsx";
import VendorOffers from "./components/VendorOffers.jsx";
import VendorFeedbacks from "./components/VendorFeedbacks.jsx";
import VendorDataUpload from "./components/VendorDataUpload.jsx";
import Analytics from "./components/Analytics.jsx";
import ProcurementManager from "./components/ProcurementManager.jsx";
import OrderHistory from "./components/OrderHistory.jsx";
import GrievanceModal from "./components/GrievanceModal.jsx";
import VendorGrievances from "./components/VendorGrievances.jsx";
import AdminControl from "./components/AdminControl.jsx";
import VendorGrievanceForm from "./components/VendorGrievanceForm.jsx";
import VendorGrievanceList from "./components/VendorGrievanceList.jsx";
import VendorConcernsMenu from "./components/VendorConcernsMenu.jsx";
import SosButton from "./components/SosButton.jsx";
import AdminVendorGrievances from "./components/AdminVendorGrievances.jsx";
import BulkOrderPortal from "./components/BulkOrderPortal.jsx";
import PaymentPage from "./components/PaymentPage.jsx";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ORDER_PLACED_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
const READY_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
const SOS_ALERT_SOUND = "data:audio/wav;base64,UklGRmYGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YT4GAACAgICAf4B/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gH+Af4B/gn+Df4V/h3+Kf45/lH+Wf5x/oH+sf7J/tH+7f8R/x3/Iv8x/0H/Uf9m/33/hv+Q/5n/o/+x/7b/vv/H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x//H/8f/x/8=\n";
const ADMIN_CREDENTIALS = {
  username: "infybhojans",
  password: "infybhojans"
};
const ADMIN_VENDORS_STORAGE_KEY = "adminManagedVendors";

/**
 * App
 * Root component orchestrating vendor and employee views.
 * Manages menu, cart, authentication, orders, notifications, and routing-like view state.
 *
 * Sections
 * - State: menu, cart, auth tokens, selected shop, employee mobile, view, favorites, orders
 * - Refs: readyNotifiedRef (suppress repeated ready alerts), etaNotifiedRef (eta change notices), readySeededRef
 * - Effects:
 *   - loadMenu on mount
 *   - vendorShopId -> setSelectedShop
 *   - userId -> loadFavorites
 *   - employee polling -> ready alerts and ETA updates
 * - Helpers:
 *   - Cart helpers (add/remove/inc/dec per variant or no-option)
 *   - Sound playback, favorites load
 * - Views:
 *   - Vendor: dashboard | menu-editor | analytics | feedbacks | grievances | user (preview)
 *   - Employee: user (menu+cart), login, orders (history with actions)
 */
function App() {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedShop, setSelectedShop] = useState(1);
  const [cartShopMismatch, setCartShopMismatch] = useState(false);
  const [vendorToken, setVendorToken] = useState(null);
  const [employeeToken, setEmployeeToken] = useState(null);
  const [employeeMobile, setEmployeeMobile] = useState("");
  const [employeeRole, setEmployeeRole] = useState({
    role: null,
    roleSlug: null,
    department: null,
    bulkOrderEligible: false,
  });
  const [pointsRefreshNonce, setPointsRefreshNonce] = useState(0);
  const [view, setView] = useState("landing");
  const [orderSummary, setOrderSummary] = useState(null);
  const [userOrders, setUserOrders] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [wallet, setWallet] = useState({ balance: 0, transactions: [] });
  const [paymentMethod, setPaymentMethod] = useState('upi_app_gpay');
  const [cartNotes, setCartNotes] = useState("");
  const [checkoutDraft, setCheckoutDraft] = useState(null);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [activeMenuSection, setActiveMenuSection] = useState(null);
  const readyNotifiedRef = useRef(new Set());
  const [inlineRating, setInlineRating] = useState(0);
  const [inlineFeedback, setInlineFeedback] = useState("");
  const [inlineHoverRating, setInlineHoverRating] = useState(0);
  const [showGrievanceModal, setShowGrievanceModal] = useState(false);
  const [selectedOrderForGrievance, setSelectedOrderForGrievance] = useState(null);
  const [showVendorConcernForm, setShowVendorConcernForm] = useState(false);
  const [showVendorConcernList, setShowVendorConcernList] = useState(false);
  const etaNotifiedRef = useRef(new Map()); // orderId -> lastNotifiedETA ms
  const readySeededRef = useRef(false);
  const [targetItemId, setTargetItemId] = useState(null);
  const [recentOrdersTodayCount, setRecentOrdersTodayCount] = useState(0);
  const [adminSession, setAdminSession] = useState(null);
  const [adminManagedVendors, setAdminManagedVendors] = useState([]);
  const [sosState, setSosState] = useState({ active: false, message: null, lastTriggeredAt: null, currentEventId: null });
  const sosPollRef = useRef(null);
  const lastSosEventIdRef = useRef(null);
  const [offerPreview, setOfferPreview] = useState(null);
  const [offersLoading, setOffersLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ADMIN_VENDORS_STORAGE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        setAdminManagedVendors(parsed);
      }
    } catch (error) {
      console.warn("Failed to load admin vendors from storage", error);
    }
  }, []);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const status = await fetchSosStatus();
        if (status) {
          setSosState(status);
        }
      } catch (error) {
        console.warn("Failed to fetch SOS status", error);
      }
    };
    fetchStatus();
    sosPollRef.current = setInterval(fetchStatus, 5000);
    return () => {
      if (sosPollRef.current) {
        clearInterval(sosPollRef.current);
        sosPollRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (sosState?.active && sosState.currentEventId && lastSosEventIdRef.current !== sosState.currentEventId) {
      lastSosEventIdRef.current = sosState.currentEventId;
      playSound(SOS_ALERT_SOUND);
      toast.error("🚨 Emergency SOS activated. Evacuate to the nearest safe point!", { autoClose: 10000 });
    }
    if (!sosState?.active && lastSosEventIdRef.current && sosState?.currentEventId === null) {
      toast.success("✅ SOS alert resolved. Await further instructions.");
      lastSosEventIdRef.current = null;
    }
  }, [sosState]);

  useEffect(() => {
    try {
      localStorage.setItem(ADMIN_VENDORS_STORAGE_KEY, JSON.stringify(adminManagedVendors));
    } catch (error) {
      console.warn("Failed to persist admin vendors", error);
    }
  }, [adminManagedVendors]);

  useEffect(() => {
    const storedSession = adminSession;
    if (!storedSession) return;
    let cancelled = false;
    const hydrateVendors = async () => {
      try {
        const res = await fetchAdminVendors(storedSession);
        if (!cancelled && res?.status === "ok" && Array.isArray(res.vendors)) {
          setAdminManagedVendors(res.vendors);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to hydrate admin vendors", error);
        }
      }
    };
    hydrateVendors();
    return () => {
      cancelled = true;
    };
  }, [adminSession]);

  const userId = employeeMobile || null;
  const vendorShopId = (() => {
    try {
      if (!vendorToken) return null;
      const payload = JSON.parse(atob(vendorToken.split('.')[1]));
      return payload.shopId || null;
    } catch {
      return null;
    }
  })();

  const loadMenu = useCallback(() => {
    let cancelled = false;
    fetchMenu().then((data) => {
      if (cancelled) return;
      setMenu(data);
      if (data.length > 0 && !selectedShop) setSelectedShop(data[0].shopId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedShop]);

  const refreshAdminManagedVendors = useCallback(async () => {
    if (!adminSession) return;
    try {
      const res = await fetchAdminVendors(adminSession);
      if (res?.status === "ok" && Array.isArray(res.vendors)) {
        setAdminManagedVendors(res.vendors);
      }
    } catch (error) {
      console.error("Failed to refresh admin vendors", error);
    }
  }, [adminSession]);

  useEffect(() => {
    document.title = "Infy Bhojans";
    const cleanup = loadMenu();
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [loadMenu]);

  // Refresh menu when other parts of app (e.g., AdminDashboard) update inventory
  useEffect(() => {
    const handler = () => loadMenu();
    window.addEventListener('menu:updated', handler);
    return () => window.removeEventListener('menu:updated', handler);
  }, [loadMenu]);

  // Global navigation events from child components (e.g., AdminDashboard)
  useEffect(() => {
    const navHandler = (e) => {
      const target = e?.detail?.to || 'menu-editor';
      const itemId = e?.detail?.itemId || null;
      if (itemId) setTargetItemId(itemId);
      setView(target);
    };
    window.addEventListener('navigate:menu-editor', navHandler);
    const clearHandler = () => setTargetItemId(null);
    window.addEventListener('menu:clear-target', clearHandler);
    return () => {
      window.removeEventListener('navigate:menu-editor', navHandler);
      window.removeEventListener('menu:clear-target', clearHandler);
    };
  }, []);

  // When vendor logs in, force selectedShop to their shop
  useEffect(() => {
    if (vendorShopId) setSelectedShop(vendorShopId);
  }, [vendorShopId]);

  // Reset notification tracking whenever the logged-in employee changes
  useEffect(() => {
    readyNotifiedRef.current.clear();
    etaNotifiedRef.current.clear();
    readySeededRef.current = false;
  }, [userId]);

  useEffect(() => {
    if (!employeeToken && ["orders", "profile"].includes(view)) {
      setView("user");
    }
  }, [employeeToken, view]);

  useEffect(() => {
    setPointsRefreshNonce(0);
  }, [employeeToken]);

  // Employee ready notification: poll orders and alert when status becomes ready
  useEffect(() => {
    if (!employeeToken || !userId) return;
    const poll = async () => {
      try {
        const orders = await fetchUserOrders(userId);
        // On first poll after login, seed the already-ready orders to suppress repeated alerts
        if (!readySeededRef.current) {
          orders.filter(o => o.status === 'ready').forEach(o => readyNotifiedRef.current.add(o.billingId));
          readySeededRef.current = true;
        }

        orders
          .filter(o => o.status === 'ready')
          .forEach(o => {
            if (!readyNotifiedRef.current.has(o.billingId)) {
              readyNotifiedRef.current.add(o.billingId);
              playSound(READY_SOUND);
              toast.info(`🔔 Order ${o.billingId} is ready for pickup!`, { autoClose: 10000 });
            }
          });

        // Detect ETA changes (delay or earlier)
        orders.forEach(o => {
          if (!o.estimatedReadyTime) return;
          const etaMs = new Date(o.estimatedReadyTime).getTime();
          const key = o.id || o.billingId;
          const last = etaNotifiedRef.current.get(key);
          if (last == null) {
            etaNotifiedRef.current.set(key, etaMs);
            return;
          }
          if (etaMs !== last) {
            const diffMin = Math.round(Math.abs(etaMs - last) / 60000);
            if (etaMs > last) {
              toast.warn(`⚠️ Order ${o.billingId}: ETA extended by ~${diffMin} min`, { autoClose: 6000 });
            } else {
              toast.success(`✅ Order ${o.billingId}: ETA improved by ~${diffMin} min`, { autoClose: 6000 });
            }
            etaNotifiedRef.current.set(key, etaMs);
          }
        });
      } catch {}
    };
    const id = setInterval(poll, 5000);
    poll();
    return () => clearInterval(id);
  }, [employeeToken, userId]);

  const shopInventoryMap = useMemo(() => {
    const map = new Map();
    menu.forEach((shop) => {
      if (!shop) return;
      const itemMap = new Map();
      const addItem = (item) => {
        if (!item || item.id == null) return;
        const id = Number(item.id);
        if (!itemMap.has(id)) {
          const inventory = Number(item.inventory ?? 100);
          const cloned = { ...item, inventory };
          itemMap.set(id, cloned);
        }
      };
      if (Array.isArray(shop.items)) {
        shop.items.forEach(addItem);
      }
      if (Array.isArray(shop.categories)) {
        shop.categories.forEach((category) => {
          if (!Array.isArray(category?.items)) return;
          category.items.forEach(addItem);
        });
      }
      map.set(String(shop.shopId), itemMap);
    });
    return map;
  }, [menu]);

  useEffect(() => {
    if (!cart.length || !selectedShop) {
      setOfferPreview(null);
      setOffersLoading(false);
      return;
    }

    const itemsPayload = cart.map((c) => ({
      id: c.item.id,
      name: c.item.name,
      price: c.item.finalPrice,
      quantity: c.quantity,
      comboId: c.item.comboId ?? null,
      option: c.item.selectedOption?.name || null,
      prepTime: c.item.prepTime
    }));

    let cancelled = false;
    setOffersLoading(true);
    previewOffers({ shopId: selectedShop, items: itemsPayload, scheduledTime: scheduledTime || undefined })
      .then((data) => {
        if (cancelled) return;
        if (data?.status === 'ok') {
          setOfferPreview(data);
        } else {
          setOfferPreview(null);
        }
      })
      .catch(() => {
        if (!cancelled) setOfferPreview(null);
      })
      .finally(() => {
        if (!cancelled) setOffersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cart, selectedShop, scheduledTime]);

  const selectedShopItems = useMemo(() => {
    const mapEntry = shopInventoryMap.get(String(selectedShop));
    if (!mapEntry) return [];
    return Array.from(mapEntry.values());
  }, [shopInventoryMap, selectedShop]);

  const currentShopInventory = useMemo(() => {
    const entry = shopInventoryMap.get(String(selectedShop));
    return entry ? entry : new Map();
  }, [shopInventoryMap, selectedShop]);

  /** Load all shops and their items */
  /** Load favorites for current user (employee) */
  const loadFavorites = useCallback(() => {
    if (!userId) return;
    fetchFavorites(userId).then(setFavorites);
  }, [userId]);

  const applyWalletPayload = useCallback((payload = {}) => {
    const balance = Number(payload.balance || 0);
    const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
    setWallet({ balance, transactions });
  }, []);

  const loadWallet = useCallback(async (tokenOverride = null) => {
    const authToken = tokenOverride || employeeToken;
    if (!authToken) {
      applyWalletPayload({ balance: 0, transactions: [] });
      return;
    }
    try {
      const res = await employeeProfile(authToken);
      if (res?.status === 'ok') {
        const walletData = res?.wallet || {};
        applyWalletPayload(walletData);
      }
    } catch (err) {
      console.warn('Failed to load wallet', err);
    }
  }, [employeeToken, applyWalletPayload]);

  useEffect(() => {
    if (userId) {
      loadFavorites();
    } else {
      setFavorites([]);
    }
  }, [userId, loadFavorites]);

  useEffect(() => {
    if (employeeToken) {
      loadWallet(employeeToken);
    } else {
      applyWalletPayload({ balance: 0, transactions: [] });
    }
  }, [employeeToken, loadWallet, applyWalletPayload]);

  const playSound = (soundUrl) => {
    const audio = new Audio(soundUrl);
    audio.play().catch(err => console.log("Audio play failed:", err));
  };

  const vendorIdentity = useMemo(() => {
    if (!vendorToken) return null;
    try {
      const payload = JSON.parse(atob(vendorToken.split('.')[1]));
      return {
        username: payload.username || payload.vendorName || "Vendor",
        shopId: payload.shopId || null
      };
    } catch (error) {
      return null;
    }
  }, [vendorToken]);

  const handleSosTrigger = useCallback(async (role) => {
    const actorName = role === "admin" ? (adminSession?.username || "Admin") : (vendorIdentity?.username || "Vendor");
    try {
      const response = await triggerSosAlert({ role, actorName, message: `Emergency reported by ${actorName}` });
      if (response?.state) setSosState(response.state);
      toast.warn("🚨 SOS alert triggered. Evacuate immediately!", { autoClose: 8000 });
    } catch (error) {
      toast.error("Failed to trigger SOS alert");
    }
  }, [adminSession, vendorIdentity]);

  const handleSosResolve = useCallback(async (role) => {
    const actorName = role === "admin" ? (adminSession?.username || "Admin") : (vendorIdentity?.username || "Vendor");
    try {
      const response = await resolveSosAlert({ actorName, note: "Cleared by control" });
      if (response?.state) setSosState(response.state);
      toast.info("SOS alert resolved. Follow standard procedures.", { autoClose: 6000 });
    } catch (error) {
      toast.error("Failed to resolve SOS alert");
    }
  }, [adminSession, vendorIdentity]);

  /**
   * Add one unit of an item (optionally with variant) to the cart.
   * Merges with existing line if same item+shop+variant exists.
   */
  const currentCartShop = cart.length > 0 ? cart[0]?.shopId : null;

  const buildOrderItemsFromCart = useCallback(() => {
    return cart.map((c) => ({
      id: c.item.id,
      name: c.item.name,
      price: c.item.finalPrice,
      quantity: c.quantity,
      comboId: c.item.comboId || null,
      option: c.item.selectedOption?.name || null,
      customization: c.item.customization,
      prepTime: c.item.prepTime
    }));
  }, [cart]);

  const calculateCartTotals = useCallback(() => {
    const items = buildOrderItemsFromCart();
    const rawSubtotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
    const discountTotal = offerPreview?.discountTotal != null ? Number(offerPreview.discountTotal) : 0;
    const totalPayable = offerPreview?.totalPayable != null ? Number(offerPreview.totalPayable) : rawSubtotal;
    return {
      items,
      rawSubtotal,
      discountTotal,
      totalPayable,
      offerSummary: offerPreview && offerPreview.status === 'ok' ? {
        subtotalBeforeDiscount: offerPreview.subtotalBeforeDiscount,
        discountTotal: offerPreview.discountTotal,
        totalPayable: offerPreview.totalPayable,
        appliedOffers: offerPreview.appliedOffers,
        extraItems: offerPreview.extraItems
      } : undefined
    };
  }, [buildOrderItemsFromCart, offerPreview]);

  const handleProceedToPayment = useCallback(() => {
    if (!cart.length) {
      toast.info('Add some delicious treats before heading to payment!');
      return;
    }

    const checkoutShopId = cart[0]?.shopId ?? selectedShop;
    if (!checkoutShopId) {
      toast.error('Unable to determine shop for this order. Please select a shop and try again.');
      return;
    }
    if (selectedShop !== checkoutShopId) {
      setSelectedShop(checkoutShopId);
    }

    const totals = calculateCartTotals();

    const draft = {
      shopId: checkoutShopId,
      scheduledTime: scheduledTime || null,
      notes: cartNotes || '',
      items: totals.items,
      totals: {
        subtotalBeforeDiscount: totals.offerSummary?.subtotalBeforeDiscount ?? totals.rawSubtotal,
        discountTotal: totals.discountTotal,
        totalPayable: totals.totalPayable
      },
      offerPreview: totals.offerSummary,
      wallet: {
        balance: wallet.balance,
        enabled: Boolean(employeeToken)
      }
    };

    setCheckoutDraft(draft);
    setView('payment');
  }, [cart, selectedShop, scheduledTime, cartNotes, calculateCartTotals, wallet.balance, employeeToken, setSelectedShop]);

  const handlePaymentNotesChange = (notes) => {
    setCartNotes(notes);
    setCheckoutDraft((prev) => (prev ? { ...prev, notes } : prev));
  };

  const handlePaymentBack = () => {
    setView('user');
    setCheckoutDraft(null);
    setIsPlacingOrder(false);
  };

  const handlePaymentMethodChange = (optionId) => {
    setPaymentMethod(optionId);
  };

  useEffect(() => {
    if (!cart.length) {
      setCartShopMismatch(false);
      return;
    }
    const mismatch = currentCartShop != null && selectedShop != null && String(currentCartShop) !== String(selectedShop);
    setCartShopMismatch(mismatch);
  }, [cart, currentCartShop, selectedShop]);

  const ensureSameShop = (incomingShopId) => {
    if (cart.length === 0) return true;
    const existingShopId = currentCartShop;
    if (existingShopId == null || incomingShopId == null) return true;
    const same = String(existingShopId) === String(incomingShopId);
    if (!same) {
      toast.warn("Cart already has items from another shop. Please place separate orders.");
    }
    return same;
  };

  const addToCart = (item, shopId, selectedOption = null, customization = {}) => {
    if (!ensureSameShop(shopId)) return;

    const cartItem = {
      ...item,
      selectedOption,
      customization,
      finalPrice: item.price + (selectedOption?.priceModifier || 0),
      prepTime: item.prepTime || 5
    };

    setCart((prev) => {
      const idx = prev.findIndex((c) => 
        c.item.id === item.id && 
        c.shopId === shopId && 
        c.item.selectedOption?.name === selectedOption?.name
      );
      if (idx >= 0) {
        const newCart = [...prev];
        newCart[idx] = { ...newCart[idx], quantity: newCart[idx].quantity + 1 };
        return newCart;
      } else {
        return [...prev, { item: cartItem, shopId, quantity: 1 }];
      }
    });
  };

  /** Decrement one unit from a cart line by index (remove when qty hits zero) */
  const decrementFromCart = (index) => {
    setCart((prev) => {
      const item = prev[index];
      if (!item) return prev;
      if (item.quantity <= 1) return prev.filter((_, i) => i !== index);
      const newCart = [...prev];
      newCart[index] = { ...item, quantity: item.quantity - 1 };
      return newCart;
    });
  };

  /** Remove a cart line entirely */
  const removeFromCart = (index) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  /** Increment a cart line by index */
  const incrementFromCart = (index) => {
    setCart((prev) => {
      const newCart = [...prev];
      newCart[index] = { ...newCart[index], quantity: newCart[index].quantity + 1 };
      return newCart;
    });
  };

  // Helpers for items without options: adjust by item+shop
  /** Increase qty in cart for non-variant item (by item+shop) */
  const incItemNoOption = (item, shopId) => {
    if (!ensureSameShop(shopId)) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id && c.shopId === shopId && !c.item.selectedOption);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      const cartItem = { ...item, selectedOption: null, customization: {}, finalPrice: item.price, prepTime: item.prepTime || 5 };
      return [...prev, { item: cartItem, shopId, quantity: 1 }];
    });
  };

  /** Decrease qty in cart for non-variant item (by item+shop) */
  const decItemNoOption = (item, shopId) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id && c.shopId === shopId && !c.item.selectedOption);
      if (idx < 0) return prev;
      const entry = prev[idx];
      if (entry.quantity <= 1) {
        return prev.filter((_, i) => i !== idx);
      }
      const next = [...prev];
      next[idx] = { ...entry, quantity: entry.quantity - 1 };
      return next;
    });
  };

  // Helpers for items with variants (options)
  /** Increase qty for a specific item variant (by item+shop+option) */
  const incItemVariant = (item, shopId, option) => {
    if (!ensureSameShop(shopId)) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id && c.shopId === shopId && c.item.selectedOption?.name === option?.name);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      const cartItem = { ...item, selectedOption: option, customization: {}, finalPrice: item.price + (option?.priceModifier || 0), prepTime: item.prepTime || 5 };
      return [...prev, { item: cartItem, shopId, quantity: 1 }];
    });
  };

  /** Decrease qty for a specific item variant (by item+shop+option) */
  const decItemVariant = (item, shopId, option) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id && c.shopId === shopId && c.item.selectedOption?.name === option?.name);
      if (idx < 0) return prev;
      const entry = prev[idx];
      if (entry.quantity <= 1) {
        return prev.filter((_, i) => i !== idx);
      }
      const next = [...prev];
      next[idx] = { ...entry, quantity: entry.quantity - 1 };
      return next;
    });
  };

  const placeOrderWithMethod = async ({ method, payload = {} }) => {
    if (!checkoutDraft) {
      toast.error('Payment session expired. Please review your cart.');
      setView('user');
      return;
    }

    if (isPlacingOrder) return;

    const orderItems = Array.isArray(checkoutDraft.items) ? checkoutDraft.items : [];
    const checkoutShopId = checkoutDraft.shopId || selectedShop;

    if (!checkoutShopId) {
      toast.error('Unable to determine shop for this order. Please select a shop and try again.');
      setView('user');
      return;
    }

    const totalCharge = Number(checkoutDraft?.totals?.totalPayable ?? orderItems.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0));

    if (method === 'wallet') {
      if (!employeeToken) {
        toast.error('Wallet payments require an employee login.');
        return;
      }
      if (wallet.balance < totalCharge) {
        toast.error('Your wallet is hungry too! Top-up needed!');
        return;
      }
    }

    setIsPlacingOrder(true);

    try {
      const response = await placeOrder({
        items: orderItems,
        scheduledTime: checkoutDraft.scheduledTime,
        user: userId,
        shopId: checkoutShopId,
        paymentMethod: method,
        paymentPayload: {
          ...payload,
          notes: checkoutDraft.notes || undefined,
        },
        offerPreview: checkoutDraft.offerPreview,
        orderNotes: checkoutDraft.notes || undefined,
        employeeToken: employeeToken || undefined,
      });

      if (!response || response.status !== 'success') {
        const msg = response?.message || 'Order failed. Please try again';
        if (Array.isArray(response?.notAvailable) && response.notAvailable.length > 0) {
          toast.error(msg);
          response.notAvailable.slice(0, 5).forEach((na) => {
            const win = na.window ? ` (${na.window})` : '';
            toast.info(`${na.name} is available only during ${na.section}${win}`);
          });
          return;
        }
        toast.error(msg);
        return;
      }

      setCart([]);
      setScheduledTime("");
      setOrderSummary(response.orderSummary);
      setCheckoutDraft(null);
      setCartNotes("");
      setPaymentMethod('upi_app_gpay');
      setView('user');

      loadMenu();
      if (method === 'wallet') {
        loadWallet();
      }

      const excluded = response.excludedItems || response.extra?.excludedItems;
      if (Array.isArray(excluded) && excluded.length > 0) {
        toast.warn('Some items were excluded as they are not available at this time.');
        excluded.slice(0, 5).forEach((ex) => {
          const win = ex.window ? ` (${ex.window})` : '';
          toast.info(`${ex.name} is available only during ${ex.section}${win}`);
        });
      }

      if (userId) {
        fetchUserOrders(userId).then((orders) => {
          try {
            const today = new Date();
            const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
            const countToday = (orders || []).filter((o) => {
              const d = o.createdAt ? new Date(o.createdAt) : null;
              return d ? isSameDay(d, today) : false;
            }).length;
            setRecentOrdersTodayCount(countToday);
          } catch {
            setRecentOrdersTodayCount(0);
          }
        });
      }

      setPointsRefreshNonce((nonce) => nonce + 1);

      playSound(ORDER_PLACED_SOUND);
      toast.success(`Order placed! Billing ID: ${response.billingId}`);

      const prepTime = response.orderSummary?.prepTime || 5;
      setTimeout(() => {
        playSound(READY_SOUND);
        toast.info(` Order ${response.billingId} is ready for pickup!`, {
          autoClose: 10000,
        });
      }, prepTime * 60000);
    } catch (error) {
      console.error('Failed to place order', error);
      toast.error('Order failed. Please try again');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const handleReorder = (order) => {
    setCart([]);
    order.items.forEach(item => {
      const menuItem = menu.flatMap(s => s.items).find(i => i.id === item.id);
      if (menuItem) {
        const option = item.option ? { name: item.option, priceModifier: 0 } : null;
        addToCart(menuItem, order.shopId, option, {});
      }
    });
    setView("user");
    toast.success("Previous order added to cart!");
  };

  const handleClearHistory = () => {
    if (!userOrders.length) {
      toast.info("No order history to clear");
      return;
    }

    const completedOrCancelled = userOrders.filter((order) => order.status === "completed" || order.status === "cancelled");
    if (completedOrCancelled.length === 0) {
      toast.info("Only completed or cancelled orders can be cleared." );
      return;
    }

    const confirmMessage = `This will remove ${completedOrCancelled.length} completed/cancelled ${completedOrCancelled.length === 1 ? "order" : "orders"} from your history. Pending and ready orders will stay.`;
    if (!window.confirm(`${confirmMessage}\nContinue?`)) return;

    setUserOrders((prev) => prev.filter((order) => order.status !== "completed" && order.status !== "cancelled"));
    toast.success("Completed and cancelled orders cleared");
  };

  const handleReportIssue = (order) => {
    setSelectedOrderForGrievance(order);
    setShowGrievanceModal(true);
  };

  const handleCancelScheduledOrder = async (order) => {
    if (!order || !order.id) return;
    if (!order.scheduledTime) {
      toast.error("Only scheduled orders can be cancelled");
      return;
    }
    if (!userId) {
      toast.error("Login required");
      return;
    }
    const scheduledAt = new Date(order.scheduledTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const confirmMsg = `Cancel order ${order.billingId || order.id} scheduled for ${scheduledAt}?\nRefunds depend on how early you cancel.`;
    const confirmed = window.confirm(confirmMsg);
    if (!confirmed) return;
    const reason = window.prompt("Optional: share the reason for cancellation", "");
    try {
      const response = await cancelOrder(order.id, userId, reason || "");
      if (!response || response.status !== 'success') {
        toast.error(response?.message || "Could not cancel order");
        return;
      }
      setUserOrders((prev) => prev.map((o) => (o.id === order.id ? response.order : o)));
      toast.success(`Order cancelled. Refund: ₹${response.refundAmount?.toFixed?.(2) ?? response.refundAmount ?? 0}`);
    } catch (error) {
      toast.error("Error while cancelling order");
    }
  };

  const submitInlineFeedback = async () => {
    try {
      if (!inlineRating) return toast.error("Please select a rating");
      await submitRating(null, inlineRating, inlineFeedback);
      setInlineRating(0);
      setInlineFeedback("");
      toast.success("Thanks for your feedback!");
    } catch {
      toast.error("Failed to submit feedback");
    }
  };

  const handleLogin = (token) => {
    setVendorToken(token);
    setView("dashboard");
    try { localStorage.removeItem('vendorSoundFirstLoginDone'); } catch {}
    playSound(READY_SOUND);
    try {
      if (!localStorage.getItem('vendorLoginToastShown')) {
        toast.success('Vendor logged in successfully!');
        localStorage.setItem('vendorLoginToastShown', '1');
      }
    } catch {}
  };

  const handleLogout = () => {
    setVendorToken(null);
    setShowVendorConcernForm(false);
    setShowVendorConcernList(false);
    setView("login");
    toast.info("Logged out from vendor account");
  };

  const handleEmployeeLogin = ({ token, mobile, role, roleSlug, department, bulkOrderEligible }) => {
    setEmployeeToken(token);
    setEmployeeMobile(mobile);
    setEmployeeRole({
      role: role || null,
      roleSlug: roleSlug || null,
      department: department || null,
      bulkOrderEligible: Boolean(bulkOrderEligible),
    });
    setPaymentMethod('upi_app_gpay');
    setCartNotes("");
    setCheckoutDraft(null);
    setIsPlacingOrder(false);
    setView("user");
    playSound(READY_SOUND);
    toast.success("Employee logged in");
  };

  const handleEmployeeLogout = () => {
    setEmployeeToken(null);
    setEmployeeMobile("");
    setEmployeeRole({ role: null, roleSlug: null, department: null, bulkOrderEligible: false });
    setCart([]);
    setOrderSummary(null);
    applyWalletPayload({ balance: 0, transactions: [] });
    setPaymentMethod('upi_app');
    setCartNotes("");
    setCheckoutDraft(null);
    setIsPlacingOrder(false);
    readyNotifiedRef.current.clear();
    etaNotifiedRef.current.clear();
    readySeededRef.current = false;
    toast.info("Logged out");
  };

  const handleAdminLogin = async ({ username, password }) => {
    const trimmedUser = String(username || '').trim();
    const trimmedPass = String(password || '').trim();
    if (!trimmedUser || !trimmedPass) {
      toast.error("Enter admin credentials");
      return;
    }
    if (
      trimmedUser !== ADMIN_CREDENTIALS.username ||
      trimmedPass !== ADMIN_CREDENTIALS.password
    ) {
      toast.error("Invalid admin username or password");
      return;
    }
    const session = { username: trimmedUser, password: trimmedPass };
    setAdminSession(session);
    try {
      const res = await fetchAdminVendors(session);
      if (res?.status === "ok" && Array.isArray(res.vendors)) {
        setAdminManagedVendors(res.vendors);
      } else {
        setAdminManagedVendors([]);
        if (res?.message) {
          toast.error(res.message);
        }
      }
    } catch (error) {
      console.error("Failed to load admin vendors", error);
      toast.error("Unable to load vendors");
      setAdminManagedVendors([]);
    }
    toast.success("Admin logged in");
  };

  const handleAdminLogout = () => {
    setAdminSession(null);
    toast.info("Admin logged out");
    setView("landing");
  };

  const handleCreateVendor = async (payload) => {
    if (!adminSession) {
      console.warn("Create vendor attempted without admin session", payload);
      toast.error("Admin session expired. Please log in again before creating vendors.");
      return;
    }
    try {
      const res = await createVendor(payload, adminSession);
      if (res?.status === "success") {
        const vendor = res.vendor || {};
        setAdminManagedVendors((prev) => [...prev, vendor]);
        toast.success(`Vendor ${vendor.shopName || payload.shopName} created successfully.`);
      } else {
        toast.error(res?.message || "Failed to create vendor");
      }
    } catch (error) {
      console.error("Error creating vendor", error);
      toast.error("Error creating vendor");
    }
  };

  const handleUpdateVendor = async (vendorId, payload) => {
    if (!adminSession) {
      console.warn("Update vendor attempted without admin session", vendorId, payload);
      toast.error("Admin session expired. Please log in again before updating vendors.");
      return;
    }
    try {
      const res = await updateVendor(vendorId, payload, adminSession);
      if (res?.status === "success") {
        setAdminManagedVendors((prev) => prev.map((vendor) => {
          if (String(vendor.vendorId ?? vendor.id) !== String(vendorId)) return vendor;
          const updated = { ...vendor, ...payload };
          if (res.vendor) {
            Object.assign(updated, res.vendor);
          }
          return updated;
        }));
        toast.success("Vendor credentials updated and notification sent");
      } else {
        toast.error(res?.message || "Failed to update vendor");
      }
    } catch (error) {
      console.error("Error updating vendor", error);
      toast.error("Error updating vendor");
    }
  };

  return (
    <>
      <header>
        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Infosys_logo.svg/200px-Infosys_logo.svg.png" alt="Infy Bhojans Logo" />
        <h1>Infy Bhojans</h1>
      </header>

      <div className="app-container">
        <ToastContainer position="top-right" autoClose={3000} />

        {vendorToken ? (
          <>
            <div className="vendor-toolbar">
              <div className="vendor-toolbar-left">
                <button onClick={() => setView("dashboard")}>Dashboard</button>
                <button onClick={() => setView("menu-editor")}>Edit Menu</button>
                <button onClick={() => setView("analytics")}>Analytics</button>
                <button onClick={() => setView("vendor-data-upload")}>Historic Upload</button>
                <button onClick={() => setView("procurement")}>Procurement</button>
                <button onClick={() => setView("vendor-combos")}>Combos</button>
                <button onClick={() => setView("vendor-offers")}>Offers</button>
                <button onClick={() => setView("feedbacks")}>Feedbacks</button>
                <button onClick={() => setView("grievances")}>Complaints</button>
                <button onClick={() => setView("user")}>Switch to User View</button>
                <VendorConcernsMenu
                  onRaiseNew={() => {
                    setShowVendorConcernForm(true);
                    setShowVendorConcernList(false);
                  }}
                  onViewStatus={() => {
                    setShowVendorConcernForm(false);
                    setShowVendorConcernList(true);
                  }}
                />
              </div>
            </div>

            {view === "menu-editor" && (
              <MenuEditor token={vendorToken} menu={menu} onUpdate={loadMenu} targetItemId={targetItemId} />
            )}
            {view === "dashboard" && <AdminDashboard token={vendorToken} />}
            {view === "analytics" && <Analytics token={vendorToken} />}
            {view === "vendor-data-upload" && <VendorDataUpload token={vendorToken} />}
            {view === "procurement" && <ProcurementManager token={vendorToken} />}
            {view === "vendor-combos" && <VendorCombos token={vendorToken} />}
            {view === "vendor-offers" && <VendorOffers token={vendorToken} />}
            {view === "grievances" && <VendorGrievances token={vendorToken} />}
            {view === "feedbacks" && <VendorFeedbacks token={vendorToken} />}
            {view === "user" && (
              <div className="layout-container">
                <div className="menu-section">
                  <Menu
                    menu={menu}
                    addToCart={() => {}}
                    cart={[]}
                    selectedShop={selectedShop}
                    setSelectedShop={setSelectedShop}
                    favorites={[]}
                    onFavoriteToggle={() => {}}
                    userId={null}
                    hideFavorites
                    hideShopSelector={false}
                    showInventory
                    readOnly
                    activeSection={activeMenuSection}
                    onActiveSectionChange={setActiveMenuSection}
                  />
                </div>
                {/* Read-only user view for vendor: no cart, no order summary */}
                <div className="cart-section" style={{ display: 'none' }} />
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={handleLogout} style={{ background: '#e74c3c', color: '#fff' }}>Logout</button>
            </div>
          </>
        ) : (
          <>
            {view === "landing" && (
              <div className="landing-page">
                <div className="welcome-section">
                  <h2>Welcome to Infy Bhojans</h2>
                  <p>Choose your access level to continue:</p>
                  <div className="landing-options">
                    <div className="option-card employee-card">
                      <h3>Infy Bhojans Employee Access</h3>
                      <p>Order food, view menu, track orders, and provide feedback</p>
                      <button onClick={() => setView("user")} className="primary-button">
                        Employee Login
                      </button>
                    </div>
                    <div className="option-card vendor-card">
                      <h3>Infy Bhojans Vendor Access</h3>
                      <p>Manage menu, view analytics, handle orders, and resolve complaints</p>
                      <button onClick={() => setView("login")} className="secondary-button">
                        Vendor Login
                      </button>
                    </div>
                    <div className="option-card admin-card">
                      <h3>Infy Bhojans Admin Control</h3>
                      <p>Create vendors, reset credentials, and oversee platform access</p>
                      <button
                        onClick={() => setView("admin")}
                        className="secondary-button"
                        style={{ background: '#e67e22', borderColor: '#d35400', color: '#fff' }}
                      >
                        Admin Login
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {view === "user" && (
              employeeToken ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 12,
                      marginBottom: 20
                    }}
                  >
                    <button
                      onClick={() => setView("bulk-portal")}
                      className="primary-button"
                      style={{ minWidth: 150, width: 150 }}
                    >
                      Bulk Orders
                    </button>
                    <button
                      onClick={() => setView("profile")}
                      className="secondary-button"
                      style={{ minWidth: 150, width: 150 }}
                    >
                      My Profile
                    </button>
                    <div style={{ marginLeft: 'auto', display: 'flex' }}>
                      <button
                        onClick={() => { fetchUserOrders(userId).then(setUserOrders); setView("orders"); }}
                        className="primary-button"
                        style={{ minWidth: 150, width: 150 }}
                      >
                        My Orders
                      </button>
                    </div>
                  </div>
                  <div className="layout-container">
                    <div className="menu-section">
                      <Menu
                        menu={menu}
                        addToCart={addToCart}
                        cart={cart}
                        incItemNoOption={incItemNoOption}
                        decItemNoOption={decItemNoOption}
                        incItemVariant={incItemVariant}
                        decItemVariant={decItemVariant}
                        selectedShop={selectedShop}
                        setSelectedShop={setSelectedShop}
                        favorites={favorites}
                        cartShopMismatch={cartShopMismatch}
                        onFavoriteToggle={loadFavorites}
                        userId={userId}
                        employeeToken={employeeToken}
                        scheduledTime={scheduledTime}
                        activeSection={activeMenuSection}
                        onActiveSectionChange={setActiveMenuSection}
                      />
                      {/* Inline feedback form for employees */}
                      <div className="card" style={{ marginTop: 20 }}>
                        <div className="card-header">Rate your experience</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                          {[1,2,3,4,5].map(n => (
                            <span
                              key={n}
                              className="rating-star"
                              onMouseEnter={() => setInlineHoverRating(n)}
                              onMouseLeave={() => setInlineHoverRating(0)}
                              onClick={() => setInlineRating(n)}
                              style={{ color: n <= (inlineHoverRating || inlineRating) ? '#f1c40f' : '#ccc', fontSize: 22, cursor: 'pointer' }}
                            >★</span>
                          ))}
                        </div>
                        <textarea placeholder="Share your feedback on food quality and service" value={inlineFeedback} onChange={(e)=>setInlineFeedback(e.target.value)} />
                        <div className="mt-10">
                          <button onClick={submitInlineFeedback} disabled={!inlineRating}>Submit Feedback</button>
                        </div>
                      </div>
                    </div>
                    <div className="cart-section">
                      <Cart
                        cart={cart}
                        removeFromCart={removeFromCart}
                        decrementFromCart={decrementFromCart}
                        incrementFromCart={incrementFromCart}
                        scheduledTime={scheduledTime}
                        setScheduledTime={setScheduledTime}
                        onProceedToPayment={handleProceedToPayment}
                        shopItems={selectedShopItems}
                        inventoryById={currentShopInventory}
                        initialNotes={cartNotes}
                        onNotesChange={setCartNotes}
                        cartShopMismatch={cartShopMismatch}
                        offerPreview={offerPreview}
                        offersLoading={offersLoading}
                      />
                      {orderSummary && (
                        <div className="order-summary" style={{ marginTop: 20 }}>
                          <h3>Order Confirmation</h3>
                          <div><strong>Billing ID:</strong> {orderSummary.billingId}</div>
                          <div><strong>User:</strong> {orderSummary.user}</div>
                          <div><strong>Prep Time:</strong> {orderSummary.prepTime} mins</div>
                          <h4>Items:</h4>
                          <ul style={{ listStyle: "none", paddingLeft: 0 }}>
                            {orderSummary.items.map((item, idx) => (
                              <li key={idx} style={{ fontSize: 13, marginBottom: 4 }}>
                                {item.name} {item.option && `(${item.option})`} x{item.quantity} - ₹{item.price * item.quantity}
                              </li>
                            ))}
                          </ul>
                          <div><strong>Total:</strong> ₹{orderSummary.totalAmount}</div>
                          {recentOrdersTodayCount > 1 && (
                            <div style={{ marginTop: 10 }}>
                              <span
                                role="button"
                                onClick={() => { fetchUserOrders(userId).then(setUserOrders); setView("orders"); }}
                                style={{ cursor: 'pointer', color: '#2c3e50', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                              >
                                View recent orders
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={handleEmployeeLogout} style={{ background: '#e74c3c', color: '#fff', minWidth: 140 }}>
                      Logout
                    </button>
                  </div>
                </>
              ) : (
                <div className="employee-auth-container">
                  <EmployeeLogin onSuccess={handleEmployeeLogin} onBack={() => setView("landing")} />
                </div>
              )
            )}

            {view === "login" && (
              <>
                <button onClick={() => setView("landing")} style={{ marginBottom: 15 }}>
                  ← Back to Main Login
                </button>
                <Login onLogin={handleLogin} />
              </>
            )}

            {view === "bulk-portal" && employeeToken && (
              <BulkOrderPortal
                token={employeeToken}
                employeeRole={employeeRole}
                onClose={() => setView("user")}
              />
            )}

            {view === "orders" && (
              <OrderHistory
                orders={userOrders}
                onReorder={handleReorder}
                onBack={() => setView("user")}
                onClearHistory={handleClearHistory}
                onReportIssue={handleReportIssue}
                onCancel={handleCancelScheduledOrder}
              />
            )}

            {view === "payment" && (
              <PaymentPage
                draft={checkoutDraft}
                paymentMethod={paymentMethod}
                onPaymentMethodChange={handlePaymentMethodChange}
                onPlaceOrder={placeOrderWithMethod}
                onBack={handlePaymentBack}
                onNotesChange={handlePaymentNotesChange}
                isPlacingOrder={isPlacingOrder}
                emitToast={(type, message) => {
                  if (type === 'error') toast.error(message);
                  else if (type === 'info') toast.info(message);
                  else toast(message);
                }}
              />
            )}

            {view === "profile" && (
              <div>
                <button onClick={() => setView("user")} style={{ marginBottom: 15 }}>← Back</button>
                <EmployeeProfile
                  token={employeeToken}
                  wallet={wallet}
                  onWalletChange={applyWalletPayload}
                  onRequestWalletRefresh={loadWallet}
                  pointsRefreshNonce={pointsRefreshNonce}
                />
              </div>
            )}

            {view === "admin" && (
              <div className="admin-panel">
                <button onClick={() => setView("landing")} style={{ marginBottom: 15 }}>
                  &larr; Back to Main Login
                </button>
                <div className="admin-panel-main">
                  <AdminControl
                    adminSession={adminSession}
                    onAdminLogin={handleAdminLogin}
                    onAdminLogout={handleAdminLogout}
                    onCreateVendor={handleCreateVendor}
                    onUpdateVendor={handleUpdateVendor}
                    vendors={adminManagedVendors}
                    onRequestRefresh={() => {
                      loadMenu();
                      refreshAdminManagedVendors();
                    }}
                    sosState={sosState}
                    onTriggerSos={() => handleSosTrigger("admin")}
                    onResolveSos={() => handleSosResolve("admin")}
                  />
                  {adminSession && (
                    <AdminVendorGrievances adminSession={adminSession} />
                  )}
                </div>
                {adminSession && (
                  <div className="admin-sos-footer">
                    <SosButton
                      isActive={Boolean(sosState?.active)}
                      onTrigger={() => handleSosTrigger("admin")}
                      onResolve={() => handleSosResolve("admin")}
                    />
                    <button
                      onClick={handleAdminLogout}
                      className="logout-button"
                      style={{ background: "#e74c3c", color: "#fff", minWidth: 160 }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      {showGrievanceModal && selectedOrderForGrievance && (
        <GrievanceModal
          order={selectedOrderForGrievance}
          onClose={() => setShowGrievanceModal(false)}
        />
      )}

      {showVendorConcernForm && vendorToken && (
        <VendorGrievanceForm
          token={vendorToken}
          onClose={() => setShowVendorConcernForm(false)}
          sosState={sosState}
          onTriggerSos={() => handleSosTrigger("vendor")}
          onResolveSos={() => handleSosResolve("vendor")}
        />
      )}

      {showVendorConcernList && vendorToken && (
        <VendorGrievanceList
          token={vendorToken}
          onClose={() => setShowVendorConcernList(false)}
        />
      )}
    </div>
  </>
  );
}

export default App;