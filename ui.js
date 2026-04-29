// ui.js
// Весь интерфейс: рендеринг, модальные окна, настройки, визуализация.
// Все обращения к DOM-элементам проверяются на существование.

function $(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Элемент с id="${id}" не найден`);
    return el;
}

// Безопасное получение элемента (без предупреждений)
function getEl(id) { return document.getElementById(id); }

// ==================== Настройки и контакты ====================
function loadSettings() {
    myName = localStorage.getItem('myName') || 'Вы';
    myAvatar = localStorage.getItem('myAvatar') || '';
    currentUser = localStorage.getItem('uid');
    if (!currentUser) {
        currentUser = CryptoSystem.generateKey().slice(0, 16);
        localStorage.setItem('uid', currentUser);
    }

    const nameInput = getEl('name-input');
    if (nameInput) nameInput.value = myName;
    const avatarInput = getEl('avatar-input');
    if (avatarInput) avatarInput.value = myAvatar;

    contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    renderContactList();

    // Восстановление активного чата
    const savedActivePeer = localStorage.getItem('activePeer');
    if (savedActivePeer && contacts[savedActivePeer]) {
        activePeer = savedActivePeer;
        openChat(activePeer);
    } else {
        const mainChat = getEl('main-chat');
        const sidebar = getEl('sidebar');
        if (mainChat) mainChat.classList.add('hidden');
        if (sidebar) sidebar.classList.remove('hidden');
    }
}

function renderContactList() {
    const list = getEl('contact-list');
    if (!list) return;
    list.innerHTML = '';
    Object.entries(contacts).forEach(([peerId, data]) => {
        const div = document.createElement('div');
        div.className = 'contact-item' + (peerId === activePeer ? ' active' : '');
        div.innerHTML = `
            <span class="contact-avatar">${data.avatar || '👤'}</span>
            <span class="contact-name">${data.name || peerId.slice(0, 8)}</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${peerId}')">✕</button>
        `;
        div.onclick = () => { 
            activePeer = peerId; 
            localStorage.setItem('activePeer', peerId);
            openChat(peerId); 
        };
        list.appendChild(div);
    });
}

function deleteChat(peerId) {
    if (!confirm('Удалить чат и историю с ' + (contacts[peerId]?.name || peerId) + '?')) return;
    const histKey = `history_${[currentUser, peerId].sort().join('_')}`;
    localStorage.removeItem(histKey);
    localStorage.removeItem(`pinned_${peerId}`);
    localStorage.removeItem(`role_${peerId}`);
    delete contacts[peerId];
    saveContacts();
    if (activePeer === peerId) {
        activePeer = null;
        localStorage.removeItem('activePeer');
        const mainChat = getEl('main-chat');
        const sidebar = getEl('sidebar');
        if (mainChat) mainChat.classList.add('hidden');
        if (sidebar) sidebar.classList.remove('hidden');
    }
    renderContactList();
}

function saveContacts() {
    localStorage.setItem('contacts', JSON.stringify(contacts));
}

// ==================== Управление чатом (UI) ====================
function openChat(peerId) {
    if (!contacts[peerId]) {
        contacts[peerId] = { name: peerId.slice(0, 8), avatar: '' };
        saveContacts();
        renderContactList();
    }

    // Если уже есть активное соединение с этим пиром
    if (dataChannel && dataChannel.readyState === 'open' && connectedPeerId === peerId) {
        updateUIForPeer(peerId);
        return;
    }

    // Если есть сохранённая сессия
    if (contacts[peerId].localSessionKey) {
        pendingLocalKey = contacts[peerId].localSessionKey;
        connectedPeerId = peerId;
        setupPeerConnection(peerId);
        updateUIForPeer(peerId);
        
        // Проверяем через 5 секунд, установилось ли соединение
        setTimeout(() => {
            if (!dataChannel || dataChannel.readyState !== 'open') {
                const restorePanel = getEl('restore-panel');
                if (restorePanel) restorePanel.classList.add('visible');
            }
        }, 5000);
    } else {
        // Новая сессия
        pendingLocalKey = CryptoSystem.generateKey();
        contacts[peerId].localSessionKey = pendingLocalKey;
        saveContacts();
        connectedPeerId = peerId;
        setupPeerConnection(peerId);
        updateUIForPeer(peerId);
    }
}

function restoreChat() {
    const peerId = activePeer || connectedPeerId;
    if (!peerId) return;
    
    restoreSession(peerId);
}

function updateUIForPeer(peerId) {
    console.log('updateUIForPeer called for:', peerId);
    activePeer = peerId;
    localStorage.setItem('activePeer', peerId);
    
    const mainChat = getEl('main-chat');
    const sidebar = getEl('sidebar');
    
    // Показываем основной чат
    if (mainChat) {
        mainChat.classList.remove('hidden');
        mainChat.style.display = 'flex';
    }
    
    // Скрываем боковую панель на мобильных
    if (sidebar && window.innerWidth <= 700) {
        sidebar.classList.remove('visible');
        sidebar.classList.add('hidden');
    }

    const peer = contacts[peerId] || {};
    const chatName = getEl('chat-name');
    if (chatName) chatName.textContent = peer.name || peerId.slice(0, 8);
    
    const chatAvatar = getEl('chat-avatar');
    if (chatAvatar) chatAvatar.textContent = peer.avatar || '👤';
    
    const chatStatus = getEl('chat-status');
    if (chatStatus) {
        const isConnected = dataChannel && dataChannel.readyState === 'open';
        chatStatus.textContent = isConnected ? 'онлайн' : 'подключение...';
    }

    updateKeyDisplay();
    loadMessages(peerId);
    loadPinned(peerId);
    renderContactList();

    // Скрываем панель восстановления, если соединение активно
    if (dataChannel && dataChannel.readyState === 'open') {
        const restorePanel = getEl('restore-panel');
        if (restorePanel) restorePanel.classList.remove('visible');
    }
}

async function loadMessages(peerId) {
    const container = getEl('messages');
    if (!container) return;
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    container.innerHTML = '';
    const localKey = contacts[peerId]?.localSessionKey;
    const remoteKey = contacts[peerId]?.remoteKey;
    
    for (const msg of hist) {
        const isMine = msg.from === currentUser;
        let content = '';
        
        if (msg.type === 'image') {
            const decryptKey = isMine ? remoteKey : localKey;
            if (decryptKey && msg.ciphertext) {
                try {
                    const decrypted = await CryptoSystem.decryptData(msg.ciphertext, decryptKey);
                    if (decrypted) {
                        const blob = new Blob([decrypted], { type: msg.mimeType || 'image/jpeg' });
                        const url = URL.createObjectURL(blob);
                        content = `<img src="${url}" alt="изображение" loading="lazy" />`;
                    } else {
                        content = '🔒 Зашифрованное изображение';
                    }
                } catch (e) {
                    content = '🔒 Зашифрованное изображение';
                }
            } else {
                content = '🔒 Зашифрованное изображение';
            }
        } else {
            const decryptKey = isMine ? remoteKey : localKey;
            if (decryptKey && msg.ciphertext) {
                const decrypted = await CryptoSystem.decrypt(msg.ciphertext, decryptKey);
                if (decrypted !== null) {
                    content = decrypted;
                } else {
                    content = '🔒 Зашифровано';
                }
            } else {
                content = '🔒 Зашифровано';
            }
        }
        
        const div = document.createElement('div');
        div.className = `message ${isMine ? 'my-message' : 'other-message'}`;
        div.innerHTML = `
            <div class="message-content">${content}</div>
            <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        `;
        container.appendChild(div);
    }
    
    // Прокрутка вниз
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}

function updateOnlineStatus() {
    const onlineStatusEl = getEl('online-status');
    if (onlineStatusEl) {
        const status = (dataChannel && dataChannel.readyState === 'open') ? '🟢 Онлайн' : '⚪ Отключен';
        onlineStatusEl.innerText = status;
    }
    
    const chatStatusEl = getEl('chat-status');
    if (chatStatusEl && activePeer) {
        chatStatusEl.textContent = (dataChannel && dataChannel.readyState === 'open') ? 'онлайн' : 'офлайн';
    }
    
    // Управление панелью восстановления
    const restorePanel = getEl('restore-panel');
    if (restorePanel && activePeer) {
        if (dataChannel && dataChannel.readyState === 'open') {
            restorePanel.classList.remove('visible');
        }
    }
}

function updateKeyDisplay() {
    if (!activePeer) return;
    const myKeyEl = getEl('my-key-display');
    const partnerKeyEl = getEl('partner-key-display');
    const localKey = contacts[activePeer]?.localSessionKey;
    const remoteKey = contacts[activePeer]?.remoteKey;
    if (myKeyEl) myKeyEl.innerText = localKey ? localKey.slice(0, 8) + '...' : 'none';
    if (partnerKeyEl) partnerKeyEl.innerText = remoteKey ? remoteKey.slice(0, 8) + '...' : '(ожидание...)';
}

// Обработка загрузки изображения
function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        sendImage(file);
        event.target.value = '';
    }
}

// Закреплённые сообщения
function togglePin(peerId, ts) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    const msg = hist.find(m => m.timestamp === ts);
    if (!msg) return;
    const pinnedKey = `pinned_${peerId}`;
    const pinned = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
    const exists = pinned.find(p => p.ts === ts);
    if (exists) {
        pinned = pinned.filter(p => p.ts !== ts);
    } else {
        let text = '';
        if (msg.type === 'image') {
            text = '🖼️ Изображение';
        } else if (msg.ciphertext) {
            const decryptKey = (msg.from === currentUser) ? contacts[peerId]?.remoteKey : contacts[peerId]?.localSessionKey;
            if (decryptKey) {
                CryptoSystem.decrypt(msg.ciphertext, decryptKey).then(dec => {
                    if (dec) {
                        text = dec;
                        pinned.push({ ts, text });
                        localStorage.setItem(pinnedKey, JSON.stringify(pinned));
                        loadPinned(peerId);
                    }
                });
                return;
            }
        }
        pinned.push({ ts, text });
    }
    localStorage.setItem(pinnedKey, JSON.stringify(pinned));
    loadPinned(peerId);
}

function loadPinned(peerId) {
    const pinnedMsgs = getEl('pinned-messages');
    if (!pinnedMsgs) return;
    const pinned = JSON.parse(localStorage.getItem(`pinned_${peerId}`) || '[]');
    pinnedMsgs.innerHTML = pinned.length ? pinned.map(p => `📌 ${p.text}`).join(' | ') : 'Нет закреплённых сообщений';
}

function togglePinnedPanel() {
    const panel = getEl('pinned-panel');
    if (panel) panel.classList.toggle('visible');
}

// ==================== Модальные окна и flow ====================
function showNewChat() {
    resetToRoleSelect();
    const modal = getEl('new-chat-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeNewChat() {
    const modal = getEl('new-chat-modal');
    if (modal) modal.classList.add('hidden');
    // Не сбрасываем соединение при закрытии модалки!
}

function resetToRoleSelect() {
    showSection('role-select-section');
    // Сбрасываем видимость step-content
    document.querySelectorAll('.step-content').forEach(el => {
        el.classList.remove('visible');
    });
}

function showSection(sectionId) {
    ['role-select-section', 'host-flow', 'join-flow'].forEach(id => {
        const el = getEl(id);
        if (el) el.classList.add('hidden');
    });
    const target = getEl(sectionId);
    if (target) target.classList.remove('hidden');
    
    // Сбрасываем анимации
    document.querySelectorAll('.step-content').forEach(el => {
        el.classList.remove('visible');
    });
}

async function startHostFlow() {
    showSection('host-flow');
    const hostInviteArea = getEl('host-invite-area');
    const hostResponseArea = getEl('host-response-area');
    const hostWaiting = getEl('host-waiting');
    const hostConnectBtn = getEl('host-connect-btn');
    const hostAnswerInput = getEl('host-answer-input');
    const hostOfferWords = getEl('host-offer-words');

    if (hostInviteArea) setTimeout(() => hostInviteArea.classList.add('visible'), 100);
    if (hostResponseArea) setTimeout(() => hostResponseArea.classList.add('visible'), 200);
    if (hostWaiting) hostWaiting.classList.add('hidden');
    if (hostConnectBtn) hostConnectBtn.disabled = true;
    if (hostAnswerInput) hostAnswerInput.value = '';
    if (hostOfferWords) hostOfferWords.textContent = 'Генерация...';

    try {
        connectedPeerId = CryptoSystem.generateKey().slice(0, 16);
        pendingLocalKey = CryptoSystem.generateKey();
        
        if (!contacts[connectedPeerId]) {
            contacts[connectedPeerId] = { name: connectedPeerId.slice(0, 8), avatar: '' };
        }
        contacts[connectedPeerId].localSessionKey = pendingLocalKey;
        contacts[connectedPeerId].role = 'host';
        localStorage.setItem(`role_${connectedPeerId}`, 'host');
        saveContacts();

        setupPeerConnectionForHost();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGathering();

        const finalOffer = peerConnection.localDescription;
        const hostOfferDisplay = getEl('host-offer-display');
        if (hostOfferDisplay) hostOfferDisplay.value = JSON.stringify(finalOffer);
        if (hostOfferWords) hostOfferWords.textContent = sdpToWords(finalOffer.sdp);
        
        // Копируем в буфер обмена
        copyToClipboard(JSON.stringify(finalOffer));
        
        const shareBtn = getEl('share-host-btn');
        if (shareBtn && navigator.share) shareBtn.style.display = '';
    } catch (e) {
        alert('Ошибка создания приглашения');
        console.error(e);
        resetToRoleSelect();
    }
}

async function hostSubmitAnswer() {
    const hostAnswerInput = getEl('host-answer-input');
    if (!hostAnswerInput) return;
    const answerStr = hostAnswerInput.value.trim();
    if (!answerStr) return;
    
    try {
        const answer = JSON.parse(answerStr);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        
        const hostResponseArea = getEl('host-response-area');
        const hostWaiting = getEl('host-waiting');
        
        if (hostResponseArea) hostResponseArea.classList.remove('visible');
        if (hostWaiting) {
            hostWaiting.classList.remove('hidden');
            hostWaiting.style.display = 'block';
        }
        
        console.log('Ответ установлен, ожидаем подключения...');
    } catch (e) {
        alert('Неверный код ответа');
        console.error(e);
    }
}

function startJoinFlow() {
    showSection('join-flow');
    const joinInputArea = getEl('join-input-area');
    const joinResponseArea = getEl('join-response-area');
    const joinWaiting = getEl('join-waiting');
    const joinGenerateBtn = getEl('join-generate-btn');
    const joinOfferInput = getEl('join-offer-input');

    if (joinInputArea) setTimeout(() => joinInputArea.classList.add('visible'), 100);
    if (joinResponseArea) {
        joinResponseArea.classList.add('hidden');
        joinResponseArea.classList.remove('visible');
    }
    if (joinWaiting) joinWaiting.classList.add('hidden');
    if (joinGenerateBtn) joinGenerateBtn.disabled = true;
    if (joinOfferInput) joinOfferInput.value = '';
}

async function joinSubmitOffer() {
    const joinOfferInput = getEl('join-offer-input');
    if (!joinOfferInput) return;
    const offerStr = joinOfferInput.value.trim();
    if (!offerStr) return;
    
    try {
        const offer = JSON.parse(offerStr);
        connectedPeerId = CryptoSystem.generateKey().slice(0, 16);
        pendingLocalKey = CryptoSystem.generateKey();
        
        if (!contacts[connectedPeerId]) {
            contacts[connectedPeerId] = { name: connectedPeerId.slice(0, 8), avatar: '' };
        }
        contacts[connectedPeerId].localSessionKey = pendingLocalKey;
        contacts[connectedPeerId].role = 'guest';
        localStorage.setItem(`role_${connectedPeerId}`, 'guest');
        saveContacts();

        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(configuration);
        
        peerConnection.ondatachannel = (event) => {
            console.log('Получен data channel от хоста');
            dataChannel = event.channel;
            setupDataChannel(connectedPeerId);
            
            // Когда data channel откроется, UI обновится через setupDataChannel
        };
        
        peerConnection.oniceconnectionstatechange = updateOnlineStatus;
        peerConnection.onconnectionstatechange = () => {
            console.log('Guest connection state:', peerConnection.connectionState);
            if (peerConnection.connectionState === 'connected') updateOnlineStatus();
        };
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await waitForIceGathering();

        const finalAnswer = peerConnection.localDescription;
        const joinAnswerDisplay = getEl('join-answer-display');
        const joinAnswerWords = getEl('join-answer-words');
        
        if (joinAnswerDisplay) joinAnswerDisplay.value = JSON.stringify(finalAnswer);
        if (joinAnswerWords) joinAnswerWords.textContent = sdpToWords(finalAnswer.sdp);
        
        // Копируем в буфер обмена
        copyToClipboard(JSON.stringify(finalAnswer));

        const joinInputArea = getEl('join-input-area');
        const joinResponseArea = getEl('join-response-area');
        const joinWaiting = getEl('join-waiting');
        
        if (joinInputArea) joinInputArea.classList.remove('visible');
        if (joinResponseArea) {
            joinResponseArea.classList.remove('hidden');
            setTimeout(() => joinResponseArea.classList.add('visible'), 100);
        }
        
        const shareBtn = getEl('share-join-btn');
        if (shareBtn && navigator.share) shareBtn.style.display = '';
        
        if (joinWaiting) {
            joinWaiting.classList.remove('hidden');
            joinWaiting.style.display = 'block';
        }
        
        console.log('Ответ сгенерирован, отправьте его хосту');
    } catch (e) {
        alert('Не удалось обработать приглашение');
        console.error(e);
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

function copyHostOffer() {
    const el = getEl('host-offer-display');
    if (el) copyToClipboard(el.value);
}
function shareHostOffer() {
    const el = getEl('host-offer-display');
    if (el && navigator.share) navigator.share({ title: 'Приглашение в /0byte/', text: el.value });
}
function copyJoinAnswer() {
    const el = getEl('join-answer-display');
    if (el) copyToClipboard(el.value);
}
function shareJoinAnswer() {
    const el = getEl('join-answer-display');
    if (el && navigator.share) navigator.share({ title: 'Ответ на приглашение в /0byte/', text: el.value });
}

function showSettings() {
    const modal = getEl('settings-modal');
    if (modal) modal.classList.remove('hidden');
}
function closeSettings() {
    const modal = getEl('settings-modal');
    if (modal) modal.classList.add('hidden');
}
function saveSettings() {
    const nameInput = getEl('name-input');
    const avatarInput = getEl('avatar-input');
    myName = nameInput ? nameInput.value.trim() || 'Вы' : 'Вы';
    myAvatar = avatarInput ? avatarInput.value.trim() || '' : '';
    localStorage.setItem('myName', myName);
    localStorage.setItem('myAvatar', myAvatar);
    closeSettings();
    renderContactList();
}
function toggleTheme() {
    const toggle = getEl('theme-toggle');
    if (toggle) {
        document.body.classList.toggle('light', !toggle.checked);
        localStorage.setItem('theme', toggle.checked ? 'dark' : 'light');
    }
}
function loadTheme() {
    const toggle = getEl('theme-toggle');
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light');
        if (toggle) toggle.checked = false;
    } else {
        document.body.classList.remove('light');
        if (toggle) toggle.checked = true;
    }
}
function toggleSidebar() {
    const sidebar = getEl('sidebar');
    const mainChat = getEl('main-chat');
    if (sidebar) sidebar.classList.toggle('visible');
    if (mainChat) mainChat.classList.toggle('shifted');
}