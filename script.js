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
let room = null;

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
    const savedRoom = localStorage.getItem('activeRoom');
    if (savedRoom) {
        room = trystero.joinRoom({ appId: '/0byte/' }, savedRoom);
        setupRoomListeners();
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
    $('room-created').classList.add('hidden');
    $('join-room-input').value = '';
}

function closeNewRoomModal() { $('new-room-modal').classList.add('hidden'); }

function generateRoomCode() {
    const adj = ['brave','calm','cool','dark','fancy','glad','kind','nice','quick','sharp','swift','wild','wise','young','bold','bright'];
    const noun = ['wolf','fox','cat','bear','hawk','deer','frog','hare','lynx','seal','boar','newt','crab','dove','hawk','wren'];
    return adj[Math.floor(Math.random() * adj.length)] + '-' +
           noun[Math.floor(Math.random() * noun.length)] + '-' +
           Math.floor(Math.random() * 100);
}

async function createRoom() {
    const code = generateRoomCode();
    navigator.clipboard.writeText(code);
    $('room-code-display').innerText = code;
    $('room-create').classList.add('hidden');
    $('room-created').classList.remove('hidden');
    if (room) room.leave();
    room = trystero.joinRoom({ appId: '/0byte/' }, code);
    setupRoomListeners();
    localStorage.setItem('activeRoom', code);
}

async function joinRoom() {
    const code = $('join-room-input').value.trim().toLowerCase();
    if (!code) return;
    closeNewRoomModal();
    if (room) room.leave();
    room = trystero.joinRoom({ appId: '/0byte/' }, code);
    setupRoomListeners();
    localStorage.setItem('activeRoom', code);
}

function setupRoomListeners() {
    room.onPeerJoin(peerId => {
        if (!contacts[peerId]) {
            contacts[peerId] = { name: peerId.slice(0, 8), avatar: '❓', joined: Date.now() };
            saveContacts();
            renderContactList();
        }
        const key = CryptoSystem.generateKey();
        room.send({ type: 'key', key }, peerId);
    });

    room.onPeerMessage((peerId, data) => {
        if (data.type === 'key') {
            contacts[peerId].sessionKey = data.key;
            saveContacts();
        } else if (data.type === 'message') {
            handleIncomingMessage(peerId, data);
        }
    });

    room.onPeerLeave(peerId => {
        updateOnlineStatus();
    });
}

function sendMessage() {
    const text = $('message-input').value.trim();
    if (!text || !activePeer || !room) return;
    const sessionKey = contacts[activePeer]?.sessionKey;
    if (!sessionKey) {
        alert('Encryption key not yet exchanged. Please wait...');
        return;
    }
    const packets = CryptoSystem.encryptDual(text, sessionKey);
    const msgObj = { type: 'message', from: currentUser, packets, timestamp: Date.now() };
    room.send(msgObj, activePeer);
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
    if (!activePeer || !room) return;
    const online = room.getPeers().includes(activePeer);
    $('online-status').innerText = online ? '🟢 Online' : '⚪ Offline';
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

window.onload = () => {
    loadTheme();
    loadSettings();
    $('main-chat').classList.add('hidden');
};
