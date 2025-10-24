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

function App() {
  // States
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedShop, setSelectedShop] = useState(1);
  const [vendorToken, setVendorToken] = useState(null);
  const [view, setView] = useState("user"); // 'user', 'login', 'admin', 'menu-editor', 'analytics', 'dashboard'

  // Fetch menu initially and when user changes shop
  useEffect(() => {
    fetchMenu().then((data) => {
      setMenu(data);
      if (!selectedShop && data.length > 0) setSelectedShop(data[0].shopId);
    });
  }, [selectedShop]);

  // User cart management
  const addToCart = (item, shopId) => {
    setCart([...cart, { ...item, shopId }]);
  };
  const removeFromCart = (index) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  // Handle order payment and placement
  const handlePaymentSuccess = () => {
    placeOrder({
      items: cart,
      scheduledTime,
      user: "Employee XYZ",
      shopId: selectedShop,
    }).then(() => {
      setCart([]);
      setScheduledTime("");
      toast.success("Order confirmed and sent to vendor!");
    });
  };

  // Vendor login handler
  const handleLogin = (token) => {
    setVendorToken(token);
    setView("dashboard");
    toast.success("Vendor logged in successfully!");
  };

  // Vendor logout
  const handleLogout = () => {
    setVendorToken(null);
    setView("user");
    toast.info("Logged out from vendor account");
  };

  // Render UI based on current view
  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "auto" }}>
      <ToastContainer position="top-right" autoClose={3000} />
      <h1>Smart Preordering & Billing - Food Court</h1>

      {vendorToken ? (
        <>
          <button onClick={handleLogout} style={{ marginBottom: "15px" }}>
            Logout
          </button>
          <div style={{ marginBottom: "15px" }}>
            <button onClick={() => setView("dashboard")}>Dashboard</button>{" "}
            <button onClick={() => setView("menu-editor")}>Edit Menu</button>{" "}
            <button onClick={() => setView("analytics")}>Analytics</button>{" "}
            <button onClick={() => setView("user")}>Switch to User View</button>
          </div>
          {view === "menu-editor" && (
            <MenuEditor token={vendorToken} shopItems={menu.find(s => s.shopId === selectedShop)?.items} />
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
              <button onClick={() => setView("login")} style={{ marginBottom: "15px" }}>
                Vendor Login
              </button>
              <Menu
                menu={menu}
                addToCart={addToCart}
                selectedShop={selectedShop}
                setSelectedShop={setSelectedShop}
              />
              <Cart
                cart={cart}
                removeFromCart={removeFromCart}
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