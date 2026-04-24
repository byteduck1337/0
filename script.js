// Crypto System
class CryptoSystem {
    static generateKey() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    static caesarEncrypt(text, shift) {
        return text.split('').map(char => {
            const code = char.charCodeAt(0);
            if (code >= 32 && code <= 126) {
                return String.fromCharCode(((code - 32 + shift) % 95) + 32);
            }
            return char;
        }).join('');
    }

    static caesarDecrypt(text, shift) {
        return this.caesarEncrypt(text, 95 - (shift % 95));
    }

    static sha256Simple(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    static encryptDual(message, key) {
        const shift = this.sha256Simple(key) % 95;
        const msgObj = { text: message, ts: Date.now(), sender: currentUser };
        const json = JSON.stringify(msgObj);

        const hash1 = this.sha256Simple(json).toString();
        const step1 = btoa(unescape(encodeURIComponent(json + '|' + hash1)));
        const packet1 = this.caesarEncrypt(step1, shift);

        const caesarJson = this.caesarEncrypt(json, shift);
        const step2 = btoa(unescape(encodeURIComponent(caesarJson)));
        const hash2 = this.sha256Simple(step2).toString();
        const packet2 = step2 + '|' + hash2;

        return { p1: packet1, p2: packet2 };
    }

    static decryptDual(p1, p2, key) {
        const shift = this.sha256Simple(key) % 95;
        try {
            const caesarDec1 = this.caesarDecrypt(p1, shift);
            const decoded1 = decodeURIComponent(escape(atob(caesarDec1)));
            const [json1, hash1] = decoded1.split('|');
            if (this.sha256Simple(json1).toString() !== hash1) return null;

            const [b64, hash2] = p2.split('|');
            if (this.sha256Simple(b64).toString() !== hash2) return null;
            const decoded2 = decodeURIComponent(escape(atob(b64)));
            const json2 = this.caesarDecrypt(decoded2, shift);

            if (json1 === json2) {
                return JSON.parse(json1);
            }
            return null;
        } catch (e) {
            return null;
        }
    }
}

let currentUser = null;
let myEncryptionKey = null;
let myName = 'User';
let myAvatar = '👤';
let gistId = '';
let githubToken = '';
let contacts = {};
let activeChat = null;
let peerConnection = null;
let dataChannel = null;
let pendingMessages = [];

function loadSettings() {
    myName = localStorage.getItem('myName') || 'User';
    myAvatar = localStorage.getItem('myAvatar') || '👤';
    currentUser = localStorage.getItem('messenger_username');
    myEncryptionKey = localStorage.getItem('messenger_my_key');
    if (!currentUser || !myEncryptionKey) {
        currentUser = 'user-' + Math.random().toString(36).substring(2, 8);
        myEncryptionKey = CryptoSystem.generateKey();
        localStorage.setItem('messenger_username', currentUser);
        localStorage.setItem('messenger_my_key', myEncryptionKey);
    }
    document.getElementById('name-input').value = myName;
    document.getElementById('avatar-input').value = myAvatar;
    gistId = localStorage.getItem('gist_id') || '';
    githubToken = localStorage.getItem('github_token') || '';
    document.getElementById('gist-url-input').value = gistId ? 'https://gist.github.com/' + gistId : '';
    document.getElementById('token-input').value = githubToken;
    contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    renderContactList();
    if (activeChat) openChat(activeChat);
}

function saveSettings() {
    myName = document.getElementById('name-input').value.trim() || 'User';
    myAvatar = document.getElementById('avatar-input').value.trim() || '👤';
    localStorage.setItem('myName', myName);
    localStorage.setItem('myAvatar', myAvatar);
    const url = document.getElementById('gist-url-input').value.trim();
    githubToken = document.getElementById('token-input').value.trim();
    if (url && githubToken) {
        gistId = extractGistId(url);
        localStorage.setItem('gist_id', gistId);
        localStorage.setItem('github_token', githubToken);
        document.getElementById('settings-status').innerText = 'Saved.';
        initSignalPolling();
    } else {
        document.getElementById('settings-status').innerText = 'Gist URL and token required.';
    }
    closeSettings();
}

function extractGistId(url) {
    const match = url.match(/gist\.github\.com\/(?:[^\/]+\/)?([a-f0-9]+)/i);
    return match ? match[1] : url.trim();
}

function addContactPrompt() {
    document.getElementById('add-contact-modal').classList.remove('hidden');
}
function closeAddContact() {
    document.getElementById('add-contact-modal').classList.add('hidden');
}
function connectToPartner() {
    const key = document.getElementById('new-contact-key').value.trim();
    if (!key) return;
    let partner = Object.keys(contacts).find(u => contacts[u].key === key);
    if (!partner) {
        partner = 'partner-' + Math.random().toString(36).substr(2, 6);
        contacts[partner] = { key, name: partner, avatar: '❓' };
        saveContacts();
    }
    activeChat = partner;
    localStorage.setItem('activeChat', partner);
    document.getElementById('add-contact-modal').classList.add('hidden');
    renderContactList();
    openChat(partner);
    initiateWebRTC(partner);
}
function saveContacts() {
    localStorage.setItem('contacts', JSON.stringify(contacts));
}
function renderContactList() {
    const list = document.getElementById('contact-list');
    list.innerHTML = '';
    Object.keys(contacts).forEach(username => {
        const c = contacts[username];
        const div = document.createElement('div');
        div.className = 'contact-item' + (username === activeChat ? ' active' : '');
        div.innerHTML = `<span class="contact-avatar">${c.avatar || '👤'}</span> ${c.name || username}`;
        div.onclick = () => { activeChat = username; openChat(username); renderContactList(); };
        list.appendChild(div);
    });
}

function openChat(username) {
    document.getElementById('sidebar').classList.add('visible');
    document.getElementById('main-chat').classList.remove('hidden');
    const c = contacts[username];
    document.getElementById('partner-name-display').innerText = c?.name || username;
    document.getElementById('partner-avatar').innerText = c?.avatar || '👤';
    activeChat = username;
    localStorage.setItem('activeChat', username);
    loadMessages(username);
    loadPinned(username);
    updateOnlineStatus();
}
function goBack() {
    document.getElementById('main-chat').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('visible');
    activeChat = null;
}

async function initiateWebRTC(partner) {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(configuration);
    dataChannel = peerConnection.createDataChannel('chat');
    setupDataChannel(dataChannel);
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            // собираем ICE и позже отправим вместе с offer
        }
    };
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    peerConnection.onicegatheringstatechange = () => {
        if (peerConnection.iceGatheringState === 'complete') {
            saveSignal('offer', JSON.stringify(peerConnection.localDescription));
        }
    };
    setTimeout(() => {
        if (peerConnection.iceGatheringState !== 'complete') {
            saveSignal('offer', JSON.stringify(peerConnection.localDescription));
        }
    }, 3000);
}

function setupDataChannel(channel) {
    channel.onopen = () => {
        document.getElementById('online-status').innerText = '🟢 Online';
        pendingMessages.forEach(msg => channel.send(JSON.stringify(msg)));
        pendingMessages = [];
    };
    channel.onmessage = event => {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
            handleIncomingMessage(data);
        }
    };
}

async function checkForAnswer() {
    if (!gistId || !githubToken || !activeChat) return;
    const signal = await loadSignal();
    if (signal && signal.answer && !peerConnection) {
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(configuration);
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };
        await peerConnection.setRemoteDescription(JSON.parse(signal.answer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        saveSignal('answer', JSON.stringify(peerConnection.localDescription));
    } else if (signal && signal.offer && !peerConnection) {
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(configuration);
        peerConnection.ondatachannel = event => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel);
        };
        await peerConnection.setRemoteDescription(JSON.parse(signal.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        saveSignal('answer', JSON.stringify(peerConnection.localDescription));
    }
}

async function saveSignal(type, sdp) {
    const signal = { [type]: sdp };
    await fetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: { 'signal.json': { content: JSON.stringify(signal) } } })
    });
}
async function loadSignal() {
    try {
        const res = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: { 'Authorization': `token ${githubToken}` }
        });
        const gist = await res.json();
        const file = gist.files?.['signal.json'];
        return file ? JSON.parse(file.content) : null;
    } catch (e) { return null; }
}

function sendMessage() {
    const text = document.getElementById('message-input').value.trim();
    if (!text || !activeChat || !dataChannel || dataChannel.readyState !== 'open') {
        alert('No P2P connection.');
        return;
    }
    const partnerKey = contacts[activeChat]?.key;
    if (!partnerKey) return;
    const packets = CryptoSystem.encryptDual(text, partnerKey);
    const msgObj = {
        type: 'message',
        from: currentUser,
        to: activeChat,
        packets,
        timestamp: Date.now()
    };
    dataChannel.send(JSON.stringify(msgObj));
    saveMessageToHistory(activeChat, msgObj);
    document.getElementById('message-input').value = '';
    loadMessages(activeChat);
}

function handleIncomingMessage(data) {
    saveMessageToHistory(activeChat, data);
    loadMessages(activeChat);
}

function saveMessageToHistory(partner, msg) {
    const histKey = `history_${[currentUser, partner].sort().join('_')}`;
    let hist = JSON.parse(localStorage.getItem(histKey) || '[]');
    hist.push(msg);
    localStorage.setItem(histKey, JSON.stringify(hist));
}
function loadMessages(partner) {
    const histKey = `history_${[currentUser, partner].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(histKey) || '[]');
    const container = document.getElementById('messages');
    container.innerHTML = '';
    hist.forEach(msg => {
        const isMine = msg.from === currentUser;
        const partnerKey = isMine ? myEncryptionKey : contacts[partner]?.key;
        let content = '🔒 Encrypted';
        if (partnerKey && msg.packets) {
            const dec = CryptoSystem.decryptDual(msg.packets.p1, msg.packets.p2, partnerKey);
            if (dec) content = dec.text;
        }
        const div = document.createElement('div');
        div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
        div.innerHTML = `
            <div class="message-bubble">${content}</div>
            <div class="message-meta">
                <span>${new Date(msg.timestamp).toLocaleTimeString()}</span>
                <button class="pin-btn" onclick="togglePin('${partner}', ${msg.timestamp})">📌</button>
            </div>`;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

function loadPinned(partner) {
    const pinned = JSON.parse(localStorage.getItem(`pinned_${partner}`) || '[]');
    const container = document.getElementById('pinned-messages');
    if (pinned.length === 0) { container.innerHTML = ''; return; }
    container.innerHTML = pinned.map(p => `<div class="pinned-msg">📌 ${p.text} <small>${new Date(p.ts).toLocaleTimeString()}</small></div>`).join('');
}
function togglePin(partner, timestamp) {
    const histKey = `history_${[currentUser, partner].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(histKey) || '[]');
    const msg = hist.find(m => m.timestamp === timestamp);
    if (!msg) return;
    const pinned = JSON.parse(localStorage.getItem(`pinned_${partner}`) || '[]');
    const already = pinned.find(p => p.ts === timestamp);
    if (already) {
        const idx = pinned.indexOf(already);
        pinned.splice(idx, 1);
    } else {
        const decKey = contacts[partner]?.key;
        let text = '🔒';
        if (decKey && msg.packets) {
            const dec = CryptoSystem.decryptDual(msg.packets.p1, msg.packets.p2, decKey);
            if (dec) text = dec.text;
        }
        pinned.push({ ts: timestamp, text });
    }
    localStorage.setItem(`pinned_${partner}`, JSON.stringify(pinned));
    loadPinned(partner);
}

function updateOnlineStatus() {
    document.getElementById('online-status').innerText = (dataChannel && dataChannel.readyState === 'open') ? '🟢 Online' : '⚪ Waiting...';
}

function showSettings() {
    document.getElementById('settings-modal').classList.remove('hidden');
}
function closeSettings() {
    document.getElementById('settings-modal').classList.add('hidden');
}

function initSignalPolling() {
    setInterval(checkForAnswer, 2000);
}

window.onload = () => {
    loadSettings();
    if (gistId && githubToken) initSignalPolling();
};
