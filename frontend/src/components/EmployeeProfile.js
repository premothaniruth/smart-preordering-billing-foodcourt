import React, { useEffect, useState } from 'react';
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

  const load = async () => {
    const decodeJwt = (tkn) => {
      try {
        const parts = String(tkn || '').split('.');
        if (parts.length < 2) return null;
        const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(json);
      } catch { return null; }
    };
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
      // Fallback: create temporary profile from JWT
      const payload = decodeJwt(token);
      if (payload && payload.mobile) {
        const mobileRaw = String(payload.mobile || '');
        const tempProfile = { id: 0, username: mobileRaw, email: '', mobile: mobileRaw, friends: [], birthday: '' };
        setProfile(tempProfile);
        setEmail('');
        setMobile(mobileRaw.replace(/^\+91/, ''));
        setBirthday('');
        setUsernameEdit(mobileRaw);
      } else {
        toast.error('Failed to load profile');
      }
    } catch {
      const payload = (function(){ try { const parts = String(token||'').split('.'); if (parts.length<2) return null; const json = atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')); return JSON.parse(json);} catch { return null; }})();
      if (payload && payload.mobile) {
        const mobileRaw = String(payload.mobile || '');
        const tempProfile = { id: 0, username: mobileRaw, email: '', mobile: mobileRaw, birthday: '' };
        setProfile(tempProfile);
        setEmail('');
        setMobile(mobileRaw.replace(/^\+91/, ''));
        setBirthday('');
        setUsernameEdit(mobileRaw);
      } else {
        toast.error('Failed to load profile');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const requestOtp = async (action) => {
    try {
      setOtp(''); setOtpAction(action);
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
      const updates = {};
      const isTemp = !profile || Number(profile.id) === 0;
      // Client-side validations for first-time completion
      const isValidEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s||''));
      if (isTemp) {
        if (!usernameEdit || !usernameEdit.trim()) { toast.error('Please choose a username'); return; }
        if (email && !isValidEmail(email)) { toast.error('Enter a valid email'); return; }
        if (mobile && String(mobile).replace(/[^0-9]/g,'').length !== 10) { toast.error('Enter a 10-digit mobile'); return; }
        if (password && !pwdRuleOk(password)) { toast.error('Password must be 8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!'); return; }
        if (pin && !/^\d{4}$/.test(pin)) { toast.error('PIN must be exactly 4 digits'); return; }
        // Username availability check
        try {
          const a = await (await import('../api')).employeeCheckUsername(usernameEdit.trim());
          if (a && a.available === false) { toast.error('Username not available'); return; }
        } catch {}
      }
      if (isTemp && usernameEdit && usernameEdit !== (profile?.username || '')) {
        updates.username = usernameEdit;
      }
      if (email !== (profile?.email || '')) updates.email = email;
      if (mobile && ('+91' + mobile) !== (profile?.mobile || '')) updates.mobile = mobile;
      if (password) updates.password = password;
      if (pin) updates.pin = pin;
      if (birthday !== (profile?.birthday || '')) updates.birthday = birthday;
      const needsOtp = (!isTemp) && (updates.email || updates.mobile || updates.password || updates.pin);
      const body = { token, updates };
      if (needsOtp) {
        if (!otp || !otpAction) { toast.error('Enter OTP after requesting it for this action'); return; }
        body.otp = otp; body.action = otpAction;
      }
      setLoading(true);
      const r = await employeeProfileUpdate(body);
      if (r && r.status === 'ok') { toast.success('Profile updated'); load(); setPassword(''); setPin(''); setOtp(''); }
      else { toast.error(r?.message || 'Failed to update profile'); }
    } catch { toast.error('Failed to update profile'); } finally { setLoading(false); }
  };

  const pwdRuleOk = (s) => s.length>=8 && s.length<=20 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[\.,&%#@!]/.test(s);

  return (
    <div>
      <h2>My Profile</h2>
      {!profile && loading && <div>Loading...</div>}
      {profile && (
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display:'grid', gap:10 }}>
            {/* Temporary profile banner */}
            {(Number(profile.id) === 0) && (
              <div style={{ padding:10, border:'1px solid #f59e0b', background:'#fffbeb', borderRadius:8, color:'#92400e' }}>
                Complete your profile to enable PIN and password login.
              </div>
            )}
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Username</div>
              {Number(profile.id) === 0 ? (
                <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:6 }}>
                  <input value={usernameEdit} onChange={(e)=>setUsernameEdit(e.target.value)} placeholder="Choose a username" />
                  <div style={{ fontSize:11, color:'#666' }}>Set your username. This enables PIN and password login.</div>
                </div>
              ) : (
                <div style={{ fontWeight:700 }}>{profile.username}</div>
              )}
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Email</div>
              <div style={{ display:'flex', gap:8 }}>
                <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" />
                <button type="button" onClick={()=>requestOtp('verify-email')}>Request OTP</button>
              </div>
              <div style={{ fontSize:11, color:'#666' }}>Changing email will send OTP to your mobile{Number(profile.id) === 0 ? ' (first-time save will not require OTP)' : ''}</div>
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Mobile (+91)</div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <div style={{ fontWeight:700 }}>+91</div>
                <input value={mobile} onChange={(e)=>setMobile(e.target.value.replace(/[^0-9]/g,'').slice(0,10))} placeholder="10-digit mobile" maxLength={10} />
                <button type="button" onClick={()=>requestOtp('verify-mobile')}>Request OTP</button>
              </div>
              <div style={{ fontSize:11, color:'#666' }}>Changing mobile will send OTP to your email{Number(profile.id) === 0 ? ' (first-time save will not require OTP)' : ''}</div>
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Change Password</div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span title="Hidden for security" style={{ fontFamily:'monospace', color:'#999' }}>Current: ••••••••</span>
                <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="New password" />
                <button type="button" onClick={()=>requestOtp('change-password')}>Request OTP</button>
              </div>
              <div style={{ fontSize:11, color: pwdRuleOk(password) || !password ? '#666' : '#e74c3c' }}>8-20 chars with a-z, A-Z, 0-9 and one of .,&%#@!{Number(profile.id) === 0 ? ' (first-time save will not require OTP)' : ''}</div>
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Change PIN</div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span title="Hidden for security" style={{ fontFamily:'monospace', color:'#999' }}>Current: ••••</span>
                <input value={pin} onChange={(e)=>setPin(e.target.value.replace(/[^0-9]/g,'').slice(0,4))} placeholder="4-digit PIN" maxLength={4} />
                <button type="button" onClick={()=>requestOtp('change-pin')}>Request OTP</button>
              </div>
              <div style={{ fontSize:11, color:'#666' }}>PIN must be exactly 4 digits{Number(profile.id) === 0 ? ' (first-time save will not require OTP)' : ''}</div>
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Birthday (optional)</div>
              <input type="date" value={birthday} onChange={(e)=>setBirthday(e.target.value)} />
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Enter OTP (only required for email/mobile/password/PIN change)</div>
              <input value={otp} onChange={(e)=>setOtp(e.target.value.replace(/[^0-9]/g,''))} placeholder="6-digit OTP" maxLength={6} />
            </div>
            <div>
              <button onClick={saveChanges} disabled={loading}>Save Changes</button>
            </div>
            <div>
              <div style={{ fontSize:12, color:'#666' }}>Friends (usernames, comma-separated)</div>
              <input value={friendsText} onChange={(e)=>setFriendsText(e.target.value)} placeholder="e.g., alice,bob,carol" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeProfile;
