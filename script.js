// Crypto system (dual packet, no manual keys)
class CryptoSystem {
    static generateKey() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2,'0')).join('');
    }
    static caesar(str, shift) {
        return [...str].map(c => {
            const code = c.charCodeAt(0);
            if (code>=32 && code<=126) return String.fromCharCode(((code-32+shift)%95)+32);
            return c;
        }).join('');
    }
    static sha256(str) {
        let hash = 0;
        for (let i=0; i<str.length; i++) {
            const ch = str.charCodeAt(i);
            hash = ((hash<<5)-hash) + ch;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }
    static encryptDual(msg, key) {
        const shift = this.sha256(key) % 95;
        const obj = { text: msg, ts: Date.now() };
        const json = JSON.stringify(obj);
        // Packet 1: sha256 -> base64 -> caesar
        const hash1 = this.sha256(json).toString();
        const step1 = btoa(unescape(encodeURIComponent(json+'|'+hash1)));
        const p1 = this.caesar(step1, shift);
        // Packet 2: caesar -> base64 -> sha256
        const caesarJson = this.caesar(json, shift);
        const step2 = btoa(unescape(encodeURIComponent(caesarJson)));
        const hash2 = this.sha256(step2).toString();
        const p2 = step2+'|'+hash2;
        return {p1, p2};
    }
    static decryptDual(p1, p2, key) {
        const shift = this.sha256(key) % 95;
        try {
            // Decode p1
            const dec1 = this.caesar(p1, 95-(shift%95));
            const decStr1 = decodeURIComponent(escape(atob(dec1)));
            const [json1, hash1] = decStr1.split('|');
            if (this.sha256(json1).toString() !== hash1) return null;
            // Decode p2
            const [b64, hash2] = p2.split('|');
            if (this.sha256(b64).toString() !== hash2) return null;
            const decStr2 = decodeURIComponent(escape(atob(b64)));
            const json2 = this.caesar(decStr2, 95-(shift%95));
            if (json1 === json2) return JSON.parse(json1);
            return null;
        } catch(e) { return null; }
    }
}

// Global state
let currentUser, myName='You', myAvatar='👤';
let contacts = {}; // { peerId: { name, avatar, roomKey?, joined } }
let activePeer = null;
let roomName = null;
let room = null; // trystero room
let pendingRoom = null;

// Load saved data
function loadSettings() {
    myName = localStorage.getItem('myName') || 'You';
    myAvatar = localStorage.getItem('myAvatar') || '👤';
    currentUser = localStorage.getItem('uid');
    if (!currentUser) {
        currentUser = CryptoSystem.generateKey().slice(0,16);
        localStorage.setItem('uid', currentUser);
    }
    document.getElementById('name-input').value = myName;
    document.getElementById('avatar-input').value = myAvatar;
    contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    renderContactList();
    // Если была активная комната, переподключиться
    const savedRoom = localStorage.getItem('activeRoom');
    if (savedRoom) {
        roomName = savedRoom;
        joinExistingRoom(roomName);
    }
}

function renderContactList() {
    const list = document.getElementById('contact-list');
    list.innerHTML = '';
    Object.entries(contacts).forEach(([peerId, data]) => {
        const div = document.createElement('div');
        div.className = 'contact-item' + (peerId === activePeer ? ' active' : '');
        div.innerHTML = `<span class="contact-avatar">${data.avatar||'👤'}</span> ${data.name||peerId.slice(0,8)}`;
        div.onclick = () => openChat(peerId);
        list.appendChild(div);
    });
}

function openChat(peerId) {
    activePeer = peerId;
    document.getElementById('partner-name-display').innerText = contacts[peerId]?.name || peerId.slice(0,8);
    document.getElementById('partner-avatar').innerText = contacts[peerId]?.avatar || '👤';
    document.getElementById('main-chat').classList.add('active');
    if (window.innerWidth <= 700) document.getElementById('sidebar').classList.add('hidden');
    loadMessages(peerId);
    updateOnlineStatus();
}

function goBack() {
    document.getElementById('main-chat').classList.remove('active');
    document.getElementById('sidebar').classList.remove('hidden');
    activePeer = null;
}

// Room management
function promptNewRoom() {
    document.getElementById('new-room-modal').classList.remove('hidden');
    document.getElementById('room-placeholder').classList.remove('hidden');
    document.getElementById('room-created').classList.add('hidden');
    document.getElementById('join-room-input').value = '';
}

function closeNewRoomModal() {
    document.getElementById('new-room-modal').classList.add('hidden');
}

function generateRoomCode() {
    const adj = ['brave','calm','cool','dark','fancy','glad','kind','nice','quick','sharp','swift','wild','wise','young','bold','bright'];
    const noun = ['wolf','fox','cat','bear','hawk','deer','frog','hare','lynx','seal','boar','newt','crab','dove','hawk','wren'];
    return adj[Math.floor(Math.random()*adj.length)] + '-' +
           noun[Math.floor(Math.random()*noun.length)] + '-' +
           Math.floor(Math.random()*100);
}

async function createRoom() {
    roomName = generateRoomCode();
    navigator.clipboard.writeText(roomName);
    document.getElementById('room-code-display').innerText = roomName;
    document.getElementById('room-placeholder').classList.add('hidden');
    document.getElementById('room-created').classList.remove('hidden');
    joinExistingRoom(roomName);
}

async function joinRoom() {
    const code = document.getElementById('join-room-input').value.trim().toLowerCase();
    if (!code) return;
    roomName = code;
    closeNewRoomModal();
    joinExistingRoom(roomName);
}

async function joinExistingRoom(name) {
    if (room) room.leave();
    room = trystero.joinRoom({appId: '/0byte/'}, name);
    room.onPeerJoin(peerId => {
        if (!contacts[peerId]) {
            contacts[peerId] = { name: peerId.slice(0,8), avatar: '❓', joined: Date.now() };
            saveContacts();
            renderContactList();
        }
        // Exchange encryption keys automatically
        room.send({type:'key', key: CryptoSystem.generateKey()}, peerId); // send our fresh session key
    });
    room.onPeerLeave(peerId => {
        updateOnlineStatus();
    });
    room.onPeerMessage((peerId, data) => {
        if (data.type === 'key') {
            contacts[peerId].sessionKey = data.key;
            saveContacts();
        } else if (data.type === 'message') {
            handleIncomingMessage(peerId, data);
        }
    });
    localStorage.setItem('activeRoom', name);
    // If room already has peers? (after rejoin)
    updateOnlineStatus();
}

function saveContacts() {
    localStorage.setItem('contacts', JSON.stringify(contacts));
}

// Messaging
function sendMessage() {
    const text = document.getElementById('message-input').value.trim();
    if (!text || !activePeer || !room) return;
    const sessionKey = contacts[activePeer]?.sessionKey;
    if (!sessionKey) { alert('Encryption key not exchanged yet'); return; }
    const packets = CryptoSystem.encryptDual(text, sessionKey);
    const msgObj = { type:'message', from: currentUser, packets, timestamp: Date.now() };
    room.send(msgObj, activePeer);
    saveMessageToHistory(activePeer, msgObj);
    document.getElementById('message-input').value = '';
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
    const container = document.getElementById('messages');
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
    const status = document.getElementById('online-status');
    if (!activePeer) return;
    const online = room && room.getPeers().includes(activePeer);
    status.innerText = online ? '🟢 Online' : '⚪ Offline';
}

// Pinning
function togglePin(peerId, ts) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    const msg = hist.find(m => m.timestamp === ts);
    if (!msg) return;
    const pinnedKey = `pinned_${peerId}`;
    const pinned = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
    const exists = pinned.find(p => p.ts === ts);
    if (exists) pinned.splice(pinned.indexOf(exists),1);
    else {
        let text = '🔒';
        const sessionKey = contacts[peerId]?.sessionKey;
        if (sessionKey && msg.packets) {
            const dec = CryptoSystem.decryptDual(msg.packets.p1, msg.packets.p2, sessionKey);
            if (dec) text = dec.text;
        }
        pinned.push({ts, text});
    }
    localStorage.setItem(pinnedKey, JSON.stringify(pinned));
    loadPinned(peerId);
}
function loadPinned(peerId) {
    const pinned = JSON.parse(localStorage.getItem(`pinned_${peerId}`) || '[]');
    document.getElementById('pinned-messages').innerHTML =
        pinned.length ? pinned.map(p => `📌 ${p.text}`).join(' | ') : '';
}

// Settings & theme
function showSettings() { document.getElementById('settings-modal').classList.remove('hidden'); }
function closeSettings() { document.getElementById('settings-modal').classList.add('hidden'); }
function saveSettings() {
    myName = document.getElementById('name-input').value.trim() || 'You';
    myAvatar = document.getElementById('avatar-input').value.trim() || '👤';
    localStorage.setItem('myName', myName);
    localStorage.setItem('myAvatar', myAvatar);
    closeSettings();
}
function toggleTheme() {
    document.body.classList.toggle('dark', document.getElementById('theme-toggle').checked);
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}
function loadTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark');
        document.getElementById('theme-toggle').checked = true;
    }
}

window.onload = () => {
    loadTheme();
    loadSettings();
};
