const SIGNALING_URL = 'https://stable.okeysexsex.workers.dev';

let currentUser, myName = 'Node_01', myAvatar = '';
let contacts = {}, activePeer = null, masterPassword = null;
let peerConnection = null, dataChannel = null, pendingLocalKey = null;
let keySendInterval = null, session = null;

/* ======================================================================
   ЦВЕТНОЕ ЛОГИРОВАНИЕ
   ====================================================================== */
const LOG = {
  webrtc:  (...a) => console.log('%c[WebRTC]%c',   'color:#38bdf8;font-weight:bold', 'color:inherit', ...a),
  signal:  (...a) => console.log('%c[Signal]%c',   'color:#fbbf24;font-weight:bold', 'color:inherit', ...a),
  channel: (...a) => console.log('%c[Channel]%c',  'color:#10b981;font-weight:bold', 'color:inherit', ...a),
  keys:    (...a) => console.log('%c[Keys]%c',     'color:#a78bfa;font-weight:bold', 'color:inherit', ...a),
  crypto:  (...a) => console.log('%c[Crypto]%c',   'color:#f472b6;font-weight:bold', 'color:inherit', ...a),
  send:    (...a) => console.log('%c[Send]%c',     'color:#34d399;font-weight:bold', 'color:inherit', ...a),
  history: (...a) => console.log('%c[History]%c',  'color:#60a5fa;font-weight:bold', 'color:inherit', ...a),
  error:   (...a) => console.error('%c[ERROR]%c',  'color:#ef4444;font-weight:bold', 'color:inherit', ...a),
  warn:    (...a) => console.warn('%c[WARN]%c',    'color:#f59e0b;font-weight:bold', 'color:inherit', ...a),
};

/* ======================================================================
   СЕКРЕТНЫЕ ФРАЗЫ
   ====================================================================== */
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

/* ======================================================================
   СИГНАЛЬНЫЙ СЕРВЕР
   ====================================================================== */
const Signal = {
  async getOffer(id) {
    LOG.signal('GET /offer', { roomId: id });
    try {
      const r = await fetch(`${SIGNALING_URL}/api/rooms/${id}/offer`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      LOG.signal('← offer', r.status);
      return r.ok ? await r.json() : null;
    } catch (e) {
      LOG.error('getOffer FAILED:', e.name, e.message);
      throw new Error(`Сигнальный сервер недоступен (${e.name}). Проверьте интернет.`);
    }
  },

  async getAnswer(id) {
    try {
      const r = await fetch(`${SIGNALING_URL}/api/rooms/${id}/answer`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      return r.ok ? await r.json() : null;
    } catch (e) {
      LOG.warn('getAnswer failed:', e.message);
      return null;
    }
  },

  async postOffer(id, sdp) {
    LOG.signal('POST /offer', { roomId: id, sdpLen: sdp.length });
    const r = await fetch(`${SIGNALING_URL}/api/rooms/${id}/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp }),
      signal: AbortSignal.timeout(8000),
    });
    LOG.signal('← offer result', r.status);
    return r;
  },

  async postAnswer(id, sdp) {
    LOG.signal('POST /answer', { roomId: id, sdpLen: sdp.length });
    const r = await fetch(`${SIGNALING_URL}/api/rooms/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp }),
      signal: AbortSignal.timeout(8000),
    });
    LOG.signal('← answer result', r.status);
    return r;
  },

  closeRoom(id) {
    LOG.signal('CLOSE room', id);
    fetch(`${SIGNALING_URL}/api/rooms/${id}/close`, { method: 'POST' }).catch(() => {});
  },
};

/* ======================================================================
   УПРАВЛЕНИЕ СОЕДИНЕНИЕМ
   ====================================================================== */
async function connect(rawPhrase) {
  const clean = (rawPhrase || '').trim();
  const norm = normalizePhrase(clean);
  LOG.webrtc('connect() phrase:', { raw: clean, normalized: norm });
  if (norm.length < 5) throw new Error('Фраза слишком короткая — минимум 5 символов');

  const roomId = (await CryptoSystem.sha256(norm)).slice(0, 16);
  LOG.webrtc('roomId:', roomId);
  cancelConnect(true);

  session = {
    roomId,
    phrase: norm,
    display: clean.toUpperCase().replace(/\s+/g, '-'),
    role: null,
    aborted: false,
    timer: null,
  };

  UI.setConnectStage('checking');

  // Проверяем доступность сервера и получаем offer с обработкой ошибок
  let existing = null;
  try {
    existing = await Signal.getOffer(roomId);
  } catch (e) {
    LOG.error('connect() getOffer error:', e);
    failConnect(e.message);
    return;
  }
  if (session.aborted) return;

  if (existing) {
    LOG.webrtc('Existing offer found → joining as GUEST');
    await joinAsGuest(session, existing);
  } else {
    LOG.webrtc('No offer → trying as HOST');
    await tryHost(session);
  }
}

async function tryHost(s) {
  s.role = 'host';

  // ВАЖНО: сначала создаём канал (teardownPeer обнулит старое), потом генерируем ключ
  setupPeerConnection(s.roomId, true/false);  
pendingLocalKey = CryptoSystem.generateKey();  
LOG.keys('Host/Guest: generated local key', pendingLocalKey.slice(0, 8) + '...');

  // Создаём контакт ДО отправки offer, чтобы onmessage мог сохранить remoteKey
  await upsertContact(s);

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIce();
  if (s.aborted) return;

  const res = await Signal.postOffer(s.roomId, peerConnection.localDescription.sdp);

  if (res.status === 409) {
    const body = await res.json().catch(() => ({}));
    teardownPeer();
    if (body.error === 'session_active') {
      throw new Error('Фраза занята завершённой сессией. Попробуйте другую фразу.');
    }
    LOG.webrtc('Conflict 409 → falling back to GUEST');
    const theirOffer = await Signal.getOffer(s.roomId);
    if (!theirOffer) throw new Error('Не удалось подключиться. Попробуйте ещё раз.');
    return joinAsGuest(s, theirOffer);
  }

  UI.setConnectStage('waiting');
  LOG.webrtc('Host: waiting for answer...');

  s.timer = setTimeout(() => failConnect('Время ожидания истекло'), 5 * 60 * 1000);

  const poll = async () => {
    if (s.aborted || session !== s) return;
    const ans = await Signal.getAnswer(s.roomId);
    if (ans && ans.sdp) {
      LOG.webrtc('Answer received, setting remote description');
      try {
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
      } catch (e) { LOG.error('setRemoteDescription(answer) failed:', e); }
    } else {
      setTimeout(poll, 1500);
    }
  };
  poll();
}

async function joinAsGuest(s, offerData) {
  s.role = 'guest';
  UI.setConnectStage('linking');

  // ВАЖНО: сначала создаём канал (teardownPeer обнулит старое), потом генерируем ключ
  setupPeerConnection(s.roomId, false);
  pendingLocalKey = CryptoSystem.generateKey();
  LOG.keys('Guest: generated local key', pendingLocalKey.slice(0, 8) + '...');

  // Создаём контакт ДО установки remote description, чтобы onmessage мог сохранить remoteKey
  await upsertContact(s);

  LOG.webrtc('Setting remote offer');
  await peerConnection.setRemoteDescription({ type: 'offer', sdp: offerData.sdp });
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await waitForIce();
  if (s.aborted) return;

  await Signal.postAnswer(s.roomId, peerConnection.localDescription.sdp);
  LOG.webrtc('Guest: answer posted, waiting for WebRTC handshake');

  s.timer = setTimeout(() => failConnect('Узел не отвечает'), 90 * 1000);
}

function cancelConnect(silent = false) {
  if (session) {
    LOG.webrtc('cancelConnect()', { role: session.role, roomId: session.roomId });
    session.aborted = true;
    if (session.timer) clearTimeout(session.timer);
    if (session.role === 'host') Signal.closeRoom(session.roomId);
  }
  session = null;
  teardownPeer();
  if (!silent) UI.setConnectStage('idle');
}

function failConnect(message) {
  LOG.error('Connection failed:', message);
  if (session) {
    session.aborted = true;
    if (session.timer) clearTimeout(session.timer);
  }
  session = null;
  teardownPeer();
  UI.setConnectStage('idle');
  UI.toast(message, 'error');
}

function teardownPeer() {
  LOG.webrtc('teardownPeer()');
  if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
  if (dataChannel) { try { dataChannel.close(); } catch (e) {} dataChannel = null; }
  if (peerConnection) { try { peerConnection.close(); } catch (e) {} peerConnection = null; }
  pendingLocalKey = null;
  UI.updateStatus();
}

function onLinkEstablished() {
  if (!session) return;
  const s = session;
  LOG.webrtc('✅ LINK ESTABLISHED', { roomId: s.roomId, role: s.role });
  if (s.timer) clearTimeout(s.timer);
  if (s.role === 'host') Signal.closeRoom(s.roomId);
  session = null;
  UI.onConnected(s.roomId);
}

async function reconnect(peerId) {
  const c = contacts[peerId];
  if (!c || !c.phrase) {
    UI.toast('Секретная фраза для этого чата не сохранена', 'error');
    return;
  }
  LOG.webrtc('reconnect() with phrase:', c.phrase);
  UI.openNewSession(c.phrase, true);
}

/* ======================================================================
   WEBRTC / DATACHANNEL
   ====================================================================== */
function setupPeerConnection(roomId, isHost) {
  teardownPeer();

  const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
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
  iceCandidatePoolSize: 10,
};

  peerConnection = new RTCPeerConnection(config);
  LOG.webrtc('RTCPeerConnection created', { roomId, isHost, iceServers: config.iceServers.length });

  peerConnection.oniceconnectionstatechange = () => {
    LOG.webrtc('ICE state:', peerConnection.iceConnectionState);
    UI.updateStatus();
  };

  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    const st = peerConnection.connectionState;
    LOG.webrtc('Connection state:', st);
    UI.updateStatus();
    if (st === 'connected') onLinkEstablished();
    if ((st === 'failed' || st === 'closed') && session && !session.aborted) {
      failConnect('Не удалось установить соединение (state=' + st + ')');
    }
  };

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) {
      LOG.webrtc('ICE candidate:', e.candidate.type, e.candidate.protocol, e.candidate.address);
    }
  };

  if (isHost) {
    dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
    LOG.channel('DataChannel created by HOST');
    setupDataChannel(roomId);
  } else {
    peerConnection.ondatachannel = (e) => {
      dataChannel = e.channel;
      LOG.channel('DataChannel received by GUEST');
      setupDataChannel(roomId);
    };
  }
}

function setupDataChannel(roomId) {
  if (!dataChannel) return;
  LOG.channel('setupDataChannel for roomId:', roomId);

  const sendKey = () => {
    LOG.keys('sendKey() check', {
      readyState: dataChannel?.readyState,
      hasKey: !!pendingLocalKey,
    });
    if (dataChannel && dataChannel.readyState === 'open' && pendingLocalKey) {
      LOG.keys('⬆ sending local key to peer', pendingLocalKey.slice(0, 8) + '...');
      dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
    } else {
      LOG.warn('sendKey() skipped:', {
        channelOpen: dataChannel?.readyState === 'open',
        hasKey: !!pendingLocalKey,
      });
    }
  };

  dataChannel.onopen = () => {
    LOG.channel('✅ DataChannel OPEN');
    sendKey();
    keySendInterval = setInterval(sendKey, 1000);
    activePeer = roomId;
    localStorage.setItem('activePeer', roomId);
    UI.updateStatus();
    UI.renderContacts();
    const banner = document.getElementById('connection-banner');
    if (banner) banner.classList.add('hidden');
  };

  dataChannel.onclose = () => {
    LOG.channel('❌ DataChannel CLOSED');
    if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
    UI.updateStatus();
    if (activePeer === roomId) {
      const banner = document.getElementById('connection-banner');
      if (banner) banner.classList.remove('hidden');
    }
  };

  dataChannel.onerror = (e) => {
    LOG.error('DataChannel error:', e);
  };

  dataChannel.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      LOG.channel('⬇ incoming message, type:', msg.type);

      if (msg.type === 'key') {
        LOG.keys('Received REMOTE key:', msg.key.slice(0, 8) + '...');
        const c = contacts[roomId];
        if (c) {
          if (!c.remoteKeys) c.remoteKeys = [];
          if (!c.remoteKeys.includes(msg.key)) {
            c.remoteKeys.push(msg.key);
            LOG.keys('New remote key added. Total keys:', c.remoteKeys.length);
          } else {
            LOG.keys('Remote key already known (duplicate)');
          }
          await saveContacts();
          if (activePeer === roomId) UI.loadMessages(roomId);
          LOG.keys('⬆ sending key_ack');
          dataChannel.send(JSON.stringify({ type: 'key_ack' }));
        } else {
          LOG.warn('Contact not found for roomId:', roomId, '— creating emergency contact');
          // Экстренное создание контакта, если он по какой-то причине отсутствует
          contacts[roomId] = {
            name: roomId.slice(0, 8),
            phrase: '',
            display: roomId.slice(0, 8).toUpperCase(),
            role: 'unknown',
            localKeys: [],
            remoteKeys: [msg.key],
          };
          await saveContacts();
          if (activePeer === roomId) UI.loadMessages(roomId);
          dataChannel.send(JSON.stringify({ type: 'key_ack' }));
        }
      } else if (msg.type === 'key_ack') {
        LOG.keys('Received key_ack — stopping key broadcast');
        if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
      } else if (msg.type === 'message' || msg.type === 'image') {
        LOG.channel('Incoming ' + msg.type + ', ciphertext length:', msg.ciphertext?.length);
        await saveMessage(roomId, msg);
        if (roomId === activePeer) {
          UI.loadMessages(roomId);
        } else if (contacts[roomId]) {
          contacts[roomId].unread = (contacts[roomId].unread || 0) + 1;
          UI.renderContacts();
        }
      }
    } catch (e) {
      LOG.error('onmessage parse error:', e, 'raw:', event.data.slice(0, 200));
    }
  };
}

async function waitForIce() {
  LOG.webrtc('waitForIce() start');
  if (!peerConnection) return;
  if (peerConnection.iceGatheringState === 'complete') {
    LOG.webrtc('waitForIce() already complete');
    return;
  }
  return new Promise(resolve => {
    const timeout = 10000;
    let resolved = false;
    const doResolve = (reason) => {
      if (resolved) return;
      resolved = true;
      LOG.webrtc(`waitForIce() done (${reason})`);
      peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
      clearTimeout(timer);
      resolve();
    };
    const onStateChange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        doResolve('gathering complete');
      }
    };
    peerConnection.addEventListener('icegatheringstatechange', onStateChange);
    const timer = setTimeout(() => {
      LOG.warn(`waitForIce() timeout after ${timeout / 1000}s`);
      doResolve('timeout');
    }, timeout);
  });
}

/* ======================================================================
   КОНТАКТЫ И ИСТОРИЯ
   ====================================================================== */
async function upsertContact(s) {
  const prev = contacts[s.roomId] || {};
  const oldLocalKeys = prev.localKeys || (prev.localSessionKey ? [prev.localSessionKey] : []);
  const oldRemoteKeys = prev.remoteKeys || (prev.remoteKey ? [prev.remoteKey] : []);
  const newLocalKeys = pendingLocalKey && !oldLocalKeys.includes(pendingLocalKey)
    ? [...oldLocalKeys, pendingLocalKey]
    : oldLocalKeys;

  const updated = {
    ...prev,
    name: prev.name || s.display,
    phrase: s.phrase,
    display: s.display,
    role: s.role,
    localKeys: newLocalKeys,
    remoteKeys: oldRemoteKeys,
  };

  const ordered = { [s.roomId]: updated };
  for (const [k, v] of Object.entries(contacts)) if (k !== s.roomId) ordered[k] = v;
  contacts = ordered;
  LOG.history('Contact upserted:', {
    roomId: s.roomId,
    localKeys: updated.localKeys.length,
    remoteKeys: updated.remoteKeys.length,
  });
  await saveContacts();
}

/* ======================================================================
   ОТПРАВКА СООБЩЕНИЙ
   ====================================================================== */
async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();

  LOG.send('sendMessage() called', { textLen: text.length, activePeer, hasChannel: !!dataChannel });

  if (!text) {
    LOG.warn('sendMessage() rejected: empty text');
    return;
  }
  if (!activePeer) {
    LOG.error('sendMessage() rejected: no activePeer');
    UI.toast('Нет активного соединения', 'error');
    return;
  }
  if (!dataChannel) {
    LOG.error('sendMessage() rejected: no dataChannel');
    UI.toast('Канал не создан', 'error');
    return;
  }
  if (dataChannel.readyState !== 'open') {
    LOG.error('sendMessage() rejected: channel state =', dataChannel.readyState);
    UI.toast('Канал не открыт (state=' + dataChannel.readyState + ')', 'error');
    return;
  }

  const contact = contacts[activePeer];
  if (!contact) {
    LOG.error('sendMessage() rejected: contact not found for', activePeer);
    return;
  }

  const keys = contact.remoteKeys || [];
  LOG.keys('remoteKeys for activePeer:', keys.length, 'keys');
  if (keys.length === 0) {
    LOG.error('sendMessage() rejected: NO REMOTE KEYS');
    UI.toast('Ожидание обмена ключами... подождите 2-3 секунды', 'error');
    return;
  }

  const remoteKey = keys[keys.length - 1];
  LOG.crypto('Using remote key:', remoteKey.slice(0, 8) + '...');

  try {
    LOG.crypto('Encrypting text:', text.slice(0, 30) + (text.length > 30 ? '...' : ''));
    const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
    LOG.crypto('Encrypted, length:', ciphertext.length);

    const msg = {
      type: 'message',
      from: currentUser,
      ciphertext,
      timestamp: Date.now(),
    };

    LOG.send('Sending via dataChannel, payload size:', JSON.stringify(msg).length, 'bytes');
    dataChannel.send(JSON.stringify(msg));
    LOG.send('✅ Message SENT');

    LOG.history('Saving to local history...');
    await saveMessage(activePeer, msg);
    LOG.history('Saved to history');

    input.value = '';
    input.style.height = 'auto';
    UI.loadMessages(activePeer);
    UI.toggleSendBtn();
  } catch (e) {
    LOG.error('sendMessage() failed:', e);
    UI.toast('Ошибка отправки: ' + e.message, 'error');
  }
}

async function sendImage(file) {
  LOG.send('sendImage() called', { name: file.name, size: file.size, type: file.type });
  if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') {
    LOG.error('sendImage() rejected: channel not ready');
    return;
  }
  const keys = contacts[activePeer]?.remoteKeys || [];
  const remoteKey = keys[keys.length - 1];
  if (!remoteKey) {
    LOG.error('sendImage() rejected: no remote key');
    return;
  }
  try {
    const { blob, type } = await CryptoSystem.compressImage(file, 800);
    LOG.send('Image compressed, new size:', blob.size);
    const buffer = await blob.arrayBuffer();
    const ciphertext = await CryptoSystem.encryptData(buffer, remoteKey);
    const msg = { type: 'image', from: currentUser, ciphertext, mimeType: type, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msg));
    await saveMessage(activePeer, msg);
    UI.loadMessages(activePeer);
    LOG.send('✅ Image sent');
  } catch (e) {
    LOG.error('sendImage failed:', e);
    UI.toast('Не удалось отправить изображение', 'error');
  }
}

async function saveMessage(peerId, msg) {
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
    UI.toast('Хранилище переполнено', 'error');
  }
}

async function loadHistory(peerId) {
  const key = `history_${[currentUser, peerId].sort().join('_')}`;
  const history = masterPassword
    ? await CryptoSystem.loadEncryptedHistory(key, masterPassword)
    : JSON.parse(localStorage.getItem(key) || '[]');
  LOG.history('loadHistory for', peerId, '→', history.length, 'messages');
  return history;
}

async function saveContacts() {
  if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
  else localStorage.setItem('contacts', JSON.stringify(contacts));
}

/* ======================================================================
   ОТЛАДОЧНЫЕ КОМАНДЫ
   ====================================================================== */
window.debug = {
  dump: () => {
    const s = window.WebRTC.getState();
    console.log('%c===== STATE DUMP =====', 'color:#38bdf8;font-weight:bold;font-size:14px');
    console.log('currentUser:', s.currentUser);
    console.log('activePeer:', s.activePeer);
    console.log('masterPassword set:', !!s.masterPassword);
    console.log('dataChannel:', s.dataChannel ? s.dataChannel.readyState : 'null');
    console.log('peerConnection:', s.peerConnection ? s.peerConnection.connectionState : 'null');
    console.log('session:', s.session);
    console.log('contacts:', Object.entries(s.contacts).map(([id, c]) => ({
      id: id.slice(0, 8),
      name: c.name,
      localKeys: (c.localKeys || []).length,
      remoteKeys: (c.remoteKeys || []).length,
    })));
    if (s.activePeer && s.contacts[s.activePeer]) {
      const c = s.contacts[s.activePeer];
      console.log('%c--- Active peer details ---', 'color:#a78bfa;font-weight:bold');
      console.log('localKeys:', c.localKeys);
      console.log('remoteKeys:', c.remoteKeys);
    }
    return 'dump complete';
  },

  testCrypto: async (hexKey = null) => {
    const key = hexKey || (contacts[activePeer]?.remoteKeys || [])[0];
    if (!key) { console.error('No key to test'); return; }
    try {
      const enc = await CryptoSystem.encrypt('hello world', key);
      const dec = await CryptoSystem.decrypt(enc, key);
      console.log('Test encrypt+decrypt:', dec === 'hello world' ? '✅ OK' : '❌ MISMATCH');
      console.log('  key:', key.slice(0, 16) + '...');
      console.log('  ciphertext len:', enc.length);
    } catch (e) {
      console.error('Crypto test failed:', e);
    }
  },

  simulateIncoming: async (text = 'test') => {
    const c = contacts[activePeer];
    if (!c || !c.localKeys?.length) { console.error('No local key to encrypt as "incoming"'); return; }
    const localKey = c.localKeys[c.localKeys.length - 1];
    const ciphertext = await CryptoSystem.encrypt(text, localKey);
    const msg = { type: 'message', from: activePeer, ciphertext, timestamp: Date.now() };
    await saveMessage(activePeer, msg);
    UI.loadMessages(activePeer);
    console.log('Simulated incoming message saved');
  },

  resetKeys: (peerId = activePeer) => {
    if (!peerId || !contacts[peerId]) { console.error('No such peer'); return; }
    contacts[peerId].remoteKeys = [];
    contacts[peerId].localKeys = [];
    saveContacts();
    console.log('Keys wiped for', peerId);
  },

  sendTestMessage: () => {
    const inp = document.getElementById('message-input');
    inp.value = 'test_' + Date.now();
    window.WebRTC.sendMessage();
  },
};

console.log('%c[DEBUG] /0byte/ ready. Run debug.dump() for full state.', 'color:#38bdf8;font-weight:bold');

window.WebRTC = {
  connect, cancelConnect, reconnect, generatePhrase,
  sendMessage, sendImage, loadHistory, saveContacts,
  getState: () => ({ contacts, activePeer, currentUser, masterPassword, dataChannel, peerConnection, session }),
};
