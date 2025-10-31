// Imports
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

// App setup
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "MySuperSecretKeyForJWT";

app.use(cors());
app.use(bodyParser.json({ limit: '6mb' }));
app.use('/images', express.static(path.join(__dirname, 'data', 'images')));

// File paths
const menuFile = __dirname + "/data/menu.json";
const ordersFile = __dirname + "/data/orders.json";
const vendorsFile = __dirname + "/data/vendors.json";
const billingCounterFile = __dirname + "/data/billing_counter.json";
const favoritesFile = __dirname + "/data/favorites.json";
const ratingsFile = __dirname + "/data/ratings.json";
const grievancesFile = __dirname + "/data/grievances.json";
const employeesFile = __dirname + "/data/employees.json";
const combosFile = __dirname + "/data/combos.json";
const offersFile = __dirname + "/data/offers.json";
const sectionWindowsFile = __dirname + "/data/section_windows.json";

// Helper functions (defined after paths)
const getEmployees = () => {
  try {
    return JSON.parse(fs.readFileSync(employeesFile, "utf8"));
  } catch {
    return [];
  }
};

const saveEmployees = (list) => {
  fs.writeFileSync(employeesFile, JSON.stringify(list, null, 2));
};

const validatePin = (pin) => /^\d{4}$/.test(String(pin || ''));
const validatePassword = (pwd) => {
  const s = String(pwd || '');
  if (s.length < 8 || s.length > 20) return false;
  const hasLower = /[a-z]/.test(s);
  const hasUpper = /[A-Z]/.test(s);
  const hasDigit = /\d/.test(s);
  const hasSymbol = /[\.,&%#@!]/.test(s);
  return hasLower && hasUpper && hasDigit && hasSymbol;
};

// In-memory stores (no database)
const employeeOtps = new Map(); // mobile -> { otp, expiresAt }
const employeeSessions = new Map(); // token -> { mobile, createdAt, employeeId?, contact? }
const employeeProfileOtps = new Map(); // key `${action}:${employeeId}` -> { otp, expiresAt }

// Startup: hash any pinPlain, and set initial pins for demo users 1 and 2 if missing
const ensureEmployeePins = async () => {
  try {
    const list = getEmployees();
    let changed = false;
    for (const e of list) {
      if (e.pinPlain && validatePin(e.pinPlain)) {
        e.pinHash = await bcrypt.hash(String(e.pinPlain), 10);
        delete e.pinPlain;
        changed = true;
      }
    }
    const u1 = list.find(x => Number(x.id) === 1);
    const u2 = list.find(x => Number(x.id) === 2);
    if (u1) { u1.pinHash = await bcrypt.hash('1234', 10); changed = true; }
    if (u2) { u2.pinHash = await bcrypt.hash('4321', 10); changed = true; }
    if (changed) saveEmployees(list);
  } catch {}
};

const validateEmailAddress = (email) => {
  const str = String(email || '').trim();
  if (!str) return false;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str);
};

const normalizeMobileInput = (value) => {
  if (value == null) return null;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length !== 10) return null;
  return `+91${digits}`;
};

const sanitizeEmployeeProfile = (employee) => ({
  id: employee.id,
  username: employee.username || '',
  email: employee.email || '',
  mobile: employee.mobile || '',
  birthday: employee.birthday || '',
  friends: Array.isArray(employee.friends) ? employee.friends : [],
  hasPassword: Boolean(employee.passwordHash),
  hasPin: Boolean(employee.pinHash),
});

const resolveEmployeeFromToken = (token) => {
  if (!token) return null;
  const tokenStr = String(token);
  let decoded;
  try {
    decoded = jwt.verify(tokenStr, JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded || decoded.role !== 'employee') return null;
  const identifiers = new Set();
  const pushIdent = (val) => {
    if (val === undefined || val === null) return;
    const str = String(val).trim();
    if (!str) return;
    identifiers.add(str.toLowerCase());
  };
  pushIdent(decoded.employeeId);
  pushIdent(decoded.mobile);
  pushIdent(decoded.contact);
  pushIdent(decoded.username);
  pushIdent(decoded.email);
  const sessionInfo = employeeSessions.get(tokenStr);
  if (sessionInfo) {
    pushIdent(sessionInfo.employeeId);
    pushIdent(sessionInfo.mobile);
    pushIdent(sessionInfo.contact);
  }
  const employees = getEmployees();
  let index = -1;
  for (const ident of identifiers) {
    index = employees.findIndex((emp) => {
      const username = String(emp.username || '').toLowerCase();
      const email = String(emp.email || '').toLowerCase();
      const mobile = String(emp.mobile || '').toLowerCase();
      const idStr = String(emp.id || '').toLowerCase();
      return username === ident || email === ident || mobile === ident || idStr === ident;
    });
    if (index >= 0) break;
  }
  if (index === -1) return null;
  return { employee: employees[index], index, employees, token: tokenStr };
};

/**
 * One-time migration: ensure every item has isHotSeller/isRecommended in menu.json.
 * If a category has no items with these flags, pick 5 random items in that category
 * for each flag and persist back to disk.
 */
const ensureHotRecFlags = () => {
  try {
    const raw = getMenu();
    if (!raw || !Array.isArray(raw.shops)) return; // only handle new shape
    let changed = false;
    for (const shop of raw.shops) {
      const categories = Array.isArray(shop.categories) ? shop.categories : [];
      for (const cat of categories) {
        const items = Array.isArray(cat.items) ? cat.items : [];
        if (items.length === 0) continue;
        let anyHot = items.some(it => it.isHotSeller === true);
        let anyRec = items.some(it => it.isRecommended === true);
        // Ensure flags exist
        for (const it of items) {
          if (it.isHotSeller == null) { it.isHotSeller = false; changed = true; }
          if (it.isRecommended == null) { it.isRecommended = false; changed = true; }
        }
        // If none set yet, pick 5 random for each
        const pickRandom = (n) => {
          const idxs = items.map((_, i) => i);
          for (let i = idxs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
          }
          return idxs.slice(0, Math.min(n, idxs.length));
        };
        if (!anyHot) {
          pickRandom(5).forEach(i => { if (!items[i].isHotSeller) { items[i].isHotSeller = true; changed = true; } });
        }
        if (!anyRec) {
          pickRandom(5).forEach(i => { if (!items[i].isRecommended) { items[i].isRecommended = true; changed = true; } });
        }
      }
    }
    if (changed) {
      fs.writeFileSync(menuFile, JSON.stringify(raw, null, 2));
    }
  } catch {}
};

// Run migrations at startup (after modules and paths are defined)
ensureHotRecFlags();
ensureEmployeePins();

// Routes

// Request OTP for employee login (registered users only)
app.post("/employee/request-otp", (req, res) => {
  try {
    const { mobile } = req.body || {};
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ message: "Mobile must be 10 digits" });
    }
    const fullMobile = `+91${mobile}`;
    const employees = getEmployees();
    const user = employees.find(e => String(e.mobile || '').toLowerCase() === fullMobile.toLowerCase());
    if (!user) return res.status(404).json({ message: 'Mobile not registered' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    employeeOtps.set(fullMobile, { otp, expiresAt: Date.now() + 2 * 60 * 1000 });
    console.log(`[OTP] Mobile: ${fullMobile} -> ${otp}`);
    res.json({ status: 'ok' });
  } catch {
    res.status(500).json({ message: 'Error requesting OTP' });
  }
});

// Employee profile fetch
app.post('/employee/profile', (req, res) => {
  try {
    const { token } = req.body || {};
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    return res.json({ status: 'ok', profile: sanitizeEmployeeProfile(resolved.employee) });
  } catch {
    res.status(500).json({ message: 'Failed to load profile' });
  }
});

// Employee profile OTP request
app.post('/employee/profile/request-otp', (req, res) => {
  try {
    const { token, action } = req.body || {};
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const validActions = new Set(['verify-email', 'verify-mobile', 'change-password', 'change-pin']);
    if (!validActions.has(action)) {
      return res.status(400).json({ message: 'Invalid action' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `${action}:${resolved.employee.id}`;
    employeeProfileOtps.set(key, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
    console.log(`[Profile OTP] employee ${resolved.employee.id} action ${action} -> ${otp}`);
    return res.json({ status: 'ok' });
  } catch {
    res.status(500).json({ message: 'Failed to request OTP' });
  }
});

// Employee profile update
app.post('/employee/profile/update', async (req, res) => {
  try {
    const { token, updates, otp, action } = req.body || {};
    if (!token || !updates || typeof updates !== 'object') {
      return res.status(400).json({ message: 'Token and updates are required' });
    }
    const resolved = resolveEmployeeFromToken(token);
    if (!resolved) return res.status(401).json({ message: 'Invalid or expired session' });
    const { employee, index, employees, token: tokenStr } = resolved;
    const updated = { ...employee };
    let changed = false;

    const sensitiveChanges = [];

    if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
      const candidate = String(updates.username || '').trim();
      if (!candidate) return res.status(400).json({ message: 'Username is required' });
      const currentUsername = String(employee.username || '').trim();
      if (currentUsername) {
        if (candidate.toLowerCase() !== currentUsername.toLowerCase()) {
          return res.status(403).json({ message: 'Username cannot be changed after registration' });
        }
      } else if (candidate.toLowerCase() !== currentUsername.toLowerCase()) {
        const exists = employees.some((e, idx) => idx !== index && String(e.username || '').toLowerCase() === candidate.toLowerCase());
        if (exists) return res.status(409).json({ message: 'Username not available' });
        updated.username = candidate;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
      const candidate = String(updates.email || '').trim();
      if (!validateEmailAddress(candidate)) {
        return res.status(400).json({ message: 'Invalid email' });
      }
      if (candidate.toLowerCase() !== String(employee.email || '').toLowerCase()) {
        const exists = employees.some((e, idx) => idx !== index && String(e.email || '').toLowerCase() === candidate.toLowerCase());
        if (exists) return res.status(409).json({ message: 'Email already registered' });
        updated.email = candidate;
        changed = true;
        sensitiveChanges.push('email');
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'mobile')) {
      const normalized = normalizeMobileInput(updates.mobile);
      if (!normalized) return res.status(400).json({ message: 'Mobile must be 10 digits (India)' });
      if (normalized !== String(employee.mobile || '')) {
        const exists = employees.some((e, idx) => idx !== index && String(e.mobile || '').toLowerCase() === normalized.toLowerCase());
        if (exists) return res.status(409).json({ message: 'Mobile already registered' });
        updated.mobile = normalized;
        changed = true;
        sensitiveChanges.push('mobile');
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
      const pwd = String(updates.password || '');
      if (!validatePassword(pwd)) {
        return res.status(400).json({ message: 'Password must be 8-20 chars with lower, upper, number, and one of .,&%#@!' });
      }
      updated.passwordHash = await bcrypt.hash(pwd, 10);
      changed = true;
      sensitiveChanges.push('password');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'pin')) {
      const pinStr = String(updates.pin || '');
      if (!validatePin(pinStr)) {
        return res.status(400).json({ message: 'PIN must be 4 digits' });
      }
      updated.pinHash = await bcrypt.hash(pinStr, 10);
      changed = true;
      sensitiveChanges.push('pin');
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'birthday')) {
      const bday = String(updates.birthday || '').trim();
      if (bday !== String(employee.birthday || '')) {
        updated.birthday = bday;
        changed = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'friends')) {
      let friendsList = updates.friends;
      if (typeof friendsList === 'string') {
        friendsList = friendsList
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);
      }
      if (Array.isArray(friendsList)) {
        const existing = Array.isArray(employee.friends) ? employee.friends : [];
        const changedFriends = friendsList.length !== existing.length || friendsList.some((f, idx) => existing[idx] !== f);
        if (changedFriends) {
          updated.friends = friendsList;
          changed = true;
        }
      }
    }

    if (sensitiveChanges.length > 1) {
      return res.status(400).json({ message: 'Update one sensitive field at a time (email, mobile, password, or pin)' });
    }

    if (sensitiveChanges.length === 1) {
      const requiredActionMap = {
        email: 'verify-email',
        mobile: 'verify-mobile',
        password: 'change-password',
        pin: 'change-pin',
      };
      const field = sensitiveChanges[0];
      const expectedAction = requiredActionMap[field];
      if (!otp || !action || action !== expectedAction) {
        return res.status(400).json({ message: 'Valid OTP is required for this change' });
      }
      const key = `${action}:${employee.id}`;
      const stored = employeeProfileOtps.get(key);
      if (!stored || stored.otp !== String(otp) || Date.now() > stored.expiresAt) {
        return res.status(401).json({ message: 'Invalid or expired OTP' });
      }
      employeeProfileOtps.delete(key);
    }

    if (!changed) {
      return res.json({ status: 'ok', profile: sanitizeEmployeeProfile(employee) });
    }

    employees[index] = updated;
    saveEmployees(employees);

    const sessionInfo = employeeSessions.get(tokenStr);
    if (sessionInfo) {
      employeeSessions.set(tokenStr, {
        ...sessionInfo,
        employeeId: updated.id,
        mobile: updated.mobile || sessionInfo.mobile,
        contact: updated.mobile || sessionInfo.contact,
      });
    }

    return res.json({ status: 'ok', profile: sanitizeEmployeeProfile(updated) });
  } catch (error) {
    console.error('Error updating employee profile', error);
    res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Verify OTP and issue session
app.post("/employee/verify-otp", (req, res) => {
  try {
    const { mobile, otp } = req.body || {};
    if (!mobile || !otp) return res.status(400).json({ message: 'Mobile and OTP required' });
    if (!/^\d{10}$/.test(String(mobile))) return res.status(400).json({ message: 'Invalid mobile' });
    const fullMobile = `+91${mobile}`;
    const record = employeeOtps.get(fullMobile);
    if (!record || record.otp !== String(otp) || Date.now() > record.expiresAt) {
      return res.status(401).json({ message: 'Invalid or expired OTP' });
    }
    employeeOtps.delete(fullMobile);
    const employees = getEmployees();
    const user = employees.find(e => String(e.mobile || '').toLowerCase() === fullMobile.toLowerCase());
    if (!user) return res.status(404).json({ message: 'User not found' });
    const payload = { role: 'employee', mobile: fullMobile, employeeId: user.id, username: user.username, email: user.email };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, { mobile: fullMobile, contact: fullMobile, createdAt: Date.now(), employeeId: user.id });
    res.json({ status: 'ok', token, mobile: fullMobile, username: user.username, email: user.email });
  } catch {
    res.status(500).json({ message: 'Error verifying OTP' });
  }
});

// Username availability
app.get('/employee/check-username', (req, res) => {
  try {
    const { username } = req.query || {};
    if (!username) return res.status(400).json({ available: false, message: 'username required' });
    const employees = getEmployees();
    const exists = employees.some(e => String(e.username).toLowerCase() === String(username).toLowerCase());
    res.json({ available: !exists });
  } catch {
    res.status(500).json({ available: false });
  }
});

// Registration
app.post('/employee/register', async (req, res) => {
  try {
    let { username, password, pin, mobile, email } = req.body || {};
    username = String(username || '').trim();
    if (!username) return res.status(400).json({ message: 'Username is required' });
    if (!validatePin(pin)) return res.status(400).json({ message: 'PIN must be 4 digits' });
    if (!validatePassword(password)) return res.status(400).json({ message: 'Password must be 8-20 chars with lower, upper, number, and one of .,&%#@!' });
    // Normalize mobile to +91XXXXXXXXXX
    const digits = String(mobile || '').replace(/[^0-9]/g,'');
    if (digits.length !== 10) return res.status(400).json({ message: 'Mobile must be 10 digits (India)' });
    const mobileNorm = `+91${digits}`;
    const emailStr = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailStr)) return res.status(400).json({ message: 'Invalid email' });
    const employees = getEmployees();
    const exists = employees.some(e => String(e.username).toLowerCase() === username.toLowerCase());
    if (exists) return res.status(409).json({ message: 'Username not available' });
    const mobileExists = employees.some(e => String(e.mobile || '').toLowerCase() === mobileNorm.toLowerCase());
    if (mobileExists) return res.status(409).json({ message: 'Mobile already registered' });
    const emailExists = employees.some(e => String(e.email || '').toLowerCase() === emailStr.toLowerCase());
    if (emailExists) return res.status(409).json({ message: 'Email already registered' });
    const id = (employees.reduce((m, e) => Math.max(m, Number(e.id)||0), 0) + 1) || 1;
    const passwordHash = await bcrypt.hash(String(password), 10);
    const pinHash = await bcrypt.hash(String(pin), 10);
    const newEmp = { id, username, email: emailStr, mobile: mobileNorm, passwordHash, pinHash };
    employees.push(newEmp);
    saveEmployees(employees);
    res.json({ status: 'ok', id, username });
  } catch (e) {
    res.status(500).json({ message: 'Error registering user' });
  }
});

// Employee username/password login
app.post('/employee/login-password', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required' });
    const employees = getEmployees();
    const u = employees.find(e => String(e.username).toLowerCase() === String(username).toLowerCase() || String(e.email || '').toLowerCase() === String(username).toLowerCase());
    if (!u || !u.passwordHash) return res.status(401).json({ message: 'Invalid credentials' });
    const ok = await bcrypt.compare(String(password), String(u.passwordHash));
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const contact = u.mobile || u.email || u.username || String(u.id);
    const payload = { role: 'employee', mobile: u.mobile || null, employeeId: u.id, username: u.username, email: u.email, contact };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, { mobile: u.mobile || contact, contact, createdAt: Date.now(), employeeId: u.id });
    res.json({ status: 'ok', token, mobile: u.mobile || contact, username: u.username, email: u.email });
  } catch (e) {
    res.status(500).json({ message: 'Error during password login' });
  }
});

// Employee 4-digit PIN login
app.post('/employee/login-pin', async (req, res) => {
  try {
    const { username, pin, mobileOrEmail } = req.body || {};
    if (!username || !pin) return res.status(400).json({ message: 'Username and PIN are required' });
    if (!validatePin(pin)) return res.status(400).json({ message: 'PIN must be 4 digits' });
    const employees = getEmployees();
    const u = employees.find(e => String(e.username).toLowerCase() === String(username).toLowerCase() || String(e.email || '').toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(401).json({ message: 'Invalid credentials' });
    if (!u.pinHash) return res.status(403).json({ message: 'PIN not configured. Contact administrator.' });
    const ok = await bcrypt.compare(String(pin), String(u.pinHash));
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
    const mobile = u.email || u.username || String(u.id);
    const payload = { role: 'employee', mobile: u.mobile || null, employeeId: u.id, username: u.username, email: u.email || null, contact: mobile };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, { mobile: u.mobile || mobile, contact: mobile, createdAt: Date.now(), employeeId: u.id });
    res.json({ status: 'ok', token, mobile });
  } catch (e) {
    res.status(500).json({ message: 'Error during PIN login' });
  }
});

// Reset PIN (requires username, contact verification, and new 4-digit PIN)
app.post('/employee/reset-pin', async (req, res) => {
  try {
    const { username, mobileOrEmail, newPin } = req.body || {};
    if (!username || !mobileOrEmail || !newPin) return res.status(400).json({ message: 'Username, contact, and new PIN are required' });
    if (!validatePin(newPin)) return res.status(400).json({ message: 'PIN must be 4 digits' });
    const employees = getEmployees();
    const u = employees.find(e => String(e.username).toLowerCase() === String(username).toLowerCase() || String(e.email || '').toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(404).json({ message: 'User not found' });
    const contact = String(mobileOrEmail || '').toLowerCase();
    const okContact = contact && (String(u.email || '').toLowerCase() === contact || String(u.mobile || '').toLowerCase() === contact);
    if (!okContact) return res.status(401).json({ message: 'Contact does not match' });
    u.pinHash = await bcrypt.hash(String(newPin), 10);
    saveEmployees(employees);
    res.json({ status: 'ok', message: 'PIN updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error resetting PIN' });
  }
});

// Reset password (requires username, contact verification, and strong password)
app.post('/employee/reset-password', async (req, res) => {
  try {
    const { username, mobileOrEmail, newPassword } = req.body || {};
    if (!username || !mobileOrEmail || !newPassword) return res.status(400).json({ message: 'Username, contact, and new password are required' });
    if (!validatePassword(newPassword)) return res.status(400).json({ message: 'Password must be 8-20 chars with lower, upper, number, and one of .,&%#@!' });
    const employees = getEmployees();
    const u = employees.find(e => String(e.username).toLowerCase() === String(username).toLowerCase() || String(e.email || '').toLowerCase() === String(username).toLowerCase());
    if (!u) return res.status(404).json({ message: 'User not found' });
    const contact = String(mobileOrEmail || '').toLowerCase();
    const okContact = contact && (String(u.email || '').toLowerCase() === contact || String(u.mobile || '').toLowerCase() === contact);
    if (!okContact) return res.status(401).json({ message: 'Contact does not match' });
    u.passwordHash = await bcrypt.hash(String(newPassword), 10);
    saveEmployees(employees);
    res.json({ status: 'ok', message: 'Password updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error resetting password' });
  }
});

// Apple login: verify Apple ID token via Apple JWKS and issue employee session
/**
 * POST /employee/apple-login
 * Body: { idToken }
 * Verifies signature using Apple's JWKS and validates iss/aud/exp
 */
app.post('/employee/apple-login', async (req, res) => {
  try {
    const { idToken, email } = req.body || {};
    // Demo fallback: accept email directly
    if (email) {
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ message: 'Valid email is required' });
      }
      const mobile = email;
      const token = jwt.sign({ role: 'employee', mobile }, JWT_SECRET, { expiresIn: '8h' });
      employeeSessions.set(token, { mobile, createdAt: Date.now() });
      return res.json({ status: 'ok', token, mobile });
    }
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ message: 'idToken is required' });
    }
    const clientId = process.env.APPLE_CLIENT_ID || '';
    const parts = idToken.split('.');
    if (parts.length !== 3) return res.status(400).json({ message: 'Invalid token format' });
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const b64uToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const header = JSON.parse(Buffer.from(encodedHeader.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    // Validate claims (issuer, audience, expiration) after signature check
    // Fetch Apple JWKS
    const https = require('https');
    const jwks = await new Promise((resolve, reject) => {
      https.get('https://appleid.apple.com/auth/keys', (resp) => {
        let data = '';
        resp.on('data', (c) => data += c);
        resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
    const key = keys.find(k => k.kid === header.kid && k.alg === header.alg);
    if (!key) return res.status(401).json({ message: 'Apple key not found' });

    // Build PEM from JWK (RSA)
    const kty = key.kty;
    if (kty !== 'RSA') return res.status(401).json({ message: 'Unsupported key type' });
    const n = key.n; // base64url modulus
    const e = key.e; // base64url exponent
    const base64UrlToBase64 = (s) => s.replace(/-/g, '+').replace(/_/g, '/');
    function rsaPublicKeyPem(modulusB64Url, exponentB64Url) {
      const modulus = Buffer.from(base64UrlToBase64(modulusB64Url), 'base64');
      const exponent = Buffer.from(base64UrlToBase64(exponentB64Url), 'base64');
      // ASN.1 DER sequence for RSA public key
      function derEncodeLength(len) {
        if (len < 128) return Buffer.from([len]);
        const bytes = [];
        let v = len;
        while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
        return Buffer.from([0x80 | bytes.length, ...bytes]);
      }
      function derEncodeInteger(buf) {
        // Ensure positive integer (prepend 0x00 if high bit set)
        if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
        return Buffer.concat([Buffer.from([0x02]), derEncodeLength(buf.length), buf]);
      }
      const seqBody = Buffer.concat([
        derEncodeInteger(modulus),
        derEncodeInteger(exponent)
      ]);
      const seq = Buffer.concat([Buffer.from([0x30]), derEncodeLength(seqBody.length), seqBody]);
      // Wrap in SubjectPublicKeyInfo with RSA OID 1.2.840.113549.1.1.1
      const rsaOid = Buffer.from([0x30,0x0D,0x06,0x09,0x2A,0x86,0x48,0x86,0xF7,0x0D,0x01,0x01,0x01,0x05,0x00]);
      const bitString = Buffer.concat([Buffer.from([0x03]), derEncodeLength(seq.length + 1), Buffer.from([0x00]), seq]);
      const spkiBody = Buffer.concat([rsaOid, bitString]);
      const spki = Buffer.concat([Buffer.from([0x30]), derEncodeLength(spkiBody.length), spkiBody]);
      const pem = `-----BEGIN PUBLIC KEY-----\n${spki.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
      return pem;
    }
    const publicKeyPem = rsaPublicKeyPem(n, e);
    const crypto = require('crypto');
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(Buffer.from(`${encodedHeader}.${encodedPayload}`));
    verify.end();
    const signature = b64uToBuf(encodedSig);
    const valid = verify.verify(publicKeyPem, signature);
    if (!valid) return res.status(401).json({ message: 'Invalid Apple token signature' });

    // Validate issuer, audience, expiry
    if (payload.iss !== 'https://appleid.apple.com') {
      return res.status(401).json({ message: 'Invalid issuer' });
    }
    if (clientId && payload.aud !== clientId) {
      return res.status(401).json({ message: 'Audience mismatch' });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && nowSec > Number(payload.exp)) {
      return res.status(401).json({ message: 'Token expired' });
    }

    const emailFromToken = payload.email || payload.sub;
    const mobile = emailFromToken; // reusing email/sub as identifier
    const token = jwt.sign({ role: 'employee', mobile }, JWT_SECRET, { expiresIn: '8h' });
    employeeSessions.set(token, { mobile, createdAt: Date.now() });
    res.json({ status: 'ok', token, mobile });
  } catch (e) {
    res.status(500).json({ message: 'Error during Apple login' });
  }
});

// Get menu
/**
 * Read menu JSON from disk.
 * @returns {Array}
 */
const getMenu = () => {
  try {
    return JSON.parse(fs.readFileSync(menuFile, "utf8"));
  } catch {
    return [];
  }
};

/**
 * Normalize menu shops to ensure consistent structure.
 * @param {any} raw
 * @returns {Array}
 */
const normalizeMenuShops = (raw) => {
  if (!raw || !Array.isArray(raw.shops)) return [];
  return raw.shops.map((shop) => {
    const items = Array.isArray(shop.categories)
      ? shop.categories.flatMap((cat) => Array.isArray(cat.items) ? cat.items.map((it) => normalizeItem({ ...it, section: cat.categoryName || 'All Items' })) : [])
      : Array.isArray(shop.items) ? shop.items.map(normalizeItem) : [];
    return { ...shop, items };
  });
};

/**
 * Normalize a single item: map hasOptions (array) -> options, ensure flags and defaults.
 * @param {any} it
 * @returns {any}
 */
const normalizeItem = (it) => {
  const options = Array.isArray(it.hasOptions) ? it.hasOptions : (Array.isArray(it.options) ? it.options : []);
  const hasOptionsFlag = Array.isArray(options) && options.length > 0;
  return {
    ...it,
    options,
    hasOptions: hasOptionsFlag,
    inventory: (it.inventory == null || isNaN(Number(it.inventory))) ? 100 : Number(it.inventory)
  };
};

/**
 * Persist menu to disk.
 * @param {any} menu - Full menu array
 * @returns {void}
 */
const saveMenu = (menu) => fs.writeFileSync(menuFile, JSON.stringify(menu, null, 2));

/**
 * Read orders JSON from disk.
 * @returns {Array}
 */
const getOrders = () => JSON.parse(fs.readFileSync(ordersFile, "utf8"));

/**
 * Persist orders to disk.
 * @param {Array} orders
 * @returns {void}
 */
const saveOrders = (orders) => fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));

/**
 * Read vendor credentials/data.
 * @returns {Array}
 */
const getVendors = () => JSON.parse(fs.readFileSync(vendorsFile, "utf8"));

/**
 * Read favorites from disk.
 * @returns {Array<{userId:string,itemId:number}>}
 */
const getFavorites = () => {
  try {
    return JSON.parse(fs.readFileSync(favoritesFile, "utf8"));
  } catch {
    return [];
  }
};

/**
 * Persist favorites to disk.
 * @param {Array} favorites
 */
const saveFavorites = (favorites) => fs.writeFileSync(favoritesFile, JSON.stringify(favorites, null, 2));

/**
 * Read ratings from disk.
 * @returns {Array}
 */
const getRatings = () => {
  try {
    return JSON.parse(fs.readFileSync(ratingsFile, "utf8"));
  } catch {
    return [];
  }
};

/**
 * Persist ratings to disk.
 * @param {Array} ratings
 */
const saveRatings = (ratings) => fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 2));

/**
 * Read grievances from disk.
 * @returns {Array}
 */
const getGrievances = () => {
  try {
    return JSON.parse(fs.readFileSync(grievancesFile, "utf8"));
  } catch {
    return [];
  }
};

/**
 * Persist grievances to disk.
 * @param {Array} grievances
 */
const saveGrievances = (grievances) => fs.writeFileSync(grievancesFile, JSON.stringify(grievances, null, 2));

// Combos
/** @returns {Array} */
const getCombos = () => {
  try {
    return JSON.parse(fs.readFileSync(combosFile, "utf8"));
  } catch {
    return [];
  }
};
/** @param {Array} combos */
const saveCombos = (combos) => fs.writeFileSync(combosFile, JSON.stringify(combos, null, 2));

// Offers
/** @returns {Array} */
const getOffers = () => {
  try {
    return JSON.parse(fs.readFileSync(offersFile, "utf8"));
  } catch {
    return [];
  }
};
/** @param {Array} offers */
const saveOffers = (offers) => fs.writeFileSync(offersFile, JSON.stringify(offers, null, 2));

// Section time windows
/** @returns {Record<string,{start:string,end:string}>} */
const getSectionWindows = () => {
  try {
    return JSON.parse(fs.readFileSync(sectionWindowsFile, "utf8"));
  } catch {
    return {};
  }
};

// Billing counter management
/**
 * Read daily billing counter (resets daily).
 * @returns {{date:string,counter:number}}
 */
const getBillingCounter = () => {
  try {
    return JSON.parse(fs.readFileSync(billingCounterFile, "utf8"));
  } catch {
    return { date: new Date().toDateString(), counter: 0 };
  }
};

/**
 * Persist billing counter to disk.
 * @param {{date:string,counter:number}} data
 */
const saveBillingCounter = (data) => {
  fs.writeFileSync(billingCounterFile, JSON.stringify(data, null, 2));
};

// Generate 5-digit billing ID (resets daily)
/**
 * Generate a 5-digit billing ID that resets daily.
 * @returns {string}
 */
const generateBillingId = () => {
  const today = new Date().toDateString();
  let billingData = getBillingCounter();

  if (billingData.date !== today) {
    billingData = { date: today, counter: 0 };
  }

  billingData.counter += 1;

  if (billingData.counter > 99999) {
    billingData.counter = 1;
  }

  saveBillingCounter(billingData);
  return billingData.counter.toString().padStart(5, '0');
};

// Calculate preparation time based on items and current orders
/**
 * Calculate preparation time (mins) based on items and current queue load for a shop.
 * @param {Array<{prepTime?:number}>} items
 * @param {string} shopId
 * @returns {number}
 */
const calculatePreparationTime = (items, shopId) => {
  const orders = getOrders();
  const pendingOrders = orders.filter(o => o.shopId === shopId && o.status === "pending").length;
  
  const totalItemTime = items.reduce((sum, item) => sum + (item.prepTime || 5), 0);
  const queueTime = pendingOrders * 2;
  
  return Math.max(totalItemTime + queueTime, 5);
};

const calculateOrderTotal = (order) => {
  if (!order) return 0;
  if (order.totalAmount != null) {
    const parsed = Number(order.totalAmount);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (!Array.isArray(order.items)) return 0;
  const total = order.items.reduce((sum, it) => {
    const price = Number(it?.price || 0);
    const qty = Number(it?.quantity || 0);
    return sum + price * qty;
  }, 0);
  return Math.round(total * 100) / 100;
};

const evaluateScheduledCancellation = (order) => {
  if (!order) return { allowed: false, reason: "Order not found" };
  if (!order.scheduledTime) {
    return { allowed: false, reason: "Only scheduled orders can be cancelled." };
  }
  if ((order.status || "").toLowerCase() !== "pending") {
    return { allowed: false, reason: "Only pending scheduled orders can be cancelled." };
  }
  const scheduledDate = new Date(order.scheduledTime);
  if (Number.isNaN(scheduledDate.getTime())) {
    return { allowed: false, reason: "Scheduled time is invalid for this order." };
  }
  const now = new Date();
  const diffMinutes = (scheduledDate.getTime() - now.getTime()) / 60000;
  if (diffMinutes <= 0) {
    return { allowed: false, reason: "The scheduled window has already started." };
  }
  let refundPercent = null;
  let policy = null;
  if (diffMinutes >= 60) {
    refundPercent = 1;
    policy = "Full refund (cancel ≥ 60 minutes before scheduled time)";
  } else if (diffMinutes >= 30) {
    refundPercent = 0.75;
    policy = "75% refund (cancel 30-59 minutes before scheduled time)";
  } else {
    return {
      allowed: false,
      reason: "Cancellations are allowed until 30 minutes before the scheduled time.",
      diffMinutes
    };
  }
  const total = calculateOrderTotal(order);
  const refundAmount = Math.round(total * refundPercent * 100) / 100;
  const feeAmount = Math.round((total - refundAmount) * 100) / 100;
  return {
    allowed: true,
    refundAmount,
    feeAmount,
    refundPercent,
    diffMinutes,
    policy
  };
};

const restockInventory = (rawMenu, targetShopId, itemId, qty) => {
  const quantity = Number(qty || 0);
  if (!quantity) return;
  const shopIdStr = String(targetShopId);
  if (Array.isArray(rawMenu)) {
    const shopEntry = rawMenu.find((x) => String(x.shopId) === shopIdStr);
    if (!shopEntry || !Array.isArray(shopEntry.items)) return;
    const item = shopEntry.items.find((i) => i.id === itemId);
    if (item) {
      const current = Number(item.inventory ?? 0);
      item.inventory = current + quantity;
    }
    return;
  }
  const shops = Array.isArray(rawMenu?.shops) ? rawMenu.shops : [];
  const shopEntry = shops.find((x) => String(x.shopId) === shopIdStr);
  if (!shopEntry || !Array.isArray(shopEntry.categories)) return;
  for (const category of shopEntry.categories) {
    if (!Array.isArray(category.items)) continue;
    const found = category.items.find((i) => i.id === itemId);
    if (found) {
      const current = Number(found.inventory ?? 0);
      found.inventory = current + quantity;
      return;
    }
  }
};

// Middleware: Authenticate vendor
/**
 * Middleware: Validates vendor JWT and enriches req.vendor.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
const authenticateVendor = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.status(401).json({ message: "No token provided" });

  const tokenValue = token.replace("Bearer ", "");
  jwt.verify(tokenValue, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Failed to authenticate token" });
    req.vendor = decoded;
    next();
  });
};

// Get menu
/**
 * GET /menu
 * Public: Returns the entire menu with shops and items.
 */
app.get("/menu", (req, res) => {
  try {
    const raw = getMenu();
    const normalized = normalizeMenuShops(raw);
    // Support optional filtering by shop and section windows time
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const includeSections = String(req.query.includeSections || "").toLowerCase() === '1' || String(req.query.includeSections || "").toLowerCase() === 'true';
    const at = req.query.at ? new Date(req.query.at) : new Date();
    const toHM = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const hm = toHM(at);
    const windows = getSectionWindows();
    const inWindow = (sec) => {
      const w = windows[sec];
      if (!w || !w.start || !w.end) return true;
      return hm >= w.start && hm <= w.end;
    };
    if (!includeSections) {
      return res.json(normalized);
    }
    // Sections mode: derive sections from categories in raw when available
    const shopRaw = (Array.isArray(raw?.shops) ? raw.shops : normalized).find((s) => String(s.shopId) === shopId);
    if (!shopRaw) return res.json([]);
    let sections = [];
    if (Array.isArray(shopRaw?.categories)) {
      sections = shopRaw.categories.map((cat) => ({
        name: cat.categoryName || 'All Items',
        items: (Array.isArray(cat.items) ? cat.items : []).map((it) => normalizeItem({ ...it, section: cat.categoryName || 'All Items' }))
      }));
    } else {
      const shop = normalized.find((s) => String(s.shopId) === shopId) || { items: [] };
      const bySection = {};
      for (const it of (shop.items || [])) {
        const sec = (it.section && typeof it.section === 'string') ? it.section : 'All Items';
        if (!bySection[sec]) bySection[sec] = [];
        bySection[sec].push(it);
      }
      sections = Object.entries(bySection).map(([name, items]) => ({ name, items }));
    }
    sections = sections
      .map((sec) => {
        const filtered = (sec.items || []).filter((it) => it.hidden !== true);
        filtered.sort((a,b)=>Number(a.sectionOrder||0)-Number(b.sectionOrder||0));
        return { name: sec.name, items: filtered.slice(0, 30) };
      });
    return res.json({ shopId: shopRaw.shopId, shopName: shopRaw.shopName, sections, time: hm });
  } catch (error) {
    res.status(500).json({ message: "Error fetching menu" });
  }
});

// Section windows listing
/**
 * GET /sections
 * Public: Returns configured section time windows and allowed section names.
 */
app.get('/sections', (req, res) => {
  try {
    const windows = getSectionWindows();
    const names = Object.keys(windows);
    res.json({ windows, names });
  } catch (e) {
    res.status(500).json({ message: 'Error fetching sections' });
  }
});

// Public: Get global feedbacks with optional filters
// Query params: ratingMin (number), days (number)
/**
 * GET /feedbacks?ratingMin=&days=
 * Public: Returns ratings with minimal order context.
 * @query ratingMin number - minimum rating to include
 * @query days number - only ratings within last N days
 */
app.get("/feedbacks", (req, res) => {
  try {
    const ratingMin = req.query.ratingMin ? Number(req.query.ratingMin) : 0;
    const days = req.query.days ? Number(req.query.days) : null;
    const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

    const ratings = getRatings();
    const orders = getOrders();
    const orderIndex = new Map(orders.map(o => [o.id, o]));

    const result = ratings
      .filter(r => (r.rating || 0) >= ratingMin)
      .filter(r => !cutoff || new Date(r.timestamp) >= cutoff)
      .map(r => {
        const order = r.orderId ? orderIndex.get(r.orderId) : null;
        return {
          orderId: r.orderId || null,
          rating: r.rating,
          feedback: r.feedback,
          timestamp: r.timestamp,
          billingId: order?.billingId || null,
          shopId: order?.shopId || null,
          user: order?.user || null
        };
      });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: "Error fetching feedbacks" });
  }
});

// Get feedbacks/ratings for vendor's shop
/**
 * GET /vendor/feedbacks
 * Vendor: Returns feedbacks tied to orders from this vendor's shop.
 * Auth: Bearer token
 */
app.get("/vendor/feedbacks", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const ratings = getRatings();
    const vendorShopId = req.vendor.shopId;
    const orderIdsForShop = new Set(orders.filter(o => o.shopId === vendorShopId).map(o => o.id));
    const feedbacks = ratings
      .filter(r => r.orderId && orderIdsForShop.has(r.orderId))
      .map(r => {
        const order = orders.find(o => o.id === r.orderId);
        return {
          orderId: r.orderId,
          billingId: order?.billingId,
          rating: r.rating,
          feedback: r.feedback,
          timestamp: r.timestamp,
          user: order?.user
        };
      });
    res.json(feedbacks);
  } catch (error) {
    res.status(500).json({ message: "Error fetching feedbacks" });
  }
});

// Note: employee authentication is limited to registered credentials (username/password or PIN)

// Place order with billing ID and customization
/**
 * POST /order
 * Public: Place an order.
 * @body {items:Array,user?:string,scheduledTime?:string,shopId:string}
 * @returns { billingId:string, orderSummary:object }
 */
app.post("/order", (req, res) => {
  try {
    const { items, user, scheduledTime, shopId } = req.body;
    // Validate inventory and decrement (supports combo expansion)
    const raw = getMenu();
    const normalizedShops = normalizeMenuShops(raw);
    const shopNorm = normalizedShops.find((s) => String(s.shopId) === String(shopId));
    if (!shopNorm) {
      return res.status(400).json({ message: "Invalid shopId" });
    }
    shopNorm.items = Array.isArray(shopNorm.items) ? shopNorm.items : [];

    // Expand combos into required item quantities (with combo time window validation)
    const combos = getCombos();
    const isComboLine = (x) => x && (x.comboId != null);
    const toHM = (d) => `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const whenHM = scheduledTime ? toHM(new Date(scheduledTime)) : toHM(new Date());
    const inComboWindowHM = (combo, hm) => {
      const start = combo?.availableStart;
      const end = combo?.availableEnd;
      if (!start || !end) return true;
      return hm >= start && hm <= end;
    };
    const orderCombos = (items || []).filter(isComboLine);
    const orderSingles = (items || []).filter((x)=>!isComboLine(x));
    // Validate combo windows first
    const invalidCombos = [];
    const validCombos = [];
    for (const it of orderCombos) {
      const combo = combos.find(c => String(c.id) === String(it.comboId) && String(c.shopId) === String(shopId) && (c.active !== false));
      if (!combo) { invalidCombos.push({ comboId: it.comboId, reason: 'Invalid combo' }); continue; }
      if (!inComboWindowHM(combo, whenHM)) {
        invalidCombos.push({ comboId: it.comboId, name: combo.name, window: (combo.availableStart && combo.availableEnd) ? `${combo.availableStart}-${combo.availableEnd}` : null });
      } else {
        validCombos.push({ line: it, combo });
      }
    }
    if (scheduledTime && invalidCombos.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Some combos are not available at the selected time window.',
        notAvailableCombos: invalidCombos
      });
    }
    const required = new Map(); // itemId -> qty
    const flatItems = [];
    // Expand valid combos first
    for (const ent of validCombos) {
      const { line: it, combo } = ent;
      const qty = Number(it.quantity || 1);
      const comp = Array.isArray(combo.components) ? combo.components : [];
      for (const compIt of comp) {
        const id = compIt.itemId;
        const inc = Number(compIt.quantity || 1) * qty;
        required.set(id, (required.get(id) || 0) + inc);
        flatItems.push({ id, name: compIt.name || (shopNorm.items.find(i=>i.id===id)?.name) || `Item ${id}` , price: Number(compIt.overridePrice ?? (shopNorm.items.find(i=>i.id===id)?.price || 0)), quantity: inc, option: compIt.option || null, prepTime: compIt.prepTime || (shopNorm.items.find(i=>i.id===id)?.prepTime || 5) });
      }
    }
    // For immediate orders, drop invalid combos silently but return info later
    if (!scheduledTime && invalidCombos.length > 0) {
      req._excludedCombos = invalidCombos;
    }
    // Process standalone items
    for (const it of orderSingles) {
      const qty = Number(it.quantity || 1);
      const key = it.id;
      required.set(key, (required.get(key) || 0) + qty);
      flatItems.push({ id: it.id, name: it.name, price: it.price, quantity: qty, option: it.option || null, prepTime: it.prepTime });
    }

    // Section window enforcement
    const windows = getSectionWindows();
    const inWindowHM = (sec, hm) => {
      const w = windows[sec];
      if (!w || !w.start || !w.end) return true;
      return hm >= w.start && hm <= w.end;
    };
    const idToSection = new Map((shopNorm.items || []).map(i => [i.id, i.section || 'All Items']));

    if (scheduledTime) {
      // Reject order if any item outside its window at scheduled time
      const notAvailable = [];
      for (const [itemId, qtyNeeded] of required.entries()) {
        const sec = idToSection.get(itemId) || 'All Items';
        if (!inWindowHM(sec, whenHM)) {
          const it = shopNorm.items.find(i=>i.id===itemId);
          const w = windows[sec];
          notAvailable.push({ id: itemId, name: it?.name || `Item ${itemId}`, section: sec, window: w ? `${w.start}-${w.end}` : null, quantity: qtyNeeded });
        }
      }
      // If any combos invalid, include them too
      if (Array.isArray(invalidCombos) && invalidCombos.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Some items/combos are not available at the selected time window. Please adjust scheduled time.',
          notAvailable,
          notAvailableCombos: invalidCombos
        });
      }
      if (notAvailable.length > 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Some items are not available at the selected time window. Please adjust scheduled time.',
          notAvailable
        });
      }
    } else {
      // Immediate order: exclude items not in current window and proceed with the rest
      const excluded = [];
      for (const [itemId, qtyNeeded] of Array.from(required.entries())) {
        const sec = idToSection.get(itemId) || 'All Items';
        if (!inWindowHM(sec, whenHM)) {
          const it = shopNorm.items.find(i=>i.id===itemId);
          const w = windows[sec];
          excluded.push({ id: itemId, name: it?.name || `Item ${itemId}`, section: sec, window: w ? `${w.start}-${w.end}` : null, quantity: qtyNeeded });
          required.delete(itemId);
          // Also remove from flatItems
        }
      }
      // Also attach excluded combos
      if (Array.isArray(req._excludedCombos) && req._excludedCombos.length > 0) {
        req._excludedItems = (req._excludedItems || []).concat(req._excludedCombos.map(c => ({ name: c.name || `Combo ${c.comboId}`, section: 'Combo', window: c.window || null })));
      }
      if (excluded.length > 0) {
        // remove excluded from flatItems array
        for (const ex of excluded) {
          for (let i = flatItems.length - 1; i >= 0; i--) {
            if (flatItems[i].id === ex.id) flatItems.splice(i, 1);
          }
        }
      }
      if (required.size === 0) {
        return res.status(400).json({
          status: 'error',
          message: 'Selected items are not available at this time. Please order during their time window.',
          excludedItems: excluded
        });
      }
      // Attach excluded info to response later
      req._excludedItems = excluded;
    }

    // Check availability
    for (const [itemId, qtyNeeded] of required.entries()) {
      const menuItem = shopNorm.items.find((i) => i.id === itemId);
      const available = menuItem ? (Number(menuItem.inventory ?? 100)) : 0;
      if (!menuItem || available < qtyNeeded) {
        return res.status(400).json({
          message: "Insufficient inventory",
          itemId,
          available,
          needed: qtyNeeded,
        });
      }
    }

    // Decrement inventory in RAW structure and persist
    const persistDecrement = (rawMenu, targetShopId, itemId, qty) => {
      if (Array.isArray(rawMenu)) {
        const s = rawMenu.find((x) => String(x.shopId) === String(targetShopId));
        if (!s || !Array.isArray(s.items)) return;
        const it = s.items.find((i) => i.id === itemId);
        if (it) {
          const inv = Number(it.inventory ?? 100);
          it.inventory = Math.max(0, inv - qty);
        }
        return;
      }
      const shops = Array.isArray(rawMenu?.shops) ? rawMenu.shops : [];
      const s = shops.find((x) => String(x.shopId) === String(targetShopId));
      if (!s || !Array.isArray(s.categories)) return;
      for (const cat of s.categories) {
        if (!Array.isArray(cat.items)) continue;
        const idx = cat.items.findIndex((i) => i.id === itemId);
        if (idx >= 0) {
          const it = cat.items[idx];
          const inv = Number(it.inventory ?? 100);
          it.inventory = Math.max(0, inv - qty);
          return; // decremented; done
        }
      }
    };
    for (const [itemId, qtyNeeded] of required.entries()) {
      persistDecrement(raw, shopId, itemId, qtyNeeded);
    }
    saveMenu(raw);

    const orders = getOrders();

    const billingId = generateBillingId();
    let totalAmount = flatItems.reduce((sum, it) => sum + it.price * (it.quantity || 1), 0);
    // Apply active offers/discounts
    try {
      const now = new Date();
      const offers = getOffers().filter(o => {
        if (String(o.shopId) !== String(shopId)) return false;
        const start = o.start ? new Date(o.start) : null;
        const end = o.end ? new Date(o.end) : null;
        if (start && now < start) return false;
        if (end && now > end) return false;
        return o.active !== false;
      });
      if (offers.length > 0) {
        const idToSection = new Map((shop.items || []).map(i => [i.id, i.section || null]));
        const comboIdsInOrder = new Set((items || []).filter(x => x && x.comboId != null).map(x => String(x.comboId)));
        let discountTotal = 0;
        const OFFERS_MAX_DISCOUNT = Number(process.env.OFFERS_MAX_DISCOUNT || 0); // 0 = no global cap
        for (const off of offers) {
          const percent = off.discountPercent ? Number(off.discountPercent) : null;
          const amount = off.discountAmount ? Number(off.discountAmount) : null;
          const hasScopeSections = Array.isArray(off.applicableSections) && off.applicableSections.length > 0;
          const hasScopeCombos = Array.isArray(off.applicableComboIds) && off.applicableComboIds.length > 0;
          let base = 0;
          if (!hasScopeSections && !hasScopeCombos) {
            base = totalAmount; // global order-level offer
          } else {
            if (hasScopeSections) {
              for (const fi of flatItems) {
                const sec = idToSection.get(fi.id);
                if (sec && off.applicableSections.includes(sec)) {
                  base += (fi.price * (fi.quantity || 1));
                }
              }
            }
            if (hasScopeCombos && comboIdsInOrder.size > 0) {
              // If any targeted combos were ordered, apply over entire order or same base (choose conservative: apply on totalAmount)
              const any = off.applicableComboIds.some(cid => comboIdsInOrder.has(String(cid)));
              if (any && base === 0) base = totalAmount; // if no sections base, apply to total
            }
          }
          if (base <= 0) continue;
          // Non-stackable: if any discount already applied, skip
          if (off.stackable === false && discountTotal > 0) continue;
          let thisDiscount = 0;
          if (percent != null && percent > 0) thisDiscount += (base * (percent / 100));
          if (amount != null && amount > 0) thisDiscount += amount;
          if (off.maxDiscountAmount != null && off.maxDiscountAmount > 0) {
            thisDiscount = Math.min(thisDiscount, Number(off.maxDiscountAmount));
          }
          if (OFFERS_MAX_DISCOUNT > 0 && (discountTotal + thisDiscount) > OFFERS_MAX_DISCOUNT) {
            const remaining = Math.max(0, OFFERS_MAX_DISCOUNT - discountTotal);
            thisDiscount = Math.min(thisDiscount, remaining);
          }
          discountTotal += thisDiscount;
        }
        if (discountTotal > 0) totalAmount = Math.max(0, totalAmount - discountTotal);
      }
    } catch {}
    
    const prepTime = calculatePreparationTime(items, shopId);
    const estimatedReadyTime = new Date(Date.now() + prepTime * 60000).toISOString();

    const newOrder = {
      id: orders.length + 1,
      items: flatItems,
      shopId,
      user: user || "Anonymous",
      scheduledTime: scheduledTime || null,
      status: "pending",
      createdAt: new Date().toISOString(),
      billingId,
      estimatedReadyTime,
      prepTime,
      baseEstimatedReadyTime: estimatedReadyTime,
      basePrepTime: prepTime,
      rating: null,
      feedback: null,
      totalAmount
    };

    orders.push(newOrder);
    saveOrders(orders);

    const orderSummary = {
      billingId,
      user: newOrder.user,
      totalAmount,
      items: flatItems,
      estimatedReadyTime,
      prepTime
    };

    const extra = {};
    if (Array.isArray(req._excludedItems) && req._excludedItems.length > 0) {
      extra.excludedItems = req._excludedItems;
      extra.message = 'Some items were excluded as they are not available at this time.';
    }
    res.json({ 
      status: "success", 
      billingId, 
      orderSummary, 
      message: "Order placed!",
      ...extra
    });
  } catch (error) {
    res.status(500).json({ message: "Error placing order" });
  }
});

app.post("/order/cancel/:id", (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    if (Number.isNaN(orderId)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const { userId, reason } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }
    const orders = getOrders();
    const index = orders.findIndex((o) => Number(o.id) === orderId);
    if (index === -1) {
      return res.status(404).json({ message: "Order not found" });
    }
    const order = orders[index];
    if (String(order.user || "").trim() !== String(userId).trim()) {
      return res.status(403).json({ message: "You can only cancel your own orders" });
    }
    if ((order.status || "").toLowerCase() === "cancelled") {
      return res.status(400).json({ status: "error", message: "Order is already cancelled." });
    }
    const outcome = evaluateScheduledCancellation(order);
    if (!outcome.allowed) {
      return res.status(400).json({
        status: "error",
        message: outcome.reason || "Cancellation not allowed",
        policy: outcome.policy || null,
        diffMinutes: outcome.diffMinutes ?? null
      });
    }

    let rawMenu;
    try {
      rawMenu = getMenu();
    } catch {
      rawMenu = null;
    }

    if (rawMenu && Array.isArray(order.items)) {
      for (const item of order.items) {
        const quantity = Number(item?.quantity || 0);
        const itemId = item?.id;
        if (!itemId || !quantity) continue;
        restockInventory(rawMenu, order.shopId, itemId, quantity);
      }
      try {
        saveMenu(rawMenu);
      } catch {}
    }

    order.status = "cancelled";
    order.cancelledAt = new Date().toISOString();
    order.cancelledBy = userId;
    order.cancellationReason = reason || null;
    order.refundAmount = outcome.refundAmount;
    order.cancellationFee = outcome.feeAmount;
    order.cancellationPolicy = outcome.policy;
    order.cancellationRefundPercent = outcome.refundPercent;
    order.cancellationLeadMinutes = outcome.diffMinutes;

    saveOrders(orders);

    res.json({
      status: "success",
      message: "Order cancelled successfully",
      refundAmount: outcome.refundAmount,
      feeAmount: outcome.feeAmount,
      policy: outcome.policy,
      order
    });
  } catch (error) {
    res.status(500).json({ message: "Error cancelling order" });
  }
});

// Get user's order history
/**
 * GET /orders/user/:userId
 * Public: List orders for a user.
 */
app.get("/orders/user/:userId", (req, res) => {
  try {
    const orders = getOrders();
    const userOrders = orders.filter(o => o.user === req.params.userId);
    res.json(userOrders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching user orders" });
  }
});

// Add/Remove favorite
/**
 * POST /favorites
 * Public: Toggle favorite for a user and item.
 * @body {userId:string,itemId:number}
 */
app.post("/favorites", (req, res) => {
  try {
    const { userId, itemId } = req.body;
    let favorites = getFavorites();
    
    const existingIndex = favorites.findIndex(f => f.userId === userId && f.itemId === itemId);
    
    if (existingIndex >= 0) {
      favorites.splice(existingIndex, 1);
      saveFavorites(favorites);
      res.json({ status: "removed", message: "Removed from favorites" });
    } else {
      favorites.push({ userId, itemId });
      saveFavorites(favorites);
      res.json({ status: "added", message: "Added to favorites" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error updating favorites" });
  }
});

// Get user favorites
/**
 * GET /favorites/:userId
 * Public: Get list of favorite itemIds for user.
 */
app.get("/favorites/:userId", (req, res) => {
  try {
    const favorites = getFavorites();
    const userFavorites = favorites.filter(f => f.userId === req.params.userId).map(f => f.itemId);
    res.json(userFavorites);
  } catch (error) {
    res.status(500).json({ message: "Error fetching favorites" });
  }
});

// Submit rating and feedback
/**
 * POST /rating
 * Public: Submit rating/feedback. If orderId present, stores on order too.
 * @body {orderId?:number,rating:number,feedback?:string}
 */
app.post("/rating", (req, res) => {
  try {
    const { orderId, rating, feedback } = req.body;
    const ratings = getRatings();

    if (orderId) {
      const orders = getOrders();
      const order = orders.find(o => o.id === orderId);
      if (order) {
        order.rating = rating;
        order.feedback = feedback;
        saveOrders(orders);
      }
    }

    ratings.push({
      orderId: orderId || null,
      rating,
      feedback,
      timestamp: new Date().toISOString()
    });
    saveRatings(ratings);

    res.json({ status: "success", message: "Rating submitted" });
  } catch (error) {
    res.status(500).json({ message: "Error submitting rating" });
  }
});

// Submit grievance
/**
 * POST /grievance
 * Public: Submit a complaint/grievance for follow-up.
 */
app.post("/grievance", (req, res) => {
  try {
    const { orderId, billingId, issueType, description, contactPreference, shopId } = req.body;
    const grievances = getGrievances();

    const newGrievance = {
      id: grievances.length + 1,
      orderId,
      billingId,
      issueType,
      description,
      contactPreference,
      shopId,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    grievances.push(newGrievance);
    saveGrievances(grievances);

    res.json({ status: "success", message: "Grievance submitted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error submitting grievance" });
  }
});

// ========== VENDOR ROUTES ==========

// Vendor login
/**
 * POST /vendor/login
 * Vendor: Authenticate vendor and return JWT.
 * @body {username:string,password:string}
 */
app.post("/vendor/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const vendors = getVendors();
    
    const vendor = vendors.find((v) => v.username === username);
    if (!vendor) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    let authenticated = false;
    if (password === 'password123') {
      authenticated = true; // demo bypass
    } else {
      const match = await bcrypt.compare(password, vendor.passwordHash);
      authenticated = match;
    }
    if (!authenticated) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { 
        vendorId: vendor.vendorId, 
        shopId: vendor.shopId, 
        username: vendor.username 
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: "Error during login" });
  }
});

// Update menu
/**
 * PUT /menu
 * Vendor: Replace shop's menu items.
 * Auth: Bearer token
 */
app.put("/menu", authenticateVendor, (req, res) => {
  try {
    const updatedItems = Array.isArray(req.body.items) ? req.body.items : [];
    const raw = getMenu();
    const vendorShopId = req.vendor.shopId;

    // Legacy structure: array of shops with items[]
    if (Array.isArray(raw)) {
      const shopIndex = raw.findIndex((shop) => String(shop.shopId) === String(vendorShopId));
      if (shopIndex === -1) {
        return res.status(404).json({ message: "Vendor shop menu not found" });
      }
      raw[shopIndex].items = updatedItems;
      saveMenu(raw);
      return res.json({ status: "success", message: "Menu updated successfully" });
    }

    // New structure: { shops: [ { categories: [...] } ] }
    const shops = Array.isArray(raw?.shops) ? raw.shops : [];
    const shop = shops.find((s) => String(s.shopId) === String(vendorShopId));
    if (!shop) {
      return res.status(404).json({ message: "Vendor shop menu not found" });
    }

    // Group updated items by their section (categoryName)
    const bySection = new Map();
    for (const it of updatedItems) {
      const sec = (it.section && typeof it.section === 'string') ? it.section : 'All Items';
      if (!bySection.has(sec)) bySection.set(sec, []);
      // Persist options under hasOptions for raw schema compatibility
      const record = { ...it };
      if (Array.isArray(it.options)) {
        record.hasOptions = it.options;
      }
      bySection.get(sec).push(record);
    }

    // Replace categories with grouped items
    shop.categories = Array.from(bySection.entries()).map(([categoryName, items]) => ({ categoryName, items }));
    saveMenu(raw);
    res.json({ status: "success", message: "Menu updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating menu" });
  }
});

// Get orders for vendor's shop
/**
 * GET /orders
 * Vendor: List all orders for this vendor's shop.
 * Auth: Bearer token
 */
app.get("/orders", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const vendorShopId = req.vendor.shopId;
    const filteredOrders = orders.filter((order) => order.shopId === vendorShopId);
    res.json(filteredOrders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// ===== Combos & Offers =====
/**
 * GET /combos?shopId=&activeOnly=
 * Public: List combos for a shop.
 */
app.get('/combos', (req, res) => {
  try {
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const activeOnly = String(req.query.activeOnly || '').toLowerCase() === '1' || String(req.query.activeOnly || '').toLowerCase() === 'true';
    let combos = getCombos();
    if (shopId) combos = combos.filter(c => String(c.shopId) === shopId);
    if (activeOnly) combos = combos.filter(c => c.active !== false);
    res.json(combos);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching combos' });
  }
});

/**
 * PUT /combos
 * Vendor: Replace combos for this vendor's shop.
 */
app.put('/combos', authenticateVendor, (req, res) => {
  try {
    const incoming = Array.isArray(req.body.combos) ? req.body.combos : [];
    const all = getCombos();
    const rest = all.filter(c => String(c.shopId) !== String(req.vendor.shopId));
    const normalized = incoming.map(c => ({
      id: c.id || Date.now() + Math.random(),
      shopId: req.vendor.shopId,
      name: c.name || 'Combo',
      price: Number(c.price || 0),
      active: c.active !== false,
      availableStart: c.availableStart || null,
      availableEnd: c.availableEnd || null,
      components: Array.isArray(c.components) ? c.components : []
    }));
    saveCombos([...rest, ...normalized]);
    res.json({ status: 'success', message: 'Combos updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error updating combos' });
  }
});

/**
 * GET /offers/active?shopId=
 * Public: Active offers for a shop based on date range.
 */
app.get('/offers/active', (req, res) => {
  try {
    const now = new Date();
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    const offers = getOffers().filter(o => {
      if (shopId && String(o.shopId) !== shopId) return false;
      const start = o.start ? new Date(o.start) : null;
      const end = o.end ? new Date(o.end) : null;
      if (start && now < start) return false;
      if (end && now > end) return false;
      return o.active !== false;
    });
    res.json(offers);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching offers' });
  }
});

/**
 * PUT /offers
 * Vendor: Replace offers for this vendor's shop.
 */
app.put('/offers', authenticateVendor, (req, res) => {
  try {
    const incoming = Array.isArray(req.body.offers) ? req.body.offers : [];
    const all = getOffers();
    const rest = all.filter(o => String(o.shopId) !== String(req.vendor.shopId));
    const normalized = incoming.map(o => ({
      id: o.id || Date.now() + Math.random(),
      shopId: req.vendor.shopId,
      title: o.title || 'Special Offer',
      bannerText: o.bannerText || o.title || 'Offer',
      discountPercent: o.discountPercent ? Number(o.discountPercent) : null,
      discountAmount: o.discountAmount ? Number(o.discountAmount) : null,
      applicableSections: Array.isArray(o.applicableSections) ? o.applicableSections : [],
      applicableComboIds: Array.isArray(o.applicableComboIds) ? o.applicableComboIds : [],
      start: o.start || null,
      end: o.end || null,
      active: o.active !== false,
      stackable: o.stackable !== false,
      maxDiscountAmount: o.maxDiscountAmount ? Number(o.maxDiscountAmount) : null
    }));
    saveOffers([...rest, ...normalized]);
    res.json({ status: 'success', message: 'Offers updated' });
  } catch (e) {
    res.status(500).json({ message: 'Error updating offers' });
  }
});

/**
 * GET /offers?shopId=
 * Public: List all offers for a shop (management UI read).
 */
app.get('/offers', (req, res) => {
  try {
    const shopId = req.query.shopId ? String(req.query.shopId) : null;
    let offers = getOffers();
    if (shopId) offers = offers.filter(o => String(o.shopId) === shopId);
    res.json(offers);
  } catch (e) {
    res.status(500).json({ message: 'Error fetching offers' });
  }
});

// Mark order as ready
/**
 * POST /order/ready/:id
 * Vendor: Mark an order as ready; records readyAt timestamp.
 */
app.post("/order/ready/:id", authenticateVendor, (req, res) => {
  try {
    const orders = getOrders();
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    order.status = "ready";
    order.readyAt = new Date().toISOString();
    saveOrders(orders);
    res.json({ status: "success", message: `Order ${orderId} marked ready` });
  } catch (error) {
    res.status(500).json({ message: "Error marking order ready" });
  }
});

// Extend preparation time for an order (in minutes)
/**
 * POST /order/extend/:id
 * Vendor: Extend preparation time for an order in minutes; adjusts ETA.
 * @body {addMinutes:number}
 */
app.post("/order/extend/:id", authenticateVendor, (req, res) => {
  try {
    const addMinutes = Number(req.body.addMinutes || 0);
    if (!addMinutes || addMinutes <= 0) {
      return res.status(400).json({ message: "addMinutes must be > 0" });
    }
    const orders = getOrders();
    const orderId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const order = orders.find((o) => o.id === orderId && o.shopId === vendorShopId);
    if (!order) {
      return res.status(404).json({ message: "Order not found for your shop" });
    }

    order.prepTime = (order.prepTime || 0) + addMinutes;
    const prevEta = order.estimatedReadyTime ? new Date(order.estimatedReadyTime).getTime() : Date.now();
    const baseTime = Math.max(prevEta, Date.now());
    order.estimatedReadyTime = new Date(baseTime + addMinutes * 60000).toISOString();
    order.etaExtendedAt = new Date().toISOString();
    order.etaExtensionMinutes = (order.etaExtensionMinutes || 0) + addMinutes;

    saveOrders(orders);
    res.json({ status: "success", message: "Preparation time extended", order });
  } catch (error) {
    res.status(500).json({ message: "Error extending preparation time" });
  }
});

// Get analytics
/**
 * GET /analytics?period=
 * Vendor: Returns basic KPIs and popularity for selected period.
 */
app.get("/analytics", authenticateVendor, (req, res) => {
  try {
    const period = (req.query.period || '').toLowerCase();
    const allOrdersForShop = getOrders().filter((o) => o.shopId === req.vendor.shopId);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfQuarter = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

    const inRange = (d, start) => new Date(d) >= start;
    const filterByPeriod = (orders, p) => {
      if (p === 'daily') return orders.filter(o => inRange(o.createdAt, startOfDay));
      if (p === 'monthly') return orders.filter(o => inRange(o.createdAt, startOfMonth));
      if (p === 'quarterly') return orders.filter(o => inRange(o.createdAt, startOfQuarter));
      if (p === 'yearly') return orders.filter(o => inRange(o.createdAt, startOfYear));
      return orders;
    };

    const orders = filterByPeriod(allOrdersForShop, period);
    const totalOrders = orders.length;

    const itemCounts = {};
    let totalItems = 0;
    for (const order of orders) {
      for (const item of order.items) {
        const qty = item.quantity || 1;
        totalItems += qty;
        const itemName = item.name;
        if (!itemCounts[itemName]) itemCounts[itemName] = 0;
        itemCounts[itemName] += qty;
      }
    }

    const popularItems = Object.entries(itemCounts).map(([name, count]) => ({
      name,
      count
    }));

    const ratingsData = getRatings();
    const shopOrderIds = orders.map(o => o.id);
    const shopRatings = ratingsData.filter(r => r.orderId && shopOrderIds.includes(r.orderId));
    const avgRating = shopRatings.length > 0 
      ? (shopRatings.reduce((sum, r) => sum + r.rating, 0) / shopRatings.length).toFixed(1)
      : 0;

    // breakdown counts irrespective of current period
    const breakdown = {
      daily: filterByPeriod(allOrdersForShop, 'daily').length,
      monthly: filterByPeriod(allOrdersForShop, 'monthly').length,
      quarterly: filterByPeriod(allOrdersForShop, 'quarterly').length,
      yearly: filterByPeriod(allOrdersForShop, 'yearly').length
    };

    res.json({ totalOrders, totalItems, popularItems, avgRating, totalRatings: shopRatings.length, breakdown });
  } catch (error) {
    res.status(500).json({ message: "Error fetching analytics" });
  }
});

// Get grievances for vendor's shop
/**
 * GET /grievances
 * Vendor: List grievances for this shop.
 */
app.get("/grievances", authenticateVendor, (req, res) => {
  try {
    const grievances = getGrievances();
    const vendorShopId = req.vendor.shopId;
    const filteredGrievances = grievances.filter((g) => g.shopId === vendorShopId);
    res.json(filteredGrievances);
  } catch (error) {
    res.status(500).json({ message: "Error fetching grievances" });
  }
});

// Mark grievance as resolved
/**
 * POST /grievance/resolve/:id
 * Vendor: Mark a grievance as resolved.
 */
app.post("/grievance/resolve/:id", authenticateVendor, (req, res) => {
  try {
    const grievances = getGrievances();
    const grievanceId = parseInt(req.params.id);
    const vendorShopId = req.vendor.shopId;

    const grievance = grievances.find((g) => g.id === grievanceId && g.shopId === vendorShopId);
    if (!grievance) {
      return res.status(404).json({ message: "Grievance not found" });
    }

    grievance.status = "resolved";
    grievance.resolvedAt = new Date().toISOString();
    saveGrievances(grievances);
    
    res.json({ status: "success", message: "Grievance marked as resolved" });
  } catch (error) {
    res.status(500).json({ message: "Error resolving grievance" });
  }
});

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Images served from: http://localhost:${PORT}/images/`);
});