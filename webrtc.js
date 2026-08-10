
const SIGNALING_URL = 'https://stable.okeysexsex.workers.dev'; // <-- URL вашего воркера

let currentUser, myName = 'Node_01', myAvatar = '';
let contacts = {}, activePeer = null, masterPassword = null;
let peerConnection = null, dataChannel = null, pendingLocalKey = null;
let keySendInterval = null, session = null;

/* ---------------- секретные фразы ---------------- */

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

/* ---------------- сигнальный сервер ---------------- */

const Signal = {
  async getOffer(id) {
    try {
      const r = await fetch(`${SIGNALING_URL}/api/rooms/${id}/offer`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  },
  async getAnswer(id) {
    try {
      const r = await fetch(`${SIGNALING_URL}/api/rooms/${id}/answer`, { cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  },
  async postOffer(id, sdp) {
    return fetch(`${SIGNALING_URL}/api/rooms/${id}/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp }),
    });
  },
  async postAnswer(id, sdp) {
    return fetch(`${SIGNALING_URL}/api/rooms/${id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp }),
    });
  },
  closeRoom(id) {
    fetch(`${SIGNALING_URL}/api/rooms/${id}/close`, { method: 'POST' }).catch(() => {});
  },
};

/* ---------------- управление соединением ---------------- */

async function connect(rawPhrase) {
  const clean = (rawPhrase || '').trim();
  const norm = normalizePhrase(clean);
  if (norm.length < 5) throw new Error('Фраза слишком короткая — минимум 5 символов');

  const roomId = (await CryptoSystem.sha256(norm)).slice(0, 16);
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
  const existing = await Signal.getOffer(roomId);
  if (session.aborted) return;

  if (existing) {
    await joinAsGuest(session, existing);
  } else {
    await tryHost(session);
  }
}

async function tryHost(s) {
  s.role = 'host';
  pendingLocalKey = CryptoSystem.generateKey();
  setupPeerConnection(s.roomId, true);

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
    // Кто-то успел стать хостом раньше — становимся гостем
    const theirOffer = await Signal.getOffer(s.roomId);
    if (!theirOffer) throw new Error('Не удалось подключиться. Попробуйте ещё раз.');
    return joinAsGuest(s, theirOffer);
  }

  await upsertContact(s);
  UI.setConnectStage('waiting');

  s.timer = setTimeout(() => failConnect('Время ожидания истекло'), 5 * 60 * 1000);

  const poll = async () => {
    if (s.aborted || session !== s) return;
    const ans = await Signal.getAnswer(s.roomId);
    if (ans && ans.sdp) {
      try {
        await peerConnection.setRemoteDescription({ type: 'answer', sdp: ans.sdp });
      } catch (e) { console.error('answer:', e); }
    } else {
      setTimeout(poll, 1500);
    }
  };
  poll();
}

async function joinAsGuest(s, offerData) {
  s.role = 'guest';
  UI.setConnectStage('linking');
  pendingLocalKey = CryptoSystem.generateKey();
  setupPeerConnection(s.roomId, false);

  await peerConnection.setRemoteDescription({ type: 'offer', sdp: offerData.sdp });
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await waitForIce();
  if (s.aborted) return;

  await Signal.postAnswer(s.roomId, peerConnection.localDescription.sdp);
  await upsertContact(s);

  s.timer = setTimeout(() => failConnect('Узел не отвечает'), 90 * 1000);
}

function cancelConnect(silent = false) {
  if (session) {
    session.aborted = true;
    if (session.timer) clearTimeout(session.timer);
    if (session.role === 'host') Signal.closeRoom(session.roomId);
  }
  session = null;
  teardownPeer();
  if (!silent) UI.setConnectStage('idle');
}

function failConnect(message) {
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
  if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
  if (dataChannel) { try { dataChannel.close(); } catch (e) {} dataChannel = null; }
  if (peerConnection) { try { peerConnection.close(); } catch (e) {} peerConnection = null; }
  pendingLocalKey = null;
  UI.updateStatus();
}

function onLinkEstablished() {
  if (!session) return;
  const s = session;
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
  UI.openNewSession(c.phrase, true);
}

/* ---------------- WebRTC / DataChannel ---------------- */

function setupPeerConnection(roomId, isHost) {
  teardownPeer();
  const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  peerConnection = new RTCPeerConnection(config);

  peerConnection.oniceconnectionstatechange = () => UI.updateStatus();
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    UI.updateStatus();
    const st = peerConnection.connectionState;
    if (st === 'connected') onLinkEstablished();
    if ((st === 'failed' || st === 'closed') && session && !session.aborted) {
      failConnect('Не удалось установить соединение');
    }
  };

  if (isHost) {
    dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
    setupDataChannel(roomId);
  } else {
    peerConnection.ondatachannel = (e) => {
      dataChannel = e.channel;
      setupDataChannel(roomId);
    };
  }
}

function setupDataChannel(roomId) {
  if (!dataChannel) return;

  const sendKey = () => {
    if (dataChannel && dataChannel.readyState === 'open' && pendingLocalKey) {
      dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
    }
  };

  dataChannel.onopen = () => {
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
    if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
    UI.updateStatus();
    if (activePeer === roomId) {
      const banner = document.getElementById('connection-banner');
      if (banner) banner.classList.remove('hidden');
    }
  };

  dataChannel.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'key') {
        const c = contacts[roomId];
        if (c) {
          if (!c.remoteKeys) c.remoteKeys = [];
          if (!c.remoteKeys.includes(msg.key)) c.remoteKeys.push(msg.key);
          await saveContacts();
          if (activePeer === roomId) UI.loadMessages(roomId);
          dataChannel.send(JSON.stringify({ type: 'key_ack' }));
        }
      } else if (msg.type === 'key_ack') {
        if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
      } else if (msg.type === 'message' || msg.type === 'image') {
        await saveMessage(roomId, msg);
        if (roomId === activePeer) {
          UI.loadMessages(roomId);
        } else if (contacts[roomId]) {
          contacts[roomId].unread = (contacts[roomId].unread || 0) + 1;
          UI.renderContacts();
        }
      }
    } catch (e) { console.error(e); }
  };
}

async function waitForIce() {
  return new Promise(resolve => {
    if (!peerConnection) return resolve();
    if (peerConnection.iceGatheringState === 'complete') return resolve();
    peerConnection.onicegatheringstatechange = () => {
      if (peerConnection.iceGatheringState === 'complete') resolve();
    };
    setTimeout(resolve, 3000);
  });
}

/* ---------------- контакты и история ---------------- */

async function upsertContact(s) {
  const prev = contacts[s.roomId] || {};
  const updated = {
    ...prev,
    name: prev.name || s.display,
    phrase: s.phrase,
    display: s.display,
    role: s.role,
    localKeys: prev.localKeys || (prev.localSessionKey ? [prev.localSessionKey] : []),
    remoteKeys: prev.remoteKeys || (prev.remoteKey ? [prev.remoteKey] : []),
  };
  if (pendingLocalKey && !updated.localKeys.includes(pendingLocalKey)) {
    updated.localKeys.push(pendingLocalKey);
  }
  const ordered = { [s.roomId]: updated };
  for (const [k, v] of Object.entries(contacts)) if (k !== s.roomId) ordered[k] = v;
  contacts = ordered;
  await saveContacts();
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') return;
  const keys = contacts[activePeer]?.remoteKeys || [];
  const remoteKey = keys[keys.length - 1];
  if (!remoteKey) return;
  try {
    const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
    const msg = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msg));
    await saveMessage(activePeer, msg);
    input.value = '';
    input.style.height = 'auto';
    UI.loadMessages(activePeer);
    UI.toggleSendBtn();
  } catch (e) { console.error(e); }
}

async function sendImage(file) {
  if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') return;
  const keys = contacts[activePeer]?.remoteKeys || [];
  const remoteKey = keys[keys.length - 1];
  if (!remoteKey) return;
  try {
    const { blob, type } = await CryptoSystem.compressImage(file, 800);
    const buffer = await blob.arrayBuffer();
    const ciphertext = await CryptoSystem.encryptData(buffer, remoteKey);
    const msg = { type: 'image', from: currentUser, ciphertext, mimeType: type, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msg));
    await saveMessage(activePeer, msg);
    UI.loadMessages(activePeer);
  } catch (e) {
    console.error(e);
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
    console.error(e);
    UI.toast('Хранилище переполнено', 'error');
  }
}

async function loadHistory(peerId) {
  const key = `history_${[currentUser, peerId].sort().join('_')}`;
  return masterPassword
    ? await CryptoSystem.loadEncryptedHistory(key, masterPassword)
    : JSON.parse(localStorage.getItem(key) || '[]');
}

async function saveContacts() {
  if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
  else localStorage.setItem('contacts', JSON.stringify(contacts));
}

window.WebRTC = {
  connect, cancelConnect, reconnect, generatePhrase,
  sendMessage, sendImage, loadHistory, saveContacts,
  getState: () => ({ contacts, activePeer, currentUser, masterPassword, dataChannel, peerConnection, session }),
};
