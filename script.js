class CryptoSystem {
    static generateKey() { /* без изменений */ }
    static caesar(str, shift) { /* без изменений */ }
    static sha256(str) { /* без изменений */ }
    static encryptDual(msg, key) { /* без изменений */ }
    static decryptDual(p1, p2, key) { /* без изменений */ }
}

let currentUser, myName = 'You', myAvatar = '👤';
let contacts = {};
let activePeer = null;
let room = null; // Trystero room

function $(id) { return document.getElementById(id); }

function loadSettings() {
    // ... загрузка имени, аватара, uid
    contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    renderContactList();
    // переподключение к комнате, если была активна
    const savedRoom = localStorage.getItem('activeRoom');
    if (savedRoom) {
        room = trystero.joinRoom({appId: '/0byte/'}, savedRoom);
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
            <span class="contact-name">${data.name || peerId.slice(0,8)}</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${peerId}')">✕</button>
        `;
        div.onclick = () => { activePeer = peerId; openChat(peerId); };
        list.appendChild(div);
    });
}

function deleteChat(peerId) {
    if (!confirm('Delete chat and history with ' + (contacts[peerId]?.name || peerId) + '?')) return;
    // удаляем историю
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
    // ... отображение чата
    // скрываем сигнальную зону (она не нужна)
    $('main-chat').classList.add('active');
    $('main-chat').classList.remove('hidden');
    $('sidebar').classList.add('hidden');
    // ...
    updateOnlineStatus();
}

function promptNewRoom() {
    $('new-room-modal').classList.remove('hidden');
    $('room-create').classList.remove('hidden');
    $('room-created').classList.add('hidden');
    $('join-room-input').value = '';
}

function closeNewRoomModal() {
    $('new-room-modal').classList.add('hidden');
}

function generateRoomCode() {
    // генератор слов
    const adj = ['brave','calm','cool','dark','fancy','glad','kind','nice','quick','sharp','swift','wild','wise','young','bold','bright'];
    const noun = ['wolf','fox','cat','bear','hawk','deer','frog','hare','lynx','seal','boar','newt','crab','dove','hawk','wren'];
    return adj[Math.floor(Math.random()*adj.length)] + '-' +
           noun[Math.floor(Math.random()*noun.length)] + '-' +
           Math.floor(Math.random()*100);
}

async function createRoom() {
    const code = generateRoomCode();
    navigator.clipboard.writeText(code);
    $('room-code-display').innerText = code;
    $('room-create').classList.add('hidden');
    $('room-created').classList.remove('hidden');
    // покидаем предыдущую комнату, если есть
    if (room) room.leave();
    room = trystero.joinRoom({appId: '/0byte/'}, code);
    setupRoomListeners();
    localStorage.setItem('activeRoom', code);
}

async function joinRoom() {
    const code = $('join-room-input').value.trim().toLowerCase();
    if (!code) return;
    closeNewRoomModal();
    if (room) room.leave();
    room = trystero.joinRoom({appId: '/0byte/'}, code);
    setupRoomListeners();
    localStorage.setItem('activeRoom', code);
}

function setupRoomListeners() {
    room.onPeerJoin(peerId => {
        if (!contacts[peerId]) {
            contacts[peerId] = { name: peerId.slice(0,8), avatar: '❓', joined: Date.now() };
            saveContacts();
            renderContactList();
        }
        // отправляем свой ключ шифрования новому пиру
        const key = CryptoSystem.generateKey();
        room.send({type:'key', key}, peerId);
    });

    room.onPeerMessage((peerId, data) => {
        if (data.type === 'key') {
            contacts[peerId].sessionKey = data.key;
            saveContacts();
        } else if (data.type === 'message') {
            handleIncomingMessage(peerId, data);
        }
    });

    // при выходе пира обновляем статус
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
    const msgObj = { type:'message', from:currentUser, packets, timestamp: Date.now() };
    room.send(msgObj, activePeer);
    saveMessageToHistory(activePeer, msgObj);
    $('message-input').value = '';
    loadMessages(activePeer);
}

// ... (остальные функции saveMessageToHistory, loadMessages, togglePin, loadPinned и т.д. остаются как в предыдущем ответе)
