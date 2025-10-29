import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { employeeProfile, employeeProfileRequestOtp, employeeProfileUpdate, employeeChatHistory, employeeChatStreamUrl, employeeChatSend, employeeChatTyping, employeeGroupsList, employeeGroupsCreate, employeeGroupsUpdate } from '../api';

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
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [selectedOwner, setSelectedOwner] = useState(null); // owner username
  const [selectedName, setSelectedName] = useState(null); // named group name or null for owner room
  const [unreadCount, setUnreadCount] = useState(0);
  const chatBoxRef = React.useRef(null);
  const [groups, setGroups] = useState([]); // accessible named groups [{owner,name,members}]
  const [showGroupsMgr, setShowGroupsMgr] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState('');
  const [editGroupSel, setEditGroupSel] = useState('');
  const [editAddMembers, setEditAddMembers] = useState('');
  const [editRemoveMembers, setEditRemoveMembers] = useState('');
  const [editNewName, setEditNewName] = useState('');

  // Mentions state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionList, setMentionList] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);

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
      }
    } catch {
      toast.error('Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // After profile loads, fetch accessible named groups and set default chat room
  useEffect(() => {
    const run = async () => {
      if (!profile) return;
      if (!selectedOwner) setSelectedOwner(profile.username);
      try {
        const r = await employeeGroupsList(token);
        if (r && r.status==='ok') setGroups(Array.isArray(r.groups) ? r.groups : []);
      } catch {}
    };
    run();
  }, [profile, selectedOwner, token]);

  // Load chat history and SSE for selected room (owner + optional name)
  useEffect(() => {
    if (!selectedOwner) return;
    let source;
    const init = async () => {
      try {
        const h = await employeeChatHistory(token, 100, selectedOwner, selectedName || undefined);
        if (h && h.status === 'ok') setChatMessages(h.messages || []);
      } catch {}
      try {
        const url = employeeChatStreamUrl(token, selectedOwner, selectedName || undefined);
        source = new EventSource(url);
        source.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            setChatMessages((prev) => {
              const next = [...prev, msg].slice(-200);
              const el = chatBoxRef.current;
              const nearBottom = el ? (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) : true;
              if (!nearBottom) setUnreadCount((c)=>c+1);
              return next;
            });
          } catch {}
        };
        source.addEventListener('typing', (e) => {
          try {
            const data = JSON.parse(e.data);
            setTypingUsers((prev) => {
              const next = { ...prev };
              if (data.isTyping) next[data.sender] = Date.now(); else delete next[data.sender];
              return next;
            });
          } catch {}
        });
      } catch {}
    };
    init();
    return () => { try { source && source.close(); } catch {} };
  }, [token, selectedOwner, selectedName]);

  // Clear unread count when scrolled to bottom
  const onScrollChat = () => {
    const el = chatBoxRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    if (nearBottom && unreadCount) setUnreadCount(0);
  };

  // Typing: debounce send typing
  useEffect(() => {
    if (!selectedOwner) return;
    if (!chatInput) {
      employeeChatTyping(token, false, selectedOwner, selectedName || undefined).catch(()=>{});
      return;
    }
    const id = setTimeout(() => {
      employeeChatTyping(token, true, selectedOwner, selectedName || undefined).catch(()=>{});
      setTimeout(()=>employeeChatTyping(token, false, selectedOwner, selectedName || undefined).catch(()=>{}), 2000);
    }, 200);
    return () => clearTimeout(id);
  }, [chatInput, selectedOwner, selectedName]);

  // Mentions: compute candidate list for current room
  const computeMentionCandidates = () => {
    const friendList = (profile?.friends || []).map(String);
    // Named group members
    if (selectedName) {
      const g = groups.find(g => String(g.owner).toLowerCase() === String(selectedOwner).toLowerCase() && String(g.name).toLowerCase() === String(selectedName).toLowerCase());
      const mem = g && Array.isArray(g.members) ? g.members.map(String) : [];
      return Array.from(new Set([selectedOwner, ...mem, ...friendList]));
    }
    // Owner room: owner + your friends
    return Array.from(new Set([selectedOwner, ...friendList]));
  };

  const onChatInputChange = (e) => {
    const val = e.target.value;
    setChatInput(val);
    const at = val.lastIndexOf('@');
    if (at >= 0) {
      const tail = val.slice(at + 1);
      if (/^[A-Za-z0-9_]*$/.test(tail)) {
        const cand = computeMentionCandidates();
        const list = cand.filter(u => u.toLowerCase().startsWith(tail.toLowerCase())).slice(0, 6);
        setMentionList(list);
        setMentionIndex(0);
        setMentionQuery(tail);
        setMentionOpen(list.length > 0);
        return;
      }
    }
    setMentionOpen(false);
  };

  const applyMention = (name) => {
    const val = chatInput;
    const at = val.lastIndexOf('@');
    if (at < 0) return;
    const before = val.slice(0, at + 1);
    // if blank mention, insert name; else replace query
    const next = `${before}${name} `;
    setChatInput(next);
    setMentionOpen(false);
  };

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
      if (isTemp && usernameEdit && usernameEdit !== (profile?.username || '')) {
        updates.username = usernameEdit;
      }
      if (email !== (profile?.email || '')) updates.email = email;
      if (mobile && ('+91' + mobile) !== (profile?.mobile || '')) updates.mobile = mobile;
      if (password) updates.password = password;
      if (pin) updates.pin = pin;
      const friends = friendsText.split(',').map(s => s.trim()).filter(Boolean);
      if (JSON.stringify(friends) !== JSON.stringify(profile?.friends || [])) updates.friends = friends;
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
              <div style={{ fontSize:12, color:'#666' }}>Friends (usernames, comma-separated)</div>
              <input value={friendsText} onChange={(e)=>setFriendsText(e.target.value)} placeholder="e.g., alice,bob,carol" />
              <div style={{ marginTop:6, display:'flex', gap:8, flexWrap:'wrap' }}>
                {(profile.friends || []).map((f, i) => (
                  <button key={i} type="button" onClick={async ()=>{
                    try {
                      const text = `Hi ${f}, please help pick up my food order if I miss it. - ${profile.username}`;
                      await navigator.clipboard.writeText(text);
                      toast.info('Pickup message copied to clipboard');
                    } catch { toast.info('Pickup message prepared'); }
                  }} style={{ background:'#f1f5f9', border:'1px solid #e5e7eb', borderRadius:999, padding:'4px 10px', fontSize:12 }}>Share with {f}</button>
                ))}
              </div>
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
            <div className="card" style={{ padding:12, marginTop:10 }}>
              <div style={{ fontWeight:700, marginBottom:8, fontSize:14 }}>Friend Circle Chat</div>
              {/* Group tabs */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                {/* Self and friends */}
                {[profile.username, ...(profile.friends || [])].map((owner, idx) => (
                  <button key={`p-${idx}`} type="button" onClick={()=>{ setSelectedOwner(owner); setSelectedName(null); setUnreadCount(0);} } style={{ padding:'6px 10px', borderRadius:999, border:'1px solid #ddd', background: selectedOwner===owner && !selectedName ? '#111' : '#fff', color: selectedOwner===owner && !selectedName ? '#fff' : '#111' }}>
                    {owner}
                  </button>
                ))}
                {/* Named groups accessible */}
                {groups.map((g, i) => (
                  <button key={`g-${i}`} type="button" onClick={()=>{ setSelectedOwner(g.owner); setSelectedName(g.name); setUnreadCount(0);} } style={{ padding:'6px 10px', borderRadius:999, border:'1px solid #ddd', background: selectedOwner===g.owner && selectedName===g.name ? '#111' : '#fff', color: selectedOwner===g.owner && selectedName===g.name ? '#fff' : '#111' }}>
                    {g.owner === profile.username ? g.name : `${g.owner}/${g.name}`}
                  </button>
                ))}
                <button type="button" onClick={()=>setShowGroupsMgr(s=>!s)} style={{ padding:'6px 10px', borderRadius:999, border:'1px solid #111', background:'#fff' }}>Manage Groups</button>
              </div>
              <div ref={chatBoxRef} onScroll={onScrollChat} style={{ border:'1px solid #eee', borderRadius:8, height:220, overflowY:'auto', padding:8, background:'#fafafa', position:'relative' }}>
                {(chatMessages || []).map((m) => (
                  <div key={m.id} style={{ fontSize:13, marginBottom:6 }}>
                    <span style={{ color:'#2c3e50', fontWeight:700 }}>{m.sender}</span>
                    <span style={{ color:'#bbb', margin:'0 6px' }}>•</span>
                    <span>{m.text}</span>
                  </div>
                ))}
                {unreadCount>0 && (
                  <div style={{ position:'absolute', bottom:8, right:8, background:'#111', color:'#fff', borderRadius:999, padding:'4px 10px', fontSize:12, cursor:'pointer' }} onClick={()=>{ const el=chatBoxRef.current; if (el) { el.scrollTop = el.scrollHeight; setUnreadCount(0);} }}>Unread {unreadCount}</div>
                )}
              </div>
              {/* mention autocomplete */}
              <div style={{ display:'flex', gap:8, marginTop:8, position:'relative' }}>
                <input
                  value={chatInput}
                  onChange={onChatInputChange}
                  onKeyDown={(e)=>{
                    if (!mentionOpen) return;
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i=>Math.min(i+1, Math.max(0, mentionList.length-1))); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i=>Math.max(0, i-1)); }
                    else if (e.key === 'Enter' || e.key === 'Tab') { if (mentionList[mentionIndex]) { e.preventDefault(); applyMention(mentionList[mentionIndex]); } }
                    else if (e.key === 'Escape') { setMentionOpen(false); }
                  }}
                  placeholder={`Message ${selectedName ? (selectedOwner + '/' + selectedName) : selectedOwner}'s circle... Use @ to mention`}
                />
                {mentionOpen && (
                  <div style={{ position:'absolute', top:'100%', left:0, zIndex:20, background:'#fff', border:'1px solid #ddd', borderRadius:8, marginTop:4, minWidth:180, overflow:'hidden', boxShadow:'0 6px 18px rgba(0,0,0,0.06)' }}>
                    {mentionList.map((u, idx) => (
                      <div key={u}
                        onMouseDown={(e)=>{ e.preventDefault(); applyMention(u); }}
                        style={{ padding:'8px 10px', background: idx===mentionIndex ? '#f1f5f9' : '#fff', cursor:'pointer', fontSize:13 }}
                      >@{u}</div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={async ()=>{
                  const text = chatInput.trim();
                  if (!text) return;
                  try {
                    const r = await employeeChatSend(token, text, selectedOwner, selectedName || undefined);
                    if (r && r.status==='ok') setChatInput(''); else toast.error(r?.message || 'Failed to send');
                  } catch { toast.error('Failed to send'); }
                }}>Send</button>
              </div>
              {/* typing indicators */}
              <div style={{ fontSize:11, color:'#666', marginTop:6 }}>
                {Object.keys(typingUsers).length>0 && <span>{Object.keys(typingUsers).slice(0,3).join(', ')} {Object.keys(typingUsers).length>1? 'are':'is'} typing...</span>}
              </div>
              <div style={{ fontSize:11, color:'#666', marginTop:6 }}>Messages in this room are visible to your friend circle (usernames you added).</div>
              {showGroupsMgr && (
                <div className="card" style={{ padding:12, marginTop:10 }}>
                  <div style={{ fontWeight:700, marginBottom:8, fontSize:14 }}>Groups Manager</div>
                  <div style={{ display:'grid', gap:10 }}>
                    <div>
                      <div style={{ fontSize:12, color:'#666' }}>Create Group</div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8 }}>
                        <input placeholder="Group name" value={newGroupName} onChange={(e)=>setNewGroupName(e.target.value)} />
                        <input placeholder="Members (comma-separated usernames)" value={newGroupMembers} onChange={(e)=>setNewGroupMembers(e.target.value)} />
                        <button type="button" onClick={async ()=>{
                          const name = newGroupName.trim();
                          const members = newGroupMembers.split(',').map(s=>s.trim()).filter(Boolean);
                          if (!name) { toast.error('Enter group name'); return; }
                          try { const r = await employeeGroupsCreate(token, name, members); if (r && r.status==='ok') { toast.success('Group created'); setNewGroupName(''); setNewGroupMembers(''); const ls = await employeeGroupsList(token); if (ls?.status==='ok') setGroups(ls.groups||[]);} else { toast.error(r?.message||'Failed'); } } catch { toast.error('Failed'); }
                        }}>Create</button>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize:12, color:'#666' }}>Edit Group</div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr auto', gap:8 }}>
                        <select value={editGroupSel} onChange={(e)=>setEditGroupSel(e.target.value)}>
                          <option value="">Select your group</option>
                          {groups.filter(g=>g.owner===profile.username).map((g,i)=> (
                            <option key={i} value={g.name}>{g.name}</option>
                          ))}
                        </select>
                        <input placeholder="Add members (csv)" value={editAddMembers} onChange={(e)=>setEditAddMembers(e.target.value)} />
                        <input placeholder="Remove members (csv)" value={editRemoveMembers} onChange={(e)=>setEditRemoveMembers(e.target.value)} />
                        <button type="button" onClick={async ()=>{
                          const name = editGroupSel; if (!name) { toast.error('Select group'); return; }
                          const addMembers = editAddMembers.split(',').map(s=>s.trim()).filter(Boolean);
                          const removeMembers = editRemoveMembers.split(',').map(s=>s.trim()).filter(Boolean);
                          try { const r = await employeeGroupsUpdate(token, name, { addMembers, removeMembers }); if (r && r.status==='ok') { toast.success('Group updated'); setEditAddMembers(''); setEditRemoveMembers(''); const ls = await employeeGroupsList(token); if (ls?.status==='ok') setGroups(ls.groups||[]);} else { toast.error(r?.message||'Failed'); } } catch { toast.error('Failed'); }
                        }}>Update Members</button>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:8, marginTop:8 }}>
                        <input placeholder="Rename to" value={editNewName} onChange={(e)=>setEditNewName(e.target.value)} />
                        <button type="button" onClick={async ()=>{
                          const name = editGroupSel; if (!name) { toast.error('Select group'); return; }
                          const newName = editNewName.trim(); if (!newName) { toast.error('Enter new name'); return; }
                          try { const r = await employeeGroupsUpdate(token, name, { newName }); if (r && r.status==='ok') { toast.success('Group renamed'); setEditNewName(''); const ls = await employeeGroupsList(token); if (ls?.status==='ok') setGroups(ls.groups||[]);} else { toast.error(r?.message||'Failed'); } } catch { toast.error('Failed'); }
                        }}>Rename</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmployeeProfile;
