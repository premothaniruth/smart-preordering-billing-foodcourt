import React, { useEffect, useState } from "react";
import { fetchMenu, placeOrder, vendorLogin, updateMenu, fetchOrders, markOrderReady, fetchAnalytics } from "./api";
import Menu from "./components/Menu";
import Cart from "./components/Cart";
import Payment from "./components/Payment";
import Login from "./components/Login";
import MenuEditor from "./components/MenuEditor";
import AdminDashboard from "./components/AdminDashboard";
import Analytics from "./components/Analytics";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const ORDER_PLACED_SOUND = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDWM0/K/gC4EH29+3WgyBCk4XoCWJhcBTnLcWswB";
const READY_SOUND = "data:audio/wav;base64,UklGRmQFAABXQVZFZm10IBAAAAABAAEARKwAAESsAAABAAgAZGF0YUAFAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

function App() {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedShop, setSelectedShop] = useState(1);
  const [vendorToken, setVendorToken] = useState(null);
  const [view, setView] = useState("user");
  const [orderSummary, setOrderSummary] = useState(null);

  useEffect(() => {
    fetchMenu().then((data) => {
      setMenu(data);
      if (data.length > 0 && !selectedShop) setSelectedShop(data[0].shopId);
    });
  }, [selectedShop]);

  const playSound = (soundUrl) => {
    const audio = new Audio(soundUrl);
    audio.play().catch(err => console.log("Audio play failed:", err));
  };

  const addToCart = (item, shopId, selectedOption = null) => {
    const cartItem = {
      ...item,
      selectedOption,
      finalPrice: item.price + (selectedOption?.priceModifier || 0)
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
      option: c.item.selectedOption?.name || null
    }));

    placeOrder({
      items: orderItems,
      scheduledTime,
      user: "Employee XYZ",
      shopId: selectedShop,
    }).then((response) => {
      setCart([]);
      setScheduledTime("");
      setOrderSummary(response.orderSummary);
      
      playSound(ORDER_PLACED_SOUND);
      toast.success(`Order placed! Billing ID: ${response.billingId}`);

      setTimeout(() => {
        playSound(READY_SOUND);
        toast.info(`🔔 Order ${response.billingId} is ready for pickup!`, {
          autoClose: 10000,
        });
      }, 60000);
    });
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
              <button onClick={() => setView("user")}>Switch to User View</button>
            </div>

            {view === "menu-editor" && (
              <MenuEditor token={vendorToken} shopItems={menu.find((s) => s.shopId === selectedShop)?.items} />
            )}
            {view === "dashboard" && <AdminDashboard token={vendorToken} />}
            {view === "analytics" && <Analytics token={vendorToken} />}
            {view === "user" && (
              <div className="layout-container">
                <div className="menu-section">
                  <Menu
                    menu={menu}
                    addToCart={addToCart}
                    cart={cart}
                    selectedShop={selectedShop}
                    setSelectedShop={setSelectedShop}
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
                      <div><strong>Total:</strong> ₹{orderSummary.totalAmount}</div>
                      <div><strong>Estimated Ready:</strong> 1 minute</div>
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
                <button onClick={() => setView("login")}>Vendor Login</button>
                <div className="layout-container">
                  <div className="menu-section">
                    <Menu
                      menu={menu}
                      addToCart={addToCart}
                      cart={cart}
                      selectedShop={selectedShop}
                      setSelectedShop={setSelectedShop}
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
                        <div><strong>Total:</strong> ₹{orderSummary.totalAmount}</div>
                        <div><strong>Estimated Ready:</strong> 1 minute</div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
            {view === "login" && <Login onLogin={handleLogin} />}
          </>
        )}
      </div>
    </>
  );
}

export default App;