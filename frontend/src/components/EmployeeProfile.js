import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { employeeProfile, employeeProfileRequestOtp, employeeProfileUpdate } from '../api';

const EmployeeProfile = ({ token }) => {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState(null);

  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [usernameEdit, setUsernameEdit] = useState('');
  const [friendsText, setFriendsText] = useState('');
  const [birthday, setBirthday] = useState('');

  const [otp, setOtp] = useState('');
  const [otpAction, setOtpAction] = useState('');
  const [activeField, setActiveField] = useState(null);
  const [viewMode, setViewMode] = useState('view');

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
        return;
      }
      toast.error(res?.message || 'Failed to load profile');
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
      if (!usernameEdit || !usernameEdit.trim()) { toast.error('Username is required'); return; }
      if (email && !isValidEmail(email)) { toast.error('Enter a valid email'); return; }
      if (mobile && String(mobile).replace(/[^0-9]/g,'').length !== 10) { toast.error('Enter a 10-digit mobile'); return; }
      if (password && !pwdRuleOk(password)) { toast.error('Password must be 8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!'); return; }
      if (pin && !/^\d{4}$/.test(pin)) { toast.error('PIN must be exactly 4 digits'); return; }
      if (usernameEdit !== (profile?.username || '')) updates.username = usernameEdit;
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
      if (r && r.status === 'ok') { toast.success('Profile updated'); load(); setPassword(''); setPin(''); setOtp(''); setActiveField(null); setOtpAction(''); setViewMode('view'); }
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

  return (
    <div>
      <h2>My Profile</h2>
      {!profile && loading && <div>Loading...</div>}
      {profile && (
        <div className="card" style={{ padding: 16 }}>
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
              <div className="profile-label">Current Username</div>
              <div className="profile-field-row">
                {viewMode === 'view' ? (
                  <div className="profile-text">{profileSummary?.username || '—'}</div>
                ) : (
                  <input value={usernameEdit} onChange={(e) => setUsernameEdit(e.target.value)} placeholder="Choose a username" />
                )}
              </div>
              <div className="profile-hint">Username is used for PIN and password logins.</div>
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
                  <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="New password" />
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
                  <input value={pin} onChange={(e)=>setPin(e.target.value.replace(/[^0-9]/g,'').slice(0,4))} placeholder="4-digit PIN" maxLength={4} />
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
    </div>
  );
};

const resetDrafts = () => {
  // Placeholder for future reset logic if needed
};

export default EmployeeProfile;
