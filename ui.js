// ui.js — интерфейс: мастер-пароль, контакты, сообщения, настройки, код-комнаты.
function $(id) { const el = document.getElementById(id); if (!el) console.warn(`Нет #${id}`); return el; }
function getEl(id) { return document.getElementById(id); }

// ==================== Мастер-пароль ====================
async function showMasterPasswordPrompt(isFirstTime = false) {
  return new Promise((resolve) => {
    const old = document.querySelector('.master-password-modal'); if (old) old.remove();
    const modal = document.createElement('div');
    modal.className = 'master-password-modal';
    modal.innerHTML = `<div class="master-password-content">
      <h2>🔐 ${isFirstTime ? 'Создайте мастер-пароль' : 'Введите мастер-пароль'}</h2>
      <p>${isFirstTime ? 'Защитит ключи и историю чатов. Не потеряйте его!' : 'Нужен для расшифровки данных.'}</p>
      <input type="password" id="master-password-input" placeholder="Мастер-пароль" autocomplete="off"/>
      ${isFirstTime ? '<input type="password" id="master-password-confirm" placeholder="Подтвердите пароль" autocomplete="off"/>' : ''}
      <button class="btn-primary" id="master-password-submit">${isFirstTime ? 'Создать' : 'Войти'}</button>
      <div class="master-error" id="master-error"></div></div>`;
    document.body.appendChild(modal);
    const submitBtn = document.getElementById('master-password-submit');
    const errorEl = document.getElementById('master-error');
    const passwordInput = document.getElementById('master-password-input');
    submitBtn.onclick = async () => {
      const password = passwordInput.value.trim();
      if (!password || password.length < 6) { errorEl.textContent = 'Пароль должен быть не менее 6 символов'; return; }
      if (isFirstTime && password !== document.getElementById('master-password-confirm').value.trim()) { errorEl.textContent = 'Пароли не совпадают'; return; }
      try {
        if (!isFirstTime) {
          const encrypted = localStorage.getItem('contacts_encrypted');
          if (encrypted && (await CryptoSystem.decryptWithMaster(encrypted, password)) === null) { errorEl.textContent = 'Неверный пароль'; return; }
          if (!encrypted) {
            const oldContacts = localStorage.getItem('contacts');
            if (oldContacts) { localStorage.setItem('contacts_encrypted', await CryptoSystem.encryptWithMaster(oldContacts, password)); localStorage.removeItem('contacts'); }
          }
        } else {
          const test = await CryptoSystem.encryptWithMaster('test', password);
          if (!test) { errorEl.textContent = 'Ошибка создания ключа'; return; }
        }
        masterPassword = password; modal.remove(); resolve();
      } catch (e) { errorEl.textContent = 'Ошибка: ' + e.message; }
    };
    passwordInput.onkeydown = e => { if (e.key === 'Enter') submitBtn.click(); };
    passwordInput.focus();
  });
}

// ==================== Настройки и контакты ====================
async function loadSettings() {
  myName = localStorage.getItem('myName') || 'Вы';
  myAvatar = localStorage.getItem('myAvatar') || '';
  const sigUrl = getEl('signaling-url-input');
if (sigUrl) sigUrl.value = localStorage.getItem('signalingUrl') || '';
  currentUser = localStorage.getItem('uid');
  if (!currentUser) { currentUser = CryptoSystem.generateKey().slice(0, 16); localStorage.setItem('uid', currentUser); }
  const n = getEl('name-input'); if (n) n.value = myName;
  const a = getEl('avatar-input'); if (a) a.value = myAvatar;
  if (masterPassword) {
    const encrypted = localStorage.getItem('contacts_encrypted');
    if (encrypted) { const json = await CryptoSystem.decryptWithMaster(encrypted, masterPassword); contacts = json ? JSON.parse(json) : {}; }
    else contacts = {};
  } else contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
  renderContactList();
  const saved = localStorage.getItem('activePeer');
  if (saved && contacts[saved]) { activePeer = saved; openChat(activePeer); }
  else { const m = $('main-chat'); if (m) m.classList.add('hidden'); }
}
function renderContactList() {
  const list = getEl('contact-list'); if (!list) return;
  list.innerHTML = '';
  Object.entries(contacts).forEach(([peerId, data]) => {
    const div = document.createElement('div');
    div.className = 'contact-item' + (peerId === activePeer ? ' active' : '');
    div.innerHTML = `<span class="contact-avatar">${data.avatar || '👤'}</span><span class="contact-name">${data.name || peerId.slice(0, 8)}</span><button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${peerId}')">✕</button>`;
    div.onclick = () => openChat(peerId);
    list.appendChild(div);
  });
}
async function deleteChat(peerId) {
  if (!contacts[peerId] || !confirm('Удалить чат и историю с ' + (contacts[peerId]?.name || peerId) + '?')) return;
  const histKey = `history_${[currentUser, peerId].sort().join('_')}`;
  localStorage.removeItem(masterPassword ? `hist_${histKey}` : histKey);
  localStorage.removeItem(`pinned_${peerId}`);
  dropPeer(peerId);
  delete contacts[peerId];
  await saveContacts();
  if (activePeer === peerId) { activePeer = null; localStorage.removeItem('activePeer'); const m = $('main-chat'); if (m) m.classList.add('hidden'); }
  renderContactList();
}
async function saveContacts() { await saveContactsSecure(); }

// ==================== UI чата ====================
function updateUIForPeer(peerId) {
  activePeer = peerId;
  localStorage.setItem('activePeer', peerId);
  const mainChat = $('main-chat'), sidebar = $('sidebar');
  if (mainChat) { mainChat.classList.remove('hidden'); mainChat.style.display = 'flex'; }
  if (sidebar && window.innerWidth <= 700) { sidebar.classList.remove('visible'); sidebar.classList.add('hidden'); }
  const peer = contacts[peerId] || {};
  const cn = $('chat-name'); if (cn) cn.textContent = peer.name || peerId.slice(0, 8);
  const ca = $('chat-avatar'); if (ca) ca.textContent = peer.avatar || '👤';
  const cs = $('chat-status'); if (cs) cs.textContent = (channels[peerId] && channels[peerId].readyState === 'open') ? 'онлайн' : 'подключение...';
  updateKeyDisplay(); loadMessages(peerId); loadPinned(peerId); renderContactList();
}
async function loadMessages(peerId) {
  const container = $('messages'); if (!container) return;
  const hist = await loadMessageHistory(peerId);
  container.innerHTML = '';
  const localKey = contacts[peerId]?.localSessionKey, remoteKey = contacts[peerId]?.remoteKey;
  for (const msg of hist) {
    const isMine = msg.from === currentUser;
    let content = '';
    if (msg.type === 'image') {
      const k = isMine ? remoteKey : localKey;
      try {
        const dec = k && msg.ciphertext ? await CryptoSystem.decryptData(msg.ciphertext, k) : null;
        content = dec ? `<img src="${URL.createObjectURL(new Blob([dec], { type: msg.mimeType || 'image/jpeg' }))}" alt="изображение" loading="lazy"/>` : '🔒 Зашифрованное изображение';
      } catch (e) { content = '🔒 Зашифрованное изображение'; }
    } else {
      const k = isMine ? remoteKey : localKey;
      const dec = k && msg.ciphertext ? await CryptoSystem.decrypt(msg.ciphertext, k) : null;
      content = dec !== null ? dec : '🔒 Зашифровано';
    }
    const div = document.createElement('div');
    div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
    div.innerHTML = `<div class="message-content">${content}</div><div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div><button class="delete-btn" style="opacity:.4" onclick="togglePin('${peerId}', ${msg.timestamp})">📌</button>`;
    container.appendChild(div);
  }
  setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}
function updateKeyDisplay() {
  if (!activePeer) return;
  const mk = getEl('my-key-display'), pk = getEl('partner-key-display');
  const lk = contacts[activePeer]?.localSessionKey, rk = contacts[activePeer]?.remoteKey;
  if (mk) mk.innerText = lk ? lk.slice(0, 8) + '...' : 'none';
  if (pk) pk.innerText = rk ? rk.slice(0, 8) + '...' : '(ожидание...)';
}
function handleImageUpload(event) { const f = event.target.files[0]; if (f) { sendImage(f); event.target.value = ''; } }
async function togglePin(peerId, ts) {
  const hist = await loadMessageHistory(peerId);
  const msg = hist.find(m => m.timestamp === ts); if (!msg) return;
  const pinnedKey = `pinned_${peerId}`;
  let pinned = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
  if (pinned.find(p => p.ts === ts)) pinned = pinned.filter(p => p.ts !== ts);
  else {
    let text = '🖼️ Изображение';
    if (msg.type !== 'image') {
      const k = (msg.from === currentUser) ? contacts[peerId]?.remoteKey : contacts[peerId]?.localSessionKey;
      const dec = k ? await CryptoSystem.decrypt(msg.ciphertext, k) : null;
      text = dec || '🔒 Зашифровано';
    }
    pinned.push({ ts, text });
  }
  localStorage.setItem(pinnedKey, JSON.stringify(pinned));
  loadPinned(peerId);
}
function loadPinned(peerId) {
  const el = $('pinned-messages'); if (!el) return;
  const pinned = JSON.parse(localStorage.getItem(`pinned_${peerId}`) || '[]');
  el.innerHTML = pinned.length ? pinned.map(p => `📌 ${p.text}`).join(' | ') : 'Нет закреплённых сообщений';
}
function togglePinnedPanel() { const p = $('pinned-panel'); if (p) p.classList.toggle('visible'); }
function toggleSidebar() { const s = $('sidebar'); if (s) s.classList.toggle('visible'); const m = $('main-chat'); if (m) m.classList.toggle('shifted'); }

// ==================== Код-комнаты (UI) ====================
function showNewChat() { resetToRoleSelect(); const m = $('new-chat-modal'); if (m) m.classList.remove('hidden'); }
function closeNewChat() { const m = $('new-chat-modal'); if (m) m.classList.add('hidden'); }
function resetToRoleSelect() {
  ['role-select-section', 'host-flow', 'join-flow'].forEach(id => { const el = getEl(id); if (el) el.classList.add('hidden'); });
  getEl('role-select-section').classList.remove('hidden');
}
function showSection(id) {
  ['role-select-section', 'host-flow', 'join-flow'].forEach(s => { const el = getEl(s); if (el) el.classList.add('hidden'); });
  getEl(id).classList.remove('hidden');
}
async function startHostFlow() {
  showSection('host-flow');
  const codeEl = $('host-room-code'), wait = $('host-waiting');
  codeEl.textContent = 'Создание комнаты...';
  wait.classList.add('hidden');
  try {
    await hostStart(words => {
      codeEl.textContent = words;
      copyToClipboard(words);
      wait.classList.remove('hidden');
    });
  } catch (e) { alert('Не удалось создать комнату'); resetToRoleSelect(); }
}
function startJoinFlow() {
  showSection('join-flow');
  const i = $('join-code-input'); if (i) { i.value = ''; setTimeout(() => i.focus(), 150); }
  const e = $('join-error'); if (e) e.textContent = '';
  const w = $('join-waiting'); if (w) w.classList.add('hidden');
}
async function joinByCode() {
  const input = $('join-code-input'), err = $('join-error'), btn = $('join-connect-btn'), wait = $('join-waiting');
  err.textContent = '';
  btn.disabled = true; wait.classList.remove('hidden');
  try {
    await guestJoin(input.value.trim());
  } catch (msg) {
    err.textContent = msg;
    wait.classList.add('hidden');
    btn.disabled = false;
  }
}
function copyHostCode() { const el = $('host-room-code'); if (el) copyToClipboard(el.textContent); }
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
}

// ==================== Настройки / тема ====================
function showSettings() { const m = $('settings-modal'); if (m) m.classList.remove('hidden'); }
function closeSettings() { const m = $('settings-modal'); if (m) m.classList.add('hidden'); }
async function saveSettings() {
  myName = getEl('name-input')?.value.trim() || 'Вы';
  myAvatar = getEl('avatar-input')?.value.trim() || '';
  localStorage.setItem('myName', myName); localStorage.setItem('myAvatar', myAvatar);
  const sigInput = getEl('signaling-url-input');
if (sigInput && sigInput.value.trim()) localStorage.setItem('signalingUrl', sigInput.value.trim());
else localStorage.removeItem('signalingUrl');
  closeSettings(); renderContactList();
}
function toggleTheme() {
  const t = $('theme-toggle');
  if (t) { document.body.classList.toggle('light', !t.checked); localStorage.setItem('theme', t.checked ? 'dark' : 'light'); }
}
function loadTheme() {
  const t = $('theme-toggle');
  if (localStorage.getItem('theme') === 'light') { document.body.classList.add('light'); if (t) t.checked = false; }
  else { document.body.classList.remove('light'); if (t) t.checked = true; }
}
async function deleteAllChats() {
  const count = Object.keys(contacts).length;
  if (!count) { alert('Нет чатов для удаления.'); return; }
  if (!confirm(`⚠️ Удалить ВСЕ чаты (${count})? История и ключи будут потеряны безвозвратно!`)) return;
  if (!confirm('Точно уверены? Это действие нельзя отменить.')) return;
  Object.keys(contacts).forEach(pid => dropPeer(pid));
  if (pendingHostPeer) { try { pendingHostPeer.destroy(); } catch (e) {} pendingHostPeer = null; }
  for (const peerId of Object.keys(contacts)) {
    const histKey = `history_${[currentUser, peerId].sort().join('_')}`;
    localStorage.removeItem(masterPassword ? `hist_${histKey}` : histKey);
    localStorage.removeItem(`pinned_${peerId}`);
  }
  contacts = {}; await saveContacts();
  activePeer = null; connectedPeerId = null; verifiedFingerprints = {};
  localStorage.removeItem('activePeer');
  renderContactList();
  const m = $('main-chat'); if (m) m.classList.add('hidden');
  getEl('messages').innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><p>Выберите чат или создайте новый</p></div>';
  updateOnlineStatus(); closeSettings();
  alert(`✅ Все чаты удалены (${count} шт.)`);
}
