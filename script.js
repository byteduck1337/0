class CryptoSystem {
    static generateKey() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    static caesar(str, shift) {
        return [...str].map(c => {
            const code = c.charCodeAt(0);
            if (code >= 32 && code <= 126) return String.fromCharCode(((code - 32 + shift) % 95) + 32);
            return c;
        }).join('');
    }

    static sha256(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    static encryptDual(msg, key) {
        const shift = this.sha256(key) % 95;
        const obj = { text: msg, ts: Date.now() };
        const json = JSON.stringify(obj);
        const hash1 = this.sha256(json).toString();
        const step1 = btoa(unescape(encodeURIComponent(json + '|' + hash1)));
        const p1 = this.caesar(step1, shift);
        const caesarJson = this.caesar(json, shift);
        const step2 = btoa(unescape(encodeURIComponent(caesarJson)));
        const hash2 = this.sha256(step2).toString();
        const p2 = step2 + '|' + hash2;
        return { p1, p2 };
    }

    static decryptDual(p1, p2, key) {
        const shift = this.sha256(key) % 95;
        try {
            const dec1 = this.caesar(p1, 95 - (shift % 95));
            const decStr1 = decodeURIComponent(escape(atob(dec1)));
            const [json1, hash1] = decStr1.split('|');
            if (this.sha256(json1).toString() !== hash1) return null;
            const [b64, hash2] = p2.split('|');
            if (this.sha256(b64).toString() !== hash2) return null;
            const decStr2 = decodeURIComponent(escape(atob(b64)));
            const json2 = this.caesar(decStr2, 95 - (shift % 95));
            if (json1 === json2) return JSON.parse(json1);
            return null;
        } catch (e) { return null; }
    }
}

let currentUser, myName = 'You', myAvatar = '👤';
let contacts = {};
let activePeer = null;
let peerConnection = null;
let dataChannel = null;
let pendingSessionKey = CryptoSystem.generateKey(); // новый ключ для каждого соединения
let partnerOffer = null;

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
}

function renderContactList() {
    const list = $('contact-list');
    list.innerHTML = '';
    Object.entries(contacts).forEach(([peerId, data]) => {
        const div = document.createElement('div');
        div.className = 'contact-item' + (peerId === activePeer ? ' active' : '');
        div.innerHTML = `<span class="contact-avatar">${data.avatar || '👤'}</span> ${data.name || peerId.slice(0, 8)}`;
        div.onclick = () => { activePeer = peerId; openChat(peerId); };
        list.appendChild(div);
    });
}

function openChat(peerId) {
    activePeer = peerId;
    $('partner-name-display').innerText = contacts[peerId]?.name || peerId.slice(0, 8);
    $('partner-avatar').innerText = contacts[peerId]?.avatar || '👤';
    const main = $('main-chat');
    main.classList.add('active');
    main.classList.remove('hidden');
    $('sidebar').classList.add('hidden');
    loadMessages(peerId);
    loadPinned(peerId);
    updateOnlineStatus();
    $('signaling-area').style.display = (dataChannel && dataChannel.readyState === 'open') ? 'none' : 'flex';
    $('offer-textarea').value = '';
    $('answer-textarea').value = '';
}

function goBack() {
    $('main-chat').classList.remove('active');
    $('main-chat').classList.add('hidden');
    $('sidebar').classList.remove('hidden');
    activePeer = null;
}

function promptNewRoom() { $('new-room-modal').classList.remove('hidden'); }
function closeNewRoomModal() { $('new-room-modal').classList.add('hidden'); }

async function createRoom() {
    const tempId = 'partner-' + Math.random().toString(36).substr(2, 6);
    contacts[tempId] = { name: tempId, avatar: '❓' };
    activePeer = tempId;
    saveContacts();
    renderContactList();
    openChat(tempId);
    closeNewRoomModal();
    pendingSessionKey = CryptoSystem.generateKey(); // свежий ключ
    await setupWebRTC(true);
}

async function joinRoom() {
    if (!activePeer) return alert('No active chat.');
    const offerStr = $('offer-textarea').value.trim();
    if (!offerStr) return alert('Paste partner offer first.');
    try {
        partnerOffer = JSON.parse(offerStr);
    } catch (e) { alert('Invalid offer format.'); return; }
    pendingSessionKey = CryptoSystem.generateKey(); // свежий ключ
    await setupWebRTC(false);
}

async function completeConnection() {
    const answerStr = $('answer-textarea').value.trim();
    if (!peerConnection || !answerStr) return alert('No answer to apply.');
    try {
        const answer = JSON.parse(answerStr);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
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
            setupDataChannel();
        };
    }

    if (isOfferer) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGathering();
        const offerStr = JSON.stringify(peerConnection.localDescription);
        $('offer-textarea').value = offerStr;
        copyToClipboard(offerStr);
        alert('Offer copied to clipboard! Send it to your partner.');
    } else {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(partnerOffer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await waitForIceGathering();
        const answerStr = JSON.stringify(peerConnection.localDescription);
        $('answer-textarea').value = answerStr;
        copyToClipboard(answerStr);
        alert('Answer copied to clipboard! Send it back to your partner.');
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
        // Отправляем свой ключ партнёру сразу после открытия канала
        dataChannel.send(JSON.stringify({ type: 'key', key: pendingSessionKey }));
        updateOnlineStatus();
        $('signaling-area').style.display = 'none';
    };
    dataChannel.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'key') {
            contacts[activePeer].sessionKey = data.key;
            saveContacts();
            // Можно показать уведомление, что ключ получен
        } else if (data.type === 'message') {
            handleIncomingMessage(activePeer, data);
        }
    };
}

function sendMessage() {
    const text = $('message-input').value.trim();
    if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') {
        alert('No connection.');
        return;
    }
    const sessionKey = contacts[activePeer]?.sessionKey;
    if (!sessionKey) {
        alert('Encryption key not yet exchanged. Please wait a moment.');
        return;
    }
    const packets = CryptoSystem.encryptDual(text, sessionKey);
    const msgObj = { type: 'message', from: currentUser, packets, timestamp: Date.now() };
    dataChannel.send(JSON.stringify(msgObj));
    saveMessageToHistory(activePeer, msgObj);
    $('message-input').value = '';
    loadMessages(activePeer);
}

function handleIncomingMessage(peerId, data) {
    saveMessageToHistory(peerId, data);
    if (peerId === activePeer) loadMessages(peerId);
}

function saveMessageToHistory(peerId, msg) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    hist.push(msg);
    localStorage.setItem(key, JSON.stringify(hist));
}

function loadMessages(peerId) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    const container = $('messages');
    container.innerHTML = '';
    hist.forEach(msg => {
        const isMine = msg.from === currentUser;
        const sessionKey = contacts[peerId]?.sessionKey;
        let content = '🔒 Encrypted';
        if (sessionKey && msg.packets) {
            const dec = CryptoSystem.decryptDual(msg.packets.p1, msg.packets.p2, sessionKey);
            if (dec) content = dec.text;
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
    });
    container.scrollTop = container.scrollHeight;
}

function updateOnlineStatus() {
    const status = dataChannel && dataChannel.readyState === 'open' ? '🟢 Online' : '⚪ Disconnected';
    $('online-status').innerText = status;
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
        const sessionKey = contacts[peerId]?.sessionKey;
        if (sessionKey && msg.packets) {
            const dec = CryptoSystem.decryptDual(msg.packets.p1, msg.packets.p2, sessionKey);
            if (dec) text = dec.text;
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

window.onload = () => {
    loadTheme();
    loadSettings();
    $('main-chat').classList.add('hidden');
    $('signaling-area').style.display = 'none';
};
