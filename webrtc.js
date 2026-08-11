const WORD_LIST = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Golf','Hotel','India','Juliett','Kilo','Lima','Mike','November','Oscar','Papa','Quebec','Romeo','Sierra','Tango','Uniform','Victor','Whiskey','Xray','Yankee','Zulu','Red','Blue','Green','Yellow','Orange','Purple','Silver','Gold','Crystal','Diamond','Ruby','Emerald','Sapphire','Jade','Onyx','Amber','Coral','Azure','Violet','Crimson','Indigo','Turquoise','Magenta','Olive','Maroon'];

/* ======================================================================
   МОСТ СОВМЕСТИМОСТИ
   ====================================================================== */
function updateOnlineStatus() {
    if (typeof UI !== 'undefined' && UI.updateStatus) UI.updateStatus();
}
if (typeof $ === 'undefined') window.$ = (id) => document.getElementById(id);
if (typeof closeNewChat === 'undefined') window.closeNewChat = () => {};
if (typeof showSection === 'undefined') window.showSection = () => {};
if (typeof resetToRoleSelect === 'undefined') window.resetToRoleSelect = () => {};
if (typeof renderContactList === 'undefined') window.renderContactList = () => { if (UI.renderContacts) UI.renderContacts(); };
if (typeof updateUIForPeer === 'undefined') window.updateUIForPeer = () => {};
if (typeof updateKeyDisplay === 'undefined') window.updateKeyDisplay = () => {};
if (typeof loadMessages === 'undefined') window.loadMessages = (id) => { if (UI.loadMessages) UI.loadMessages(id); };
if (typeof saveContacts === 'undefined') window.saveContacts = async () => { if (window.WebRTC && window.WebRTC.saveContacts) await window.WebRTC.saveContacts(); };

/* ======================================================================
   ЦВЕТНОЕ ЛОГИРОВАНИЕ
   ====================================================================== */
const LOG = {
    webrtc:  (...a) => console.log('%c[WebRTC]%c', 'color:#38bdf8;font-weight:bold', 'color:inherit', ...a),
    signal:  (...a) => console.log('%c[Signal]%c', 'color:#fbbf24;font-weight:bold', 'color:inherit', ...a),
    channel: (...a) => console.log('%c[Channel]%c', 'color:#10b981;font-weight:bold', 'color:inherit', ...a),
    keys:    (...a) => console.log('%c[Keys]%c', 'color:#a78bfa;font-weight:bold', 'color:inherit', ...a),
    phrase:  (...a) => console.log('%c[Phrase]%c', 'color:#fb923c;font-weight:bold', 'color:inherit', ...a),
    error:   (...a) => console.error('%c[ERROR]%c', 'color:#ef4444;font-weight:bold', 'color:inherit', ...a),
    warn:    (...a) => console.warn('%c[WARN]%c', 'color:#f59e0b;font-weight:bold', 'color:inherit', ...a),
};

/* ======================================================================
   СЕКРЕТНЫЕ ФРАЗЫ + СИГНАЛЬНЫЙ СЕРВЕР
   ====================================================================== */
const SIGNALING_URL = 'https://stable.okeysexsex.workers.dev';

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

let phraseSession = null;

async function connectByPhrase(rawPhrase) {
    const clean = (rawPhrase || '').trim();
    const norm = normalizePhrase(clean);
    LOG.phrase('connectByPhrase:', { raw: clean, normalized: norm });
    if (norm.length < 5) throw new Error('Фраза слишком короткая (минимум 5 символов)');

    const roomId = (await CryptoSystem.sha256(norm)).slice(0, 16);
    LOG.phrase('roomId:', roomId);

    cancelPhraseSession(true);
    phraseSession = { roomId, role: null, aborted: false, timer: null };

    if (UI.setConnectStage) UI.setConnectStage('checking');

    let existingOffer = null;
    try {
        const r = await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/offer`, { cache: 'no-store' });
        if (r.ok) existingOffer = await r.json();
    } catch (e) {
        LOG.error('getOffer failed:', e);
        cancelPhraseSession();
        throw new Error('Сигнальный сервер недоступен: ' + e.message);
    }
    if (phraseSession.aborted) return;

    if (existingOffer && existingOffer.sdp) {
        LOG.phrase('Offer exists → GUEST');
        await phraseJoinAsGuest(roomId, existingOffer);
    } else {
        LOG.phrase('No offer → HOST');
        await phraseStartAsHost(roomId);
    }
}

async function phraseStartAsHost(roomId) {
    phraseSession.role = 'host';
    connectedPeerId = roomId;
    pendingLocalKey = CryptoSystem.generateKey();

    if (!contacts[roomId]) contacts[roomId] = { name: roomId.slice(0, 8), avatar: '' };
    contacts[roomId].localSessionKey = pendingLocalKey;
    contacts[roomId].role = 'host';
    await saveContactsSecure();

    await setupPeerConnectionForHost();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering();

    LOG.phrase('Posting offer...');
    const res = await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: peerConnection.localDescription.sdp }),
    });

    if (res.status === 409) {
        LOG.phrase('Conflict 409 → switching to GUEST');
        const r2 = await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/offer`, { cache: 'no-store' });
        const theirOffer = r2.ok ? await r2.json() : null;
        if (!theirOffer || !theirOffer.sdp) throw new Error('Не удалось подключиться');
        await phraseJoinAsGuest(roomId, theirOffer);
        return;
    }

    LOG.phrase('Offer posted, waiting for answer...');
    if (UI.setConnectStage) UI.setConnectStage('waiting');

    phraseSession.timer = setTimeout(() => {
        cancelPhraseSession();
        alert('Время ожидания истекло (5 минут)');
    }, 5 * 60 * 1000);

    const poll = async () => {
        if (!phraseSession || phraseSession.aborted) return;
        try {
            const r = await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/answer`, { cache: 'no-store' });
            if (r.ok) {
                const ans = await r.json();
                if (ans && ans.sdp) {
                    LOG.phrase('Answer received!');
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(ans));
                    return;
                }
            }
        } catch (e) { /* retry */ }
        setTimeout(poll, 1500);
    };
    poll();
}

async function phraseJoinAsGuest(roomId, offerData) {
    phraseSession.role = 'guest';
    if (UI.setConnectStage) UI.setConnectStage('linking');

    connectedPeerId = roomId;
    pendingLocalKey = CryptoSystem.generateKey();

    if (!contacts[roomId]) contacts[roomId] = { name: roomId.slice(0, 8), avatar: '' };
    contacts[roomId].localSessionKey = pendingLocalKey;
    contacts[roomId].role = 'guest';
    await saveContactsSecure();

    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }

    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(config);

    peerConnection.ondatachannel = async (event) => {
        LOG.channel('DataChannel received from host');
        dataChannel = event.channel;
        setupDataChannel(roomId, 'guest');
    };

    peerConnection.oniceconnectionstatechange = () => updateOnlineStatus();
    peerConnection.onconnectionstatechange = () => {
        LOG.webrtc('Guest connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') updateOnlineStatus();
    };

    LOG.phrase('Setting remote offer');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offerData));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGathering();

    LOG.phrase('Posting answer...');
    await fetch(`${SIGNALING_URL}/api/rooms/${roomId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp: peerConnection.localDescription.sdp }),
    });

    LOG.phrase('Answer posted, waiting for WebRTC handshake...');

    phraseSession.timer = setTimeout(() => {
        cancelPhraseSession();
        alert('Узел не отвечает (90 секунд)');
    }, 90 * 1000);
}

function cancelPhraseSession(silent = false) {
    if (phraseSession) {
        phraseSession.aborted = true;
        if (phraseSession.timer) clearTimeout(phraseSession.timer);
        if (phraseSession.role === 'host') {
            fetch(`${SIGNALING_URL}/api/rooms/${phraseSession.roomId}/close`, { method: 'POST' }).catch(() => {});
        }
    }
    phraseSession = null;
    if (!silent && UI.setConnectStage) UI.setConnectStage('idle');
}

/* ======================================================================
   ВАШ РАБОЧИЙ КОД (без QR)
   ====================================================================== */

let currentUser, myName = 'You', myAvatar = '', contacts = {}, activePeer = null;
let peerConnection = null, dataChannel = null, pendingLocalKey = null;
let keySendInterval = null, connectedPeerId = null, masterPassword = null;
let verifiedFingerprints = {};

function sdpToWords(a) {
    let b = CryptoSystem.extractFingerprint(a);
    if (!b) return 'Unknown session';
    let c = 0;
    for (let d = 0; d < b.length; d++) c = ((c << 5) - c) + b.charCodeAt(d), c |= 0;
    let e = [], f = Math.abs(c);
    for (let g = 0; g < 3; g++) { let h = (f + g * 7) % WORD_LIST.length; e.push(WORD_LIST[h]); }
    return e.join(' · ');
}

function generateRoomId() { return CryptoSystem.generateKey().slice(0, 8); }
function createInvitePayload(a, b) { return JSON.stringify({ roomId: b, sdp: a.sdp, type: a.type }); }

function parseInvitePayload(a) {
    try { let b = JSON.parse(a); if (b.roomId && b.sdp && b.type) return b; } catch (c) {}
    let d = JSON.parse(a), e = CryptoSystem.extractFingerprint(d.sdp);
    return { roomId: e ? e.slice(0, 8) : generateRoomId(), sdp: d.sdp, type: d.type };
}

function setupPeerConnection(a) {
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
    let b = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(b);
    peerConnection.oniceconnectionstatechange = () => updateOnlineStatus();
    peerConnection.onconnectionstatechange = () => { console.log('Connection state:', peerConnection.connectionState); updateOnlineStatus(); };
    dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
    setupDataChannel(a, 'host');
}

function setupDataChannel(a, b = 'unknown') {
    if (!dataChannel) return;
    console.log(`[DEBUG] setupDataChannel role=${b}, readyState=${dataChannel.readyState}`);
    let c = () => {
        if (!dataChannel || dataChannel.readyState !== 'open') { console.warn('[DEBUG] sendMyKey: channel not open'); return; }
        if (!pendingLocalKey) { console.warn('[DEBUG] sendMyKey: no pendingLocalKey'); return; }
        console.log('[DEBUG] Sending my key:', pendingLocalKey.slice(0, 8));
        dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
    };
    let d = () => { c(); if (keySendInterval) clearInterval(keySendInterval); keySendInterval = setInterval(c, 400); console.log('[DEBUG] Key send interval started'); };
    let e = f => { if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; console.log(`[DEBUG] Key send interval stopped (${f})`); } };
    let g = async () => {
        console.log('[DEBUG] Data channel opened, role:', b);
        d(); updateOnlineStatus();
        if (connectedPeerId && contacts[connectedPeerId]) {
            let h = localStorage.getItem(`role_${connectedPeerId}`);
            if (h && !contacts[connectedPeerId].role) { contacts[connectedPeerId].role = h; await saveContactsSecure(); }
        }
        let i = $('new-chat-modal'); if (i && !i.classList.contains('hidden')) closeNewChat();
        if (connectedPeerId) {
            console.log('[DEBUG] Activating chat for:', connectedPeerId);
            activePeer = connectedPeerId; localStorage.setItem('activePeer', activePeer);
            updateUIForPeer(activePeer); renderContactList();
        }
        let j = $('restore-panel'); if (j) j.classList.remove('visible');
    };
    dataChannel.onopen = g;
    dataChannel.onclose = () => { console.log('[DEBUG] Data channel closed'); e('channel closed'); updateOnlineStatus(); if (activePeer && a === activePeer) { let k = $('restore-panel'); if (k) k.classList.add('visible'); } };
    dataChannel.onmessage = async f => {
        try {
            let h = JSON.parse(f.data);
            console.log('[DEBUG] Received message type:', h.type, h.type === 'key' ? h.key?.slice(0, 8) : '');
            if (h.type === 'key') {
                let i = connectedPeerId || activePeer;
                if (i && contacts[i]) {
                    contacts[i].remoteKey = h.key; await saveContactsSecure();
                    console.log('[DEBUG] Saved partner key:', h.key.slice(0, 8));
                    loadMessages(i); updateKeyDisplay();
                    if (dataChannel && dataChannel.readyState === 'open') { dataChannel.send(JSON.stringify({ type: 'key_ack' })); console.log('[DEBUG] Sent key_ack'); }
                }
            } else if (h.type === 'key_ack') { console.log('[DEBUG] Received key_ack – partner got our key'); e('received key_ack'); }
            else if (h.type === 'message' || h.type === 'image') { let i = connectedPeerId || activePeer; if (i && contacts[i]) { await saveMessageToHistory(i, h); if (i === activePeer) loadMessages(i); } }
            else if (h.type === 'fingerprint_ack') { if (connectedPeerId) verifiedFingerprints[connectedPeerId] = true, console.log('[DEBUG] Fingerprint confirmed'); }
        } catch (j) { console.error('[DEBUG] Message processing error:', j); }
    };
    if (dataChannel.readyState === 'open') { console.log('[DEBUG] Channel already open, calling onOpenLogic immediately'); g(); }
}

async function sendMessage() {
    let a = $('message-input').value.trim();
    if (!a || !activePeer || !dataChannel || dataChannel.readyState !== 'open') { alert('No connection.'); return; }
    let b = contacts[activePeer]?.remoteKey;
    if (!b) { alert('Waiting for encryption key...'); return; }
    try {
        let c = await CryptoSystem.encrypt(a, b), d = { type: 'message', from: currentUser, ciphertext: c, timestamp: Date.now() };
        dataChannel.send(JSON.stringify(d)); await saveMessageToHistory(activePeer, d);
        $('message-input').value = ''; loadMessages(activePeer);
    } catch (e) { console.error('Encryption error:', e); alert('Failed to encrypt message.'); }
}

async function sendImage(a) {
    if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') { alert('No connection.'); return; }
    let b = contacts[activePeer]?.remoteKey;
    if (!b) { alert('Waiting for encryption key...'); return; }
    try {
        let c = await new Promise((e, f) => {
            let g = new FileReader; g.onload = h => {
                let i = new Image; i.onload = () => {
                    let j = document.createElement('canvas'), k = 800, l = i.width, m = i.height;
                    if (l > k || m > k) { let n = Math.min(k / l, k / m); l *= n; m *= n; }
                    j.width = l; j.height = m; let o = j.getContext('2d'); o.drawImage(i, 0, 0, l, m);
                    j.toBlob(p => e(p), 'image/jpeg', 0.7);
                }; i.src = h.target.result;
            }; g.readAsDataURL(a);
        });
        let d = await c.arrayBuffer(), e = await CryptoSystem.encryptData(d, b);
        let f = { type: 'image', from: currentUser, ciphertext: e, mimeType: 'image/jpeg', timestamp: Date.now() };
        dataChannel.send(JSON.stringify(f)); await saveMessageToHistory(activePeer, f); loadMessages(activePeer);
    } catch (g) { console.error('Image send error:', g); alert('Failed to send image.'); }
}

async function saveMessageToHistory(a, b) {
    let c = `history_${[currentUser, a].sort().join('_')}`, d = [];
    if (masterPassword) d = await CryptoSystem.loadEncryptedHistory(c, masterPassword);
    else d = JSON.parse(localStorage.getItem(c) || '[]');
    d.push(b);
    if (masterPassword) await CryptoSystem.saveEncryptedHistory(c, d, masterPassword);
    else localStorage.setItem(c, JSON.stringify(d));
}

async function loadMessageHistory(a) {
    let b = `history_${[currentUser, a].sort().join('_')}`;
    if (masterPassword) return await CryptoSystem.loadEncryptedHistory(b, masterPassword);
    else return JSON.parse(localStorage.getItem(b) || '[]');
}

function waitForIceGathering() {
    return new Promise(a => {
        if (peerConnection.iceGatheringState === 'complete') a();
        else {
            peerConnection.onicegatheringstatechange = () => { if (peerConnection.iceGatheringState === 'complete') a(); };
            setTimeout(a, 3000);
        }
    });
}

async function verifyFingerprint(a, b, c) {
    if (verifiedFingerprints[a]) return true;
    let d = sdpToWordsByFp(b), e = sdpToWordsByFp(c);
    if (d === e) { verifiedFingerprints[a] = true; return true; }
    return new Promise(f => {
        let g = document.createElement('div'); g.className = 'modal';
        g.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>🔐 Fingerprint verification</h2></div><div class="modal-body"><p>Compare codes with your partner:</p><div class="fingerprint-verify"><p><strong>Your code:</strong> <span style="color:var(--primary);font-weight:700;">${d}</span></p><p><strong>Partner's code:</strong> <span style="color:var(--primary);font-weight:700;">${e}</span></p><p style="color:var(--text-secondary);margin:8px 0;">Codes must match.</p></div><div class="fp-buttons"><button class="btn-primary" id="fp-confirm">✅ Match</button><button class="btn-secondary" id="fp-deny">❌ Do not match</button></div></div></div>`;
        document.body.appendChild(g);
        document.getElementById('fp-confirm').onclick = () => { verifiedFingerprints[a] = true; g.remove(); if (dataChannel && dataChannel.readyState === 'open') dataChannel.send(JSON.stringify({ type: 'fingerprint_ack' })); f(true); };
        document.getElementById('fp-deny').onclick = () => { g.remove(); f(false); };
    });
}

function sdpToWordsByFp(a) {
    if (!a) return 'Unknown';
    let b = 0; for (let c = 0; c < a.length; c++) b = ((b << 5) - b) + a.charCodeAt(c), b |= 0;
    let d = [], e = Math.abs(b);
    for (let f = 0; f < 3; f++) { let g = (e + f * 7) % WORD_LIST.length; d.push(WORD_LIST[g]); }
    return d.join(' · ');
}

async function saveContactsSecure() {
    if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
    else localStorage.setItem('contacts', JSON.stringify(contacts));
}

async function pasteFromClipboard(a) {
    try {
        let b = await navigator.clipboard.readText();
        if (!b || b.trim() === '') { alert('Clipboard is empty or does not contain text'); return; }
        let c = document.getElementById(a); if (c) { c.value = b; c.dispatchEvent(new Event('input')); }
    } catch (d) { alert('Could not read clipboard.'); console.error(d); }
}

function setupPasteZone(a, b, c) {
    let d = document.getElementById(a); if (!d) return;
    d.onpaste = async e => {
        let f = e.clipboardData?.items; if (!f) return;
        for (let g = 0; g < f.length; g++) if (f[g].type.startsWith('image/')) {
            e.preventDefault();
            // QR сканирование удалено — просто вставляем текст
            return;
        }
    };
}

async function startHostFlow() {
    showSection('host-flow');
    let a = $('host-invite-area'), b = $('host-response-area'), c = $('host-waiting'), d = $('host-connect-btn'), e = $('host-answer-input'), f = $('host-offer-words');
    if (a) setTimeout(() => a.classList.add('visible'), 100);
    if (b) setTimeout(() => b.classList.add('visible'), 200);
    if (c) c.classList.add('hidden');
    if (d) d.disabled = true;
    if (e) e.value = '';
    if (f) f.textContent = 'Generating...';
    setTimeout(() => { setupPasteZone('host-paste-zone', 'host-answer-input', () => { let g = $('host-connect-btn'); if (g && !g.disabled) g.click(); }); }, 300);
    try {
        connectedPeerId = generateRoomId(); pendingLocalKey = CryptoSystem.generateKey();
        if (!contacts[connectedPeerId]) contacts[connectedPeerId] = { name: connectedPeerId, avatar: '' };
        contacts[connectedPeerId].localSessionKey = pendingLocalKey; contacts[connectedPeerId].role = 'host';
        localStorage.setItem(`role_${connectedPeerId}`, 'host'); await saveContacts();
        await setupPeerConnectionForHost();
        let g = await peerConnection.createOffer(); await peerConnection.setLocalDescription(g); await waitForIceGathering();
        let h = peerConnection.localDescription, i = createInvitePayload(h, connectedPeerId);
        $('host-offer-display').value = i; $('host-offer-words').textContent = sdpToWords(h.sdp);
        copyToClipboard(i);
        let j = $('share-host-btn'); if (j && navigator.share) j.style.display = '';
    } catch (k) { alert('Error creating invitation'); console.error(k); resetToRoleSelect(); }
}

async function hostSubmitAnswer() {
    let a = $('host-answer-input'); if (!a) return;
    let b = a.value.trim(); if (!b) return;
    try {
        let c = parseInvitePayload(b), d = { sdp: c.sdp, type: c.type };
        let e = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp), f = CryptoSystem.extractFingerprint(d.sdp);
        let g = await verifyFingerprint(connectedPeerId, e, f);
        if (!g) { alert('Fingerprints do not match!'); return; }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(d));
        $('host-response-area').classList.remove('visible');
        let h = $('host-waiting'); if (h) { h.classList.remove('hidden'); h.style.display = 'block'; }
        console.log('Answer set, waiting for connection...');
    } catch (i) { alert('Invalid answer code'); console.error(i); }
}

function startJoinFlow() {
    showSection('join-flow');
    let a = $('join-input-area'), b = $('join-response-area'), c = $('join-waiting'), d = $('join-generate-btn'), e = $('join-offer-input');
    if (a) setTimeout(() => a.classList.add('visible'), 100);
    if (b) { b.classList.add('hidden'); b.classList.remove('visible'); }
    if (c) c.classList.add('hidden');
    if (d) d.disabled = true;
    if (e) e.value = '';
    setTimeout(() => { setupPasteZone('join-paste-zone', 'join-offer-input', () => { let f = $('join-generate-btn'); if (f && !f.disabled) f.click(); }); }, 300);
}

async function joinSubmitOffer() {
    let a = $('join-offer-input'); if (!a) return;
    let b = a.value.trim(); if (!b) return;
    try {
        let c = parseInvitePayload(b), d = { sdp: c.sdp, type: c.type }, e = c.roomId;
        if (!contacts[e]) contacts[e] = { name: e, avatar: '' };
        connectedPeerId = e; pendingLocalKey = CryptoSystem.generateKey();
        contacts[e].localSessionKey = pendingLocalKey; contacts[e].role = 'guest';
        localStorage.setItem(`role_${e}`, 'guest'); await saveContacts();
        let f = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(f);
        peerConnection.ondatachannel = async g => {
            console.log('[DEBUG] Received data channel from host');
            dataChannel = g.channel;
            let h = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp), i = CryptoSystem.extractFingerprint(d.sdp);
            let j = await verifyFingerprint(e, h, i);
            if (!j) { alert('Fingerprints do not match!'); dataChannel.close(); return; }
            setupDataChannel(e, 'guest');
        };
        peerConnection.oniceconnectionstatechange = updateOnlineStatus;
        peerConnection.onconnectionstatechange = () => { console.log('Guest connection state:', peerConnection.connectionState); if (peerConnection.connectionState === 'connected') updateOnlineStatus(); };
        await peerConnection.setRemoteDescription(new RTCSessionDescription(d));
        let g = await peerConnection.createAnswer(); await peerConnection.setLocalDescription(g); await waitForIceGathering();
        let h = peerConnection.localDescription, i = createInvitePayload(h, e);
        $('join-answer-display').value = i; $('join-answer-words').textContent = sdpToWords(h.sdp);
        copyToClipboard(i);
        $('join-input-area').classList.remove('visible'); $('join-response-area').classList.remove('hidden');
        setTimeout(() => $('join-response-area').classList.add('visible'), 100);
        let j = $('share-join-btn'); if (j && navigator.share) j.style.display = '';
        let k = $('join-waiting'); if (k) { k.classList.remove('hidden'); k.style.display = 'block'; }
        console.log('Answer generated, send it to the host');
    } catch (l) { alert('Could not process invitation'); console.error(l); }
}

function copyToClipboard(a) { navigator.clipboard.writeText(a).catch(() => { let b = document.createElement('textarea'); b.value = a; document.body.appendChild(b); b.select(); document.execCommand('copy'); document.body.removeChild(b); }); }
function copyHostOffer() { let a = $('host-offer-display'); if (a) copyToClipboard(a.value); }
function shareHostOffer() { let a = $('host-offer-display'); if (a && navigator.share) navigator.share({ title: 'Invitation to /0byte/', text: a.value }); }
function copyJoinAnswer() { let a = $('join-answer-display'); if (a) copyToClipboard(a.value); }
function shareJoinAnswer() { let a = $('join-answer-display'); if (a && navigator.share) navigator.share({ title: 'Answer to /0byte/ invitation', text: a.value }); }

async function setupPeerConnectionForHost() {
    let a = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(a);
    dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
    setupDataChannel(connectedPeerId, 'host');
    peerConnection.oniceconnectionstatechange = updateOnlineStatus;
    peerConnection.onconnectionstatechange = () => { console.log('Host connection state:', peerConnection.connectionState); if (peerConnection.connectionState === 'connected') updateOnlineStatus(); };
}

async function restoreSession(a) {
    let b = contacts[a]?.role || localStorage.getItem(`role_${a}`);
    if (contacts[a]?.localSessionKey) pendingLocalKey = contacts[a].localSessionKey;
    else { pendingLocalKey = CryptoSystem.generateKey(); contacts[a].localSessionKey = pendingLocalKey; await saveContactsSecure(); }
    connectedPeerId = a;
    if (b === 'host') {
        await setupPeerConnectionForHost();
        let c = await peerConnection.createOffer(); await peerConnection.setLocalDescription(c); await waitForIceGathering();
        let d = createInvitePayload(peerConnection.localDescription, a);
        // QR удалён — копируем payload в буфер
        copyToClipboard(d);
        alert('Код скопирован в буфер обмена. Отправьте его собеседнику.');
    } else if (b === 'guest') showGuestRestoreInput(a);
    else showNewChat();
}

function showGuestRestoreInput(a) {
    let b = document.createElement('div'); b.className = 'modal'; b.id = 'guest-restore-modal';
    b.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>🔗 Reconnection</h2><button class="icon-btn close-restore-btn">✕</button></div><div class="modal-body"><div class="alert alert-info">Paste invitation text from your friend</div><textarea id="restore-offer-input" class="sdp-input" placeholder="Paste JSON code from friend..." rows="4"></textarea><button onclick="submitRestoreOffer('${a}')" class="btn-primary" id="restore-connect-btn" disabled style="width:100%;margin-top:12px;">Connect</button></div></div>`;
    document.body.appendChild(b);
    let f = document.getElementById('restore-offer-input'), g = document.getElementById('restore-connect-btn');
    f.addEventListener('input', () => { try { let h = parseInvitePayload(f.value.trim()); g.disabled = !h.sdp; } catch (i) { g.disabled = true; } });
    b.querySelector('.close-restore-btn').onclick = () => b.remove();
}

async function submitRestoreOffer(a) {
    let b = document.getElementById('restore-offer-input'); if (!b) return;
    let c = b.value.trim(); if (!c) return;
    try {
        let d = parseInvitePayload(c), e = { sdp: d.sdp, type: d.type }, f = d.roomId;
        if (a !== f) { alert('This invitation is for a different chat'); return; }
        let g = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(g);
        peerConnection.ondatachannel = h => { dataChannel = h.channel; setupDataChannel(a, 'guest'); };
        peerConnection.oniceconnectionstatechange = updateOnlineStatus;
        peerConnection.onconnectionstatechange = () => { if (peerConnection.connectionState === 'connected') updateOnlineStatus(); };
        await peerConnection.setRemoteDescription(new RTCSessionDescription(e));
        let h = await peerConnection.createAnswer(); await peerConnection.setLocalDescription(h); await waitForIceGathering();
        let i = document.getElementById('guest-restore-modal'); if (i) i.remove();
        console.log('Reconnection successful');
    } catch (j) { alert('Reconnection error'); console.error(j); }
}

/* ======================================================================
   ЭКСПОРТ
   ====================================================================== */
window.WebRTC = {
    startHost: startHostFlow,
    startGuest: startJoinFlow,
    processGuestInput: () => {
        const input = document.getElementById('guest-offer-input')?.value?.trim();
        const btn = document.getElementById('btn-guest-generate');
        if (btn) {
            const isJson = input && input.startsWith('{');
            const isCode = input && input.length >= 4 && input.length <= 10;
            btn.disabled = !(isJson || isCode);
        }
        window.guestInput = input;
    },
    generateAnswer: joinSubmitOffer,
    sendMessage, sendImage,
    loadHistory: loadMessageHistory,
    saveContacts: saveContactsSecure,
    getState: () => ({ contacts, activePeer, currentUser, masterPassword, dataChannel, peerConnection }),
    // Подключение по секретной фразе
    connect: connectByPhrase,
    connectByPhrase,
    generatePhrase,
    cancelConnect: cancelPhraseSession,
};

console.log('%c[DEBUG] /0byte/ ready. WebRTC.connect("фраза") для подключения по секретной фразе.', 'color:#38bdf8;font-weight:bold');
