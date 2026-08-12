const SIGNALING_URL = 'https://stable.okeysexsex.workers.dev';

// ===================== ICE КОНФИГУРАЦИЯ (TURN + STUN) =====================
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // РАБОЧИЙ TURN из old.js
    {
      urls: 'turn:a.relay.metered.ca:80',
      username: 'Ok-KBsUxeX9YqPHO8ILweksA0uH5oIPxmxRvroC6YHDBI8d6',
      credential: 'Ok-KBsUxeX9YqPHO8ILweksA0uH5oIPxmxRvroC6YHDBI8d6'
    },
    {
      urls: 'turn:a.relay.metered.ca:443?transport=tcp',
      username: 'Ok-KBsUxeX9YqPHO8ILweksA0uH5oIPxmxRvroC6YHDBI8d6',
      credential: 'Ok-KBsUxeX9YqPHO8ILweksA0uH5oIPxmxRvroC6YHDBI8d6'
    }
  ],
  iceCandidatePoolSize: 10
};

// ===================== ГЛОБАЛЬНОЕ СОСТОЯНИЕ =====================
let currentUser = null;
let myName = 'Node_01';
let contacts = {};
let activePeer = null;
let masterPassword = null;

let peerConnection = null;
let dataChannel = null;
let pendingLocalKey = null;
let keySendInterval = null;
let session = null; // { roomId, phrase, display, role, aborted, timer }

// ===================== ЛОГИРОВАНИЕ =====================
const LOG = {
  webrtc:  (...a) => console.log('%c[WebRTC]%c',  'color:#38bdf8;font-weight:bold', 'color:inherit', ...a),
  signal:  (...a) => console.log('%c[Signal]%c',   'color:#fbbf24;font-weight:bold', 'color:inherit', ...a),
  channel: (...a) => console.log('%c[Channel]%c',  'color:#10b981;font-weight:bold', 'color:inherit', ...a),
  keys:    (...a) => console.log('%c[Keys]%c',     'color:#a78bfa;font-weight:bold', 'color:inherit', ...a),
  send:    (...a) => console.log('%c[Send]%c',     'color:#34d399;font-weight:bold', 'color:inherit', ...a),
  error:   (...a) => console.error('%c[ERROR]%c',  'color:#ef4444;font-weight:bold', 'color:inherit', ...a),
  warn:    (...a) => console.warn('%c[WARN]%c',    'color:#f59e0b;font-weight:bold', 'color:inherit', ...a),
};

// ===================== СЕКРЕТНЫЕ ФРАЗЫ =====================
const ADJ = [
  'быстрый','тихий','смелый','красный','синий','белый','чёрный','серый','ясный','тёплый',
  'холодный','летний','зимний','весенний','осенний','дикий','гордый','умный','добрый','строгий',
  'весёлый','ловкий','мудрый','верный','вольный','мягкий','твёрдый','лёгкий','тайный','светлый',
  'тёмный','золотой','серебряный','стальной','небесный','земной','полярный','восточный','западный','северный',
  'южный','дальний','близкий','новый','старый','молодой','вечный','утренний','вечерний','ночной',
  'дневной','сильный','спокойный','яркий','бледный','чистый','глубокий','высокий','ровный','острый',
  'круглый','тонкий','широкий','малый','великий','простой','редкий','громкий','бодрый','пепельный',
  'янтарный','зеркальный'
];
const NOUN = [
  'сокол','волк','медведь','лиса','барс','тигр','орлан','кит','дельфин','аист',
  'журавль','ворон','гагара','туман','ветер','дождь','снег','иней','роса','заря',
  'закат','рассвет','полночь','комета','метеор','орбита','кварц','гранит','кремний','кобальт',
  'никель','титан','атолл','фьорд','каньон','хребет','пик','обрыв','маяк','радар',
  'импульс','вектор','сигнал','канал','шифр','ключ','код','доступ','протокол','север',
  'восток','запад','юг','полюс','экватор','меридиан','лагуна','бухта','мыс','пролив',
  'волна','прибой','русло','исток','дельта','порог','каскад','массив','кристалл','горизонт',
  'зенит','азимут'
];

function generatePhrase() {
  const rnd = new Uint32Array(3);
  crypto.getRandomValues(rnd);
  const num = String(rnd[2] % 1000).padStart(3, '0');
  return `${ADJ[rnd[0] % ADJ.length]}-${NOUN[rnd[1] % NOUN.length]}-${num}`;
}

function normalizePhrase(raw) {
  return (raw || '').toLowerCase().replace(/[^a-zа-яё0-9]/g, '');
}

// ===================== СИГНАЛЬНЫЙ СЕРВЕР =====================
const Signal = {
  async getOffer(roomId) {
    try {
      const r = await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/offer`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      throw new Error('Сигнальный сервер недоступен: ' + e.message);
    }
  },
  async getAnswer(roomId) {
    try {
      const r = await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/answer`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  },
  async postOffer(roomId, sdp) {
    return fetch(`${SIGNALING_URL}/api/rooms/${roomId}/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp })
    });
  },
  async postAnswer(roomId, sdp) {
    return fetch(`${SIGNALING_URL}/api/rooms/${roomId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp })
    });
  },
  closeRoom(roomId) {
    fetch(`${SIGNALING_URL}/api/rooms/${roomId}/close`, { method: 'POST' }).catch(() => {});
  }
};

// ===================== ПОДКЛЮЧЕНИЕ ПО ФРАЗЕ =====================
async function connect(rawPhrase) {
  const clean = (rawPhrase || '').trim();
  const norm = normalizePhrase(clean);
  if (norm.length < 5) throw new Error('Фраза слишком короткая (мин. 5 символов)');

  const roomId = (await CryptoSystem.sha256(norm)).slice(0, 16);
  LOG.webrtc('connect()', { phrase: clean, roomId });

  cancelConnect(true);
  session = { roomId, phrase: norm, display: clean.toUpperCase().replace(/\s+/g, '-'), role: null, aborted: false, timer: null };

  if (typeof UI !== 'undefined' && UI.setConnectStage) UI.setConnectStage('checking');

  let existing = null;
  try {
    existing = await Signal.getOffer(roomId);
  } catch (e) {
    cancelConnect();
    throw e;
  }
  if (!session || session.aborted) return;

  if (existing && existing.sdp) {
    LOG.webrtc('Offer found → GUEST');
    await _joinAsGuest(roomId, existing);
  } else {
    LOG.webrtc('No offer → HOST');
    await _startAsHost(roomId);
  }
}

async function _startAsHost(roomId) {
  if (!session) return;
  session.role = 'host';

  // 1. Создаём PeerConnection ПЕРВЫМ
  _createPeerConnection(roomId, true);

  // 2. Генерируем ключ ПОСЛЕ
  pendingLocalKey = CryptoSystem.generateKey();
  LOG.keys('Host key:', pendingLocalKey.slice(0, 8) + '...');

  // 3. Сохраняем контакт
  await _upsertContact(roomId, session.display, 'host');

  // 4. Создаём offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await _waitForIce();
  
  if (!session || session.aborted) return;

  const res = await Signal.postOffer(roomId, peerConnection.localDescription.sdp);
  if (res.status === 409) {
    LOG.webrtc('409 conflict → switching to GUEST');
    _teardownPeer();
    const their = await Signal.getOffer(roomId);
    if (!their || !their.sdp) throw new Error('Не удалось подключиться');
    return _joinAsGuest(roomId, their);
  }

  if (typeof UI !== 'undefined' && UI.setConnectStage) UI.setConnectStage('waiting');
  LOG.webrtc('Host: waiting for answer...');

  // ИСПРАВЛЕНИЕ ОШИБКИ TIMER: проверяем session перед установкой
  if (session) {
    session.timer = setTimeout(() => _failConnect('Время ожидания истекло'), 5 * 60 * 1000);
  }

  const poll = async () => {
    if (!session || session.aborted) return;
    const ans = await Signal.getAnswer(roomId);
    if (ans && ans.sdp) {
      LOG.webrtc('Answer received!');
      try { await peerConnection.setRemoteDescription({ type: 'answer', sdp: ans.sdp }); }
      catch (e) { LOG.error('setRemoteDescription failed:', e); }
    } else {
      setTimeout(poll, 1500);
    }
  };
  poll();
}

async function _joinAsGuest(roomId, offerData) {
  if (!session) return;
  session.role = 'guest';
  if (typeof UI !== 'undefined' && UI.setConnectStage) UI.setConnectStage('linking');

  // 1. Создаём PeerConnection ПЕРВЫМ
  _createPeerConnection(roomId, false);

  // 2. Генерируем ключ ПОСЛЕ
  pendingLocalKey = CryptoSystem.generateKey();
  LOG.keys('Guest key:', pendingLocalKey.slice(0, 8) + '...');

  // 3. Сохраняем контакт
  await _upsertContact(roomId, session.display, 'guest');

  // 4. Устанавливаем offer
  LOG.webrtc('Setting remote offer');
  await peerConnection.setRemoteDescription({ type: 'offer', sdp: offerData.sdp });
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await _waitForIce();
  
  if (!session || session.aborted) return;

  await Signal.postAnswer(roomId, peerConnection.localDescription.sdp);
  LOG.webrtc('Guest: answer posted, waiting for handshake...');

  // ИСПРАВЛЕНИЕ ОШИБКИ TIMER
  if (session) {
    session.timer = setTimeout(() => _failConnect('Узел не отвечает'), 90 * 1000);
  }
}

function cancelConnect(silent) {
  if (session) {
    session.aborted = true;
    if (session.timer) clearTimeout(session.timer);
    if (session.role === 'host') Signal.closeRoom(session.roomId);
    session.timer = null; // Обнуляем таймер
  }
  session = null; // Обнуляем сессию
  _teardownPeer();
  if (!silent && typeof UI !== 'undefined' && UI.setConnectStage) UI.setConnectStage('idle');
}

function _failConnect(msg) {
  LOG.error('Connection failed:', msg);
  
  // ИСПРАВЛЕНИЕ: Проверяем существование session и timer
  if (session) {
    if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
    }
    session.aborted = true;
  }
  
  session = null;
  _teardownPeer();
  
  if (typeof UI !== 'undefined') {
    if (UI.setConnectStage) UI.setConnectStage('idle');
    if (UI.toast) UI.toast(msg, 'error');
  }
}

async function reconnect(peerId) {
  const c = contacts[peerId];
  if (!c || !c.phrase) {
    if (typeof UI !== 'undefined' && UI.toast) UI.toast('Фраза не сохранена', 'error');
    return;
  }
  if (typeof UI !== 'undefined' && UI.openNewSession) UI.openNewSession(c.phrase, true);
}

// ===================== WEBRTC / DATACHANNEL =====================
function _createPeerConnection(roomId, isHost) {
  _teardownPeer();

  peerConnection = new RTCPeerConnection(ICE_CONFIG);
  LOG.webrtc('RTCPeerConnection created', { roomId, isHost, servers: ICE_CONFIG.iceServers.length });

  peerConnection.oniceconnectionstatechange = () => {
    LOG.webrtc('ICE:', peerConnection.iceConnectionState);
    if (typeof UI !== 'undefined' && UI.updateStatus) UI.updateStatus();
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const st = peerConnection.connectionState;
    LOG.webrtc('State:', st);
    if (typeof UI !== 'undefined' && UI.updateStatus) UI.updateStatus();
    
    if (st === 'connected') _onConnected();
    
    // ИСПРАВЛЕНИЕ: Проверяем session перед вызовом failConnect
    if ((st === 'failed' || st === 'closed') && session && !session.aborted) {
      _failConnect('Соединение разорвано (' + st + ')');
    }
  };

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
        LOG.webrtc('ICE candidate:', e.candidate.type, e.candidate.protocol);
    }
  };

  if (isHost) {
    dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
    LOG.channel('DataChannel created (host)');
    _setupDataChannel(roomId);
  } else {
    peerConnection.ondatachannel = (e) => {
      dataChannel = e.channel;
      LOG.channel('DataChannel received (guest)');
      _setupDataChannel(roomId);
    };
  }
}

function _setupDataChannel(roomId) {
  if (!dataChannel) return;

  const sendKey = () => {
    if (dataChannel && dataChannel.readyState === 'open' && pendingLocalKey) {
      LOG.keys('⬆ Sending key:', pendingLocalKey.slice(0, 8) + '...');
      dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
    }
  };

  dataChannel.onopen = () => {
    LOG.channel('✅ DataChannel OPEN');
    sendKey();
    keySendInterval = setInterval(sendKey, 1000);
    activePeer = roomId;
    localStorage.setItem('activePeer', roomId);
    if (typeof UI !== 'undefined') {
      if (UI.updateStatus) UI.updateStatus();
      if (UI.renderContacts) UI.renderContacts();
    }
    const banner = document.getElementById('connection-banner');
    if (banner) banner.classList.add('hidden');
  };

  dataChannel.onclose = () => {
    LOG.channel('❌ DataChannel CLOSED');
    if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
    if (typeof UI !== 'undefined' && UI.updateStatus) UI.updateStatus();
    if (activePeer === roomId) {
      const banner = document.getElementById('connection-banner');
      if (banner) banner.classList.remove('hidden');
    }
  };

  dataChannel.onerror = (e) => LOG.error('DataChannel error:', e);

  dataChannel.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'key') {
        LOG.keys('⬇ Received remote key:', msg.key.slice(0, 8) + '...');
        if (!contacts[roomId]) {
          contacts[roomId] = { name: roomId.slice(0, 8), localKeys: [], remoteKeys: [] };
        }
        if (!contacts[roomId].remoteKeys) contacts[roomId].remoteKeys = [];
        if (!contacts[roomId].remoteKeys.includes(msg.key)) {
          contacts[roomId].remoteKeys.push(msg.key);
          LOG.keys('Remote key saved. Total:', contacts[roomId].remoteKeys.length);
        }
        await _saveContacts();
        if (activePeer === roomId && typeof UI !== 'undefined' && UI.loadMessages) UI.loadMessages(roomId);
        dataChannel.send(JSON.stringify({ type: 'key_ack' }));

      } else if (msg.type === 'key_ack') {
        LOG.keys('key_ack received — stopping broadcast');
        if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }

      } else if (msg.type === 'message' || msg.type === 'image') {
        await _saveMessage(roomId, msg);
        if (roomId === activePeer) {
          if (typeof UI !== 'undefined' && UI.loadMessages) UI.loadMessages(roomId);
        } else if (contacts[roomId]) {
          contacts[roomId].unread = (contacts[roomId].unread || 0) + 1;
          if (typeof UI !== 'undefined' && UI.renderContacts) UI.renderContacts();
        }
      }
    } catch (e) {
      LOG.error('onmessage error:', e);
    }
  };
}

function _onConnected() {
  if (!session) return;
  const roomId = session.roomId; // Берем ID из session, так как activePeer может быть еще null
  LOG.webrtc('✅ LINK ESTABLISHED', { roomId, role: session.role });
  
  if (session.timer) clearTimeout(session.timer);
  if (session.role === 'host') Signal.closeRoom(roomId);
  
  // Устанавливаем activePeer ДО вызова UI
  activePeer = roomId;
  localStorage.setItem('activePeer', roomId);
  
  session = null;
  if (typeof UI !== 'undefined' && UI.onConnected) UI.onConnected(roomId);
}

function _teardownPeer() {
  if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
  if (dataChannel) { try { dataChannel.close(); } catch {} dataChannel = null; }
  if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
  pendingLocalKey = null;
  if (typeof UI !== 'undefined' && UI.updateStatus) UI.updateStatus();
}

async function _waitForIce() {
  if (!peerConnection) return;
  if (peerConnection.iceGatheringState === 'complete') return;
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    peerConnection.addEventListener('icegatheringstatechange', () => {
      if (peerConnection.iceGatheringState === 'complete') finish();
    });
    setTimeout(finish, 15000); // 15 секунд для TURN
  });
}

// ===================== КОНТАКТЫ И ИСТОРИЯ =====================
async function _upsertContact(roomId, display, role) {
  const prev = contacts[roomId] || {};
  const oldLocal = prev.localKeys || (prev.localSessionKey ? [prev.localSessionKey] : []);
  const oldRemote = prev.remoteKeys || (prev.remoteKey ? [prev.remoteKey] : []);
  const newLocal = pendingLocalKey && !oldLocal.includes(pendingLocalKey) ? [...oldLocal, pendingLocalKey] : oldLocal;

  contacts[roomId] = {
    ...prev,
    name: prev.name || display,
    phrase: session ? session.phrase : prev.phrase,
    display: display,
    role: role,
    localKeys: newLocal,
    remoteKeys: oldRemote
  };

  const ordered = { [roomId]: contacts[roomId] };
  for (const [k, v] of Object.entries(contacts)) if (k !== roomId) ordered[k] = v;
  contacts = ordered;

  await _saveContacts();
}

async function _saveContacts() {
  if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
  else localStorage.setItem('contacts', JSON.stringify(contacts));
}

async function _saveMessage(peerId, msg) {
  const key = `history_${[currentUser, peerId].sort().join('_')}`;
  try {
    let history = masterPassword
      ? await CryptoSystem.loadEncryptedHistory(key, masterPassword)
      : JSON.parse(localStorage.getItem(key) || '[]');
    history.push(msg);
    if (masterPassword) await CryptoSystem.saveEncryptedHistory(key, history, masterPassword);
    else localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    LOG.error('saveMessage failed:', e);
  }
}

async function loadHistory(peerId) {
  const key = `history_${[currentUser, peerId].sort().join('_')}`;
  return masterPassword
    ? await CryptoSystem.loadEncryptedHistory(key, masterPassword)
    : JSON.parse(localStorage.getItem(key) || '[]');
}

// ===================== ОТПРАВКА СООБЩЕНИЙ =====================
async function sendMessage() {
  const input = document.getElementById('message-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (!activePeer) { if (typeof UI !== 'undefined' && UI.toast) UI.toast('Нет соединения', 'error'); return; }
  if (!dataChannel || dataChannel.readyState !== 'open') { if (typeof UI !== 'undefined' && UI.toast) UI.toast('Канал не открыт', 'error'); return; }

  const contact = contacts[activePeer];
  const keys = contact?.remoteKeys || [];
  if (keys.length === 0) {
    if (typeof UI !== 'undefined' && UI.toast) UI.toast('Ожидание обмена ключами...', 'error');
    return;
  }
  const remoteKey = keys[keys.length - 1];

  try {
    const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
    const msg = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msg));
    await _saveMessage(activePeer, msg);
    input.value = '';
    input.style.height = 'auto';
    if (typeof UI !== 'undefined') {
      if (UI.loadMessages) UI.loadMessages(activePeer);
      if (UI.toggleSendBtn) UI.toggleSendBtn();
    }
    LOG.send('✅ Message sent');
  } catch (e) {
    LOG.error('sendMessage failed:', e);
    if (typeof UI !== 'undefined' && UI.toast) UI.toast('Ошибка отправки', 'error');
  }
}

async function sendImage(file) {
  if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') return;
  const keys = contacts[activePeer]?.remoteKeys || [];
  const remoteKey = keys[keys.length - 1];
  if (!remoteKey) return;

  try {
    // Используем встроенное сжатие если есть, иначе отправляем как есть
    let blob = file;
    let type = file.type;
    
    if (typeof CryptoSystem.compressImage === 'function') {
        const compressed = await CryptoSystem.compressImage(file, 800);
        blob = compressed.blob;
        type = compressed.type;
    }

    const buffer = await blob.arrayBuffer();
    const ciphertext = await CryptoSystem.encryptData(buffer, remoteKey);
    const msg = { type: 'image', from: currentUser, ciphertext, mimeType: type, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msg));
    await _saveMessage(activePeer, msg);
    if (typeof UI !== 'undefined' && UI.loadMessages) UI.loadMessages(activePeer);
    LOG.send('✅ Image sent');
  } catch (e) {
    LOG.error('sendImage failed:', e);
    if (typeof UI !== 'undefined' && UI.toast) UI.toast('Ошибка отправки изображения', 'error');
  }
}

// ===================== ЭКСПОРТ =====================
window.WebRTC = {
  connect,
  cancelConnect,
  reconnect,
  generatePhrase,
  sendMessage,
  sendImage,
  loadHistory,
  saveContacts: _saveContacts,
  getState: () => ({
    contacts, activePeer, currentUser, masterPassword,
    dataChannel, peerConnection, session
  })
};

console.log('%c[DEBUG] /0byte/ ready. WebRTC.connect("фраза")', 'color:#38bdf8;font-weight:bold');
