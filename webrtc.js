// webrtc.js
// Управление WebRTC соединением, data-каналом и обменом зашифрованными сообщениями.
// Исправлена гонка состояний, добавлена верификация отпечатков.

const WORD_LIST = [
    'Альфа', 'Браво', 'Чарли', 'Дельта', 'Эхо', 'Фокстрот', 'Гольф', 'Отель',
    'Индия', 'Джульет', 'Кило', 'Лима', 'Майк', 'Ноябрь', 'Оскар', 'Папа',
    'Квебек', 'Ромео', 'Сьерра', 'Танго', 'Юниформ', 'Виктор', 'Виски', 'Рентген',
    'Янки', 'Зулу', 'Красный', 'Синий', 'Зелёный', 'Жёлтый', 'Оранжевый', 'Пурпурный',
    'Серебряный', 'Золотой', 'Кристальный', 'Алмазный', 'Рубиновый', 'Изумрудный', 'Сапфировый',
    'Нефритовый', 'Ониксовый', 'Янтарный', 'Коралловый', 'Лазурный', 'Фиолетовый', 'Малиновый', 'Индиго',
    'Бирюзовый', 'Магентовый', 'Оливковый', 'Бордовый'
];

function sdpToWords(sdp) {
    const fp = CryptoSystem.extractFingerprint(sdp);
    if (!fp) return 'Неизвестная сессия';
    let seed = 0;
    for (let i = 0; i < fp.length; i++) {
        seed = ((seed << 5) - seed) + fp.charCodeAt(i);
        seed |= 0;
    }
    const words = [];
    const absSeed = Math.abs(seed);
    for (let i = 0; i < 3; i++) {
        const index = (absSeed + i * 7) % WORD_LIST.length;
        words.push(WORD_LIST[index]);
    }
    return words.join(' · ');
}

// Глобальное состояние
let currentUser, myName = 'Вы', myAvatar = '';
let contacts = {};
let activePeer = null;
let peerConnection = null;
let dataChannel = null;
let pendingLocalKey = null;
let keySendInterval = null;
let connectedPeerId = null;
let masterPassword = null;
let verifiedFingerprints = {}; // Кеш проверенных отпечатков

// Настройка WebRTC
function setupPeerConnection(peerId) {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
    }
    if (keySendInterval) {
        clearInterval(keySendInterval);
        keySendInterval = null;
    }

    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.oniceconnectionstatechange = () => updateOnlineStatus();
    peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        updateOnlineStatus();
    };

    // Хост создаёт data channel
    dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
    setupDataChannel(peerId, 'host');
}

function setupDataChannel(peerId, role = 'unknown') {
    if (!dataChannel) return;

    dataChannel.onopen = async () => {
        console.log('Data channel открыт, отправляю ключ');
        
        // Отправка ключа
        if (pendingLocalKey) {
            const sendKey = () => {
                if (!dataChannel || dataChannel.readyState !== 'open') return;
                dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
            };
            sendKey();
            if (keySendInterval) clearInterval(keySendInterval);
            keySendInterval = setInterval(sendKey, 400);
        }
        
        updateOnlineStatus();

        if (connectedPeerId && contacts[connectedPeerId]) {
            const roleSaved = localStorage.getItem(`role_${connectedPeerId}`);
            if (roleSaved && !contacts[connectedPeerId].role) {
                contacts[connectedPeerId].role = roleSaved;
                await saveContactsSecure();
            }
        }

        const newChatModal = $('new-chat-modal');
        if (newChatModal && !newChatModal.classList.contains('hidden')) {
            closeNewChat();
        }

        if (connectedPeerId) {
            console.log('Активируем чат для:', connectedPeerId);
            activePeer = connectedPeerId;
            localStorage.setItem('activePeer', activePeer);
            updateUIForPeer(activePeer);
            renderContactList();
        }

        const restorePanel = $('restore-panel');
        if (restorePanel) restorePanel.classList.remove('visible');
    };

    dataChannel.onclose = () => {
        console.log('Data channel закрыт');
        updateOnlineStatus();
        if (activePeer && peerId === activePeer) {
            const restorePanel = $('restore-panel');
            if (restorePanel) restorePanel.classList.add('visible');
        }
    };

    dataChannel.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'key') {
                const targetPeer = connectedPeerId || activePeer;
                if (targetPeer && contacts[targetPeer]) {
                    contacts[targetPeer].remoteKey = data.key;
                    await saveContactsSecure();
                    console.log('Получен ключ собеседника:', data.key);
                    if (keySendInterval) clearInterval(keySendInterval);
                    loadMessages(targetPeer);
                    updateKeyDisplay();
                }
            } else if (data.type === 'message' || data.type === 'image') {
                const targetPeer = connectedPeerId || activePeer;
                if (targetPeer && contacts[targetPeer]) {
                    await saveMessageToHistory(targetPeer, data);
                    if (targetPeer === activePeer) loadMessages(targetPeer);
                }
            } else if (data.type === 'fingerprint_ack') {
                // Собеседник подтвердил наш отпечаток
                if (connectedPeerId) {
                    verifiedFingerprints[connectedPeerId] = true;
                    console.log('Отпечаток подтверждён собеседником');
                }
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    };
}

// Отправка сообщения
async function sendMessage() {
    const text = $('message-input').value.trim();
    if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') {
        alert('Нет соединения.');
        return;
    }
    const remoteKey = contacts[activePeer]?.remoteKey;
    if (!remoteKey) {
        alert('Ожидание ключа шифрования...');
        return;
    }
    try {
        const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
        const msgObj = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
        dataChannel.send(JSON.stringify(msgObj));
        await saveMessageToHistory(activePeer, msgObj);
        $('message-input').value = '';
        loadMessages(activePeer);
    } catch (e) {
        console.error('Ошибка шифрования:', e);
        alert('Не удалось зашифровать сообщение.');
    }
}

// Отправка изображения
async function sendImage(file) {
    if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') {
        alert('Нет соединения.');
        return;
    }
    const remoteKey = contacts[activePeer]?.remoteKey;
    if (!remoteKey) {
        alert('Ожидание ключа шифрования...');
        return;
    }

    try {
        const img = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
            const ratio = Math.min(maxDim / width, maxDim / height);
            width *= ratio;
            height *= ratio;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
        const arrayBuffer = await blob.arrayBuffer();

        const encrypted = await CryptoSystem.encryptData(arrayBuffer, remoteKey);
        const msgObj = {
            type: 'image',
            from: currentUser,
            ciphertext: encrypted,
            mimeType: 'image/jpeg',
            timestamp: Date.now()
        };
        dataChannel.send(JSON.stringify(msgObj));
        await saveMessageToHistory(activePeer, msgObj);
        loadMessages(activePeer);
    } catch (e) {
        console.error('Ошибка отправки изображения:', e);
        alert('Не удалось отправить изображение.');
    }
}

async function saveMessageToHistory(peerId, msg) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    let hist = [];
    if (masterPassword) {
        hist = await CryptoSystem.loadEncryptedHistory(key, masterPassword);
    } else {
        hist = JSON.parse(localStorage.getItem(key) || '[]');
    }
    hist.push(msg);
    
    if (masterPassword) {
        await CryptoSystem.saveEncryptedHistory(key, hist, masterPassword);
    } else {
        localStorage.setItem(key, JSON.stringify(hist));
    }
}

async function loadMessageHistory(peerId) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    if (masterPassword) {
        return await CryptoSystem.loadEncryptedHistory(key, masterPassword);
    } else {
        return JSON.parse(localStorage.getItem(key) || '[]');
    }
}

function waitForIceGathering() {
    return new Promise((resolve) => {
        if (peerConnection.iceGatheringState === 'complete') resolve();
        else {
            peerConnection.onicegatheringstatechange = () => {
                if (peerConnection.iceGatheringState === 'complete') resolve();
            };
            setTimeout(resolve, 3000);
        }
    });
}

// Функция верификации отпечатка
async function verifyFingerprint(peerId, localFp, remoteFp) {
    if (verifiedFingerprints[peerId]) return true;
    
    const localWords = sdpToWordsByFp(localFp);
    const remoteWords = sdpToWordsByFp(remoteFp);
    
    if (localWords === remoteWords) {
        verifiedFingerprints[peerId] = true;
        return true;
    }
    
    // Показываем диалог подтверждения
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>🔐 Проверка отпечатка</h2>
                </div>
                <div class="modal-body">
                    <p>Сравните коды с собеседником:</p>
                    <div class="fingerprint-verify">
                        <div class="fp-words">${localWords}</div>
                        <p style="color: var(--text-secondary); margin: 8px 0;">Код должен совпадать у обоих</p>
                    </div>
                    <div class="fp-buttons">
                        <button class="btn-primary" id="fp-confirm">✅ Совпадает</button>
                        <button class="btn-secondary" id="fp-deny">❌ Не совпадает</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        
        document.getElementById('fp-confirm').onclick = () => {
            verifiedFingerprints[peerId] = true;
            modal.remove();
            if (dataChannel && dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({ type: 'fingerprint_ack' }));
            }
            resolve(true);
        };
        
        document.getElementById('fp-deny').onclick = () => {
            modal.remove();
            resolve(false);
        };
    });
}

function sdpToWordsByFp(fp) {
    if (!fp) return 'Неизвестно';
    let seed = 0;
    for (let i = 0; i < fp.length; i++) {
        seed = ((seed << 5) - seed) + fp.charCodeAt(i);
        seed |= 0;
    }
    const words = [];
    const absSeed = Math.abs(seed);
    for (let i = 0; i < 3; i++) {
        const index = (absSeed + i * 7) % WORD_LIST.length;
        words.push(WORD_LIST[index]);
    }
    return words.join(' · ');
}

async function saveContactsSecure() {
    if (masterPassword) {
        await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
    } else {
        localStorage.setItem('contacts', JSON.stringify(contacts));
    }
}

// Функции потока создания чата
async function setupPeerConnectionForHost() {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(configuration);
    
    // Data channel создаётся здесь, но setupDataChannel вызывается ПОСЛЕ установки remoteDescription
    dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
    
    peerConnection.oniceconnectionstatechange = updateOnlineStatus;
    peerConnection.onconnectionstatechange = () => {
        console.log('Host connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') updateOnlineStatus();
    };
    
    // Не вызываем setupDataChannel здесь — вызовем после получения ответа
}

async function hostSubmitAnswer() {
    const hostAnswerInput = $('host-answer-input');
    if (!hostAnswerInput) return;
    const answerStr = hostAnswerInput.value.trim();
    if (!answerStr) return;
    
    try {
        const answer = JSON.parse(answerStr);
        
        // Верификация отпечатка перед установкой соединения
        const localFp = CryptoSystem.extractFingerprint(peerConnection.localDescription.sdp);
        const remoteFp = CryptoSystem.extractFingerprint(answer.sdp);
        
        const verified = await verifyFingerprint(connectedPeerId, localFp, remoteFp);
        if (!verified) {
            alert('Отпечатки не совпадают! Возможна атака "человек посередине".');
            return;
        }
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Теперь настраиваем data channel
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

async function joinSubmitOffer() {
    const joinOfferInput = $('join-offer-input');
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
        await saveContactsSecure();

        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(configuration);
        
        peerConnection.ondatachannel = (event) => {
            console.log('Получен data channel от хоста');
            dataChannel = event.channel;
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

async function restoreSession(peerId) {
    const role = contacts[peerId]?.role || localStorage.getItem(`role_${peerId}`);
    
    if (role === 'host') {
        showNewChat();
        await startHostFlow();
        
        const hostInviteArea = $('host-invite-area');
        if (hostInviteArea) {
            hostInviteArea.classList.add('visible');
        }
        
        const alertInfo = hostInviteArea?.querySelector('.alert');
        if (alertInfo) {
            alertInfo.textContent = 'Отправьте этот новый код другу для переподключения';
        }
    } else if (role === 'guest') {
        showNewChat();
        startJoinFlow();
        
        const joinInputArea = $('join-input-area');
        if (joinInputArea) {
            joinInputArea.classList.add('visible');
        }
        
        const alertInfo = joinInputArea?.querySelector('.alert');
        if (alertInfo) {
            alertInfo.textContent = 'Попросите друга отправить новый код и вставьте его сюда';
        }
    } else {
        showNewChat();
    }
}