import React, { useEffect, useState } from "react";
import { fetchMenu, placeOrder, fetchUserOrders, fetchFavorites, vendorLogin, updateMenu, markOrderReady, fetchAnalytics } from "./api";
import Menu from "./components/Menu";
import Cart from "./components/Cart";
import Payment from "./components/Payment";
import Login from "./components/Login";
import EmployeeLogin from "./components/EmployeeLogin";
import MenuEditor from "./components/MenuEditor";
import AdminDashboard from "./components/AdminDashboard";
import Analytics from "./components/Analytics";
import OrderHistory from "./components/OrderHistory";
import RatingModal from "./components/RatingModal";
import GrievanceModal from "./components/GrievanceModal";
import VendorGrievances from "./components/VendorGrievances";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ORDER_PLACED_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
const READY_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";

function App() {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedShop, setSelectedShop] = useState(1);
  const [vendorToken, setVendorToken] = useState(null);
  const [employeeToken, setEmployeeToken] = useState(null);
  const [employeeMobile, setEmployeeMobile] = useState("");
  const [view, setView] = useState("user");
  const [orderSummary, setOrderSummary] = useState(null);
  const [userOrders, setUserOrders] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [currentOrderForRating, setCurrentOrderForRating] = useState(null);
  const [showGrievanceModal, setShowGrievanceModal] = useState(false);
  const [selectedOrderForGrievance, setSelectedOrderForGrievance] = useState(null);

  const userId = employeeMobile || null;

  useEffect(() => {
    loadMenu();
  }, []);

  useEffect(() => {
    if (userId) {
      loadFavorites();
    } else {
      setFavorites([]);
    }
  }, [userId]);

  const loadMenu = () => {
    fetchMenu().then((data) => {
      setMenu(data);
      if (data.length > 0 && !selectedShop) setSelectedShop(data[0].shopId);
    });
  };

  const loadFavorites = () => {
    if (!userId) return;
    fetchFavorites(userId).then(setFavorites);
  };

  const playSound = (soundUrl) => {
    const audio = new Audio(soundUrl);
    audio.play().catch(err => console.log("Audio play failed:", err));
  };

  const addToCart = (item, shopId, selectedOption = null, customization = {}) => {
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

  const removeFromCart = (index) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const incrementFromCart = (index) => {
    setCart((prev) => {
      const newCart = [...prev];
      newCart[index] = { ...newCart[index], quantity: newCart[index].quantity + 1 };
      return newCart;
    });
  };

  const handlePaymentSuccess = () => {
    const orderItems = cart.map((c) => ({
      id: c.item.id,
      name: c.item.name,
      price: c.item.finalPrice,
      quantity: c.quantity,
      option: c.item.selectedOption?.name || null,
      customization: c.item.customization,
      prepTime: c.item.prepTime
    }));

    placeOrder({
      items: orderItems,
      scheduledTime,
      user: userId,
      shopId: selectedShop,
    }).then((response) => {
      setCart([]);
      setScheduledTime("");
      setOrderSummary(response.orderSummary);

      playSound(ORDER_PLACED_SOUND);
      toast.success(`Order placed! Billing ID: ${response.billingId}`);

      // Show rating modal after a delay
      setTimeout(() => {
        setCurrentOrderForRating(response.billingId);
        setShowRatingModal(true);
      }, 3000);

      // Set timer for ready sound
      const prepTime = response.orderSummary.prepTime || 5;
      setTimeout(() => {
        playSound(READY_SOUND);
        toast.info(` Order ${response.billingId} is ready for pickup!`, {
          autoClose: 10000,
        });
      }, prepTime * 60000);
    });
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
    if (window.confirm("Are you sure you want to clear your order history? This cannot be undone.")) {
      setUserOrders([]);
      toast.success("Order history cleared");
    }
  };

  const handleReportIssue = (order) => {
    setSelectedOrderForGrievance(order);
    setShowGrievanceModal(true);
  };

  const handleLogin = (token) => {
    setVendorToken(token);
    setView("dashboard");
    toast.success("Vendor logged in successfully!");
  };

  const handleLogout = () => {
    setVendorToken(null);
    setView("user");
    toast.info("Logged out from vendor account");
  };

  const handleEmployeeLogin = ({ token, mobile }) => {
    setEmployeeToken(token);
    setEmployeeMobile(mobile);
    setView("user");
    toast.success("Employee logged in");
  };

  const handleEmployeeLogout = () => {
    setEmployeeToken(null);
    setEmployeeMobile("");
    setCart([]);
    setOrderSummary(null);
    toast.info("Logged out");
  };

  return (
    <>
      <header>
        <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Infosys_logo.svg/200px-Infosys_logo.svg.png" alt="Company Logo" />
        <h1>Smart Preordering & Billing - Food Court</h1>
      </header>

      <div className="app-container">
        <ToastContainer position="top-right" autoClose={3000} />

        {vendorToken ? (
          <>
            <button onClick={handleLogout}>Logout</button>
            <div style={{ marginBottom: 15 }}>
              <button onClick={() => setView("dashboard")}>Dashboard</button>
              <button onClick={() => setView("menu-editor")}>Edit Menu</button>
              <button onClick={() => setView("analytics")}>Analytics</button>
              <button onClick={() => setView("grievances")}>Complaints</button>
              <button onClick={() => setView("user")}>Switch to User View</button>
            </div>

            {view === "menu-editor" && (
              <MenuEditor token={vendorToken} menu={menu} onUpdate={loadMenu} />
            )}
            {view === "dashboard" && <AdminDashboard token={vendorToken} />}
            {view === "analytics" && <Analytics token={vendorToken} />}
            {view === "grievances" && <VendorGrievances token={vendorToken} />}
            {view === "user" && (
              <div className="layout-container">
                <div className="menu-section">
                  <Menu
                    menu={menu}
                    addToCart={addToCart}
                    cart={cart}
                    selectedShop={selectedShop}
                    setSelectedShop={setSelectedShop}
                    favorites={favorites}
                    onFavoriteToggle={loadFavorites}
                    userId={userId}
                  />
                </div>
                <div className="cart-section">
                  <Cart
                    cart={cart}
                    removeFromCart={removeFromCart}
                    decrementFromCart={decrementFromCart}
                    incrementFromCart={incrementFromCart}
                    scheduledTime={scheduledTime}
                    setScheduledTime={setScheduledTime}
                    onPayment={handlePaymentSuccess}
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
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {view === "user" && (
              <>
                {employeeToken ? (
                  <>
                    <div style={{ marginBottom: 15 }}>
                      <button onClick={() => { fetchUserOrders(userId).then(setUserOrders); setView("orders"); }}>
                        My Orders
                      </button>
                      <button onClick={handleEmployeeLogout}>Logout</button>
                      <button onClick={() => setView("login")}>Vendor Login</button>
                    </div>
                    <div className="layout-container">
                      <div className="menu-section">
                        <Menu
                          menu={menu}
                          addToCart={addToCart}
                          cart={cart}
                          selectedShop={selectedShop}
                          setSelectedShop={setSelectedShop}
                          favorites={favorites}
                          onFavoriteToggle={loadFavorites}
                          userId={userId}
                        />
                      </div>
                      <div className="cart-section">
                        <Cart
                          cart={cart}
                          removeFromCart={removeFromCart}
                          decrementFromCart={decrementFromCart}
                          incrementFromCart={incrementFromCart}
                          scheduledTime={scheduledTime}
                          setScheduledTime={setScheduledTime}
                          onPayment={handlePaymentSuccess}
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
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="layout-container">
                      <div className="menu-section">
                        <EmployeeLogin onSuccess={handleEmployeeLogin} />
                      </div>
                      <div className="cart-section">
                        <h3>Vendor Access</h3>
                        <p style={{ fontSize: 13, color: '#666' }}>Vendors can log in to manage orders, menu, analytics, and grievances.</p>
                        <button onClick={() => setView("login")}>Vendor Login</button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
            {view === "login" && (
              <>
                <button onClick={() => setView("user")} style={{ marginBottom: 15 }}>
                  ← Back to Menu
                </button>
                <Login onLogin={handleLogin} />
              </>
            )}
            {view === "orders" && (
              <OrderHistory
                orders={userOrders}
                onReorder={handleReorder}
                onBack={() => setView("user")}
                onClearHistory={handleClearHistory}
                onReportIssue={handleReportIssue}
              />
            )}
          </>
        )}

        {showRatingModal && currentOrderForRating && (
          <RatingModal
            orderId={currentOrderForRating}
            onClose={() => setShowRatingModal(false)}
          />
        )}

        {showGrievanceModal && selectedOrderForGrievance && (
          <GrievanceModal
            order={selectedOrderForGrievance}
            onClose={() => setShowGrievanceModal(false)}
          />
        )}
      </div>
    </>
  );
}

export default App;