const SIGNAL_HOST = 'stable.okeysexsex.workers.dev';

const Session = {
mode: null,
roomId: null,
key: null,
ws: null,
pc: null,
dc: null,
iceServers: null,
pendingIce: [],
closedByUser: false,
reconnectTimer: null,
reconnectAttempts: 0,

async create() {
this.close();
const secret = CryptoSystem.randomBytes(16);
const hash = CryptoSystem.b64encode(secret);
await this.start(secret, 'host');
history.replaceState(null, '', '#' + hash);
return location.origin + location.pathname + '#' + hash;
},

async join(link) {
const text = String(link).trim();
const idx = text.indexOf('#');
const hash = (idx === -1 ? text : text.slice(idx + 1)).split(/[\s?&]/)[0];
const secret = CryptoSystem.b64decode(hash);
if (secret.length !== 16) throw new Error('invalid link');
this.close();
await this.start(secret, 'guest');
},

async start(secret, mode) {
this.closedByUser = false;
this.reconnectAttempts = 0;
this.mode = mode;
const derived = await CryptoSystem.deriveRoom(secret);
this.roomId = derived.roomId;
this.key = derived.key;
this.iceServers = await this.fetchIce();
this.setupPeer();
this.openSocket();
},

async fetchIce() {
try {
const r = await fetch('https://' + SIGNAL_HOST + '/turn', { cache: 'no-store' });
if (r.ok) {
const j = await r.json();
if (j.iceServers) return Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
}
} catch (e) {}
return [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
},

openSocket() {
if (this.closedByUser) return;
this.ws = new WebSocket('wss://' + SIGNAL_HOST + '/ws/' + this.roomId);
this.ws.onopen = () => {
this.reconnectAttempts = 0;
UI.signalState('waiting');
if (this.mode === 'guest') this.send({ type: 'hello' });
};
this.ws.onmessage = (e) => { this.onSignal(e.data); };
this.ws.onclose = (e) => {
if (this.closedByUser) return;
const live = this.dc && this.dc.readyState === 'open';
if (!live && e.code === 4001) { UI.fatal('Комната уже занята'); return; }
if (!live && e.code === 4000) { UI.fatal('Срок действия комнаты истёк'); return; }
this.reconnectAttempts += 1;
const delay = Math.min(1500 * Math.pow(2, this.reconnectAttempts - 1), 15000);
this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
};
},

async send(obj) {
if (!this.ws || this.ws.readyState !== 1) return;
const envelope = await CryptoSystem.seal(this.key, obj);
this.ws.send(JSON.stringify(envelope));
},

async makeOffer() {
if (!this.pc || this.pc.localDescription) return;
await this.pc.setLocalDescription(await this.pc.createOffer());
this.send({ type: 'sdp', sdp: this.pc.localDescription.toJSON() });
},

async onSignal(raw) {
let m;
try { m = JSON.parse(raw); } catch (e) { return; }
if (m.type === 'peer-joined') {
UI.signalState('paired');
if (this.mode === 'host') await this.makeOffer();
return;
}
if (m.type === 'peer-left') {
UI.peerLeft();
this.restartPeer();
return;
}
if (m.type === 'waiting') {
UI.signalState('waiting');
return;
}
if (!m.i || !m.c) return;
let msg;
try { msg = await CryptoSystem.open(this.key, m); } catch (e) { return; }
if (msg.type === 'hello' && this.mode === 'host') {
if (this.pc.localDescription && (!this.dc || this.dc.readyState !== 'open')) this.restartPeer();
await this.makeOffer();
return;
}
if (msg.type === 'sdp' && msg.sdp) {
try {
await this.pc.setRemoteDescription(msg.sdp);
for (const c of this.pendingIce) {
try { await this.pc.addIceCandidate(c); } catch (e) {}
}
this.pendingIce = [];
if (msg.sdp.type === 'offer') {
await this.pc.setLocalDescription(await this.pc.createAnswer());
this.send({ type: 'sdp', sdp: this.pc.localDescription.toJSON() });
}
} catch (e) {}
return;
}
if (msg.type === 'ice' && msg.candidate) {
if (this.pc.remoteDescription) {
try { await this.pc.addIceCandidate(msg.candidate); } catch (e) {}
} else {
this.pendingIce.push(msg.candidate);
}
}
},

setupPeer() {
const hasTurn = this.iceServers.some(s => {
const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
return String(u).startsWith('turn');
});
const policy = Settings.relayOnly && hasTurn ? 'relay' : 'all';
this.pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: policy });
this.pc.onicecandidate = (e) => {
if (e.candidate) this.send({ type: 'ice', candidate: e.candidate.toJSON() });
};
this.pc.onconnectionstatechange = () => {
const s = this.pc.connectionState;
UI.connState(s);
if (s === 'failed') this.restartPeer();
};
if (this.mode === 'host') {
this.bindChannel(this.pc.createDataChannel('0byte', { ordered: true }));
} else {
this.pc.ondatachannel = (e) => this.bindChannel(e.channel);
}
},

restartPeer() {
if (this.closedByUser) return;
this.pendingIce = [];
if (this.dc) {
this.dc.onopen = null;
this.dc.onclose = null;
this.dc.onmessage = null;
try { this.dc.close(); } catch (e) {}
this.dc = null;
}
if (this.pc) {
this.pc.onicecandidate = null;
this.pc.onconnectionstatechange = null;
this.pc.ondatachannel = null;
try { this.pc.close(); } catch (e) {}
this.pc = null;
}
this.setupPeer();
if (this.mode === 'guest' && this.ws && this.ws.readyState === 1) this.send({ type: 'hello' });
},

bindChannel(dc) {
this.dc = dc;
dc.binaryType = 'arraybuffer';
dc.bufferedAmountLowThreshold = 1048576;
dc.onopen = async () => {
Transfer.attach(dc);
let words = [];
try {
words = await CryptoSystem.sas(this.pc.localDescription.sdp, this.pc.remoteDescription.sdp);
} catch (e) {}
UI.connected(words);
this.sendProfile();
};
dc.onclose = () => {
UI.disconnected();
if (!this.closedByUser) this.restartPeer();
};
dc.onmessage = (e) => Router.route(e.data);
},

sendProfile() {
if (this.dc && this.dc.readyState === 'open') {
this.dc.send(JSON.stringify({ type: 'profile', name: Settings.displayName }));
}
},

sendText(text) {
if (!this.dc || this.dc.readyState !== 'open') return false;
this.dc.send(JSON.stringify({ type: 'msg', text, ts: Date.now() }));
return true;
},

sendTyping() {
if (this.dc && this.dc.readyState === 'open') {
this.dc.send(JSON.stringify({ type: 'typing' }));
}
},

close() {
this.closedByUser = true;
clearTimeout(this.reconnectTimer);
if (this.dc) {
this.dc.onopen = null;
this.dc.onclose = null;
this.dc.onmessage = null;
try { this.dc.close(); } catch (e) {}
}
if (this.pc) {
this.pc.onicecandidate = null;
this.pc.onconnectionstatechange = null;
this.pc.ondatachannel = null;
try { this.pc.close(); } catch (e) {}
}
if (this.ws) {
this.ws.onopen = null;
this.ws.onmessage = null;
this.ws.onclose = null;
try { this.ws.close(); } catch (e) {}
}
this.dc = null;
this.pc = null;
this.ws = null;
this.pendingIce = [];
this.mode = null;
this.key = null;
this.roomId = null;
history.replaceState(null, '', location.pathname);
}
};

const Router = {
route(data) {
if (data instanceof ArrayBuffer) {
Transfer.onChunk(data);
return;
}
let m;
try { m = JSON.parse(data); } catch (e) { return; }
if (m.type === 'msg') {
UI.addMessage({ mine: false, text: String(m.text || '').slice(0, 16000), ts: Number(m.ts) || Date.now() });
} else if (m.type === 'typing') {
UI.peerTyping();
} else if (m.type === 'profile') {
UI.setPeerName(String(m.name || '').slice(0, 40));
} else if (m.type === 'file-meta') {
Transfer.onMeta(m);
} else if (m.type === 'file-done') {
Transfer.onDone(m.id);
} else if (m.type === 'file-cancel') {
Transfer.onCancel(m.id);
}
}
};