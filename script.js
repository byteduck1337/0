let currentUser = null;
let myEncryptionKey = null;
let partnerKey = null;
let partnerUsername = null;
let messagePollingInterval = null;
let onlineUpdateInterval = null;
let decryptedMessageCache = [];

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

    static encryptMessage(message, key) {
        const shift = this.sha256Simple(key) % 95;
        const messageObj = {
            user: currentUser,
            message: message,
            timestamp: Date.now()
        };
        const jsonStr = JSON.stringify(messageObj);
        const caesarEncrypted = this.caesarEncrypt(jsonStr, shift);
        const hash = this.sha256Simple(caesarEncrypted + key);
        return btoa(unescape(encodeURIComponent(caesarEncrypted + '|' + hash)));
    }

    static decryptMessage(encryptedMessage, key) {
        try {
            const decoded = decodeURIComponent(escape(atob(encryptedMessage)));
            const parts = decoded.split('|');
            if (parts.length !== 2) return null;
            const caesarEncrypted = parts[0];
            const originalHash = parts[1];
            if (this.sha256Simple(caesarEncrypted + key) !== originalHash) return null;
            const shift = this.sha256Simple(key) % 95;
            return JSON.parse(this.caesarDecrypt(caesarEncrypted, shift));
        } catch (e) {
            return null;
        }
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
}

function generateUsername() {
    return 'user-' + Math.random().toString(36).substring(2, 8);
}

function updateOnlineStatus() {
    if (!currentUser) return;
    localStorage.setItem('messenger_online_' + currentUser, Date.now().toString());
}

function getPartnerOnlineStatus() {
    if (!partnerUsername || partnerUsername === 'partner') return '⚪ Unknown';
    const lastSeen = parseInt(localStorage.getItem('messenger_online_' + partnerUsername));
    if (!lastSeen) return '⚪ Offline';
    const secondsAgo = (Date.now() - lastSeen) / 1000;
    if (secondsAgo < 15) return '🟢 Online';
    if (secondsAgo < 60) return '🟡 Just now';
    const mins = Math.floor(secondsAgo / 60);
    if (mins < 60) return '○ ' + mins + 'm ago';
    return '○ Long ago';
}

function startOnlineUpdates() {
    if (onlineUpdateInterval) clearInterval(onlineUpdateInterval);
    updateOnlineStatus();
    onlineUpdateInterval = setInterval(updateOnlineStatus, 3000);
}

function init() {
    currentUser = localStorage.getItem('messenger_username');
    myEncryptionKey = localStorage.getItem('messenger_my_key');

    if (!currentUser || !myEncryptionKey) {
        currentUser = generateUsername();
        myEncryptionKey = CryptoSystem.generateKey();
        localStorage.setItem('messenger_username', currentUser);
        localStorage.setItem('messenger_my_key', myEncryptionKey);
    }

    document.getElementById('username-display').textContent = currentUser;
    startOnlineUpdates();

    partnerKey = localStorage.getItem('messenger_partner_key');
    partnerUsername = localStorage.getItem('messenger_partner_username');

    if (partnerKey && partnerUsername) {
        document.getElementById('partner-key-input').value = partnerKey;
        if (partnerUsername !== 'partner') {
            startChat(partnerUsername);
        } else {
            document.getElementById('waiting-section').classList.remove('hidden');
        }
    }

    loadMessageCache();
    loadMessages();

    window.addEventListener('storage', (e) => {
        if (e.key === 'messenger_all_messages') {
            loadMessages();
        }
    });
}

function copyMyKey() {
    navigator.clipboard.writeText(myEncryptionKey).then(() => {
        const btn = document.querySelector('.copy-key-btn');
        const originalText = btn.textContent;
        btn.textContent = '✅ Copied!';
        btn.style.background = '#16a34a';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '#1e293b';
        }, 2000);
    });
}

function connectToPartner() {
    const key = document.getElementById('partner-key-input').value.trim();
    if (!key) {
        document.getElementById('connection-status').textContent = 'Please paste a key';
        return;
    }

    partnerKey = key;
    localStorage.setItem('messenger_partner_key', partnerKey);

    const users = JSON.parse(localStorage.getItem('messenger_users') || '{}');
    let foundUser = null;
    for (const [username, userKey] of Object.entries(users)) {
        if (userKey === partnerKey && username !== currentUser) {
            foundUser = username;
            break;
        }
    }

    if (foundUser) {
        partnerUsername = foundUser;
        localStorage.setItem('messenger_partner_username', partnerUsername);
        startChat(partnerUsername);
        document.getElementById('connection-status').textContent = 'Connected to ' + partnerUsername;
    } else {
        partnerUsername = 'partner';
        localStorage.setItem('messenger_partner_username', partnerUsername);
        document.getElementById('chat-section').classList.add('hidden');
        document.getElementById('waiting-section').classList.remove('hidden');
        document.getElementById('connection-status').textContent = 'Waiting for partner...';
    }
}

function startChat(partner) {
    partnerUsername = partner;
    document.getElementById('partner-name').textContent = partnerUsername;
    document.getElementById('chat-section').classList.remove('hidden');
    document.getElementById('waiting-section').classList.add('hidden');
    document.getElementById('connection-status').textContent = 'Connected to ' + partnerUsername;

    if (messagePollingInterval) clearInterval(messagePollingInterval);
    messagePollingInterval = setInterval(() => {
        checkNewMessages();
        document.getElementById('online-status').textContent = getPartnerOnlineStatus();
    }, 1000);

    loadMessages();
}

function sendMessage() {
    const messageText = document.getElementById('message-input').value.trim();
    if (!messageText || !partnerKey) {
        alert('Connect to a partner first');
        return;
    }

    const encryptedMessage = CryptoSystem.encryptMessage(messageText, partnerKey);
    const messages = JSON.parse(localStorage.getItem('messenger_all_messages') || '[]');
    messages.push({
        from: currentUser,
        to: partnerUsername,
        encrypted: encryptedMessage,
        timestamp: Date.now()
    });
    localStorage.setItem('messenger_all_messages', JSON.stringify(messages));

    const users = JSON.parse(localStorage.getItem('messenger_users') || '{}');
    users[currentUser] = myEncryptionKey;
    localStorage.setItem('messenger_users', JSON.stringify(users));

    decryptedMessageCache.push({
        from: currentUser,
        message: messageText,
        timestamp: Date.now()
    });

    document.getElementById('message-input').value = '';
    loadMessages();
}

function loadMessageCache() {
    const cached = sessionStorage.getItem('decrypted_cache');
    if (cached) {
        decryptedMessageCache = JSON.parse(cached);
    }
}

function saveMessageCache() {
    sessionStorage.setItem('decrypted_cache', JSON.stringify(decryptedMessageCache));
}

function loadMessages() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;

    const allMessages = JSON.parse(localStorage.getItem('messenger_all_messages') || '[]');
    const relevantMessages = allMessages.filter(msg =>
        (msg.from === currentUser && msg.to === partnerUsername) ||
        (msg.to === currentUser && msg.from === partnerUsername)
    );

    if (relevantMessages.length === 0 && decryptedMessageCache.length === 0) {
        messagesContainer.innerHTML = '<div class="system-msg">No messages yet</div>';
        return;
    }

    messagesContainer.innerHTML = '';

    decryptedMessageCache.forEach(cached => {
        const isMyMessage = cached.from === currentUser;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isMyMessage ? 'my-message' : 'other-message'}`;
        messageDiv.innerHTML = `
            <div class="message-bubble">
                ${cached.message}
                <span class="encrypted-badge">🔒</span>
            </div>
            <div class="message-meta">${new Date(cached.timestamp).toLocaleTimeString()}</div>
        `;
        messagesContainer.appendChild(messageDiv);
    });

    relevantMessages.forEach(msg => {
        const isMyMessage = msg.from === currentUser;
        const decryptionKey = isMyMessage ? partnerKey : myEncryptionKey;

        const alreadyCached = decryptedMessageCache.some(c =>
            c.from === msg.from && c.timestamp === msg.timestamp
        );
        if (alreadyCached) return;

        let decrypted = null;
        if (decryptionKey) {
            decrypted = CryptoSystem.decryptMessage(msg.encrypted, decryptionKey);
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isMyMessage ? 'my-message' : 'other-message'}`;

        if (decrypted) {
            messageDiv.innerHTML = `
                <div class="message-bubble">
                    ${decrypted.message}
                    <span class="encrypted-badge">🔒</span>
                </div>
                <div class="message-meta">${new Date(decrypted.timestamp).toLocaleTimeString()}</div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="message-bubble" style="opacity:0.6;background:#e2e8f0;color:#475569;">
                    🔒 Encrypted
                </div>
                <div class="message-meta">${new Date(msg.timestamp).toLocaleTimeString()}</div>
            `;
        }
        messagesContainer.appendChild(messageDiv);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    saveMessageCache();
}

function checkNewMessages() {
    const allMessages = JSON.parse(localStorage.getItem('messenger_all_messages') || '[]');
    const lastMsg = allMessages[allMessages.length - 1];
    if (lastMsg && lastMsg.from !== currentUser &&
        (lastMsg.to === currentUser || lastMsg.from === partnerUsername)) {
        loadMessages();
    }
}

document.getElementById('partner-key-input').addEventListener('paste', function () {
    setTimeout(() => {
        if (this.value.trim()) {
            document.getElementById('connection-status').textContent = 'Key pasted. Click Connect';
        }
    }, 100);
});

window.addEventListener('DOMContentLoaded', init);
