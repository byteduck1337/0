// webrtc.js
// Управление WebRTC соединением, data-каналом и обменом зашифрованными сообщениями.

// Слова для визуальной маскировки SDP
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
    const fpMatch = sdp.match(/a=fingerprint:(sha-\d+) (\S+)/);
    if (!fpMatch) return 'Неизвестная сессия';
    const fingerprint = fpMatch[2].replace(/:/g, '');
    let seed = 0;
    for (let i = 0; i < fingerprint.length; i++) {
        seed = ((seed << 5) - seed) + fingerprint.charCodeAt(i);
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

// Глобальное состояние (будет инициализировано в app.js)
let currentUser, myName = 'Вы', myAvatar = '';
let contacts = {};
let activePeer = null;
let peerConnection = null;
let dataChannel = null;
let pendingLocalKey = null;
let keySendInterval = null;
let connectedPeerId = null; // идентификатор собеседника для текущего WebRTC-соединения

// Настройка WebRTC (вызывается из ui.js для открытия чата или из flow)
function setupPeerConnection(peerId) {
    // Закрываем предыдущее соединение
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

    dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
    setupDataChannel(peerId);
}

function setupDataChannel(peerId) {
    if (!dataChannel) return;

    dataChannel.onopen = () => {
        console.log('Data channel открыт, отправляю ключ');
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

        // Сохраняем роль для восстановления
        if (connectedPeerId && contacts[connectedPeerId]) {
            const role = localStorage.getItem(`role_${connectedPeerId}`);
            if (role && !contacts[connectedPeerId].role) {
                contacts[connectedPeerId].role = role;
                saveContacts();
            }
        }

        // Автозакрытие модалки создания чата
        const newChatModal = $('new-chat-modal');
        if (newChatModal && !newChatModal.classList.contains('hidden')) {
            closeNewChat();
        }

        // Активируем чат для connectedPeerId
        if (connectedPeerId) {
            console.log('Активируем чат для:', connectedPeerId);
            activePeer = connectedPeerId;
            localStorage.setItem('activePeer', activePeer);
            updateUIForPeer(activePeer);
            renderContactList();
        }

        // Скрываем панель восстановления
        const restorePanel = $('restore-panel');
        if (restorePanel) restorePanel.classList.remove('visible');
    };

    dataChannel.onclose = () => {
        console.log('Data channel закрыт');
        updateOnlineStatus();
        // Показываем панель восстановления если это был активный чат
        if (activePeer && peerId === activePeer) {
            const restorePanel = $('restore-panel');
            if (restorePanel) restorePanel.classList.add('visible');
        }
    };

    dataChannel.onmessage = async (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'key') {
                // Сохраняем ключ собеседника для connectedPeerId или activePeer
                const targetPeer = connectedPeerId || activePeer;
                if (targetPeer && contacts[targetPeer]) {
                    contacts[targetPeer].remoteKey = data.key;
                    saveContacts();
                    console.log('Получен ключ собеседника:', data.key);
                    if (keySendInterval) clearInterval(keySendInterval);
                    loadMessages(targetPeer);
                    updateKeyDisplay();
                }
            } else if (data.type === 'message' || data.type === 'image') {
                const targetPeer = connectedPeerId || activePeer;
                if (targetPeer && contacts[targetPeer]) {
                    saveMessageToHistory(targetPeer, data);
                    if (targetPeer === activePeer) loadMessages(targetPeer);
                }
            }
        } catch (e) {
            console.error('Ошибка обработки сообщения:', e);
        }
    };
}

// Отправка сообщения (вызывается из ui.js)
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
        saveMessageToHistory(activePeer, msgObj);
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
        // Сжатие через canvas
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
        saveMessageToHistory(activePeer, msgObj);
        loadMessages(activePeer);
    } catch (e) {
        console.error('Ошибка отправки изображения:', e);
        alert('Не удалось отправить изображение.');
    }
}

function saveMessageToHistory(peerId, msg) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    const hist = JSON.parse(localStorage.getItem(key) || '[]');
    hist.push(msg);
    localStorage.setItem(key, JSON.stringify(hist));
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

// Функции для потока создания чата
async function setupPeerConnectionForHost() {
    const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(configuration);
    dataChannel = peerConnection.createDataChannel('chat', { ordered: true });
    setupDataChannel(connectedPeerId);
    peerConnection.oniceconnectionstatechange = updateOnlineStatus;
    peerConnection.onconnectionstatechange = () => {
        console.log('Host connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') updateOnlineStatus();
    };
}

// Функция для восстановления чата
async function restoreSession(peerId) {
    const role = contacts[peerId]?.role || localStorage.getItem(`role_${peerId}`);
    
    if (role === 'host') {
        // Пересоздаём приглашение и показываем его
        showNewChat();
        await startHostFlow();
        
        // Показываем панель с приглашением
        const hostInviteArea = $('host-invite-area');
        if (hostInviteArea) {
            hostInviteArea.classList.add('visible');
        }
        
        // Обновляем сообщение
        const alertInfo = hostInviteArea?.querySelector('.alert');
        if (alertInfo) {
            alertInfo.textContent = 'Отправьте этот новый код другу для переподключения';
        }
    } else if (role === 'guest') {
        // Показываем модалку для ввода нового приглашения
        showNewChat();
        startJoinFlow();
        
        const joinInputArea = $('join-input-area');
        if (joinInputArea) {
            joinInputArea.classList.add('visible');
        }
        
        // Обновляем сообщение
        const alertInfo = joinInputArea?.querySelector('.alert');
        if (alertInfo) {
            alertInfo.textContent = 'Попросите друга отправить новый код и вставьте его сюда';
        }
    } else {
        showNewChat();
    }
}