import React, { useState } from "react";
import { vendorLogin } from "../api";
import { toast } from "react-toastify";

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const data = await vendorLogin(username, password);
      if (data.token) {
        toast.success("Login successful");
        onLogin(data.token);
      } else {
        toast.error(data.message || "Login failed");
      }
    } catch {
      toast.error("Login error");
    }
  };

  return (
    <div>
      <h2>Vendor Login</h2>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Employee ID"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <br />
        <input
          type="password"
          placeholder="Password (demo: password123)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <br />
        <button type="submit">Login</button>
      </form>
    </div>
  );
};

export default Login;