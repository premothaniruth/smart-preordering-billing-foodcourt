import React, { useEffect, useState } from "react";
import { fetchMenu, placeOrder } from "./api";
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
  // App states
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedShop, setSelectedShop] = useState(1);
  const [vendorToken, setVendorToken] = useState(null);
  const [view, setView] = useState("user"); // 'user', 'login', 'admin'

  // Load menu for user or vendor
  useEffect(() => {
    fetchMenu().then((data) => {
      setMenu(data);
      if (selectedShop === 0 && data.length > 0) setSelectedShop(data[0].shopId);
    });
  }, [selectedShop]);

  // User functions
  const addToCart = (item, shopId) => setCart([...cart, { ...item, shopId }]);
  const removeFromCart = (index) => setCart(cart.filter((_, i) => i !== index));

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
    setView("admin");
  };

  // Logout vendor
  const handleLogout = () => {
    setVendorToken(null);
    setView("user");
  };

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "auto" }}>
      <ToastContainer position="top-right" autoClose={3000} />
      <h1>Smart Preordering & Billing - Food Court</h1>

      {vendorToken ? (
        <>
          <button onClick={handleLogout} style={{ marginBottom: "15px" }}>
            Logout
          </button>
          {view === "admin" && (
            <>
              <button onClick={() => setView("menu-editor")}>Edit Menu</button>{" "}
              <button onClick={() => setView("dashboard")}>View Orders</button>{" "}
              <button onClick={() => setView("analytics")}>Analytics</button>
            </>
          )}
          {view === "menu-editor" && (
            <MenuEditor