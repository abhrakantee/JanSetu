/* JanSetu — mobile-first civic reporting platform.
 * Backend: Supabase Auth + Postgres (RLS) + Storage; see README.md.
 * No fabricated reports, counts, or confirmation states.
 */
const $ = (id) => document.getElementById(id);
const ICON = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const SAFE_CATEGORIES = ['Roads', 'Streetlights', 'Waste', 'Water', 'Public Safety', 'Infrastructure', 'Other'];
const STATUS_ORDER = ['Reported', 'In Review', 'In Progress', 'Resolved', 'Verified'];
const PAGE_SIZE = 48;
const pendingSupports = new Set();
const pendingDeletes = new Set();
const state = {
  client: null, user: null, profile: null, isAdmin: false,
  reports: [], myReports: [], notifications: [], total: 0, counts: {},
  page: 0, userLocation: null, reportLocation: null, photo: null, photoURL: null,
  view: 'home', map: null, mapMarkers: null, userMarker: null, channel: null,
  authMode: 'signup', phone: null, busy: false, loadingReports: false
};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const friendlyError = error => {
  const message = error?.message || 'Something went wrong. Please try again.';
  if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(message)) return 'Connection failed. Check your internet connection and backend configuration.';
  return message.replace(/\s+/g, ' ').slice(0, 220);
};
const timestamp = iso => {
  if (!iso) return 'Just now';
  const difference = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(difference / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'});
};
const formatDate = iso => iso ? new Date(iso).toLocaleDateString('en-IN', {day:'numeric', month:'short', year:'numeric'}) : '—';
function toast(message, error = false) {
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.innerHTML = ICON(error ? 'info' : 'check-circle') + `<p>${escapeHTML(message)}</p>`;
  $('toastRegion').appendChild(item);
  setTimeout(() => item.remove(), 5000);
}
function authNotice(message, error = false) {
  const node = $('authNotice'); node.hidden = !message;
  node.textContent = message || '';
  node.classList.toggle('is-error', error);
}
function loading(button, busy, label) {
  if (!button) return;
  if (busy) { button.dataset.originalText = button.innerHTML; button.disabled = true; button.textContent = label || 'Working…'; }
  else { button.disabled = false; if (button.dataset.originalText) button.innerHTML = button.dataset.originalText; delete button.dataset.originalText; }
}
function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll('[data-auth-mode]').forEach(tab => {
    const active = tab.dataset.authMode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  $('emailAuthForm').hidden = mode === 'phone';
  $('phoneAuthForm').hidden = mode !== 'phone';
  $('verifyPhoneForm').hidden = true;
  $('googleAuthDivider').hidden = mode === 'phone';
  $('googleAuthButton').hidden = mode === 'phone';
  $('nameField').hidden = mode !== 'signup';
  $('authName').required = mode === 'signup';
  $('forgotPassword').hidden = mode !== 'signin';
  $('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('authHeading').textContent = ({signup:'Create your account', signin:'Welcome back', phone:'Continue with mobile'})[mode];
  $('authSubheading').textContent = ({signup:'Join JanSetu to start making an impact.', signin:'Sign in to your community workspace.', phone:'Sign in securely using a one-time SMS code.'})[mode];
  $('emailSubmit').querySelector('span').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  authNotice('');
}
function requireClient() {
  if (state.client) return true;
  authNotice('Backend setup is required. Follow README.md to configure the public Supabase URL and publishable key in config.js.', true);
  return false;
}
function redirectURL() {
  // GitHub Pages subpath and existing Vercel domain are both supported.
  return `${location.origin}${location.pathname}`;
}
async function submitEmailAuth(event) {
  event.preventDefault();
  if (!requireClient()) return;
  const name = $('authName').value.trim();
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (state.authMode === 'signup' && name.length < 2) return authNotice('Please enter a name with at least two characters.', true);
  if (password.length < 8) return authNotice('Use a password with at least eight characters.', true);
  const button = $('emailSubmit'); loading(button, true, 'Checking your account…');
  try {
    const result = state.authMode === 'signup'
      ? await state.client.auth.signUp({email, password, options:{data:{full_name:name}, emailRedirectTo:redirectURL()}})
      : await state.client.auth.signInWithPassword({email, password});
    if (result.error) throw result.error;
    if (result.data.session) {
      await handleSession(result.data.session, state.authMode === 'signup' ? 'SIGNED_UP' : 'SIGNED_IN');
    } else {
      setAuthMode('signin');
      authNotice('Registration submitted. Please open the verification email, confirm your address and then sign in. Check spam if needed.');
      toast('Check your email for the account verification link.');
    }
  } catch (error) { authNotice(friendlyError(error), true); }
  finally { loading(button, false); }
}
async function googleSignIn() {
  if (!requireClient()) return;
  const button = $('googleAuthButton'); loading(button, true, 'Connecting to Google…');
  try {
    const {error} = await state.client.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectURL()}});
    if (error) throw error;
    // A successful OAuth call redirects to Google; don't pretend login is complete yet.
  } catch (error) { authNotice(friendlyError(error), true); loading(button, false); }
}
async function sendPhoneOtp(event) {
  event.preventDefault(); if (!requireClient()) return;
  const phone = $('phoneNumber').value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return authNotice('Enter an international mobile number such as +919876543210.', true);
  const button = $('phoneSend'); loading(button, true, 'Sending SMS…');
  try {
    const {error} = await state.client.auth.signInWithOtp({phone});
    if (error) throw error;
    state.phone = phone;
    $('phoneAuthForm').hidden = true;
    $('verifyPhoneForm').hidden = false;
    $('otpDescription').textContent = `Enter the six-digit code sent to ${phone}.`;
    authNotice('A verification code has been requested. Delivery depends on the configured SMS provider.');
  } catch (error) { authNotice(friendlyError(error), true); }
  finally { loading(button, false); }
}
async function verifyPhoneOtp(event) {
  event.preventDefault(); if (!requireClient()) return;
  const token = $('phoneOtp').value.trim();
  const button = $('phoneVerify'); loading(button, true, 'Verifying…');
  try {
    const {data,error} = await state.client.auth.verifyOtp({phone:state.phone, token, type:'sms'});
    if (error) throw error;
    if (!data?.session) throw Error('Verification did not create a session. Please try again.');
    await handleSession(data.session, 'SIGNED_IN');
    toast('Mobile number verified. Welcome to JanSetu.');
  } catch (error) { authNotice(friendlyError(error), true); }
  finally { loading(button, false); }
}
async function passwordReset() {
  if (!requireClient()) return;
  const email = $('authEmail').value.trim();
  if (!email) return authNotice('Enter your email address first.', true);
  try {
    const {error} = await state.client.auth.resetPasswordForEmail(email, {redirectTo:redirectURL()});
    if (error) throw error;
    authNotice('If an account exists for that email, a password-reset link has been sent.');
  } catch(error) { authNotice(friendlyError(error), true); }
}
async function handleSession(session, event) {
  if (!session?.user) {
    state.user = null; state.profile = null; state.isAdmin = false;
    $('locationPrompt').hidden = false;
    state.reports = []; state.myReports = []; state.notifications = [];
    if (state.channel) { try { await state.client.removeChannel(state.channel); } catch {} state.channel = null; }
    $('appShell').hidden = true;
    $('authScreen').hidden = false;
    return;
  }
  // getUser revalidates the JWT rather than trusting a cached browser user.
  let authenticatedUser;
  try {
    const result = await state.client.auth.getUser();
    if (result.error || !result.data?.user) throw result.error || Error('Authentication required.');
    authenticatedUser = result.data.user;
  } catch(error) {
    authNotice(friendlyError(error), true);
    $('appShell').hidden = true; $('authScreen').hidden = false;
    return;
  }
  if (state.user?.id === authenticatedUser.id && !$('appShell').hidden) return;
  state.user = authenticatedUser;
  $('authScreen').hidden = true;
  $('appShell').hidden = false;
  document.title = 'JanSetu — Community dashboard';
  authNotice('');
  showView('home');
  await Promise.all([fetchProfile(), refreshAll()]);
  subscribeToUpdates();
  if (event === 'SIGNED_UP') toast('Your JanSetu account has been created successfully.');
  else if (event === 'SIGNED_IN') toast('Signed in successfully. Welcome to JanSetu.');
}
async function fetchProfile() {
  if (!state.client || !state.user) return;
  try {
    const [profileRes, adminRes] = await Promise.all([
      state.client.from('profiles').select('id,full_name,created_at').eq('id',state.user.id).maybeSingle(),
      state.client.from('admins').select('id').eq('id',state.user.id).maybeSingle()
    ]);
    if (profileRes.error) throw profileRes.error;
    if (adminRes.error) throw adminRes.error;
    state.profile = profileRes.data || {full_name:state.user.user_metadata?.full_name || ''};
    state.isAdmin = Boolean(adminRes.data);
  } catch(error) { toast(`Profile could not load: ${friendlyError(error)}`, true); }
  renderProfile();
}
async function refreshAll() {
  if (!state.user || !state.client) return;
  await Promise.all([fetchReports(true), fetchMyReports(), fetchNotifications(), fetchCounts()]);
  renderHome(); renderExplore(); renderMyActivity(); renderAdmin(); renderNotificationDot();
}
async function fetchReports(reset = true) {
  if (state.loadingReports) return;
  state.loadingReports = true;
  try {
    const page = reset ? 0 : state.page + 1;
    const {data,error,count} = await state.client.from('report_feed').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page * PAGE_SIZE,(page+1)*PAGE_SIZE-1);
    if (error) throw error;
    state.reports = reset ? data || [] : [...state.reports,...(data || [])];
    state.total = count ?? state.reports.length;
    state.page = page;
  } catch (error) { toast(`Could not load community reports: ${friendlyError(error)}`,true); }
  finally { state.loadingReports = false; }
  renderHome(); renderExplore();
}
async function fetchMyReports() {
  if (!state.user) return;
  try {
    const {data,error} = await state.client.from('report_feed').select('*').eq('author_id',state.user.id).order('created_at',{ascending:false}).limit(100);
    if (error) throw error;
    state.myReports = data || [];
  } catch(error) { toast(`Could not load your reports: ${friendlyError(error)}`,true); }
  renderMyActivity();
}
async function fetchCounts() {
  if (!state.user) return;
  try {
    const queries = [
      state.client.from('reports').select('id',{head:true,count:'exact'}),
      state.client.from('reports').select('id',{head:true,count:'exact'}).in('status',['In Review','In Progress']),
      state.client.from('reports').select('id',{head:true,count:'exact'}).in('status',['Resolved','Verified']),
      state.client.from('reports').select('id',{head:true,count:'exact'}).eq('author_id',state.user.id),
      state.client.from('report_supports').select('report_id',{head:true,count:'exact'}).eq('user_id',state.user.id)
    ];
    const [all,active,resolved,mine,supported] = await Promise.all(queries);
    for (const result of [all,active,resolved,mine,supported]) if (result.error) throw result.error;
    state.counts = {total:all.count ?? 0, active:active.count ?? 0, resolved:resolved.count ?? 0, mine:mine.count ?? 0, supported:supported.count ?? 0};
  } catch(error) { toast(`Statistics unavailable: ${friendlyError(error)}`,true); }
  renderStats();
}
async function fetchNotifications() {
  if (!state.user) return;
  try {
    const {data,error} = await state.client.from('notifications').select('id,report_id,message,is_read,created_at').eq('user_id',state.user.id).order('created_at',{ascending:false}).limit(50);
    if (error) throw error;
    state.notifications = data || [];
  } catch(error) { toast(`Notifications unavailable: ${friendlyError(error)}`,true); }
  renderNotifications(); renderNotificationDot();
}
let refreshDelay;
function subscribeToUpdates() {
  if (state.channel) return;
  try {
    state.channel = state.client.channel(`jansetu-${state.user.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'reports'}, () => { clearTimeout(refreshDelay); refreshDelay = setTimeout(() => { fetchReports(true); fetchMyReports(); fetchCounts(); }, 700); })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:`user_id=eq.${state.user.id}`}, () => fetchNotifications())
      .subscribe();
  } catch(error) { console.warn('Live updates unavailable; manual refresh still works.', error); }
}
function renderStats() {
  const c = state.counts;
  $('statTotal').textContent = c.total ?? '—';
  $('statProgress').textContent = c.active ?? '—';
  $('statResolved').textContent = c.resolved ?? '—';
  $('statMine').textContent = c.mine ?? '—';
  $('activityReported').textContent = c.mine ?? '0';
  $('activitySupported').textContent = c.supported ?? '0';
  $('activityResolved').textContent = state.myReports.filter(r=>['Resolved','Verified'].includes(r.status)).length;
}
function photoURL(report) {
  if (!state.client || !report.image_path || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/i.test(report.image_path)) return '';
  return state.client.storage.from('issue-photos').getPublicUrl(report.image_path).data.publicUrl;
}
function statusClass(status) { return String(status || 'Reported').toLowerCase().replace(/\s+/g,'-'); }
function issueCard(report) {
  const src = photoURL(report);
  const category = SAFE_CATEGORIES.includes(report.category) ? report.category : 'Other';
  const supported = Boolean(report.supported_by_me);
  const count = Math.max(0, Number(report.support_count || 0));
  const owned = Boolean(state.user && report.author_id === state.user.id);
  return `<article class="issue-card" data-report-card="${escapeHTML(report.id)}">
    <div class="issue-card-photo">${src ? `<img src="${escapeHTML(src)}" alt="Evidence photo for ${escapeHTML(report.title)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="issue-no-photo" hidden>${ICON('photo')}</div>` : `<div class="issue-no-photo">${ICON('photo')}</div>`}<span class="issue-category">${escapeHTML(category)}</span></div>
    <div class="issue-card-body"><div class="issue-card-top"><span class="status-pill ${statusClass(report.status)}">${escapeHTML(report.status)}</span><span class="issue-card-meta"><span class="issue-time">${timestamp(report.created_at)}</span>${owned ? `<button type="button" class="report-delete-icon" data-delete-report="${escapeHTML(report.id)}" aria-label="Delete your report" title="Delete your report">${ICON('trash')}</button>` : ''}</span></div>
    <h3>${escapeHTML(report.title)}</h3><p class="issue-description">${escapeHTML(report.description)}</p>
    <div class="issue-location">${ICON('pin')}<span title="${escapeHTML(report.address_text)}">${escapeHTML(report.address_text)}</span></div>
    <div class="issue-card-footer"><button type="button" class="support-button ${supported ? 'supported':''}" data-support-id="${escapeHTML(report.id)}" aria-label="${supported?'Remove your support':'Support this report'}" aria-pressed="${supported}" title="Support counts are public; supporter identities are private">${ICON('thumb')} <span>${count} support${count === 1 ? '' : 's'}</span></button><button type="button" class="detail-button" data-open-report="${escapeHTML(report.id)}">View details ${ICON('arrow')}</button></div></div></article>`;
}
function emptyState(title, description, action = false) {
  return `<div class="empty-state">${ICON('map')}<strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p>${action ? `<button type="button" class="button primary" data-view="report">Create first report ${ICON('arrow')}</button>`:''}</div>`;
}
function renderHome() {
  const reports = state.reports.slice(0,3);
  $('homeIssueGrid').innerHTML = reports.length ? reports.map(issueCard).join('') : emptyState('No community reports yet','Be the first to document a local issue and make it visible.',true);
  renderStats();
}
function distanceKm(a,b) {
  if (!a || !b || a.lat == null || b.lat == null || a.lng == null || b.lng == null) return Infinity;
  const rad = deg => deg*Math.PI/180;
  const dLat = rad(b.lat-a.lat), dLng = rad(b.lng-a.lng);
  const h = Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
function filteredReports() {
  const q = $('issueSearch').value.toLowerCase().trim();
  const cat = $('categoryFilter').value;
  const status = $('statusFilter').value;
  const sort = $('sortFilter').value;
  const result = state.reports.filter(r => (cat === 'all'||r.category===cat) && (status === 'all'||r.status===status) && (!q || [r.title,r.description,r.address_text,r.category].some(t => String(t||'').toLowerCase().includes(q))));
  if (sort === 'support') result.sort((a,b)=>Number(b.support_count||0)-Number(a.support_count||0));
  if (sort === 'oldest') result.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  if (sort === 'nearby') result.sort((a,b)=>distanceKm(state.userLocation,{lat:a.latitude,lng:a.longitude})-distanceKm(state.userLocation,{lat:b.latitude,lng:b.longitude}));
  return result;
}
function renderExplore() {
  const issues = filteredReports();
  $('exploreIssueGrid').innerHTML = issues.length ? issues.map(issueCard).join('') : emptyState('Nothing matches your search','Try a different category, status, or search term.');
  $('filterCount').textContent = `${issues.length} shown of ${state.total} community report${state.total===1?'':'s'}`;
  $('loadMoreButton').hidden = state.reports.length >= state.total;
  if (state.view === 'explore') updateMapMarkers(issues);
}
function renderMyActivity() {
  $('myIssueGrid').innerHTML = state.myReports.length ? state.myReports.map(issueCard).join('') : emptyState('Your first report begins here','Once you submit a report, you can follow its status and progress.',true);
  renderStats();
}
function renderNotificationDot() { $('notificationDot').hidden = !state.notifications.some(n=>!n.is_read); }
function renderNotifications() {
  $('notificationList').innerHTML = state.notifications.length ? state.notifications.map(n => `<div class="notification-item ${n.is_read?'':'unread'}"><span class="notification-icon">${ICON('bell')}</span><div><strong>${n.is_read?'Update':'New update'}</strong><p>${escapeHTML(n.message)}</p><small>${timestamp(n.created_at)}</small></div>${n.is_read?'':`<button type="button" data-read-notification="${escapeHTML(n.id)}" aria-label="Mark notification as read">${ICON('check')}</button>`}</div>`).join('') : '<p class="no-notifications">No notifications yet. Updates to your reports will appear here.</p>';
}
function renderProfile() {
  if (!state.user) return;
  const name = state.profile?.full_name || state.user.user_metadata?.full_name || state.user.email?.split('@')[0] || 'JanSetu member';
  const initials = name.trim().split(/\s+/).slice(0,2).map(s=>s[0]?.toUpperCase()||'').join('') || 'JS';
  $('avatarButton').textContent = initials;
  $('profileAvatar').textContent = initials;
  $('profileName').textContent = name;
  $('profileEmail').textContent = state.user.email || state.user.phone || 'Verified member';
  $('profileContact').value = state.user.email || state.user.phone || '';
  $('profileFullName').value = state.profile?.full_name || '';
  $('profileJoined').textContent = formatDate(state.profile?.created_at || state.user.created_at);
  $('adminPanel').hidden = !state.isAdmin;
}
function renderAdmin() {
  if (!state.isAdmin) return;
  $('adminReportList').innerHTML = state.reports.length ? state.reports.map(r => `<div class="admin-row"><div><strong>${escapeHTML(r.title)}</strong><p>${escapeHTML(r.address_text)} · ${escapeHTML(r.status)}</p></div><div class="admin-controls"><select data-admin-status="${escapeHTML(r.id)}" aria-label="Change report status"><option value="">Change status</option>${STATUS_ORDER.filter(s=>s!=='Verified').map(s=>`<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}</select><button class="button subtle" data-admin-save="${escapeHTML(r.id)}">Save</button></div></div>`).join('') : '<p class="no-notifications">There are no reports to review.</p>';
}
function showView(view) {
  if (!$('view-'+view)) return;
  state.view = view;
  document.querySelectorAll('.view').forEach(el => { const active = el.id === 'view-'+view; el.hidden = !active; el.classList.toggle('is-active',active); });
  document.querySelectorAll('[data-view]').forEach(el=> {const isActive = el.dataset.view === view; el.classList.toggle('is-active',isActive); if (el.classList.contains('mobile-link')) el.setAttribute('aria-current',isActive?'page':'false');});
  window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  if (view === 'explore') {renderExplore(); ensureMap();}
  if (view === 'activity') fetchNotifications();
  if (view === 'profile') renderProfile();
}
async function toggleSupport(id) {
  if (!state.user) return toast('Sign in to support a report.',true);
  if (pendingSupports.has(id)) return;
  const report = [...state.reports,...state.myReports].find(r=>r.id===id);
  if (!report) return toast('This report is no longer available.',true);
  pendingSupports.add(id);
  try {
    const response = report.supported_by_me
      ? await state.client.from('report_supports').delete().eq('report_id',id).eq('user_id',state.user.id)
      : await state.client.from('report_supports').insert({report_id:id,user_id:state.user.id});
    if (response.error) throw response.error;
    const next = !report.supported_by_me;
    // A report may appear in both lists as the same object. Update each copy only once.
    const seen = new Set();
    for (const r of [...state.reports,...state.myReports]) if (r.id===id && !seen.has(r)) {
      seen.add(r);
      r.supported_by_me=next;
      r.support_count=Math.max(0,Number(r.support_count||0)+(next?1:-1));
    }
    renderHome(); renderExplore(); renderMyActivity(); fetchCounts();
    // Keep open details in sync without revealing who supported the report.
    const dialogButton = $('reportDialog').querySelector(`[data-support-id="${id}"]`);
    if (dialogButton) {
      const latest = [...state.reports,...state.myReports].find(r=>r.id===id);
      const supportCount = Number(latest?.support_count||0);
      dialogButton.innerHTML = `${ICON('thumb')} ${next?'Supported':'Support this issue'} (${supportCount})`;
      dialogButton.setAttribute('aria-pressed', String(next));
      dialogButton.classList.toggle('supported',next);
    }
    toast(next?'Your support has been recorded.':'Your support was removed.');
  } catch(error) { toast(friendlyError(error),true); }
  finally {pendingSupports.delete(id);}
}
async function deleteOwnReport(id) {
  if (!state.user || pendingDeletes.has(id)) return;
  const report = [...state.reports,...state.myReports].find(r => r.id === id);
  // The UI guard is not the security boundary: Supabase RLS enforces this again.
  if (!report || report.author_id !== state.user.id) return toast('You can only delete your own report.',true);
  if (!confirm(`Delete your report "${report.title}" permanently? Its support votes and status history will also be removed. This cannot be undone.`)) return;
  pendingDeletes.add(id);
  try {
    const {data,error} = await state.client.from('reports').delete()
      .eq('id',id).eq('author_id',state.user.id).select('id,image_path');
    if (error) throw error;
    if (!data?.length) throw Error('Report not deleted. Please check your permissions and try again.');
    if ($('reportDialog').open) $('reportDialog').close();
    state.reports = state.reports.filter(r=>r.id!==id);
    state.myReports = state.myReports.filter(r=>r.id!==id);
    renderHome();renderExplore();renderMyActivity();renderAdmin();
    // Delete evidence only AFTER its report is deleted; storage policy blocks
    // deletion while the file is still attached to an existing report.
    let photoCleanupFailed = false;
    if (data[0].image_path) {
      try {
        const result = await state.client.storage.from('issue-photos').remove([data[0].image_path]);
        if (result.error) throw result.error;
      } catch(error) { console.warn('Photo cleanup needs attention',error);photoCleanupFailed=true; }
    }
    toast(photoCleanupFailed ? 'Report deleted. Its photo could not be cleared from storage; contact a moderator.' : 'Your report was permanently deleted.', photoCleanupFailed);
    await refreshAll();
  } catch(error) {toast(friendlyError(error),true);}
  finally {pendingDeletes.delete(id);}
}
async function openReport(id) {
  const r = [...state.reports,...state.myReports].find(item=>item.id===id);
  if (!r) return toast('This report is not available. Refresh and try again.',true);
  const dialog = $('reportDialog');
  const src = photoURL(r);
  const supported = Boolean(r.supported_by_me);
  const owned = Boolean(state.user && r.author_id === state.user.id);
  const mapsUrl = r.latitude!=null && r.longitude!=null ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.latitude},${r.longitude}`)}` : '';
  $('dialogContent').innerHTML = `${src ? `<img class="dialog-image" src="${escapeHTML(src)}" alt="Issue photo" onerror="this.hidden=true">`:''}<div class="detail-body"><div class="detail-meta"><span class="status-pill ${statusClass(r.status)}">${escapeHTML(r.status)}</span><span>${escapeHTML(r.category)}</span><span>${timestamp(r.created_at)}</span></div><h2 id="detailTitle">${escapeHTML(r.title)}</h2><p>${escapeHTML(r.description)}</p><div class="detail-meta">${ICON('pin')}<span>${escapeHTML(r.address_text)}</span></div><div class="detail-actions"><button type="button" class="button subtle support-detail-button ${supported?'supported':''}" data-support-id="${escapeHTML(r.id)}" aria-pressed="${supported}" title="The supporter count is public. Identities stay private.">${ICON('thumb')} ${supported?'Supported':'Support this issue'} (${Math.max(0,Number(r.support_count||0))})</button>${mapsUrl ? `<a class="button outlined" href="${escapeHTML(mapsUrl)}" target="_blank" rel="noopener noreferrer">${ICON('external')} Open map</a>`:''}${r.author_id===state.user.id&&r.status==='Resolved'?`<button class="button primary" data-verify-id="${escapeHTML(r.id)}">${ICON('check')} Verify resolution</button>`:''}${owned ? `<button type="button" class="button report-delete-action" data-delete-report="${escapeHTML(r.id)}">${ICON('trash')} Delete my report</button>`:''}</div><div class="timeline"><h3>Progress timeline</h3><div id="detailTimeline"><p>Loading updates…</p></div></div></div>`;
  dialog.showModal();
  try {
    const {data,error} = await state.client.from('report_status_events').select('id,status,created_at').eq('report_id',id).order('created_at',{ascending:true}).limit(50);
    if (error) throw error;
    if (!dialog.open) return;
    $('detailTimeline').innerHTML = data?.length ? data.map(e=>`<div class="timeline-step"><span class="timeline-marker"></span><div><strong>${escapeHTML(e.status)}</strong><small>${formatDate(e.created_at)} · ${new Date(e.created_at).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})}</small></div></div>`).join('') : '<p>No status updates yet.</p>';
  } catch(error) { if (dialog.open) $('detailTimeline').textContent = friendlyError(error); }
}
async function verifyResolution(id) {
  if (!confirm('Confirm that this issue has actually been fixed? This will mark your report as verified.')) return;
  try {
    const {error} = await state.client.rpc('verify_resolution',{p_report_id:id});
    if (error) throw error;
    $('reportDialog').close(); toast('Thank you. The resolution is now verified.'); await refreshAll();
  } catch(error) {toast(friendlyError(error),true);}
}
async function saveAdminStatus(id,button) {
  const select = document.querySelector(`select[data-admin-status="${CSS.escape(id)}"]`);
  const newStatus = select?.value;
  if (!newStatus) return toast('Select a new status first.',true);
  loading(button,true,'Saving…');
  try {
    const {error} = await state.client.rpc('moderator_set_status',{p_report_id:id,p_status:newStatus});
    if (error) throw error;
    toast('Report status updated.'); await refreshAll();
  } catch(error) {toast(friendlyError(error),true);} finally {loading(button,false);}
}
async function saveProfile(event) {
  event.preventDefault();
  const fullName = $('profileFullName').value.trim();
  if (fullName.length < 2) return toast('Enter a valid display name.',true);
  const button = $('saveProfileButton'); loading(button,true,'Saving…');
  try {
    const {error} = await state.client.from('profiles').update({full_name:fullName}).eq('id',state.user.id);
    if (error) throw error;
    state.profile = {...state.profile,full_name:fullName};
    renderProfile(); toast('Your display name was updated.');
  } catch(error) {toast(friendlyError(error),true);} finally {loading(button,false);}
}
async function requestProfileReset() {
  if (!state.user?.email) return toast('Password resets are only available for email accounts.',true);
  try {
    const {error} = await state.client.auth.resetPasswordForEmail(state.user.email,{redirectTo:redirectURL()});
    if (error) throw error;
    toast('A password-reset link has been requested for your email.');
  } catch(error) {toast(friendlyError(error),true);}
}
async function readNotification(id) {
  try {
    const {error} = await state.client.from('notifications').update({is_read:true}).eq('id',id).eq('user_id',state.user.id);
    if (error) throw error;
    const found = state.notifications.find(n=>n.id===id); if (found) found.is_read=true;
    renderNotifications(); renderNotificationDot();
  } catch(error) {toast(friendlyError(error),true);}
}
async function markAllNotificationsRead() {
  const ids = state.notifications.filter(n=>!n.is_read).map(n=>n.id);
  if (!ids.length) return toast('No unread notifications.');
  try {
    const {error} = await state.client.from('notifications').update({is_read:true}).eq('user_id',state.user.id).in('id',ids);
    if (error) throw error;
    state.notifications.forEach(n=>{n.is_read=true;});renderNotifications();renderNotificationDot();
  } catch(error) {toast(friendlyError(error),true);}
}
function clearPhoto() {
  if (state.photoURL) URL.revokeObjectURL(state.photoURL);
  state.photo=null;state.photoURL=null;
  $('galleryInput').value='';$('cameraInput').value='';
  $('uploadPlaceholder').hidden=false;$('uploadPreview').hidden=true;
}
function selectPhoto(file) {
  if (!file) return;
  const validMime = ['image/jpeg','image/png','image/webp','image/heic','image/heif'];
  if (!validMime.includes(file.type) && !/\.(jpg|jpeg|png|webp|heic|heif)$/i.test(file.name)) return toast('Choose a JPEG, PNG, WebP or supported HEIC photo.',true);
  if (file.size > 8 * 1024 * 1024) return toast('This image is larger than 8 MB. Please choose a smaller photo.',true);
  clearPhoto();state.photo=file;
  state.photoURL=URL.createObjectURL(file);
  $('previewImage').onerror = ()=> {toast('This image cannot be previewed on your browser. Try JPEG or PNG.',true);clearPhoto();};
  $('previewImage').src=state.photoURL;
  $('uploadPlaceholder').hidden=true;$('uploadPreview').hidden=false;
}
function loadImage(file) {
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('Cannot process the image on this browser. Please use a JPEG or PNG photo.'));};
    img.src=url;
  });
}
async function compressedPhoto(file) {
  // Canvas re-encoding reduces upload size and strips camera GPS EXIF metadata.
  const img=await loadImage(file);
  const ratio=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const ctx=canvas.getContext('2d'); if (!ctx) throw Error('Image processing is unavailable in this browser.');
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not prepare the photo. Try a different image.')),'image/jpeg',.83));
}
function getGPS() {
  return new Promise((resolve,reject)=>{
    if (!navigator.geolocation) return reject(Error('Your browser does not support GPS location.'));
    if (!isSecureContext && location.hostname!=='localhost') return reject(Error('GPS needs HTTPS. Open the deployed site using https://.'));
    navigator.geolocation.getCurrentPosition(
      p=>resolve({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:Math.round(p.coords.accuracy)}),
      e=>reject(Error(e.code===1?'Location permission was denied. Enable it in browser settings and try again.':e.code===2?'Location is unavailable. Check GPS/location services and try again.':'Could not get your location. Try again near a window.')),
      {enableHighAccuracy:true,timeout:18000,maximumAge:0}
    );
  });
}
async function useCurrentLocation(forReport) {
  const button = forReport ? $('useLocation') : $('mapLocateButton'); loading(button,true,'Locating…');
  try {
    const position=await getGPS(); state.userLocation=position;
    if (forReport) {
      state.reportLocation=position;
      $('locationLabel').textContent='GPS location attached';
      $('locationDetail').textContent=`${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · approx. ${position.accuracy} m accuracy`;
      toast('Location added. Check that you are at the actual issue site.');
    } else {toast('Current location found.');renderExplore();if(state.map)state.map.setView([position.lat,position.lng],13);updateMapMarkers(filteredReports());}
  } catch(error) {toast(friendlyError(error),true);} finally {loading(button,false);}
}
async function submitReport(event) {
  event.preventDefault();
  if (!state.user || !requireClient()) return;
  if (!state.photo) return toast('Add an evidence photo using Camera or Gallery.',true);
  const title=$('reportTitle').value.trim();
  const category=$('reportCategory').value;
  const description=$('reportDescription').value.trim();
  const address_text=$('reportAddress').value.trim();
  if (title.length<8 || description.length<20 || address_text.length<5 || !SAFE_CATEGORIES.includes(category)) return toast('Complete the title, category, description and landmark accurately.',true);
  if (state.busy) return;
  state.busy=true;
  const button=$('submitReportButton');loading(button,true,'Uploading and publishing…');
  let imagePath='';
  try {
    const blob=await compressedPhoto(state.photo);
    imagePath=`${state.user.id}/${crypto.randomUUID()}.jpg`;
    const uploaded=await state.client.storage.from('issue-photos').upload(imagePath,blob,{contentType:'image/jpeg',cacheControl:'3600',upsert:false});
    if (uploaded.error) throw uploaded.error;
    const row={author_id:state.user.id,title,category,description,address_text,image_path:imagePath,
      latitude:state.reportLocation?.lat ?? null,longitude:state.reportLocation?.lng ?? null};
    const inserted=await state.client.from('reports').insert(row).select('id').single();
    if (inserted.error) throw inserted.error;
    $('reportForm').reset(); clearPhoto(); state.reportLocation=null;
    $('locationLabel').textContent='GPS not yet attached'; $('locationDetail').textContent='Tap below to securely locate the issue.';
    toast('Report published successfully. It is now available to the community.');
    await refreshAll();showView('activity');
  } catch(error) {
    if (imagePath) {try {await state.client.storage.from('issue-photos').remove([imagePath]);} catch {}}
    toast(`Report not published: ${friendlyError(error)}`,true);
  } finally { state.busy=false;loading(button,false); }
}
let leafletPromise=null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise=new Promise((resolve,reject)=>{
    const style=document.createElement('link');style.rel='stylesheet';style.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';document.head.appendChild(style);
    const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.onload=()=>window.L?resolve(window.L):reject(Error('Map unavailable.'));script.onerror=()=>reject(Error('Unable to load the interactive map.'));document.head.appendChild(script);
  });
  return leafletPromise;
}
async function ensureMap() {
  const container=$('exploreMap');
  if (state.map) {setTimeout(()=>state.map.invalidateSize(),80);updateMapMarkers(filteredReports());return;}
  container.innerHTML=`<div class="map-fallback">${ICON('map')}<strong>Loading community map</strong><p>Preparing an interactive view of GPS-linked reports.</p></div>`;
  try {
    const L=await loadLeaflet();
    if (state.map) return;
    container.replaceChildren();
    const center=state.userLocation?[state.userLocation.lat,state.userLocation.lng]:[22.5726,88.3639];
    state.map=L.map(container,{zoomControl:true,scrollWheelZoom:false}).setView(center,state.userLocation?13:8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors',maxZoom:19}).addTo(state.map);
    state.mapMarkers=L.layerGroup().addTo(state.map);
    setTimeout(()=>state.map.invalidateSize(),100);
    updateMapMarkers(filteredReports());
  } catch(error) {container.innerHTML=`<div class="map-fallback">${ICON('map')}<strong>Map could not load</strong><p>Issue cards still work. Check your internet connection.</p></div>`;}
}
function updateMapMarkers(issues) {
  if (!state.map || !window.L || !state.mapMarkers) return;
  const L=window.L;
  state.mapMarkers.clearLayers();
  const bounds=[];
  for (const r of issues) {
    if (r.latitude==null || r.longitude==null) continue;
    const icon=L.divIcon({className:'',html:'<div class="map-pin-marker" style="width:15px;height:15px"></div>',iconSize:[15,15],iconAnchor:[7,7]});
    const marker=L.marker([r.latitude,r.longitude],{icon}).addTo(state.mapMarkers);
    const popup=`<strong>${escapeHTML(r.title)}</strong><br><span>${escapeHTML(r.address_text)}</span><br><span>${escapeHTML(r.status)}</span>`;
    marker.bindPopup(popup); bounds.push([r.latitude,r.longitude]);
  }
  if (state.userMarker) {state.map.removeLayer(state.userMarker);state.userMarker=null;}
  if (state.userLocation) {
    const pos=state.userLocation;
    state.userMarker=L.marker([pos.lat,pos.lng],{icon:L.divIcon({className:'',html:'<div class="map-user-marker"></div>',iconSize:[14,14]})}).addTo(state.map);
    state.userMarker.bindPopup('Your approximate location');
    if (!bounds.length) state.map.setView([pos.lat,pos.lng],13);
  }
  if (bounds.length && !state.userLocation) state.map.fitBounds(bounds,{padding:[30,30],maxZoom:13});
}
function attachUIHandlers() {
  document.querySelectorAll('[data-auth-mode]').forEach(t=>t.addEventListener('click',()=>setAuthMode(t.dataset.authMode)));
  $('emailAuthForm').addEventListener('submit',submitEmailAuth);
  $('googleAuthButton').addEventListener('click',googleSignIn);
  $('phoneAuthForm').addEventListener('submit',sendPhoneOtp);
  $('verifyPhoneForm').addEventListener('submit',verifyPhoneOtp);
  $('changePhone').addEventListener('click',()=>{$('verifyPhoneForm').hidden=true;$('phoneAuthForm').hidden=false;authNotice('');});
  $('forgotPassword').addEventListener('click',passwordReset);
  $('reportForm').addEventListener('submit',submitReport);
  $('openCamera').addEventListener('click',()=> $('cameraInput').click());
  $('openGallery').addEventListener('click',()=> $('galleryInput').click());
  $('cameraInput').addEventListener('change',e=>selectPhoto(e.target.files?.[0]));
  $('galleryInput').addEventListener('change',e=>selectPhoto(e.target.files?.[0]));
  $('removePhoto').addEventListener('click',clearPhoto);
  $('enableDashboardLocation').addEventListener('click',async()=>{await useCurrentLocation(false);if(state.userLocation)$('locationPrompt').hidden=true;});
  $('dismissLocationPrompt').addEventListener('click',()=>{$('locationPrompt').hidden=true;});
  $('closePasswordDialog').addEventListener('click',()=>$('passwordDialog').close());
  $('newPasswordForm').addEventListener('submit',async(event)=>{
    event.preventDefault();if(!state.client)return;
    const password=$('newPassword').value;
    if(password.length<8)return toast('Use at least 8 characters.',true);
    const button=$('saveNewPassword');loading(button,true,'Updating…');
    try{const {error}=await state.client.auth.updateUser({password});if(error)throw error;
      $('newPasswordForm').reset();$('passwordDialog').close();toast('Password updated successfully.');
    }catch(error){toast(friendlyError(error),true);}finally{loading(button,false);}
  });
  $('useLocation').addEventListener('click',()=>useCurrentLocation(true));
  $('mapLocateButton').addEventListener('click',()=>useCurrentLocation(false));
  $('issueSearch').addEventListener('input',renderExplore);
  for (const id of ['categoryFilter','statusFilter','sortFilter']) $(id).addEventListener('change',renderExplore);
  $('resetFilters').addEventListener('click',()=>{$('issueSearch').value='';$('categoryFilter').value='all';$('statusFilter').value='all';$('sortFilter').value='newest';renderExplore();});
  $('loadMoreButton').addEventListener('click',async()=>{await fetchReports(false);});
  $('closeDialog').addEventListener('click',()=> $('reportDialog').close());
  $('reportDialog').addEventListener('click',event=>{if(event.target===$('reportDialog'))$('reportDialog').close();});
  $('profileForm').addEventListener('submit',saveProfile);
  $('profilePasswordReset').addEventListener('click',requestProfileReset);
  $('signOutButton').addEventListener('click',async()=>{
    try {const {error}=await state.client.auth.signOut();if(error)throw error;await handleSession(null,'SIGNED_OUT');setAuthMode('signin');toast('You have signed out.');}
    catch(error){toast(friendlyError(error),true);}
  });
  $('markAllRead').addEventListener('click',markAllNotificationsRead);
  $('notificationButton').addEventListener('click',()=>{
    showView('activity');
    $('notificationsPanel').scrollIntoView({block:'center',behavior:'smooth'});
  });
  document.addEventListener('click',event=>{
    const nav=event.target.closest('[data-view]');if(nav&&state.user){showView(nav.dataset.view);return;}
    const open=event.target.closest('[data-open-report]');if(open){openReport(open.dataset.openReport);return;}
    const support=event.target.closest('[data-support-id]');if(support){toggleSupport(support.dataset.supportId);return;}
    const remove=event.target.closest('[data-delete-report]');if(remove){deleteOwnReport(remove.dataset.deleteReport);return;}
    const verify=event.target.closest('[data-verify-id]');if(verify){verifyResolution(verify.dataset.verifyId);return;}
    const read=event.target.closest('[data-read-notification]');if(read){readNotification(read.dataset.readNotification);return;}
    const admin=event.target.closest('[data-admin-save]');if(admin){saveAdminStatus(admin.dataset.adminSave,admin);return;}
  });
  const uploadZone=$('uploadZone');
  uploadZone.addEventListener('dragover',e=>{e.preventDefault();uploadZone.classList.add('dragging');});
  uploadZone.addEventListener('dragleave',()=>uploadZone.classList.remove('dragging'));
  uploadZone.addEventListener('drop',e=>{e.preventDefault();uploadZone.classList.remove('dragging');selectPhoto(e.dataTransfer?.files?.[0]);});
}
async function initialize() {
  $('copyrightYear').textContent=String(new Date().getFullYear());
  attachUIHandlers();setAuthMode('signup');
  if ('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  const config=window.JANSETU_CONFIG || {};
  const url=(config.supabaseUrl||'').trim();
  const key=(config.supabaseAnonKey||'').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !key || /service_role|sb_secret_/.test(key)) {
    authNotice('One-time setup required: add your Supabase project URL and public publishable/anon key to config.js and run supabase/schema.sql. Read README.md for instructions.',true);
    return;
  }
  try {
    const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    state.client=createClient(url.replace(/\/$/,''),key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    state.client.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY') {
        // Recovery links create a temporary authenticated session. Use an accessible
        // in-app password form rather than a native browser prompt.
        setTimeout(()=>{if(!$('passwordDialog').open)$('passwordDialog').showModal();},80);
      }
      if(event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='SIGNED_OUT'||event==='USER_UPDATED') {
        setTimeout(()=>handleSession(session,event),0);
      }
    });
    const {data,error}=await state.client.auth.getSession();if(error)throw error;
    if(data.session) await handleSession(data.session,'INITIAL_SESSION');
  } catch(error) {authNotice(`Unable to initialise authentication: ${friendlyError(error)}`,true);}
}
initialize();
