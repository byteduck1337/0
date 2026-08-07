// webrtc.js — Signaling через Cloudflare Worker + чистый WebRTC.
// Трафик P2P, signaling только для handshake.

const WORD_LIST = [
'Альфа','Браво','Чарли','Дельта','Эхо','Фокстрот','Гольф','Отель',
'Индия','Джульет','Кило','Лима','Майк','Ноябрь','Оскар','Папа',
'Квебек','Ромео','Сьерра','Танго','Юниформ','Виктор','Виски','Рентген',
'Янки','Зулу','Красный','Синий','Зелёный','Жёлтый','Оранжевый','Пурпурный',
'Серебряный','Золотой','Кристальный','Алмазный','Рубиновый','Изумрудный','Сапфировый',
'Нефритовый','Ониксовый','Янтарный','Коралловый','Лазурный','Фиолетовый','Малиновый','Индиго',
'Бирюзовый','Магентовый','Оливковый','Бордовый'
];

// ── Глобальное состояние ──
let currentUser, myName = 'Вы', myAvatar = '';
let contacts = {};
let activePeer = null;
let peerConnection = null;
let dataChannel = null;
let pendingLocalKey = null;
let keySendInterval = null;
let connectedPeerId = null;
let masterPassword = null;
let verifiedFingerprints = {};
let pendingRemoteFp = null;
let pollingAbort = null;

// ── Signaling URL (из настроек или дефолт) ──
function signalingUrl() {
  return localStorage.getItem('signalingUrl') || 'https://0byte-signaling.YOUR-NAME.workers.dev';
}

// ── Код-комнаты ──
const randInt = n => Math.floor(Math.random() * n);
function generateRoomCode() {
  return {
    w1: WORD_LIST[randInt(WORD_LIST.length)],
    w2: WORD_LIST[randInt(WORD_LIST.length)],
    num: 10 + randInt(90)
  };
}
const roomCodeString = c => `${c.w1} ${c.w2} ${c.num}`;
function parseRoomCode(text) {
  const s = String(text || '').toLowerCase();
  const numMatch = s.match(/\d+/);
  if (!numMatch) return null;
  const num = parseInt(numMatch[0], 10);
  const lower = WORD_LIST.map(w => w.toLowerCase());
  const words = [...s.matchAll(/[a-zа-яё]+/gi)].map(m => m[0].toLowerCase());
  const found = words.map(w => lower.indexOf(w)).filter(i => i >= 0).slice(0, 2);
  if (found.length < 2) return null;
  return { w1: WORD_LIST[found[0]], w2: WORD_LIST[found[1]], num };
}

// ── ICE конфиг (STUN + бесплатный TURN OpenRelay) ──
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// ── HTTP к signaling worker ──
async function signalingRequest(path, opts = {}) {
  const url = signalingUrl() + path;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Signaling error');
  }
  return res.json();
}

// ── Проверка доступности Worker ──
async function checkSignaling() {
  try {
    const r = await signalingRequest('/api/ping');
    setStatusOk(r.rooms ?? 0);
    return true;
  } catch (e) {
    setStatusError(e.message);
    return false;
  }
}
function setStatusOk(roomsCount = '') {
  const el = getEl('signaling-status');
  const host = new URL(signalingUrl()).host;
  if (el) el.innerHTML = `<span style="color:var(--success,#22c55e)">●</span> Signaling: ${host}` + (roomsCount ? ` (${roomsCount} комн.)` : '');
}
function setStatusError(msg) {
  const el = getEl('signaling-status');
  if (el) el.innerHTML = `<span style="color:#ef4444">●</span> Signaling: ошибка${msg ? ' — ' + msg : ''}`;
}

// ── Polling answer (для хоста) ──
function startAnswerPolling(code, onAnswer) {
  if (pollingAbort) pollingAbort.abort = true;
  pollingAbort = { abort: false };
  const ctrl = pollingAbort;
  const poll = async () => {
    while (!ctrl.abort) {
      try {
        const r = await signalingRequest('/api/answer?code=' + encodeURIComponent(JSON.stringify(code)));
        if (r.answer) { onAnswer(r.answer); return; }
      } catch (e) { console.warn('polling error:', e); }
      await new Promise(r => setTimeout(r, 1500));
    }
  };
  poll();
}
function stopPolling() { if (pollingAbort) pollingAbort.abort = true; }

// ── Ожидание завершения ICE gathering ──
function waitForIceGathering(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { pc.removeEventListener('icegatheringstatechange', done); resolve(); };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(resolve, 4000);
  });
}

// ── ХОСТ: создать комнату ──
async function hostCreateRoom(onCode) {
  if (!await checkSignaling()) throw 'Signaling-сервер недоступен. Проверьте URL в настройках.';
  const code = generateRoomCode();
  pendingLocalKey = CryptoSystem.generateKey();

  // Создаём PeerConnection и offer
  if (peerConnection) { try { peerConnection.close(); } catch(e){} }
  peerConnection = new RTCPeerConnection(ICE_CONFIG);
  dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
  setupDataChannelEvents();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGathering(peerConnection);
  const finalOffer = peerConnection.localDescription;

  // Верификация отпечатка (сохраняем local fp)
  pendingRemoteFp = CryptoSystem.extractFingerprint(finalOffer.sdp);

  // Отправляем offer в Worker
  await signalingRequest('/api/room', { method: 'POST', body: { code, offer: finalOffer } });

  onCode(roomCodeString(code));

  // Ожидаем answer через polling
  startAnswerPolling(code, async (answer) => {
    try {
      // Верификация отпечатка гостя
      const remoteFp = CryptoSystem.extractFingerprint(answer.sdp);
      const localFp = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp);
      const ok = await verifyFingerprint('host-peer', localFp, remoteFp);
      if (!ok) { alert('Отпечатки не совпадают! Возможна MITM-атака.'); return; }

      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

      // Сохраняем контакт (id = room code)
      const peerId = roomCodeString(code);
      connectedPeerId = peerId;
      if (!contacts[peerId]) contacts[peerId] = { name: peerId, avatar: '', role: 'host', room: code };
      contacts[peerId].localSessionKey = pendingLocalKey;
      contacts[peerId].room = code;
      await saveContactsSecure();

      // Открываем чат
      activePeer = peerId;
      localStorage.setItem('activePeer', peerId);
      updateUIForPeer(peerId);
      renderContactList();
      const m = getEl('new-chat-modal'); if (m) m.classList.add('hidden');
    } catch (e) { console.error(e); alert('Ошибка соединения: ' + e.message); }
  });
}

// ── ГОСТЬ: подключиться по коду ──
async function guestJoin(codeText) {
  if (!await checkSignaling()) throw 'Signaling-сервер недоступен.';
  const code = parseRoomCode(codeText);
  if (!code) throw 'Не распознал код. Пример: «Янтарный Тигр 42»';

  // Получаем offer
  const { offer } = await signalingRequest('/api/room?code=' + encodeURIComponent(JSON.stringify(code)));
  if (!offer) throw 'Комната не найдена или истекла.';

  pendingLocalKey = CryptoSystem.generateKey();
  if (peerConnection) { try { peerConnection.close(); } catch(e){} }
  peerConnection = new RTCPeerConnection(ICE_CONFIG);

  peerConnection.ondatachannel = (e) => {
    dataChannel = e.channel;
    setupDataChannelEvents();
  };
  peerConnection.oniceconnectionstatechange = updateOnlineStatus;
  peerConnection.onconnectionstatechange = () => updateOnlineStatus();

  const remoteFp = CryptoSystem.extractFingerprint(offer.sdp);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await waitForIceGathering(peerConnection);
  const finalAnswer = peerConnection.localDescription;

  // Верификация отпечатка
  const localFp = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp);
  const ok = await verifyFingerprint('guest-peer', localFp, remoteFp);
  if (!ok) { alert('Отпечатки не совпадают! Возможна MITM-атака.'); throw 'Отменено'; }

  // Отправляем answer
  await signalingRequest('/api/answer', { method: 'POST', body: { code, answer: finalAnswer } });

  const peerId = roomCodeString(code);
  connectedPeerId = peerId;
  if (!contacts[peerId]) contacts[peerId] = { name: peerId, avatar: '', role: 'guest', room: code };
  contacts[peerId].localSessionKey = pendingLocalKey;
  contacts[peerId].room = code;
  await saveContactsSecure();

  activePeer = peerId;
  localStorage.setItem('activePeer', peerId);
  updateUIForPeer(peerId);
  renderContactList();
  const m = getEl('new-chat-modal'); if (m) m.classList.add('hidden');
}

// ── Переподключение сохранённого чата ──
async function reconnect(peerId) {
  const c = contacts[peerId];
  if (!c || !c.room) return false;
  if (dataChannel && dataChannel.readyState === 'open') return true;

  // Для простоты — генерируем новую комнату при каждом переподключении
  // (в production можно сохранять и переиспользовать код)
  if (c.role === 'host') {
    await hostCreateRoom(codeStr => {
      console.log('Реподключение: новый код', codeStr);
      const rp = getEl('restore-panel'); if (rp) rp.classList.add('visible');
    });
  } else {
    // Гостю нужно, чтобы хост снова создал комнату
    const rp = getEl('restore-panel'); if (rp) rp.classList.add('visible');
  }
  return true;
}

function openChat(peerId) {
  if (!contacts[peerId]) { contacts[peerId] = { name: peerId.slice(0,8), avatar: '' }; saveContactsSecure(); renderContactList(); }
  activePeer = peerId;
  localStorage.setItem('activePeer', peerId);
  updateUIForPeer(peerId);
  if (dataChannel && dataChannel.readyState === 'open') return;
  reconnect(peerId);
}
function restoreChat() {
  if (!activePeer) return;
  if (dataChannel) { try { dataChannel.close(); } catch(e){} dataChannel = null; }
  if (peerConnection) { try { peerConnection.close(); } catch(e){} peerConnection = null; }
  reconnect(activePeer);
}

// ── Data channel события ──
function setupDataChannelEvents() {
  if (!dataChannel) return;
  dataChannel.onopen = async () => {
    console.log('Канал открыт');
    if (pendingLocalKey) {
      const sendKey = () => { if (dataChannel && dataChannel.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey })); };
      sendKey();
      if (keySendInterval) clearInterval(keySendInterval);
      keySendInterval = setInterval(sendKey, 400);
    }
    dataChannel.send(JSON.stringify({ type: 'hello', name: myName, avatar: myAvatar }));
    updateOnlineStatus();
    const rp = getEl('restore-panel'); if (rp) rp.classList.remove('visible');
  };
  dataChannel.onclose = () => {
    console.log('Канал закрыт');
    updateOnlineStatus();
    if (activePeer) {
      const rp = getEl('restore-panel'); if (rp) rp.classList.add('visible');
    }
  };
  dataChannel.onerror = (e) => console.error('DC error:', e);
  dataChannel.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      const pid = activePeer || connectedPeerId;
      if (!pid || !contacts[pid]) return;
      if (data.type === 'key') {
        contacts[pid].remoteKey = data.key;
        await saveContactsSecure();
        if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
        loadMessages(pid);
        updateKeyDisplay();
      } else if (data.type === 'hello') {
        contacts[pid].name = data.name || contacts[pid].name;
        contacts[pid].avatar = data.avatar || contacts[pid].avatar;
        await saveContactsSecure();
        renderContactList();
        if (activePeer === pid) updateUIForPeer(pid);
      } else if (data.type === 'message' || data.type === 'image') {
        await saveMessageToHistory(pid, data);
        if (pid === activePeer) loadMessages(pid);
      }
    } catch (e) { console.error('msg error:', e); }
  };
}

// ── Отправка ──
async function sendMessage() {
  const text = getEl('message-input')?.value.trim();
  if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') { alert('Нет соединения.'); return; }
  const rk = contacts[activePeer]?.remoteKey;
  if (!rk) { alert('Ожидание ключа...'); return; }
  const ciphertext = await CryptoSystem.encrypt(text, rk);
  const msgObj = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
  dataChannel.send(JSON.stringify(msgObj));
  await saveMessageToHistory(activePeer, msgObj);
  getEl('message-input').value = '';
  loadMessages(activePeer);
}
async function sendImage(file) {
  if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') { alert('Нет соединения.'); return; }
  const rk = contacts[activePeer]?.remoteKey;
  if (!rk) { alert('Ожидание ключа...'); return; }
  try {
    const img = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const maxDim = 800;
    let { width, height } = img;
    if (width > maxDim || height > maxDim) { const r = Math.min(maxDim/width, maxDim/height); width*=r; height*=r; }
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.7));
    const encrypted = await CryptoSystem.encryptData(await blob.arrayBuffer(), rk);
    const msgObj = { type: 'image', from: currentUser, ciphertext: encrypted, mimeType: 'image/jpeg', timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msgObj));
    await saveMessageToHistory(activePeer, msgObj);
    loadMessages(activePeer);
  } catch (e) { console.error(e); alert('Ошибка отправки изображения.'); }
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
      <div class="modal-body"><p>Сравните код с собеседником устно:</p>
      <div class="fingerprint-verify"><div class="fp-words">${localWords}</div>
      <p style="color:var(--text-secondary)">Код должен совпадать у обоих</p></div>
      <div class="fp-buttons">
        <button class="btn-primary" id="fp-confirm">✅ Совпадает</button>
        <button class="btn-secondary" id="fp-deny">❌ Не совпадает</button></div></div></div>`;
    document.body.appendChild(modal);
    document.getElementById('fp-confirm').onclick = () => {
      verifiedFingerprints[peerId] = true; modal.remove();
      try { if (dataChannel && dataChannel.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'fingerprint_ack' })); } catch(e){}
      resolve(true);
    };
    document.getElementById('fp-deny').onclick = () => { modal.remove(); resolve(false); };
  });
}

// ── Вспомогательное ──
async function saveContactsSecure() {
  if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
  else localStorage.setItem('contacts', JSON.stringify(contacts));
}
function updateOnlineStatus() {
  const online = dataChannel && dataChannel.readyState === 'open';
  const el = getEl('online-status'); if (el) el.innerText = online ? '🟢 Онлайн' : '⚪ Отключен';
  const cs = getEl('chat-status'); if (cs && activePeer) cs.textContent = online ? 'онлайн' : 'офлайн';
  if (online) { const rp = getEl('restore-panel'); if (rp) rp.classList.remove('visible'); }
}

// ── Публичные функции для UI ──
async function startHostFlow() {
  showSection('host-flow');
  const codeEl = getEl('host-room-code');
  const wait = getEl('host-waiting');
  if (codeEl) codeEl.textContent = 'Создание комнаты...';
  if (wait) wait.classList.add('hidden');
  try {
    await hostCreateRoom(words => {
      if (codeEl) codeEl.textContent = words;
      copyToClipboard(words);
      if (wait) wait.classList.remove('hidden');
    });
  } catch (e) {
    alert(e.message || 'Ошибка создания комнаты');
    resetToRoleSelect();
  }
}
function startJoinFlow() {
  showSection('join-flow');
  const i = getEl('join-code-input'); if (i) { i.value = ''; setTimeout(() => i.focus(), 100); }
  const e = getEl('join-error'); if (e) e.textContent = '';
}
async function joinByCode() {
  const input = getEl('join-code-input');
  const err = getEl('join-error');
  const btn = getEl('join-connect-btn');
  const wait = getEl('join-waiting');
  if (err) err.textContent = '';
  if (btn) btn.disabled = true;
  if (wait) wait.classList.remove('hidden');
  try { await guestJoin(input.value.trim()); }
  catch (msg) { if (err) err.textContent = msg; if (wait) wait.classList.add('hidden'); if (btn) btn.disabled = false; }
}
function copyHostCode() { const el = getEl('host-room-code'); if (el) copyToClipboard(el.textContent); }
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  });
}
