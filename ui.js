// ui.js
// Весь интерфейс: рендеринг, модальные окна, настройки, визуализация.
// Добавлена поддержка мастер-пароля.

function $(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Элемент с id="${id}" не найден`);
    return el;
}

function getEl(id) { return document.getElementById(id); }

// ==================== Мастер-пароль ====================
async function showMasterPasswordPrompt(isFirstTime = false) {
    return new Promise((resolve) => {
        const existingModal = document.querySelector('.master-password-modal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.className = 'master-password-modal';
        modal.innerHTML = `
            <div class="master-password-content">
                <h2>🔐 ${isFirstTime ? 'Создайте мастер-пароль' : 'Введите мастер-пароль'}</h2>
                <p>${isFirstTime ? 'Защитит ваши ключи и историю чатов. Не потеряйте его!' : 'Необходим для расшифровки данных.'}</p>
                <input type="password" id="master-password-input" placeholder="Мастер-пароль" autocomplete="off" />
                ${isFirstTime ? '<input type="password" id="master-password-confirm" placeholder="Подтвердите пароль" autocomplete="off" />' : ''}
                <button class="btn-primary" id="master-password-submit">${isFirstTime ? 'Создать' : 'Войти'}</button>
                <div class="master-error" id="master-error"></div>
                ${!isFirstTime ? '<p style="margin-top: 12px; font-size: 0.8rem; color: var(--text-secondary);">Если забыли пароль — данные потеряны.</p>' : ''}
            </div>
        `;
        document.body.appendChild(modal);
        
        const submitBtn = document.getElementById('master-password-submit');
        const errorEl = document.getElementById('master-error');
        const passwordInput = document.getElementById('master-password-input');
        
        submitBtn.onclick = async () => {
            const password = passwordInput.value.trim();
            if (!password || password.length < 6) {
                errorEl.textContent = 'Пароль должен быть не менее 6 символов';
                return;
            }
            
            if (isFirstTime) {
                const confirmInput = document.getElementById('master-password-confirm');
                if (password !== confirmInput.value.trim()) {
                    errorEl.textContent = 'Пароли не совпадают';
                    return;
                }
            }
            
            try {
                if (isFirstTime) {
                    // Проверяем, что можем зашифровать
                    const test = await CryptoSystem.encryptWithMaster('test', password);
                    if (!test) {
                        errorEl.textContent = 'Ошибка создания ключа';
                        return;
                    }
                } else {
                    // Проверяем, что можем расшифровать
                    const encrypted = localStorage.getItem('contacts_encrypted');
                    if (encrypted) {
                        const test = await CryptoSystem.decryptWithMaster(encrypted, password);
                        if (test === null) {
                            errorEl.textContent = 'Неверный пароль';
                            return;
                        }
                    } else {
                        // Старые данные без шифрования
                        const oldContacts = localStorage.getItem('contacts');
                        if (oldContacts) {
                            const encrypted = await CryptoSystem.encryptWithMaster(oldContacts, password);
                            localStorage.setItem('contacts_encrypted', encrypted);
                            localStorage.removeItem('contacts');
                            
                            // Мигрируем историю
                            const allKeys = Object.keys(localStorage).filter(k => k.startsWith('history_'));
                            for (const key of allKeys) {
                                const hist = localStorage.getItem(key);
                                if (hist) {
                                    const encryptedHist = await CryptoSystem.encryptWithMaster(hist, password);
                                    localStorage.setItem(key + '_enc', encryptedHist);
                                    localStorage.removeItem(key);
                                }
                            }
                        }
                    }
                }
                
                masterPassword = password;
                modal.remove();
                resolve();
            } catch (e) {
                errorEl.textContent = 'Ошибка: ' + e.message;
            }
        };
        
        // Enter для отправки
        passwordInput.onkeydown = (e) => {
            if (e.key === 'Enter') submitBtn.click();
        };
        
        passwordInput.focus();
    });
}

// ==================== Настройки и контакты ====================
async function loadSettings() {
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

    // Загружаем контакты с мастер-паролем
    if (masterPassword) {
        const encrypted = localStorage.getItem('contacts_encrypted');
        if (encrypted) {
            const json = await CryptoSystem.decryptWithMaster(encrypted, masterPassword);
            contacts = json ? JSON.parse(json) : {};
        } else {
            const oldContacts = localStorage.getItem('contacts');
            if (oldContacts) {
                contacts = JSON.parse(oldContacts);
                await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
                localStorage.removeItem('contacts');
            } else {
                contacts = {};
            }
        }
    } else {
        contacts = JSON.parse(localStorage.getItem('contacts') || '{}');
    }
    
    renderContactList();

    const savedActivePeer = localStorage.getItem('activePeer');
    if (savedActivePeer && contacts[savedActivePeer]) {
        activePeer = savedActivePeer;
        openChat(activePeer);
    } else {
        const mainChat = $('main-chat');
        const sidebar = $('sidebar');
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

async function deleteChat(peerId) {
    if (!confirm('Удалить чат и историю с ' + (contacts[peerId]?.name || peerId) + '?')) return;
    const histKey = `history_${[currentUser, peerId].sort().join('_')}`;
    const pinnedKey = `pinned_${peerId}`;
    
    if (masterPassword) {
        localStorage.removeItem(`hist_${histKey}`);
    } else {
        localStorage.removeItem(histKey);
    }
    localStorage.removeItem(pinnedKey);
    localStorage.removeItem(`role_${peerId}`);
    delete contacts[peerId];
    await saveContacts();
    if (activePeer === peerId) {
        activePeer = null;
        localStorage.removeItem('activePeer');
        const mainChat = $('main-chat');
        const sidebar = $('sidebar');
        if (mainChat) mainChat.classList.add('hidden');
        if (sidebar) sidebar.classList.remove('hidden');
    }
    renderContactList();
}

async function saveContacts() {
    if (masterPassword) {
        await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
    } else {
        localStorage.setItem('contacts', JSON.stringify(contacts));
    }
}

// ==================== Управление чатом (UI) ====================
function openChat(peerId) {
    if (!contacts[peerId]) {
        contacts[peerId] = { name: peerId.slice(0, 8), avatar: '' };
        saveContacts();
        renderContactList();
    }

    if (dataChannel && dataChannel.readyState === 'open' && connectedPeerId === peerId) {
        updateUIForPeer(peerId);
        return;
    }

    if (contacts[peerId].localSessionKey) {
        pendingLocalKey = contacts[peerId].localSessionKey;
        connectedPeerId = peerId;
        setupPeerConnection(peerId);
        updateUIForPeer(peerId);
        
        setTimeout(() => {
            if (!dataChannel || dataChannel.readyState !== 'open') {
                const restorePanel = $('restore-panel');
                if (restorePanel) restorePanel.classList.add('visible');
            }
        }, 5000);
    } else {
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
    
    const mainChat = $('main-chat');
    const sidebar = $('sidebar');
    
    if (mainChat) {
        mainChat.classList.remove('hidden');
        mainChat.style.display = 'flex';
    }
    
    if (sidebar && window.innerWidth <= 700) {
        sidebar.classList.remove('visible');
        sidebar.classList.add('hidden');
    }

    const peer = contacts[peerId] || {};
    const chatName = $('chat-name');
    if (chatName) chatName.textContent = peer.name || peerId.slice(0, 8);
    
    const chatAvatar = $('chat-avatar');
    if (chatAvatar) chatAvatar.textContent = peer.avatar || '👤';
    
    const chatStatus = $('chat-status');
    if (chatStatus) {
        const isConnected = dataChannel && dataChannel.readyState === 'open';
        chatStatus.textContent = isConnected ? 'онлайн' : 'подключение...';
    }

    updateKeyDisplay();
    loadMessages(peerId);
    loadPinned(peerId);
    renderContactList();

    if (dataChannel && dataChannel.readyState === 'open') {
        const restorePanel = $('restore-panel');
        if (restorePanel) restorePanel.classList.remove('visible');
    }
}

async function loadMessages(peerId) {
    const container = $('messages');
    if (!container) return;
    
    const hist = await loadMessageHistory(peerId);
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
            <button class="pin-btn" onclick="togglePin('${peerId}', ${msg.timestamp})" style="background: none; border: none; cursor: pointer; font-size: 0.8rem;">📌</button>
        `;
        container.appendChild(div);
    }
    
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 100);
}

function updateOnlineStatus() {
    const onlineStatusEl = $('online-status');
    if (onlineStatusEl) {
        const status = (dataChannel && dataChannel.readyState === 'open') ? '🟢 Онлайн' : '⚪ Отключен';
        onlineStatusEl.innerText = status;
    }
    
    const chatStatusEl = $('chat-status');
    if (chatStatusEl && activePeer) {
        chatStatusEl.textContent = (dataChannel && dataChannel.readyState === 'open') ? 'онлайн' : 'офлайн';
    }
    
    const restorePanel = $('restore-panel');
    if (restorePanel && activePeer) {
        if (dataChannel && dataChannel.readyState === 'open') {
            restorePanel.classList.remove('visible');
        }
    }
}

function updateKeyDisplay() {
    if (!activePeer) return;
    const myKeyEl = $('my-key-display');
    const partnerKeyEl = $('partner-key-display');
    const localKey = contacts[activePeer]?.localSessionKey;
    const remoteKey = contacts[activePeer]?.remoteKey;
    if (myKeyEl) myKeyEl.innerText = localKey ? localKey.slice(0, 8) + '...' : 'none';
    if (partnerKeyEl) partnerKeyEl.innerText = remoteKey ? remoteKey.slice(0, 8) + '...' : '(ожидание...)';
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
        sendImage(file);
        event.target.value = '';
    }
}

async function togglePin(peerId, ts) {
    const hist = await loadMessageHistory(peerId);
    const msg = hist.find(m => m.timestamp === ts);
    if (!msg) return;
    
    const pinnedKey = `pinned_${peerId}`;
    let pinned = JSON.parse(localStorage.getItem(pinnedKey) || '[]');
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
                const dec = await CryptoSystem.decrypt(msg.ciphertext, decryptKey);
                text = dec ? dec : '🔒 Зашифровано';
            } else {
                text = '🔒 Зашифровано';
            }
        }
        pinned.push({ ts, text });
    }
    
    localStorage.setItem(pinnedKey, JSON.stringify(pinned));
    loadPinned(peerId);
}

function loadPinned(peerId) {
    const pinnedMsgs = $('pinned-messages');
    if (!pinnedMsgs) return;
    const pinned = JSON.parse(localStorage.getItem(`pinned_${peerId}`) || '[]');
    pinnedMsgs.innerHTML = pinned.length ? pinned.map(p => `📌 ${p.text}`).join(' | ') : 'Нет закреплённых сообщений';
}

function togglePinnedPanel() {
    const panel = $('pinned-panel');
    if (panel) panel.classList.toggle('visible');
}

// ==================== Модальные окна и flow ====================
function showNewChat() {
    resetToRoleSelect();
    const modal = $('new-chat-modal');
    if (modal) modal.classList.remove('hidden');
}

function closeNewChat() {
    const modal = $('new-chat-modal');
    if (modal) modal.classList.add('hidden');
}

function resetToRoleSelect() {
    showSection('role-select-section');
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
    
    document.querySelectorAll('.step-content').forEach(el => {
        el.classList.remove('visible');
    });
}

async function startHostFlow() {
    showSection('host-flow');
    const hostInviteArea = $('host-invite-area');
    const hostResponseArea = $('host-response-area');
    const hostWaiting = $('host-waiting');
    const hostConnectBtn = $('host-connect-btn');
    const hostAnswerInput = $('host-answer-input');
    const hostOfferWords = $('host-offer-words');

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
        await saveContacts();

        await setupPeerConnectionForHost();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGathering();

        const finalOffer = peerConnection.localDescription;
        const hostOfferDisplay = $('host-offer-display');
        if (hostOfferDisplay) hostOfferDisplay.value = JSON.stringify(finalOffer);
        if (hostOfferWords) hostOfferWords.textContent = sdpToWords(finalOffer.sdp);
        
        copyToClipboard(JSON.stringify(finalOffer));
        
        const shareBtn = $('share-host-btn');
        if (shareBtn && navigator.share) shareBtn.style.display = '';
    } catch (e) {
        alert('Ошибка создания приглашения');
        console.error(e);
        resetToRoleSelect();
    }
}

async function hostSubmitAnswer() {
    const hostAnswerInput = $('host-answer-input');
    if (!hostAnswerInput) return;
    const answerStr = hostAnswerInput.value.trim();
    if (!answerStr) return;
    
    try {
        const answer = JSON.parse(answerStr);
        
        // Верификация отпечатка
        const localFp = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp);
        const remoteFp = CryptoSystem.extractFingerprint(answer.sdp);
        
        const verified = await verifyFingerprint(connectedPeerId, localFp, remoteFp);
        if (!verified) {
            alert('Отпечатки не совпадают! Возможна атака "человек посередине".');
            return;
        }
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Настраиваем data channel после получения ответа
        setupDataChannel(connectedPeerId, 'host');
        
        const hostResponseArea = $('host-response-area');
        const hostWaiting = $('host-waiting');
        
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
    const joinInputArea = $('join-input-area');
    const joinResponseArea = $('join-response-area');
    const joinWaiting = $('join-waiting');
    const joinGenerateBtn = $('join-generate-btn');
    const joinOfferInput = $('join-offer-input');

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
    const joinOfferInput = $('join-offer-input');
    if (!joinOfferInput) return;
    const offerStr = joinOfferInput.value.trim();
    if (!offerStr) return;
    
    try {
        const offer = JSON.parse(offerStr);
        
        // Верификация отпечатка
        const remoteFp = CryptoSystem.extractFingerprint(offer.sdp);
        
        connectedPeerId = CryptoSystem.generateKey().slice(0, 16);
        pendingLocalKey = CryptoSystem.generateKey();
        
        if (!contacts[connectedPeerId]) {
            contacts[connectedPeerId] = { name: connectedPeerId.slice(0, 8), avatar: '' };
        }
        contacts[connectedPeerId].localSessionKey = pendingLocalKey;
        contacts[connectedPeerId].role = 'guest';
        localStorage.setItem(`role_${connectedPeerId}`, 'guest');
        await saveContacts();

        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(configuration);
        
        peerConnection.ondatachannel = async (event) => {
            console.log('Получен data channel от хоста');
            dataChannel = event.channel;
            
            // Верификация отпечатка после получения канала
            const localFp = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp);
            const verified = await verifyFingerprint(connectedPeerId, localFp, remoteFp);
            if (!verified) {
                alert('Отпечатки не совпадают! Возможна атака "человек посередине".');
                dataChannel.close();
                return;
            }
            
            setupDataChannel(connectedPeerId, 'guest');
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
        const joinAnswerDisplay = $('join-answer-display');
        const joinAnswerWords = $('join-answer-words');
        
        if (joinAnswerDisplay) joinAnswerDisplay.value = JSON.stringify(finalAnswer);
        if (joinAnswerWords) joinAnswerWords.textContent = sdpToWords(finalAnswer.sdp);
        
        copyToClipboard(JSON.stringify(finalAnswer));

        const joinInputArea = $('join-input-area');
        const joinResponseArea = $('join-response-area');
        const joinWaiting = $('join-waiting');
        
        if (joinInputArea) joinInputArea.classList.remove('visible');
        if (joinResponseArea) {
            joinResponseArea.classList.remove('hidden');
            setTimeout(() => joinResponseArea.classList.add('visible'), 100);
        }
        
        const shareBtn = $('share-join-btn');
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
    const el = $('host-offer-display');
    if (el) copyToClipboard(el.value);
}
function shareHostOffer() {
    const el = $('host-offer-display');
    if (el && navigator.share) navigator.share({ title: 'Приглашение в /0byte/', text: el.value });
}
function copyJoinAnswer() {
    const el = $('join-answer-display');
    if (el) copyToClipboard(el.value);
}
function shareJoinAnswer() {
    const el = $('join-answer-display');
    if (el && navigator.share) navigator.share({ title: 'Ответ на приглашение в /0byte/', text: el.value });
}

function showSettings() {
    const modal = $('settings-modal');
    if (modal) modal.classList.remove('hidden');
}
function closeSettings() {
    const modal = $('settings-modal');
    if (modal) modal.classList.add('hidden');
}
async function saveSettings() {
    const nameInput = $('name-input');
    const avatarInput = $('avatar-input');
    myName = nameInput ? nameInput.value.trim() || 'Вы' : 'Вы';
    myAvatar = avatarInput ? avatarInput.value.trim() || '' : '';
    localStorage.setItem('myName', myName);
    localStorage.setItem('myAvatar', myAvatar);
    closeSettings();
    renderContactList();
}
function toggleTheme() {
    const toggle = $('theme-toggle');
    if (toggle) {
        document.body.classList.toggle('light', !toggle.checked);
        localStorage.setItem('theme', toggle.checked ? 'dark' : 'light');
    }
}
function loadTheme() {
    const toggle = $('theme-toggle');
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
    const sidebar = $('sidebar');
    const mainChat = $('main-chat');
    if (sidebar) sidebar.classList.toggle('visible');
    if (mainChat) mainChat.classList.toggle('shifted');
}