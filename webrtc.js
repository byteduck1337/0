// --- Configuration ---
const SIGNALING_URL = 'https://0.okeysexsex.workers.dev/'; // Замените на ваш URL
const USE_LOCAL_SIGNALING = true; // true для теста, false для Cloudflare

// --- State ---
let currentUser, myName = 'Node_01', myAvatar = '', contacts = {}, activePeer = null;
let peerConnection = null, dataChannel = null, pendingLocalKey = null;
let keySendInterval = null, connectedPeerId = null, masterPassword = null;
let verifiedFingerprints = {};
let currentRoomId = null;

// --- Signaling Adapter ---
const Signal = {
    async send(roomId, type, data) {
        if (USE_LOCAL_SIGNALING) {
            localStorage.setItem(`sig_${roomId}_${type}`, JSON.stringify(data));
            return new Promise(r => setTimeout(r, 300));
        } else {
            const res = await fetch(`${SIGNALING_URL}/signal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId, type, data })
            });
            return res.json();
        }
    },
    async receive(roomId, type) {
        if (USE_LOCAL_SIGNALING) {
            const data = localStorage.getItem(`sig_${roomId}_${type}`);
            return data ? JSON.parse(data) : null;
        } else {
            const res = await fetch(`${SIGNALING_URL}/signal?roomId=${roomId}&type=${type}`);
            if (res.status === 404) return null;
            return res.json();
        }
    },
    async createRoom() {
        if (USE_LOCAL_SIGNALING) return CryptoSystem.generateKey().slice(0, 6).toUpperCase();
        const res = await fetch(`${SIGNALING_URL}/create`, { method: 'POST' });
        return (await res.json()).roomId;
    }
};

// --- Core Logic ---
function setupPeerConnection(peerId, isHost) {
    if (peerConnection) peerConnection.close();
    if (dataChannel) dataChannel.close();
    if (keySendInterval) clearInterval(keySendInterval);

    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    peerConnection = new RTCPeerConnection(config);

    peerConnection.oniceconnectionstatechange = () => UI.updateStatus();
    peerConnection.onconnectionstatechange = () => {
        UI.updateStatus();
        if (peerConnection.connectionState === 'connected') UI.hideLoaders();
    };

    if (isHost) {
        dataChannel = peerConnection.createDataChannel('mesh', { ordered: true });
        setupDataChannel(peerId);
    } else {
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel(peerId);
        };
    }
}

function setupDataChannel(peerId) {
    if (!dataChannel) return;

    const sendKey = () => {
        if (dataChannel.readyState === 'open' && pendingLocalKey) {
            dataChannel.send(JSON.stringify({ type: 'key', key: pendingLocalKey }));
        }
    };

    dataChannel.onopen = () => {
        sendKey();
        keySendInterval = setInterval(sendKey, 1000);
        UI.updateStatus();
        activePeer = peerId;
        localStorage.setItem('activePeer', activePeer);
        UI.renderContacts();
        UI.openChat(peerId);
        document.getElementById('connection-banner').classList.add('hidden');
    };

    dataChannel.onclose = () => {
        clearInterval(keySendInterval);
        UI.updateStatus();
        if (activePeer === peerId) document.getElementById('connection-banner').classList.remove('hidden');
    };

    dataChannel.onmessage = async (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'key') {
                if (contacts[peerId]) {
                    contacts[peerId].remoteKey = msg.key;
                    await saveContacts();
                    UI.loadMessages(peerId);
                    dataChannel.send(JSON.stringify({ type: 'key_ack' }));
                }
            } else if (msg.type === 'key_ack') {
                clearInterval(keySendInterval);
            } else if (msg.type === 'message' || msg.type === 'image') {
                await saveMessage(peerId, msg);
                if (peerId === activePeer) UI.loadMessages(peerId);
            }
        } catch (e) { console.error(e); }
    };
}

async function waitForIce() {
    return new Promise(resolve => {
        if (peerConnection.iceGatheringState === 'complete') resolve();
        else {
            peerConnection.onicegatheringstatechange = () => {
                if (peerConnection.iceGatheringState === 'complete') resolve();
            };
            setTimeout(resolve, 3000);
        }
    });
}

// --- Flows ---
async function startHost() {
    UI.showStep('step-host');
    UI.setVoiceCode('host', 'GENERATING...');
    
    try {
        currentRoomId = await Signal.createRoom();
        connectedPeerId = currentRoomId;
        pendingLocalKey = CryptoSystem.generateKey();
        
        if (!contacts[currentRoomId]) contacts[currentRoomId] = { name: currentRoomId, avatar: '' };
        contacts[currentRoomId].localSessionKey = pendingLocalKey;
        contacts[currentRoomId].role = 'host';
        await saveContacts();

        setupPeerConnection(currentRoomId, true);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIce();

        const payload = JSON.stringify({ roomId: currentRoomId, sdp: peerConnection.localDescription.sdp, type: 'offer' });
        await Signal.send(currentRoomId, 'offer', peerConnection.localDescription);

        const voiceCode = await CryptoSystem.generateVoiceCode(currentRoomId);
        UI.setVoiceCode('host', voiceCode);
        window.currentPayload = payload;

        // Poll for answer
        const poll = async () => {
            if (connectedPeerId !== currentRoomId) return;
            const ans = await Signal.receive(currentRoomId, 'answer');
            if (ans) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(ans));
                UI.showLoader('host');
            } else {
                setTimeout(poll, 2000);
            }
        };
        poll();

    } catch (e) { alert('Error: ' + e.message); }
}

async function startGuest() {
    UI.showStep('step-guest');
    UI.resetGuest();
}

async function processGuestInput() {
    const input = document.getElementById('guest-offer-input').value.trim();
    const btn = document.getElementById('btn-guest-generate');
    
    // Simple validation: is it a short code or JSON?
    const isJson = input.startsWith('{');
    const isCode = input.length >= 4 && input.length <= 10;
    
    btn.disabled = !(isJson || isCode);
    window.guestInput = input;
}

async function generateAnswer() {
    const input = window.guestInput;
    if (!input) return;

    try {
        let offerDesc, roomId;

        if (input.startsWith('{')) {
            const parsed = JSON.parse(input);
            roomId = parsed.roomId;
            offerDesc = { sdp: parsed.sdp, type: 'offer' };
        } else {
            roomId = input.toUpperCase();
            const data = await Signal.receive(roomId, 'offer');
            if (!data) throw new Error('Room not found');
            offerDesc = data;
        }

        connectedPeerId = roomId;
        pendingLocalKey = CryptoSystem.generateKey();
        
        if (!contacts[roomId]) contacts[roomId] = { name: roomId, avatar: '' };
        contacts[roomId].localSessionKey = pendingLocalKey;
        contacts[roomId].role = 'guest';
        await saveContacts();

        setupPeerConnection(roomId, false);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offerDesc));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await waitForIce();

        await Signal.send(roomId, 'answer', peerConnection.localDescription);

        const payload = JSON.stringify({ roomId, sdp: peerConnection.localDescription.sdp, type: 'answer' });
        const voiceCode = await CryptoSystem.generateVoiceCode(peerConnection.localDescription.sdp);
        
        UI.showGuestResult(voiceCode, payload);

    } catch (e) { alert('Error: ' + e.message); }
}

// --- Messaging ---
async function sendMessage() {
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !activePeer || !dataChannel || dataChannel.readyState !== 'open') return;

    const remoteKey = contacts[activePeer]?.remoteKey;
    if (!remoteKey) return;

    try {
        const ciphertext = await CryptoSystem.encrypt(text, remoteKey);
        const msg = { type: 'message', from: currentUser, ciphertext, timestamp: Date.now() };
        dataChannel.send(JSON.stringify(msg));
        await saveMessage(activePeer, msg);
        input.value = '';
        input.style.height = 'auto';
        UI.loadMessages(activePeer);
        UI.toggleSendBtn();
    } catch (e) { console.error(e); }
}

async function sendImage(file) {
    if (!activePeer || !dataChannel || dataChannel.readyState !== 'open') return;
    const remoteKey = contacts[activePeer]?.remoteKey;
    if (!remoteKey) return;

    try {
        const buffer = await file.arrayBuffer();
        const ciphertext = await CryptoSystem.encryptData(buffer, remoteKey);
        const msg = { type: 'image', from: currentUser, ciphertext, mimeType: file.type, timestamp: Date.now() };
        dataChannel.send(JSON.stringify(msg));
        await saveMessage(activePeer, msg);
        UI.loadMessages(activePeer);
    } catch (e) { console.error(e); }
}

async function saveMessage(peerId, msg) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    let history = masterPassword ? await CryptoSystem.loadEncryptedHistory(key, masterPassword) : JSON.parse(localStorage.getItem(key) || '[]');
    history.push(msg);
    if (masterPassword) await CryptoSystem.saveEncryptedHistory(key, history, masterPassword);
    else localStorage.setItem(key, JSON.stringify(history));
}

async function loadHistory(peerId) {
    const key = `history_${[currentUser, peerId].sort().join('_')}`;
    return masterPassword ? await CryptoSystem.loadEncryptedHistory(key, masterPassword) : JSON.parse(localStorage.getItem(key) || '[]');
}

async function saveContacts() {
    if (masterPassword) await CryptoSystem.saveEncryptedContacts(contacts, masterPassword);
    else localStorage.setItem('contacts', JSON.stringify(contacts));
}

// Expose to UI
window.WebRTC = {
    startHost, startGuest, processGuestInput, generateAnswer,
    sendMessage, sendImage, loadHistory, saveContacts,
    getState: () => ({ contacts, activePeer, currentUser, masterPassword, dataChannel, peerConnection })
};
