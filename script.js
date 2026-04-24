// Web Crypto AES-256-GCM encryption
class CryptoSystem {
    static generateKey() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    static hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }

    static async importKey(hexKey) {
        const rawKey = this.hexToBytes(hexKey);
        return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }

    static async encrypt(text, hexKey) {
        const key = await this.importKey(hexKey);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(text);
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);
        return btoa(String.fromCharCode(...combined));
    }

    static async decrypt(encryptedBase64, hexKey) {
        try {
            const key = await this.importKey(hexKey);
            const data = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
            const iv = data.slice(0, 12);
            const ciphertext = data.slice(12);
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            console.error('AES decrypt error:', e);
            return null;
        }
    }
}

let currentUser, myName = 'You', myAvatar = '👤';
let contacts = {};
let activePeer = null;
let peerConnection = null;
let dataChannel = null;
let pendingLocalKey = null;
let partnerOffer = null;
let keySendInterval = null;

function $(id) { return document.getElementById(id); }

function loadSettings() {
    myName = localStorage.getItem('myName') || 'You';
    myAvatar = localStorage.getItem('myAvatar') || '👤';
    currentUser = localStorage.getItem('uid');
    if (!currentUser) {
        currentUser = CryptoSystem.generateKey().slice(0, 16);
        localStorage.setItem('uid', currentUser);
    }
    $('name-input').value = myName;
    $('avatar-input').value = myAvatar;
    contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    renderContactList();
    if (activePeer) openChat(activePeer);
    else {
        $('main-chat').classList.add('hidden');
        $('sidebar').classList.remove('hidden');
    }
}

function renderContactList() {
    const list = $('contact-list');
    list.innerHTML = '';
    Object.entries(contacts).forEach(([peerId, data]) => {
        const div = document.createElement('div');
        div.className = 'contact-item' + (peerId === activePeer ? ' active' : '');
        div.innerHTML = `
            <span class="contact-avatar">${data.avatar || '👤'}</span>
            <span class="contact-name">${data.name || peerId.slice(0, 8)}</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${peerId}')">✕</button>
        `;
        div.onclick = () => { activePeer = peerId; openChat(peerId); };
        list.appendChild(div);
    });
}

function deleteChat(peerId) {
    if (!confirm('Delete chat and history with ' + (contacts[peerId]?.name || peerId) + '?')) return;
    const histKey = `history_${[currentUser, peerId].sort().join('_')}`;
    localStorage.removeItem(histKey);
    localStorage.removeItem(`pinned_${peerId}`);
    delete contacts[peerId];
    saveContacts();
    if (activePeer === peerId) {
        activePeer = null;
        goBack();
    }
    renderContactList();
}

function openChat(peerId) {
    activePeer = peerId;
    $('partner-name-display').innerText = contacts[peerId]?.name || peerId.slice(0, 8);
    $('partner-avatar').innerText = contacts[peerId]?.avatar || '👤';
    $('main-chat').classList.add('active');
    $('main-chat').classList.remove('hidden');
    $('sidebar').classList.add('hidden');
    updateKeyDisplay();
    loadMessages(peerId);
    loadPinned(peerId);
    updateOnlineStatus();
    $('message-input').focus();
}

function goBack() {
    $('main-chat').classList.remove('active');
    $('main-chat').classList.add('hidden');
    $('sidebar').classList.remove('hidden');
    activePeer = null;
}

function promptNewRoom() {
    $('new-room-modal').classList.remove('hidden');
    $('room-create').classList.remove('hidden');
    $('room-waiting').classList.add('hidden');
    $('room-joining').classList.add('hidden');
    $('offer-textarea').value = '';
    $('answer-textarea').value = '';
    clearInterval(keySendInterval);
}

function closeNewRoomModal() {
    $('new-room-modal').classList.add('hidden');
}

async function createRoom() {
    const tempId = 'partner-' + Math.random().toString(36).substr(2, 6);
    contacts[tempId] = { name: tempId, avatar: '❓' };
    activePeer = tempId;
    saveContacts();
    renderContactList();
    openChat(tempId);

    $('room-create').classList.add('hidden');
    $('room-waiting').classList.remove('hidden');

    pendingLocalKey = CryptoSystem.generateKey();
    contacts[tempId].localSessionKey = pendingLocalKey;
    saveContacts();
    updateKeyDisplay();
    console.log('My local session key:', pendingLocalKey);
    await setupWebRTC(true);
}

async function joinRoom() {
    const offerStr = $('offer-textarea').value.trim();
    if (!offerStr) return alert('Paste partner offer first.');
    try {
        partnerOffer = JSON.parse(offerStr);
    } catch (e) { alert('Invalid offer format.'); return; }

    const tempId = 'partner-' + Math.random().toString(36).substr(2, 6);
    contacts[tempId] = { name: tempId, avatar: '❓' };
    activePeer = tempId;
    saveContacts();
    renderContactList();
    openChat(tempId);

    $('room-create').classList.add('hidden');
    $('room-joining').classList.remove('hidden');

    pendingLocalKey = CryptoSystem.generateKey();
    contacts[tempId].localSessionKey = pendingLocalKey;
    saveContacts();
    updateKeyDisplay();
    console.log('My local session key:', pendingLocalKey);
    await setupWebRTC(false);
}

async function completeConnection() {
    const answerStr = $('answer-textarea').value.trim();
    if (!peerConnection || !answerStr) return alert('No answer to apply.');
    try {
        const answer = JSON.parse(answerStr);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        closeNewRoomModal();
    } catch (e) { alert('Invalid answer: ' + e.message); }
}

async function setupWebRTC(isOfferer) {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(configuration);
    dataChannel = isOfferer ? peerConnection.createDataChannel('chat') : null;

    peerConnection.onicecandidate = () => {};
    peerConnection.onconnectionstatechange = () => {
        updateOnlineStatus();
    };

    if (!isOfferer) {
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            console.log('Data channel received');
            setupDataChannel();
        };
    }

    if (isOfferer) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGathering();
        const offerStr = JSON.stringify(peerConnection.localDescription);
        $('offer-display').value = offerStr;
        copyToClipboard(offerStr);
        alert('Offer copied!');
    } else {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(partnerOffer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await waitForIceGathering();
        const answerStr = JSON.stringify(peerConnection.localDescription);
        $('answer-display').value = answerStr;
        copyToClipboard(answerStr);
        alert('Answer copied!');
    }

    setupDataChannel();
}

function waitForIceGathering() {
    return new Promise(resolve => {
        if (peerConnection.iceGatheringState === 'complete') resolve();
        else {
            peerConnection.onicegatheringstatechange = () => {
                if (peerConnection.iceGatheringState === 'complete') resolve();
            };
            setTimeout(resolve, 3000);
        }
    });
}

function setupDataChannel() {
    if (!dataChannel) return;

    dataChannel.onopen = () => {
        console.log('Data channel opened, sending key');
        const sendKey = () => {
            if (!dataChannel || dataChannel.readyState !== 'open') return;
            dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
            console.log('Sent key:', pendingLocalKey);
        };
        sendKey();
        clearInterval(keySendInterval);
        keySendInterval = setInterval(sendKey, 400);
        updateOnlineStatus();
    };

    dataChannel.onmessage = event => {
        const data = JSON.parse(event.data);
        console.log('Received', data.type, data.type === 'key' ? data.key : '');

        if (data.type === 'key') {
            if (activePeer) {
                contacts[activePeer].remoteKey = data.key;
                saveContacts();
                console.log('Stored remote key from partner:', data.key);
                clearInterval(keySendInterval);
                loadMessages(activePeer);
            }
            updateKeyDisplay();
        } else if (data.type === 'message') {
            handleIncomingMessage(activePeer, data);
        }
    };
}

async function sendMessage() {
    const text = $('message-input').value.trim();
    if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') {
        alert('No connection.');
        return;
    }
    const remoteKey = contacts[activePeer]?.remoteKey;
    if (!remoteKey) {
        alert('Waiting for encryption key...');
        return;
    }
    try {
        const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
        const msgObj = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
        dataChannel.send(JSON.stringify(msgObj));
        saveMessageToHistory(activePeer, msgObj);
        $('message-input').value = '';
        loadMessages(activePeer);
    } catch (e) {
        console.error('Encryption failed:', e);
        alert('Encryption failed. Check console.');
    }
}

async function handleIncomingMessage(peerId, data) {
    console.log('Handling incoming message from', peerId);
    saveMessageToHistory(peerId, data);
    if (peerId === activePeer) loadMessages(peerId);
}

function saveMessageToHistory(peerId, msg) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    hist.push(msg);
    localStorage.setItem(key, JSON.stringify(hist));
}

async function loadMessages(peerId) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    const container = $('messages');
    container.innerHTML = '';
    const localKey = contacts[peerId]?.localSessionKey;
    const remoteKey = contacts[peerId]?.remoteKey;
    for (const msg of hist) {
        const isMine = msg.from === currentUser;
        let content = '🔒 Encrypted';
        // В зависимости от того, я ли отправитель, выбираем ключ для расшифровки
        const decryptKey = isMine ? remoteKey : localKey;
        if (decryptKey && msg.ciphertext) {
            const decrypted = await CryptoSystem.decrypt(msg.ciphertext, decryptKey);
            if (decrypted !== null) content = decrypted;
        }
        const div = document.createElement('div');
        div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
        div.innerHTML = `
            <div class="message-bubble">${content}</div>
            <div class="message-meta">
                <span>${new Date(msg.timestamp).toLocaleTimeString()}</span>
                <button class="pin-btn" onclick="togglePin('${peerId}', ${msg.timestamp})">📌</button>
            </div>`;
        container.appendChild(div);
    }
    container.scrollTop = container.scrollHeight;
}

function updateOnlineStatus() {
    const status = (dataChannel && dataChannel.readyState === 'open') ? '🟢 Online' : '⚪ Disconnected';
    $('online-status').innerText = status;
}

function updateKeyDisplay() {
    if (!activePeer) return;
    const localKey = contacts[activePeer]?.localSessionKey;
    const remoteKey = contacts[activePeer]?.remoteKey;
    $('my-key-display').innerText = localKey ? localKey.slice(0, 8) + '...' : 'none';
    $('partner-key-display').innerText = remoteKey ? remoteKey.slice(0, 8) + '...' : '(waiting...)';
}

function togglePin(peerId, ts) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    const msg = hist.find(m => m.timestamp === ts);
    if (!msg) return;
    const pinnedKey = `pinned_${peerId}`;
    const pinned = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
    const exists = pinned.find(p => p.ts === ts);
    if (exists) pinned.splice(pinned.indexOf(exists), 1);
    else {
        let text = '🔒';
        const localKey = contacts[peerId]?.localSessionKey;
        const remoteKey = contacts[peerId]?.remoteKey;
        const decryptKey = (msg.from === currentUser) ? remoteKey : localKey;
        if (decryptKey && msg.ciphertext) {
            CryptoSystem.decrypt(msg.ciphertext, decryptKey).then(dec => {
                if (dec) text = dec;
                pinned.push({ ts, text });
                localStorage.setItem(pinnedKey, JSON.stringify(pinned));
                loadPinned(peerId);
            });
            return;
        }
        pinned.push({ ts, text });
    }
    localStorage.setItem(pinnedKey, JSON.stringify(pinned));
    loadPinned(peerId);
}

function loadPinned(peerId) {
    const pinned = JSON.parse(localStorage.getItem(`pinned_${peerId}`) || '[]');
    $('pinned-messages').innerHTML = pinned.length ? pinned.map(p => `📌 ${p.text}`).join(' | ') : '';
}

function saveContacts() { localStorage.setItem('contacts', JSON.stringify(contacts)); }

function showSettings() { $('settings-modal').classList.remove('hidden'); }
function closeSettings() { $('settings-modal').classList.add('hidden'); }
function saveSettings() {
    myName = $('name-input').value.trim() || 'You';
    myAvatar = $('avatar-input').value.trim() || '👤';
    localStorage.setItem('myName', myName);
    localStorage.setItem('myAvatar', myAvatar);
    closeSettings();
}
function toggleTheme() {
    document.body.classList.toggle('dark', $('theme-toggle').checked);
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}
function loadTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
        $('theme-toggle').checked = true;
    }
}
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    });
}
function copyOffer() {
    copyToClipboard($('offer-display').value);
    alert('Offer copied again.');
}
function copyAnswer() {
    copyToClipboard($('answer-display').value);
    alert('Answer copied again.');
}

window.onload = () => {
    loadTheme();
    loadSettings();
    $('main-chat').classList.add('hidden');
};