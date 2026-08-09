// Глобальные переменные
let currentUser, myName = 'You', myAvatar = '', contacts = {}, activePeer = null;
let peerConnection = null, dataChannel = null, pendingLocalKey = null;
let keySendInterval = null, connectedPeerId = null, masterPassword = null;
let verifiedFingerprints = {};

function $(a) { return document.getElementById(a); }
function getEl(a) { return document.getElementById(a); }

// --- EULA & INIT ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Проверка EULA
    if (!localStorage.getItem('eula_agreed')) {
        showEULA();
    } else {
        initApp();
    }
});

function showEULA() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.zIndex = '10000';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header"><h2>Пользовательское соглашение</h2></div>
            <div class="modal-body">
                <p><strong>ВНИМАНИЕ:</strong> Это E2E зашифрованный мессенджер.</p>
                <ul>
                    <li>Сообщения хранятся только на вашем устройстве.</li>
                    <li>Никакой сервер не может восстановить ваши данные.</li>
                    <li>Если вы потеряете мастер-пароль, переписка будет утеряна навсегда.</li>
                    <li>Вы несете полную ответственность за сохранность своих ключей.</li>
                </ul>
            </div>
            <div class="button-group">
                <button class="btn-primary" id="eula-agree-btn">Я принимаю условия</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    document.getElementById('eula-agree-btn').onclick = () => {
        localStorage.setItem('eula_agreed', 'true');
        modal.remove();
        initApp();
    };
}

async function initApp() {
    loadTheme();
    
    // 2. Проверка Мастер-пароля
    const hasEncryptedData = localStorage.getItem('contacts_encrypted') !== null;
    
    if (hasEncryptedData) {
        await showMasterPasswordPrompt(false);
    } else {
        // Спрашиваем, хочет ли пользователь пароль
        const wantPassword = confirm('🔐 Создать мастер-пароль для защиты данных?\n\nБез него история хранится в открытом виде.');
        if (wantPassword) {
            await showMasterPasswordPrompt(true);
        } else {
            masterPassword = null;
        }
    }

    await loadSettings();
    setupEventListeners();
    
    // UI Init
    const mainChat = $('main-chat');
    const sidebar = $('sidebar');
    if (mainChat) mainChat.classList.add('hidden');
    if (sidebar) sidebar.classList.remove('hidden');
}

function setupEventListeners() {
    // Кнопки меню
    const newChatBtn = $('new-chat-btn');
    if (newChatBtn) newChatBtn.addEventListener('click', showNewChat);
    
    const sidebarToggle = $('sidebar-toggle');
    if (sidebarToggle) sidebarToggle.addEventListener('click', toggleSidebar);
    
    // Ввод сообщения
    const msgInput = $('message-input');
    if (msgInput) {
        msgInput.addEventListener('keypress', c => {
            if (c.key === 'Enter' && !c.shiftKey) {
                c.preventDefault();
                sendMessage();
            }
        });
    }

    // Обработчики инпутов в модалках (Host/Join)
    const hostInput = $('host-answer-input');
    if (hostInput) {
        hostInput.addEventListener('input', d => {
            try {
                parseInvitePayload(d.target.value.trim());
                const btn = $('host-connect-btn');
                if (btn) btn.disabled = false;
            } catch (e) {
                const btn = $('host-connect-btn');
                if (btn) btn.disabled = true;
            }
        });
    }

    const joinInput = $('join-offer-input');
    if (joinInput) {
        joinInput.addEventListener('input', f => {
            try {
                parseInvitePayload(f.target.value.trim());
                const btn = $('join-generate-btn');
                if (btn) btn.disabled = false;
            } catch (g) {
                const btn = $('join-generate-btn');
                if (btn) btn.disabled = true;
            }
        });
    }

    // Закрытие модалок по Esc
    document.addEventListener('keydown', h => {
        if (h.key === 'Escape') {
            closeNewChat();
            closeSettings();
        }
    });
}

// --- MASTER PASSWORD LOGIC (FIXED) ---
async function showMasterPasswordPrompt(isCreate = false) {
    return new Promise(async (resolve) => {
        // Удаляем старые модалки если есть
        const oldModal = document.querySelector('.master-password-modal');
        if (oldModal) oldModal.remove();

        const modal = document.createElement('div');
        modal.className = 'master-password-modal';
        modal.innerHTML = `
            <div class="master-password-content">
                <h2>${isCreate ? 'Создание пароля' : 'Вход в систему'}</h2>
                <p>${isCreate ? 'Придумайте надежный пароль для шифрования базы.' : 'Введите пароль для расшифровки данных.'}</p>
                <input type="password" id="mp-input" placeholder="Пароль" autocomplete="off" style="width:100%; padding:12px; margin-bottom:10px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text);" />
                ${isCreate ? '<input type="password" id="mp-confirm" placeholder="Повторите пароль" autocomplete="off" style="width:100%; padding:12px; margin-bottom:10px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text);" />' : ''}
                <button class="btn-primary" id="mp-submit" style="width:100%; padding:12px;">${isCreate ? 'Создать' : 'Войти'}</button>
                <div id="mp-error" style="color:#ef4444; font-size:0.9rem; margin-top:10px; text-align:center;"></div>
            </div>
        `;
        document.body.appendChild(modal);

        const input = document.getElementById('mp-input');
        const confirmInput = document.getElementById('mp-confirm');
        const submitBtn = document.getElementById('mp-submit');
        const errorDiv = document.getElementById('mp-error');

        // Фокус на поле ввода
        setTimeout(() => input.focus(), 100);

        const handleSubmit = async () => {
            const pass = input.value.trim();
            
            if (pass.length < 6) {
                errorDiv.textContent = 'Пароль должен быть минимум 6 символов';
                return;
            }

            if (isCreate) {
                if (pass !== confirmInput.value.trim()) {
                    errorDiv.textContent = 'Пароли не совпадают';
                    return;
                }
                // Тест шифрования
                try {
                    const test = await CryptoSystem.encryptWithMaster('test', pass);
                    if (!test) throw new Error('Encryption failed');
                } catch (e) {
                    errorDiv.textContent = 'Ошибка шифрования';
                    return;
                }
            } else {
                // Проверка существующего пароля
                const encrypted = localStorage.getItem('contacts_encrypted');
                if (encrypted) {
                    const decrypted = await CryptoSystem.decryptWithMaster(encrypted, pass);
                    if (decrypted === null) {
                        errorDiv.textContent = 'Неверный пароль';
                        return;
                    }
                }
            }

            masterPassword = pass;
            modal.remove();
            resolve();
        };

        submitBtn.onclick = handleSubmit;
        input.onkeydown = (e) => { if (e.key === 'Enter') handleSubmit(); };
        if (confirmInput) confirmInput.onkeydown = (e) => { if (e.key === 'Enter') handleSubmit(); };
    });
}

// --- SETTINGS & DATA ---
async function loadSettings() {
    myName = localStorage.getItem('myName') || 'You';
    myAvatar = localStorage.getItem('myAvatar') || '';
    currentUser = localStorage.getItem('uid');
    
    if (!currentUser) {
        currentUser = CryptoSystem.generateKey().slice(0, 16);
        localStorage.setItem('uid', currentUser);
    }

    // Загрузка контактов
    if (masterPassword) {
        const enc = localStorage.getItem('contacts_encrypted');
        if (enc) {
            const dec = await CryptoSystem.decryptWithMaster(enc, masterPassword);
            contacts = dec ? JSON.parse(dec) : {};
        } else {
            // Миграция старых данных
            const plain = localStorage.getItem('contacts');
            if (plain) {
                contacts = JSON.parse(plain);
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
    
    // Восстановление последнего чата
    const lastPeer = localStorage.getItem('activePeer');
    if (lastPeer && contacts[lastPeer]) {
        activePeer = lastPeer;
        openChat(lastPeer);
    }
}

function renderContactList() {
    const list = getEl('contact-list');
    if (!list) return;
    list.innerHTML = '';
    
    Object.entries(contacts).forEach(([id, data]) => {
        const div = document.createElement('div');
        div.className = `contact-item ${id === activePeer ? 'active' : ''}`;
        div.innerHTML = `
            <span class="contact-avatar">${data.avatar || '👤'}</span>
            <span class="contact-name">${data.name || id.slice(0, 8)}</span>
            <button class="delete-btn" onclick="event.stopPropagation(); deleteChat('${id}')">✕</button>
        `;
        div.onclick = () => {
            activePeer = id;
            localStorage.setItem('activePeer', id);
            openChat(id);
        };
        list.appendChild(div);
    });
}

async function deleteChat(id) {
    if (!confirm('Удалить чат и историю?')) return;
    const histKey = `history_${[currentUser, id].sort().join('_')}`;
    const pinnedKey = `pinned_${id}`;
    
    if (masterPassword) localStorage.removeItem(`hist_${histKey}`);
    else localStorage.removeItem(histKey);
    
    localStorage.removeItem(pinnedKey);
    localStorage.removeItem(`role_${id}`);
    delete contacts[id];
    
    await saveContacts();
    
    if (activePeer === id) {
        activePeer = null;
        localStorage.removeItem('activePeer');
        const main = $('main-chat');
        const side = $('sidebar');
        if (main) main.classList.add('hidden');
        if (side) side.classList.remove('hidden');
    }
    renderContactList();
}

async function saveContacts() {
    if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
    else localStorage.setItem('contacts', JSON.stringify(contacts));
}

// --- CHAT LOGIC ---
function openChat(id) {
    if (!contacts[id]) {
        contacts[id] = { name: id.slice(0, 8), avatar: '' };
        saveContacts();
        renderContactList();
    }

    // Если уже подключены к этому пиру
    if (dataChannel && dataChannel.readyState === 'open' && connectedPeerId === id) {
        updateUIForPeer(id);
        return;
    }

    // Попытка восстановления сессии
    if (contacts[id].localSessionKey) {
        pendingLocalKey = contacts[id].localSessionKey;
        connectedPeerId = id;
        // Здесь должна быть логика переподключения, но пока просто обновляем UI
        updateUIForPeer(id);
        
        // Таймаут для проверки соединения
        setTimeout(() => {
            if (!dataChannel || dataChannel.readyState !== 'open') {
                const panel = $('restore-panel');
                if (panel) panel.classList.add('visible');
            }
        }, 2000);
    } else {
        pendingLocalKey = CryptoSystem.generateKey();
        contacts[id].localSessionKey = pendingLocalKey;
        saveContacts();
        connectedPeerId = id;
        updateUIForPeer(id);
    }
}

function updateUIForPeer(id) {
    activePeer = id;
    localStorage.setItem('activePeer', id);
    
    const main = $('main-chat');
    const side = $('sidebar');
    
    if (main) {
        main.classList.remove('hidden');
        main.style.display = 'flex';
    }
    if (side && window.innerWidth <= 700) {
        side.classList.remove('visible');
        side.classList.add('hidden');
    }

    const data = contacts[id] || {};
    const nameEl = $('chat-name');
    if (nameEl) nameEl.textContent = data.name || id.slice(0, 8);
    
    const avatarEl = $('chat-avatar');
    if (avatarEl) avatarEl.textContent = data.avatar || '👤';
    
    const statusEl = $('chat-status');
    if (statusEl) {
        const isOnline = dataChannel && dataChannel.readyState === 'open';
        statusEl.textContent = isOnline ? 'online' : 'connecting...';
    }

    updateKeyDisplay();
    loadMessages(id);
    renderContactList();
    
    const restorePanel = $('restore-panel');
    if (restorePanel && dataChannel && dataChannel.readyState === 'open') {
        restorePanel.classList.remove('visible');
    }
}

async function loadMessages(id) {
    const container = $('messages');
    if (!container) return;
    
    const history = await loadMessageHistory(id);
    container.innerHTML = '';
    
    const localKey = contacts[id]?.localSessionKey;
    const remoteKey = contacts[id]?.remoteKey;

    for (const msg of history) {
        const isMine = msg.from === currentUser;
        let content = '';
        
        if (msg.type === 'image') {
            const key = isMine ? remoteKey : localKey;
            if (key && msg.ciphertext) {
                try {
                    const buffer = await CryptoSystem.decryptData(msg.ciphertext, key);
                    if (buffer) {
                        const blob = new Blob([buffer], { type: msg.mimeType || 'image/jpeg' });
                        const url = URL.createObjectURL(blob);
                        content = `<img src="${url}" class="chat-image" onclick="openLightbox('${url}')" />`;
                    } else {
                        content = '🔒 Encrypted image';
                    }
                } catch (e) {
                    content = '🔒 Encrypted image';
                }
            } else {
                content = '🔒 Encrypted image';
            }
        } else {
            const key = isMine ? remoteKey : localKey;
            if (key && msg.ciphertext) {
                const text = await CryptoSystem.decrypt(msg.ciphertext, key);
                content = text !== null ? text : '🔒 Encrypted';
            } else {
                content = '🔒 Encrypted';
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
    
    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 100);
}

function updateOnlineStatus() {
    const statusEl = $('chat-status');
    if (statusEl && activePeer) {
        const isOnline = dataChannel && dataChannel.readyState === 'open';
        statusEl.textContent = isOnline ? 'online' : 'offline';
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
    if (partnerKeyEl) partnerKeyEl.innerText = remoteKey ? remoteKey.slice(0, 8) + '...' : '(waiting...)';
}

// --- UTILS ---
function toggleTheme() {
    const checkbox = $('theme-toggle');
    if (checkbox) {
        document.body.classList.toggle('light', !checkbox.checked);
        localStorage.setItem('theme', checkbox.checked ? 'dark' : 'light');
    }
}

function loadTheme() {
    const saved = localStorage.getItem('theme');
    const checkbox = $('theme-toggle');
    if (saved === 'light') {
        document.body.classList.add('light');
        if (checkbox) checkbox.checked = false;
    } else {
        document.body.classList.remove('light');
        if (checkbox) checkbox.checked = true;
    }
}

function toggleSidebar() {
    const side = $('sidebar');
    const main = $('main-chat');
    if (side) side.classList.toggle('visible');
    if (main) main.classList.toggle('shifted');
}

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
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('visible'));
}

function showSection(id) {
    ['role-select-section', 'host-flow', 'join-flow'].forEach(secId => {
        const el = getEl(secId);
        if (el) el.classList.add('hidden');
    });
    const target = getEl(id);
    if (target) target.classList.remove('hidden');
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('visible'));
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
    
    myName = nameInput ? nameInput.value.trim() || 'You' : 'You';
    myAvatar = avatarInput ? avatarInput.value.trim() || '' : '';
    
    localStorage.setItem('myName', myName);
    localStorage.setItem('myAvatar', myAvatar);
    
    closeSettings();
    renderContactList();
}

async function deleteAllChats() {
    const count = Object.keys(contacts).length;
    if (count === 0) { alert('Нет чатов для удаления.'); return; }
    
    if (!confirm(`⚠️ Удалить ВСЕ чаты (${count})?\nЭто действие необратимо!`)) return;
    
    // Очистка
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (keySendInterval) { clearInterval(keySendInterval); keySendInterval = null; }
    
    for (let id of Object.keys(contacts)) {
        const histKey = `history_${[currentUser, id].sort().join('_')}`;
        if (masterPassword) localStorage.removeItem(`hist_${histKey}`);
        else localStorage.removeItem(histKey);
        localStorage.removeItem(`pinned_${id}`);
        localStorage.removeItem(`role_${id}`);
    }
    
    contacts = {};
    await saveContacts();
    
    activePeer = null;
    connectedPeerId = null;
    verifiedFingerprints = {};
    localStorage.removeItem('activePeer');
    
    renderContactList();
    
    const main = $('main-chat');
    const side = $('sidebar');
    if (main) main.classList.add('hidden');
    if (side) {
        side.classList.remove('hidden');
        if (window.innerWidth <= 700) side.classList.add('visible');
    }
    
    const msgs = $('messages');
    if (msgs) msgs.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>Выберите или создайте чат</p></div>`;
    
    closeSettings();
    alert('Все чаты удалены.');
}

function openLightbox(src) {
    const existing = document.querySelector('.lightbox-overlay');
    if (existing) existing.remove();
    
    const overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    
    const img = document.createElement('img');
    img.src = src;
    img.className = 'lightbox-image';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'lightbox-close';
    closeBtn.innerHTML = '✕';
    
    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    document.body.appendChild(overlay);
    
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    closeBtn.onclick = () => overlay.remove();
    
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}
