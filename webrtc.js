// webrtc.js — PeerJS с fallback-серверами, retry и 2 ICE-серверами.
const WORD_LIST = [
'Альфа','Браво','Чарли','Дельта','Эхо','Фокстрот','Гольф','Отель',
'Индия','Джульет','Кило','Лима','Майк','Ноябрь','Оскар','Папа',
'Квебек','Ромео','Сьерра','Танго','Юниформ','Виктор','Виски','Рентген',
'Янки','Зулу','Красный','Синий','Зелёный','Жёлтый','Оранжевый','Пурпурный',
'Серебряный','Золотой','Кристальный','Алмазный','Рубиновый','Изумрудный','Сапфировый',
'Нефритовый','Ониксовый','Янтарный','Коралловый','Лазурный','Фиолетовый','Малиновый','Индиго',
'Бирюзовый','Магентовый','Оливковый','Бордовый'
];
const ROOM_PREFIX = '0byte-v1-';

// ★ РОВНО 2 ICE-сервера (убрали warning PeerJS)
const ICE_CONFIG = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
]};

// ★ Список signaling-серверов PeerJS (пробуем по очереди)
const PEERJS_SERVERS = [
  { host: '0.peerjs.com',  port: 443, path: '/', secure: true },
  { host: '1.peerjs.com',  port: 443, path: '/', secure: true },
  { host: 'peerjs-server.herokuapp.com', port: 443, path: '/', secure: true },
  { host: 'peerjs.discoverydns.com', port: 443, path: '/', secure: true },
];
let currentServerIdx = 0;

// ── Глобальное состояние ──
let currentUser, myName = 'Вы', myAvatar = '';
let contacts = {};
let activePeer = null;
let dataChannel = null;
const channels = {};
const hostPeers = {};
const keyIntervals = {};
let pendingHostPeer = null;
let connectedPeerId = null;
let masterPassword = null;
let verifiedFingerprints = {};
let myPeer = null;

// ── Код-комнаты ──
const randInt = n => Math.floor(Math.random() * n);
function generateRoomCode() {
  return { i1: randInt(WORD_LIST.length), i2: randInt(WORD_LIST.length), num: 10 + randInt(90) };
}
const roomCodeWords = c => `${WORD_LIST[c.i1]} ${WORD_LIST[c.i2]} ${c.num}`;
const roomIdFromCode = c => ROOM_PREFIX + c.i1 + '-' + c.i2 + '-' + c.num;
function parseRoomCode(text) {
  const s = String(text || '').toLowerCase();
  const numMatch = s.match(/\d+/);
  if (!numMatch) return null;
  const num = parseInt(numMatch[0], 10);
  const lower = WORD_LIST.map(w => w.toLowerCase());
  const found = [];
  const re = /[a-zа-яё]+/g; let m;
  while ((m = re.exec(s))) {
    const wi = lower.indexOf(m[0]);
    if (wi >= 0) found.push({ wi, idx: m.index });
  }
  found.sort((a, b) => a.idx - b.idx);
  if (found.length < 2) return null;
  return { i1: found[0].wi, i2: found[1].wi, num };
}

// ── Адаптер PeerJS-conn → dataChannel ──
function wrapConn(conn, peerId) {
  const a = {
    peerId, conn, _open: null, _msg: null, _close: null,
    get readyState() { return conn.open ? 'open' : 'connecting'; },
    send: s => conn.send(s),
    close: () => { try { conn.close(); } catch (e) {} },
    set onopen(fn) { a._open = fn; if (conn.open) setTimeout(() => fn && fn(), 0); },
    get onopen() { return a._open; },
    set onmessage(fn) { a._msg = fn; },
    get onmessage() { return a._msg; },
    set onclose(fn) { a._close = fn; },
    get onclose() { return a._close; }
  };
  conn.on('data',  d => a._msg  && a._msg({ data: typeof d === 'string' ? d : JSON.stringify(d) }));
  conn.on('open',  () => a._open && a._open());
  conn.on('close', () => a._close && a._close());
  conn.on('error', e => console.warn('conn error:', e));
  return a;
}

// ── ★ Создание Peer с retry по серверам ──
function createPeerWithRetry(id = null, attempt = 0) {
  return new Promise((resolve, reject) => {
    if (attempt >= PEERJS_SERVERS.length) {
      return reject(new Error(
        'Не удалось подключиться ни к одному signaling-серверу PeerJS.\n\n' +
        'Возможные причины:\n' +
        '• Включён adblocker (uBlock Origin / Privacy Badger) — отключите для этого сайта\n' +
        '• Корпоративный firewall блокирует WSS-порт 443\n' +
        '• Публичные сервера PeerJS сейчас недоступны — попробуйте через 1-2 минуты'
      ));
    }
    const server = PEERJS_SERVERS[(currentServerIdx + attempt) % PEERJS_SERVERS.length];
    console.log(`[PeerJS] Попытка ${attempt + 1}/${PEERJS_SERVERS.length}: ${server.host}`);

    const opts = {
      host: server.host,
      port: server.port,
      path: server.path,
      secure: server.secure,
      config: ICE_CONFIG,
      debug: 1,
      // короткий timeout на коннект к signaling
      pingInterval: 10000
    };
    const p = new Peer(id, opts);

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[PeerJS] Таймаут на ${server.host}, пробуем следующий`);
      try { p.destroy(); } catch (e) {}
      resolve(createPeerWithRetry(id, attempt + 1));
    }, 8000);

    p.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      currentServerIdx = (currentServerIdx + attempt) % PEERJS_SERVERS.length;
      console.log(`[PeerJS] ✓ Подключено к ${server.host} (id=${p.id})`);
      setStatusOk(server.host);
      resolve(p);
    });
    p.on('error', err => {
      if (settled && err.type !== 'peer-unavailable' && err.type !== 'network') return;
      // peer-unavailable — это нормально при подключении гостя, не считаем ошибкой сервера
      if (err.type === 'peer-unavailable') {
        const errEl = getEl('join-error');
        if (errEl) errEl.textContent = 'Комната не найдена. Проверьте код или попросите друга создать её заново.';
        setStatusOk(server.host);
        return;
      }
      console.warn(`[PeerJS] Ошибка на ${server.host}:`, err.type, err.message);
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        try { p.destroy(); } catch (e) {}
        resolve(createPeerWithRetry(id, attempt + 1));
      } else {
        // потеряли связь уже после коннекта
        setStatusError();
      }
    });
    p.on('disconnected', () => {
      try { p.reconnect(); } catch (e) {}
    });
    p.on('close', () => setStatusError());
  });
}

function setStatusOk(serverHost) {
  const el = getEl('signaling-status');
  if (el) el.innerHTML = `<span style="color:var(--success,#22c55e)">●</span> Signaling: ${serverHost}`;
}
function setStatusError() {
  const el = getEl('signaling-status');
  if (el) el.innerHTML = `<span style="color:#ef4444">●</span> Signaling: отключен (пробуем переподключиться...)`;
}

// ── Стабильный id нашего Peer ──
async function ensureMyPeer() {
  if (myPeer && !myPeer.destroyed) return myPeer;
  let id = localStorage.getItem('myPeerId');
  if (!id) { id = '0byte-u-' + CryptoSystem.generateKey().slice(0, 12); localStorage.setItem('myPeerId', id); }
  myPeer = await createPeerWithRetry(id);
  return myPeer;
}

// ── Хост: создать комнату ──
async function hostCreateRoom(code, onConn) {
  const p = await createPeerWithRetry(roomIdFromCode(code));
  p.on('connection', conn => onConn(conn));
  return p;
}
async function hostStart(onCode) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    try {
      const p = await hostCreateRoom(code, conn => onHostConnection(conn, code));
      pendingHostPeer = p;
      onCode(roomCodeWords(code));
      return;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
}
function onHostConnection(conn, code) {
  const pid = conn.peer;
  if (!contacts[pid]) contacts[pid] = { name: pid.slice(0, 8), avatar: '' };
  contacts[pid].role = 'host';
  contacts[pid].room = code;
  contacts[pid].remotePeerId = pid;
  saveContactsSecure();
  if (pendingHostPeer) { hostPeers[pid] = pendingHostPeer; pendingHostPeer = null; }
  const adapter = wrapConn(conn, pid);
  channels[pid] = adapter;
  connectedPeerId = pid;
  setupDataChannel(pid, 'host');
}

// ── Гость: подключиться по коду ──
async function guestJoin(codeText) {
  const code = parseRoomCode(codeText);
  if (!code) throw 'Не распознал код. Пример: «Янтарный Тигр 42»';
  const roomId = roomIdFromCode(code);
  await ensureMyPeer();
  const conn = myPeer.connect(roomId, { reliable: true });
  const pid = roomId;
  if (!contacts[pid]) contacts[pid] = { name: 'Комната ' + code.num, avatar: '' };
  contacts[pid].role = 'guest';
  contacts[pid].room = code;
  await saveContactsSecure();
  const adapter = wrapConn(conn, pid);
  channels[pid] = adapter;
  connectedPeerId = pid;
  setupDataChannel(pid, 'guest');
  return code;
}

// ── Переподключение сохранённого чата ──
async function reconnect(peerId) {
  const c = contacts[peerId];
  if (!c || !c.room) return false;
  if (channels[peerId] && channels[peerId].readyState === 'open') return true;
  if (c.role === 'host') {
    if (hostPeers[peerId] && !hostPeers[peerId].destroyed) return false;
    try {
      const p = await hostCreateRoom(c.room, conn => onHostConnection(conn, c.room));
      hostPeers[peerId] = p;
      return true;
    } catch (e) { return false; }
  } else {
    await ensureMyPeer();
    const conn = myPeer.connect(roomIdFromCode(c.room), { reliable: true });
    channels[peerId] = wrapConn(conn, peerId);
    setupDataChannel(peerId, 'guest');
    return true;
  }
}
function openChat(peerId) {
  if (!contacts[peerId]) { contacts[peerId] = { name: peerId.slice(0, 8), avatar: '' }; saveContactsSecure(); renderContactList(); }
  activePeer = peerId;
  localStorage.setItem('activePeer', peerId);
  dataChannel = channels[peerId] || null;
  updateUIForPeer(peerId);
  if (dataChannel && dataChannel.readyState === 'open') return;
  reconnect(peerId);
  setTimeout(() => {
    if (!(channels[peerId] && channels[peerId].readyState === 'open')) {
      const rp = getEl('restore-panel'); if (rp) rp.classList.add('visible');
    }
  }, 8000);
}
function restoreChat() {
  const peerId = activePeer || connectedPeerId;
  if (!peerId) return;
  if (channels[peerId]) { channels[peerId].close(); delete channels[peerId]; }
  dataChannel = null;
  openChat(peerId);
}
function dropPeer(peerId) {
  if (channels[peerId]) { channels[peerId].close(); delete channels[peerId]; }
  if (hostPeers[peerId]) { try { hostPeers[peerId].destroy(); } catch (e) {} delete hostPeers[peerId]; }
  if (keyIntervals[peerId]) { clearInterval(keyIntervals[peerId]); delete keyIntervals[peerId]; }
  if (activePeer === peerId) dataChannel = null;
}

// ── Канал: ключи, hello, сообщения ──
function setupDataChannel(peerId, role = 'unknown') {
  const ch = channels[peerId];
  if (!ch) return;
  if (!contacts[peerId]) contacts[peerId] = { name: peerId.slice(0, 8), avatar: '' };
  if (!contacts[peerId].localSessionKey) { contacts[peerId].localSessionKey = CryptoSystem.generateKey(); saveContactsSecure(); }

  ch.onopen = async () => {
    console.log('Канал открыт:', peerId);
    const sendKey = () => { if (ch.readyState === 'open') ch.send(JSON.stringify({ type: 'key', key: contacts[peerId].localSessionKey })); };
    sendKey();
    if (keyIntervals[peerId]) clearInterval(keyIntervals[peerId]);
    keyIntervals[peerId] = setInterval(() => { if (ch.readyState === 'open') sendKey(); else clearInterval(keyIntervals[peerId]); }, 400);
    ch.send(JSON.stringify({ type: 'hello', name: myName, avatar: myAvatar }));
    updateOnlineStatus();
    try {
      const pc = ch.conn && ch.conn.peerConnection;
      if (pc && pc.localDescription && pc.remoteDescription) {
        const localFp = CryptoSystem.extractFingerprint(pc.localDescription.sdp);
        const remoteFp = CryptoSystem.extractFingerprint(pc.remoteDescription.sdp);
        if (localFp && remoteFp) verifyFingerprint(peerId, localFp, remoteFp);
      }
    } catch (e) { console.warn(e); }
    const modal = getEl('new-chat-modal');
    if (modal && !modal.classList.contains('hidden')) closeNewChat();
    if (activePeer === peerId || !activePeer) {
      activePeer = peerId;
      dataChannel = ch;
      localStorage.setItem('activePeer', peerId);
      updateUIForPeer(peerId);
    }
    renderContactList();
    const rp = getEl('restore-panel'); if (rp) rp.classList.remove('visible');
  };
  ch.onclose = () => {
    console.log('Канал закрыт:', peerId);
    updateOnlineStatus();
    if (activePeer === peerId) {
      const rp = getEl('restore-panel'); if (rp) rp.classList.add('visible');
    }
  };
  ch.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'key') {
        if (contacts[peerId]) {
          contacts[peerId].remoteKey = data.key;
          await saveContactsSecure();
          if (keyIntervals[peerId]) clearInterval(keyIntervals[peerId]);
          loadMessages(peerId);
          updateKeyDisplay();
        }
      } else if (data.type === 'hello') {
        if (contacts[peerId]) {
          contacts[peerId].name = data.name || contacts[peerId].name;
          contacts[peerId].avatar = data.avatar || contacts[peerId].avatar;
          await saveContactsSecure();
          renderContactList();
          if (activePeer === peerId) updateUIForPeer(peerId);
        }
      } else if (data.type === 'message' || data.type === 'image') {
        await saveMessageToHistory(peerId, data);
        if (peerId === activePeer) loadMessages(peerId);
      } else if (data.type === 'fingerprint_ack') {
        verifiedFingerprints[peerId] = true;
      }
    } catch (e) { console.error('Ошибка обработки сообщения:', e); }
  };
}

// ── Отправка ──
async function sendMessage() {
  const text = getEl('message-input').value.trim();
  if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') { alert('Нет соединения.'); return; }
  const remoteKey = contacts[activePeer]?.remoteKey;
  if (!remoteKey) { alert('Ожидание ключа шифрования...'); return; }
  try {
    const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
    const msgObj = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msgObj));
    await saveMessageToHistory(activePeer, msgObj);
    getEl('message-input').value = '';
    loadMessages(activePeer);
  } catch (e) { console.error(e); alert('Не удалось зашифровать сообщение.'); }
}
async function sendImage(file) {
  if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') { alert('Нет соединения.'); return; }
  const remoteKey = contacts[activePeer]?.remoteKey;
  if (!remoteKey) { alert('Ожидание ключа шифрования...'); return; }
  try {
    const img = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const maxDim = 800;
    let { width, height } = img;
    if (width > maxDim || height > maxDim) { const r = Math.min(maxDim / width, maxDim / height); width *= r; height *= r; }
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.7));
    const encrypted = await CryptoSystem.encryptData(await blob.arrayBuffer(), remoteKey);
    const msgObj = { type: 'image', from: currentUser, ciphertext: encrypted, mimeType: 'image/jpeg', timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msgObj));
    await saveMessageToHistory(activePeer, msgObj);
    loadMessages(activePeer);
  } catch (e) { console.error(e); alert('Не удалось отправить изображение.'); }
}

// ── История ──
async function saveMessageToHistory(peerId, msg) {
  const key = `history_${[currentUser, peerId].sort().join('_')}`;
  let hist = masterPassword ? await CryptoSystem.loadEncryptedHistory(key, masterPassword) : JSON.parse(localStorage.getItem(key) || '[]');
  hist.push(msg);
  if (masterPassword) await CryptoSystem.saveEncryptedHistory(key, hist, masterPassword);
  else localStorage.setItem(key, JSON.stringify(hist));
}
async function loadMessageHistory(peerId) {
  const key = `history_${[currentUser, peerId].sort().join('_')}`;
  return masterPassword ? await CryptoSystem.loadEncryptedHistory(key, masterPassword) : JSON.parse(localStorage.getItem(key) || '[]');
}

// ── Верификация отпечатка ──
function sdpToWordsByFp(fp) {
  if (!fp) return 'Неизвестно';
  let seed = 0;
  for (let i = 0; i < fp.length; i++) { seed = ((seed << 5) - seed) + fp.charCodeAt(i); seed |= 0; }
  const words = []; const abs = Math.abs(seed);
  for (let i = 0; i < 3; i++) words.push(WORD_LIST[(abs + i * 7) % WORD_LIST.length]);
  return words.join(' · ');
}
async function verifyFingerprint(peerId, localFp, remoteFp) {
  if (verifiedFingerprints[peerId]) return true;
  const localWords = sdpToWordsByFp(localFp), remoteWords = sdpToWordsByFp(remoteFp);
  if (localWords === remoteWords) { verifiedFingerprints[peerId] = true; return true; }
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>🔐 Проверка отпечатка</h2></div>
      <div class="modal-body"><p>Сравните код с собеседником (устно):</p>
      <div class="fingerprint-verify"><div class="fp-words">${localWords}</div><p style="color:var(--text-secondary)">Код должен совпадать у обоих</p></div>
      <div class="fp-buttons"><button class="btn-primary" id="fp-confirm">✅ Совпадает</button><button class="btn-secondary" id="fp-deny">❌ Не совпадает</button></div></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('fp-confirm').onclick = () => {
      verifiedFingerprints[peerId] = true; modal.remove();
      if (dataChannel && dataChannel.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'fingerprint_ack' }));
      resolve(true);
    };
    document.getElementById('fp-deny').onclick = () => { modal.remove(); resolve(false); };
  });
}
async function saveContactsSecure() {
  if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
  else localStorage.setItem('contacts', JSON.stringify(contacts));
}
function updateOnlineStatus() {
  const ch = activePeer ? channels[activePeer] : null;
  const online = ch && ch.readyState === 'open';
  const el = getEl('online-status'); if (el) el.innerText = online ? '🟢 Онлайн' : '⚪ Отключен';
  const cs = getEl('chat-status'); if (cs && activePeer) cs.textContent = online ? 'онлайн' : 'офлайн';
  const rp = getEl('restore-panel');
  if (rp && activePeer && online) rp.classList.remove('visible');
}
