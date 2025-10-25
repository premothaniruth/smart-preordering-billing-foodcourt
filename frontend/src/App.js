import React, { useEffect, useState } from "react";
import { fetchMenu, placeOrder, vendorLogin, updateMenu, fetchOrders, markOrderReady, fetchAnalytics } from "./api";
import Menu from "./Menu";
import Cart from "./Cart";
import Payment from "./Payment";
import Login from "./Login";
import MenuEditor from "./MenuEditor";
import AdminDashboard from "./AdminDashboard";
import Analytics from "./Analytics";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function App() {
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedShop, setSelectedShop] = useState(1);
  const [vendorToken, setVendorToken] = useState(null);
  const [view, setView] = useState("user"); // user login admin etc.
  const [uiState, setUiState] = useState({}); // extension hook

  // Load menu on mount
  useEffect(() => {
    fetchMenu().then((data) => {
      setMenu(data);
      if (data.length > 0 && !selectedShop) setSelectedShop(data[0].shopId);
    });
  }, [selectedShop]);

  // Cart helpers
  const addToCart = (item, shopId) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id && c.shopId === shopId);
      if (idx >= 0) {
        const newCart = [...prev];
        newCart[idx] = { ...newCart[idx], quantity: newCart[idx].quantity + 1 };
        return newCart;
      } else {
        return [...prev, { item, shopId, quantity: 1 }];
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

  const incrementFromCart = (item, shopId) => {
    addToCart(item, shopId);
  };

  // Payment success
  const handlePaymentSuccess = () => {
    placeOrder({
      items: cart.map((c) => ({ ...c.item, quantity: c.quantity })),
      scheduledTime,
      user: "Employee XYZ",
      shopId: selectedShop,
    }).then(() => {
      setCart([]);
      setScheduledTime("");
      toast.success("Order confirmed and sent to vendor!");
    });
  };

  // Vendor login
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

  // UI
  return (
    <div style={{ padding: "20px", maxWidth: "1100px", margin: "auto" }}>
      <ToastContainer position="top-right" autoClose={3000} />
      <h1>Smart Preordering & Billing - Food Court</h1>

      {vendorToken ? (
        <>
          <button onClick={handleLogout} style={{ marginBottom: 12 }}>Logout</button>
          <div style={{ marginBottom: 12 }}>
            <button onClick={() => setView("dashboard")}>Dashboard</button>{" "}
            <button onClick={() => setView("menu-editor")}>Edit Menu</button>{" "}
            <button onClick={() => setView("analytics")}>Analytics</button>{" "}
            <button onClick={() => setView("user")}>Switch to User View</button>
          </div>

          {view === "menu-editor" && (
            <MenuEditor token={vendorToken} shopItems={menu.find((s) => s.shopId === selectedShop)?.items} />
          )}
          {view === "dashboard" && <AdminDashboard token={vendorToken} />}
          {view === "analytics" && <Analytics token={vendorToken} />}
          {view === "user" && (
            <>
              <Menu
                menu={menu}
                addToCart={addToCart}
                selectedShop={selectedShop}
                setSelectedShop={setSelectedShop}
              />
              <Cart
                cart={cart}
                removeFromCart={removeFromCart}
                decrementFromCart={decrementFromCart}
                incrementFromCart={incrementFromCart}
                scheduledTime={scheduledTime}
                setScheduledTime={setScheduledTime}
              />
              <Payment
                cart={cart}
                scheduledTime={scheduledTime}
                onSuccess={handlePaymentSuccess}
              />
            </>
          )}
        </>
      ) : (
        <>
          {view === "user" && (
            <>
              <button onClick={() => setView("login")} style={{ marginBottom: 12 }}>Vendor Login</button>
              <Menu
                menu={menu}
                addToCart={addToCart}
                selectedShop={selectedShop}
                setSelectedShop={setSelectedShop}
              />
              <Cart
                cart={cart}
                removeFromCart={removeFromCart}
                decrementFromCart={decrementFromCart}
                incrementFromCart={incrementFromCart}
                scheduledTime={scheduledTime}
                setScheduledTime={setScheduledTime}
              />
              <Payment
                cart={cart}
                scheduledTime={scheduledTime}
                onSuccess={handlePaymentSuccess}
              />
            </>
          )}
          {view === "login" && <Login onLogin={handleLogin} />}
        </>
      )}
    </div>
  );
}

export default App;