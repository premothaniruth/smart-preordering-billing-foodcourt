import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { employeeProfile, employeeProfileRequestOtp, employeeProfileUpdate, walletTopUp, fetchEmployeePointsSummary } from '../api';

const MIN_TOPUP = 100;
const MAX_TOPUP = 5000;

const TAB_PLACEHOLDERS = {
  friendCircle: {
    title: 'Friend Circle',
    description: 'Invite and manage your cafeteria friends to plan group orders and share recommendations.',
  },
  nutrition: {
    title: 'Nutrition Plan',
    description: 'Track calories, macros, and get tailored meal plans based on your dietary preferences.',
  },
  security: {
    title: 'Security',
    description: 'Manage trusted devices, activity logs, and additional authentication options for your account.',
  },
  coupons: {
    title: 'Create Coupons',
    description: 'Design personalized coupon codes and share them with your team for exclusive cafeteria perks.',
  },
  bookTable: {
    title: 'Book a Table',
    description: 'Reserve seats in advance for your group at participating cafeteria partners.',
  },
  concern: {
    title: 'Raise Concern',
    description: 'Submit feedback or report issues directly to cafeteria support for quick assistance.',
  },
  recipe: {
    title: 'Special Recipe',
    description: 'Discover curated chef specials and submit your own creations for the weekly showcase.',
  },
  theme: {
    title: 'Theme Options',
    description: 'Personalize your dashboard with color themes, accessibility presets, and layout choices.',
  }
};

const EmployeeProfile = ({ token, wallet = { balance: 0, transactions: [] }, onWalletChange = () => {}, onRequestWalletRefresh = () => {}, pointsRefreshNonce = 0 }) => {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('account');

  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsSummary, setPointsSummary] = useState(null);

  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [usernameEdit, setUsernameEdit] = useState('');
  const [friendsText, setFriendsText] = useState('');
  const [birthday, setBirthday] = useState('');

  const [topupAmount, setTopupAmount] = useState('');
  const [topupLoading, setTopupLoading] = useState(false);

  const [otp, setOtp] = useState('');
  const [otpAction, setOtpAction] = useState('');
  const [activeField, setActiveField] = useState(null);
  const [viewMode, setViewMode] = useState('view');
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const res = await employeeProfile(token);
      if (res && res.status === 'ok') {
        setProfile(res.profile);
        setEmail(res.profile.email || '');
        const mobileLocal = (res.profile.mobile || '').replace(/^\+91/, '');
        setMobile(mobileLocal);
        setFriendsText((res.profile.friends || []).join(','));
        setBirthday(res.profile.birthday || '');
        setUsernameEdit(res.profile.username || '');
        if (res.wallet) {
          onWalletChange({
            balance: Number(res.wallet.balance || 0),
            transactions: Array.isArray(res.wallet.transactions) ? res.wallet.transactions : []
          });
        }
        return;
      }
      toast.error(res?.message || 'Failed to load profile');
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const loadPoints = async () => {
    if (!token) {
      setPointsSummary(null);
      return;
    }
    try {
      setPointsLoading(true);
      const res = await fetchEmployeePointsSummary(token);
      if (res?.status === 'ok') {
        setPointsSummary(res.points || null);
      } else {
        toast.error(res?.message || 'Failed to load points summary');
        setPointsSummary(null);
      }
    } catch {
      toast.error('Failed to load points summary');
      setPointsSummary(null);
    } finally {
      setPointsLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);
  useEffect(() => { loadPoints(); }, [token, pointsRefreshNonce]);

  useEffect(() => {
    // reset input when wallet tab revisited
    if (activeTab === 'wallet') {
      setTopupAmount('');
    }
  }, [activeTab]);

  useEffect(() => {
    if (!wallet) return;
    setTopupAmount('');
  }, [wallet?.balance]);

  const handleTopup = async () => {
    if (!token) {
      toast.error('Login expired. Please re-login.');
      return;
    }
    const amountNumber = Number(topupAmount);
    if (!Number.isFinite(amountNumber)) {
      toast.error('Enter a valid amount');
      return;
    }
    if (amountNumber < MIN_TOPUP) {
      toast.error(`Minimum recharge is ₹${MIN_TOPUP}`);
      return;
    }
    if (amountNumber > MAX_TOPUP) {
      toast.error(`Maximum recharge is ₹${MAX_TOPUP}`);
      return;
    }
    setTopupLoading(true);
    try {
      const res = await walletTopUp(token, amountNumber, 'google-pay');
      if (res?.status === 'success') {
        toast.success(`₹${amountNumber} added to wallet`);
        const nextTransactions = res.transaction
          ? [res.transaction, ...(wallet.transactions || [])]
          : (wallet.transactions || []);
        onWalletChange({
          balance: Number(res.balance || 0),
          transactions: nextTransactions.filter(Boolean)
        });
        setTopupAmount('');
        onRequestWalletRefresh(token);
      } else {
        toast.error(res?.message || 'Failed to add money');
      }
    } catch {
      toast.error('Failed to add money');
    } finally {
      setTopupLoading(false);
    }
  };

  const requestOtp = async (action, fieldKey) => {
    try {
      setOtp(''); setOtpAction(action);
      setActiveField(fieldKey || null);
      const r = await employeeProfileRequestOtp(token, action);
      if (r && r.status === 'ok') {
        if (action === 'verify-email' || action === 'change-password' || action === 'change-pin') {
          toast.info('OTP sent to your registered email');
        } else if (action === 'verify-mobile') {
          toast.info('OTP sent to your registered mobile');
        }
      } else {
        toast.error(r?.message || 'Failed to request OTP');
      }
    } catch { toast.error('Failed to request OTP'); }
  };

  const saveChanges = async () => {
    try {
      if (!profile || !profile.id) { toast.error('Profile not loaded'); return; }
      const updates = {};
      const isValidEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s||''));
      const canEditUsername = !Boolean(profile?.username);
      if (canEditUsername) {
        if (!usernameEdit || !usernameEdit.trim()) { toast.error('Username is required'); return; }
      }
      if (email && !isValidEmail(email)) { toast.error('Enter a valid email'); return; }
      if (mobile && String(mobile).replace(/[^0-9]/g,'').length !== 10) { toast.error('Enter a 10-digit mobile'); return; }
      if (password && !pwdRuleOk(password)) { toast.error('Password must be 8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!'); return; }
      if (pin && !/^\d{4}$/.test(pin)) { toast.error('PIN must be exactly 4 digits'); return; }
      if (canEditUsername && usernameEdit !== (profile?.username || '')) updates.username = usernameEdit;
      if (email !== (profile?.email || '')) updates.email = email;
      if (mobile && ('+91' + mobile) !== (profile?.mobile || '')) updates.mobile = mobile;
      if (password) updates.password = password;
      if (pin) updates.pin = pin;
      if (birthday !== (profile?.birthday || '')) updates.birthday = birthday;
      const needsOtp = updates.email || updates.mobile || updates.password || updates.pin;
      const body = { token, updates };
      if (needsOtp) {
        if (!otp || !otpAction) { toast.error('Enter OTP after requesting it for this action'); return; }
        body.otp = otp; body.action = otpAction;
      }
      setLoading(true);
      const r = await employeeProfileUpdate(body);
      if (r && r.status === 'ok') { toast.success('Profile updated'); load(); setPassword(''); setPin(''); setOtp(''); setActiveField(null); setOtpAction(''); setViewMode('view'); setShowPassword(false); setShowPin(false); }
      else { toast.error(r?.message || 'Failed to update profile'); }
    } catch { toast.error('Failed to update profile'); } finally { setLoading(false); }
  };

  const pwdRuleOk = (s) => s.length>=8 && s.length<=20 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[\.,&%#@!]/.test(s);

  const profileSummary = useMemo(() => {
    if (!profile) return null;
    return {
      username: profile.username || usernameEdit,
      email: profile.email || email,
      mobile: profile.mobile || (`+91${mobile}`),
      hasPin: profile.hasPin,
      hasPassword: profile.hasPassword,
    };
  }, [profile, usernameEdit, email, mobile]);

  const canEditUsername = useMemo(() => {
    const current = profile?.username;
    return !current || !String(current).trim();
  }, [profile]);

  return (
    <div>
      <h2>My Profile</h2>
      {!profile && loading && <div>Loading...</div>}
      {profile && (
        <div className="card" style={{ display: 'flex', padding: 0, minHeight: 420 }}>
          <div
            style={{
              width: 220,
              borderRight: '1px solid #eef2f6',
              background: '#f9fbfd',
              padding: '22px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12
            }}
          >
            <div style={{ fontSize: 12, color: '#7f8c8d', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Manage Profile
            </div>
            <button
              type="button"
              className={activeTab === 'account' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('account')}
            >
              Manage Account
            </button>
            <button
              type="button"
              className={activeTab === 'wallet' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('wallet')}
            >
              Infy Wallet
            </button>
            <button
              type="button"
              className={activeTab === 'points' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('points')}
            >
              Infy streak Points
            </button>
            <button
              type="button"
              className={activeTab === 'friendCircle' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('friendCircle')}
            >
              Friend Circle
            </button>
            <button
              type="button"
              className={activeTab === 'nutrition' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('nutrition')}
            >
              Nutrition Plan
            </button>
            <button
              type="button"
              className={activeTab === 'security' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('security')}
            >
              Security
            </button>
            <button
              type="button"
              className={activeTab === 'coupons' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('coupons')}
            >
              Create Coupons
            </button>
            <button
              type="button"
              className={activeTab === 'bookTable' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('bookTable')}
            >
              Book a Table
            </button>
            <button
              type="button"
              className={activeTab === 'concern' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('concern')}
            >
              Raise Concern
            </button>
            <button
              type="button"
              className={activeTab === 'recipe' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('recipe')}
            >
              Special Recipe
            </button>
            <button
              type="button"
              className={activeTab === 'theme' ? 'primary-button' : 'secondary-button'}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('theme')}
            >
              Theme Options
            </button>
          </div>

          <div style={{ flex: 1, padding: '24px 28px' }}>
          {activeTab === 'account' && (
          <div>
            <div className="employee-profile-header">
              <div>
                <h3 style={{ margin: 0 }}>Employee Details</h3>
                <p style={{ margin: '4px 0 12px', color: '#666', fontSize: 13 }}>View and update your registered contact information and credentials.</p>
              </div>
              <div>
                {viewMode === 'view' ? (
                  <button type="button" onClick={() => setViewMode('edit')}>
                    Edit Profile
                  </button>
                ) : (
                  <button type="button" onClick={() => { setViewMode('view'); resetDrafts(); }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <div className="profile-label">Username</div>
                <div className="profile-field-row">
                  {viewMode === 'view' || !canEditUsername ? (
                    <div className="profile-text">{profileSummary?.username || '—'}</div>
                  ) : (
                    <input value={usernameEdit} onChange={(e) => setUsernameEdit(e.target.value)} placeholder="Choose a username" />
                  )}
                </div>
                <div className="profile-hint">Your username is used for PIN and password logins.</div>
              </div>

              <div>
                <div className="profile-label">Email</div>
                <div className="profile-field-row">
                  {viewMode === 'view' ? (
                    <div className="profile-text">{profileSummary?.email || '—'}</div>
                  ) : (
                    <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" />
                  )}
                  {viewMode === 'edit' && (
                    <button type="button" className="secondary" onClick={() => requestOtp('verify-email', 'email')}>
                      Request OTP
                    </button>
                  )}
                </div>
                <div className="profile-hint">Email changes require OTP verification sent to your registered mobile.</div>
              </div>

              <div>
                <div className="profile-label">Mobile (+91)</div>
                <div className="profile-field-row">
                  {viewMode === 'view' ? (
                    <div className="profile-text">{profileSummary?.mobile || '—'}</div>
                  ) : (
                    <div className="profile-input-inline">
                      <span className="prefix">+91</span>
                      <input value={mobile} onChange={(e)=>setMobile(e.target.value.replace(/[^0-9]/g,'').slice(0,10))} placeholder="10-digit mobile" maxLength={10} />
                    </div>
                  )}
                  {viewMode === 'edit' && (
                    <button type="button" className="secondary" onClick={() => requestOtp('verify-mobile', 'mobile')}>
                      Request OTP
                    </button>
                  )}
                </div>
                <div className="profile-hint">Mobile changes require OTP verification sent to your registered email.</div>
              </div>

              <div>
                <div className="profile-label">Password</div>
                <div className="profile-field-row">
                  {viewMode === 'view' ? (
                    <div className="profile-text">{profile.hasPassword ? '••••••••' : 'Not set'}</div>
                  ) : (
                    <div className="password-input-wrapper">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e)=>setPassword(e.target.value)}
                        placeholder="New password"
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M9.88 9.88A3 3 0 0114.12 14.12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            <path d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        ) : (
                          <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                  {viewMode === 'edit' && (
                    <button type="button" className="secondary" onClick={() => requestOtp('change-password', 'password')}>
                      Request OTP
                    </button>
                  )}
                </div>
                <div className="profile-hint" style={{ color: pwdRuleOk(password) || viewMode === 'view' || !password ? '#666' : '#e74c3c' }}>8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!</div>
              </div>

              <div>
                <div className="profile-label">4-digit PIN</div>
                <div className="profile-field-row">
                  {viewMode === 'view' ? (
                    <div className="profile-text">{profile.hasPin ? '••••' : 'Not set'}</div>
                  ) : (
                    <div className="password-input-wrapper">
                      <input
                        type={showPin ? 'text' : 'password'}
                        inputMode="numeric"
                        value={pin}
                        onChange={(e)=>setPin(e.target.value.replace(/[^0-9]/g,'').slice(0,4))}
                        placeholder="4-digit PIN"
                        maxLength={4}
                      />
                      <button
                        type="button"
                        className="password-toggle"
                        onClick={() => setShowPin((v) => !v)}
                        aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                      >
                        {showPin ? (
                          <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            <path d="M9.88 9.88A3 3 0 0114.12 14.12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                            <path d="M10.73 5.08A10.86 10.86 0 0121 12c-1.1 1.86-2.57 3.47-4.31 4.71M6.24 6.24C4.03 7.73 2.28 9.67 1 12c1.88 3.34 5.36 6 10 6 1.48 0 2.86-.24 4.11-.69" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                          </svg>
                        ) : (
                          <svg aria-hidden="true" className="eye-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill="none" />
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                  {viewMode === 'edit' && (
                    <button type="button" className="secondary" onClick={() => requestOtp('change-pin', 'pin')}>
                      Request OTP
                    </button>
                  )}
                </div>
                <div className="profile-hint">Secure fast access to kiosks with a 4-digit PIN.</div>
              </div>

              <div>
                <div className="profile-label">Birthday (optional)</div>
                {viewMode === 'view' ? (
                  <div className="profile-text">{birthday ? new Date(birthday).toLocaleDateString() : 'Not provided'}</div>
                ) : (
                  <input type="date" value={birthday} onChange={(e)=>setBirthday(e.target.value)} />
                )}
              </div>

              <div>
                <div className="profile-label">Friends (usernames, comma-separated)</div>
                {viewMode === 'view' ? (
                  <div className="profile-text">{friendsText || 'None added'}</div>
                ) : (
                  <input value={friendsText} onChange={(e)=>setFriendsText(e.target.value)} placeholder="e.g., alice,bob,carol" />
                )}
              </div>

              {viewMode === 'edit' && (
                <div className="profile-otp-block">
                  <div className="profile-label">Enter OTP</div>
                  <input value={otp} onChange={(e)=>setOtp(e.target.value.replace(/[^0-9]/g,''))} placeholder="6-digit OTP" maxLength={6} />
                  <div className="profile-hint">
                    OTP is only required after requesting change for email, mobile, password, or PIN.
                  </div>
                </div>
              )}

              {viewMode === 'edit' && (
                <div className="profile-actions">
                  <button onClick={saveChanges} disabled={loading}>Save Changes</button>
                </div>
              )}
            </div>
          </div>
          )}

          {activeTab === 'wallet' && (
            <div style={{ display: 'grid', gap: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f6f9fb', padding: '16px 18px', borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 13, color: '#7f8c8d' }}>Current Wallet Balance</div>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>₹{Number(wallet?.balance || 0).toFixed(2)}</div>
                </div>
                <div style={{ fontSize: 12, color: '#95a5a6', maxWidth: 220 }}>
                  Minimum recharge ₹{MIN_TOPUP}. Maximum per transaction ₹{MAX_TOPUP}.
                </div>
              </div>

              <div style={{ border: '1px solid #e1e6eb', padding: 16, borderRadius: 8 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Recharge Wallet</div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>₹</span>
                    <input
                      type="number"
                      min={MIN_TOPUP}
                      max={MAX_TOPUP}
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      placeholder={`Enter amount (${MIN_TOPUP}-${MAX_TOPUP})`}
                      style={{ width: 160 }}
                    />
                  </div>
                  <button type="button" onClick={handleTopup} disabled={topupLoading}>
                    {topupLoading ? 'Processing...' : 'Add to Wallet via Google Pay'}
                  </button>
                </div>
                <div style={{ fontSize: 12, color: '#7f8c8d', marginTop: 8 }}>
                  You will be redirected to Google Pay (demo) to complete the payment.
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Wallet Activity</div>
                {(wallet?.transactions || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: '#7f8c8d' }}>No wallet transactions yet.</div>
                ) : (
                  <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e1e6eb', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f2f6f9', textAlign: 'left', fontSize: 12, color: '#7f8c8d' }}>
                          <th style={{ padding: '10px 12px' }}>Date</th>
                          <th style={{ padding: '10px 12px' }}>Type</th>
                          <th style={{ padding: '10px 12px' }}>Amount</th>
                          <th style={{ padding: '10px 12px' }}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(wallet?.transactions || []).slice(0, 15).map((tx) => {
                          const isCredit = String(tx.type || '').toLowerCase() === 'credit';
                          return (
                            <tr key={tx.id} style={{ borderBottom: '1px solid #eef2f6', fontSize: 13 }}>
                              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{new Date(tx.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                              <td style={{ padding: '10px 12px', color: isCredit ? '#27ae60' : '#c0392b', fontWeight: 600 }}>
                                {isCredit ? 'Credit' : 'Debit'}
                              </td>
                              <td style={{ padding: '10px 12px' }}>₹{Number(tx.amount || 0).toFixed(2)}</td>
                              <td style={{ padding: '10px 12px' }}>
                                <div>{tx.reason ? tx.reason.replace(/-/g, ' ') : '—'}</div>
                                {tx.orderBillingId && (
                                  <div style={{ fontSize: 11, color: '#7f8c8d' }}>Order {tx.orderBillingId}</div>
                                )}
                                {tx.provider && (
                                  <div style={{ fontSize: 11, color: '#7f8c8d' }}>via {tx.provider}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'points' && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="points-summary-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#7f8c8d' }}>Active Points</div>
                    <div style={{ fontSize: 32, fontWeight: 700 }}>
                      {pointsLoading ? '…' : Number(pointsSummary?.summary?.activePoints || 0).toFixed(0)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#95a5a6', maxWidth: 220 }}>
                    Earn points on every order and streak bonuses. 30 points auto-convert into ₹3 wallet credit.
                  </div>
                </div>
              </div>

              <div className="points-grid" style={{ display: 'grid', gap: 16 }}>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Lifetime Overview</div>
                  {pointsLoading ? (
                    <div>Loading points…</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 6, fontSize: 13, color: '#2c3e50' }}>
                      <div>Lifetime Points Earned: <strong>{Number(pointsSummary?.summary?.lifetimePoints || 0).toFixed(0)}</strong></div>
                      <div>Total Points Converted: <strong>{Number(pointsSummary?.summary?.lifetimeConvertedPoints || 0).toFixed(0)}</strong></div>
                      <div>Total Points Expired: <strong>{Number(pointsSummary?.summary?.lifetimeExpiredPoints || 0).toFixed(0)}</strong></div>
                      <div>Last Earned On: <strong>{pointsSummary?.summary?.lastEarnedAt ? new Date(pointsSummary.summary.lastEarnedAt).toLocaleString('en-IN') : '—'}</strong></div>
                      <div>Last Conversion: <strong>{pointsSummary?.summary?.lastConvertedAt ? new Date(pointsSummary.summary.lastConvertedAt).toLocaleString('en-IN') : '—'}</strong></div>
                    </div>
                  )}
                </div>

                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Upcoming Expiries</div>
                  {pointsLoading ? (
                    <div>Loading expiries…</div>
                  ) : (Array.isArray(pointsSummary?.expiryPreview) && pointsSummary.expiryPreview.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {pointsSummary.expiryPreview.map((entry) => (
                        <li key={entry.ledgerId} style={{ marginBottom: 6 }}>
                          {Number(entry.points).toFixed(0)} pts expiring on{' '}
                          <strong>{new Date(entry.expiresAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: '#7f8c8d' }}>No upcoming expiries.</div>
                  ))}
                </div>

                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Recent Conversions</div>
                  {pointsLoading ? (
                    <div>Loading conversions…</div>
                  ) : (Array.isArray(pointsSummary?.conversionHistory) && pointsSummary.conversionHistory.length > 0 ? (
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eef2f6', borderRadius: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#f6f9fb', textAlign: 'left', fontSize: 12, color: '#7f8c8d' }}>
                            <th style={{ padding: '8px 10px' }}>Date</th>
                            <th style={{ padding: '8px 10px' }}>Points</th>
                            <th style={{ padding: '8px 10px' }}>Wallet Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pointsSummary.conversionHistory.map((entry) => (
                            <tr key={entry.id} style={{ borderBottom: '1px solid #eef2f6', fontSize: 13 }}>
                              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{new Date(entry.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                              <td style={{ padding: '8px 10px' }}>{Number(entry.points).toFixed(0)}</td>
                              <td style={{ padding: '8px 10px' }}>₹{Math.abs(Number(entry.points) * 0.1).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: '#7f8c8d' }}>No conversions yet.</div>
                  ))}
                </div>

                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Streak Highlights</div>
                  {pointsLoading ? (
                    <div>Loading streaks…</div>
                  ) : (Array.isArray(pointsSummary?.streakAchievements) && pointsSummary.streakAchievements.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      {pointsSummary.streakAchievements.map((entry) => (
                        <li key={entry.date} style={{ marginBottom: 6 }}>
                          {entry.points} pts on <strong>{entry.date}</strong>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: '#7f8c8d' }}>No streak bonuses earned yet. Place orders on consecutive days to earn daily streak points.</div>
                  ))}
                </div>
              </div>

              <div>
                <button type="button" className="secondary-button" onClick={loadPoints} disabled={pointsLoading}>
                  {pointsLoading ? 'Refreshing…' : 'Refresh Points Summary'}
                </button>
              </div>
            </div>
          )}
          {TAB_PLACEHOLDERS[activeTab] && (
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="card" style={{ padding: 20, background: '#f9fbfd', border: '1px dashed #cbd4de' }}>
                <h3 style={{ margin: '0 0 8px' }}>{TAB_PLACEHOLDERS[activeTab].title}</h3>
                <p style={{ margin: 0, color: '#5f6c7b', lineHeight: 1.6 }}>{TAB_PLACEHOLDERS[activeTab].description}</p>
                <div style={{ marginTop: 16, fontSize: 12, color: '#95a5a6' }}>Detailed tools for this section will appear here soon.</div>
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </div>
  );
};

const resetDrafts = () => {
  // Placeholder for future reset logic if needed
};

export default EmployeeProfile;
