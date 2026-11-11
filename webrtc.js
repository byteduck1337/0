const SIGNAL_HOST = 'stable.okeysexsex.workers.dev';
const SIGNAL_HTTP = 'https://' + SIGNAL_HOST;
const PROBE_TIMEOUT = 5000;

const Net = {
mode: null,
ws: null,
es: null,
queue: [],
flushing: false,
generation: 0,
roomId: null,
onMessage: null,
onStatus: null,

reset() {
this.generation += 1;
this.queue = [];
this.flushing = false;
if (this.ws) {
this.ws.onopen = null;
this.ws.onmessage = null;
this.ws.onerror = null;
this.ws.onclose = null;
try { this.ws.close(); } catch (e) {}
this.ws = null;
}
if (this.es) {
this.es.onopen = null;
this.es.onmessage = null;
this.es.onerror = null;
try { this.es.close(); } catch (e) {}
this.es = null;
}
},

async connect(roomId, onMessage, onStatus) {
this.reset();
this.roomId = roomId;
this.onMessage = onMessage;
this.onStatus = onStatus;
const gen = this.generation;
onStatus('probe');
const ok = await this.tryWebSocket(gen);
if (ok || gen !== this.generation) return ok;
onStatus('fallback');
return this.trySse(gen);
},

tryWebSocket(gen) {
return new Promise((resolve) => {
let settled = false;
let socket = null;
const finish = (ok) => {
if (settled) return;
settled = true;
clearTimeout(timer);
if (!ok && socket) {
socket.onopen = null;
socket.onmessage = null;
socket.onerror = null;
socket.onclose = null;
try { socket.close(); } catch (e) {}
if (this.ws === socket) this.ws = null;
}
resolve(ok);
};
const timer = setTimeout(() => finish(false), PROBE_TIMEOUT);
try {
socket = new WebSocket('wss://' + SIGNAL_HOST + '/ws/' + this.roomId);
} catch (e) {
finish(false);
return;
}
this.ws = socket;
socket.onopen = () => {
if (gen !== this.generation) { finish(false); return; }
this.mode = 'ws';
this.onStatus('ws');
finish(true);
};
socket.onmessage = (ev) => {
if (gen === this.generation) this.onMessage(ev.data);
};
socket.onerror = () => finish(false);
socket.onclose = (ev) => {
if (!settled) { finish(false); return; }
if (gen !== this.generation) return;
if (ev.code === 4001) { this.onStatus('full'); return; }
if (ev.code === 4000) { this.onStatus('expired'); return; }
this.onStatus('reconnect');
setTimeout(() => {
if (gen === this.generation) this.connect(this.roomId, this.onMessage, this.onStatus);
}, 1500);
};
});
},

trySse(gen) {
return new Promise((resolve) => {
let settled = false;
let source = null;
const finish = (ok) => {
if (settled) return;
settled = true;
clearTimeout(timer);
if (!ok && source) {
try { source.close(); } catch (e) {}
if (this.es === source) this.es = null;
}
resolve(ok);
};
const timer = setTimeout(() => finish(false), PROBE_TIMEOUT);
try {
source = new EventSource(SIGNAL_HTTP + '/sse/' + this.roomId);
} catch (e) {
finish(false);
return;
}
this.es = source;
source.onopen = () => {
if (gen !== this.generation) { finish(false); return; }
this.mode = 'sse';
this.onStatus('sse');
finish(true);
};
source.onmessage = (ev) => {
if (gen === this.generation && ev.data) this.onMessage(ev.data);
};
source.onerror = () => {
if (!settled) {
if (source.readyState === EventSource.CLOSED) finish(false);
return;
}
if (gen !== this.generation) return;
this.onStatus(source.readyState === EventSource.OPEN ? 'sse' : 'reconnect');
};
});
},

send(payload) {
if (this.mode === 'ws' && this.ws && this.ws.readyState === 1) {
try { this.ws.send(payload); return true; } catch (e) { return false; }
}
if (this.mode === 'sse') {
this.queue.push(payload);
this.flush();
return true;
}
return false;
},

async flush() {
if (this.flushing) return;
this.flushing = true;
while (this.queue.length && this.roomId) {
const payload = this.queue.shift();
let ok = false;
for (let attempt = 0; attempt < 3 && !ok; attempt++) {
try {
const res = await fetch(SIGNAL_HTTP + '/pub/' + this.roomId, {
method: 'POST',
headers: { 'Content-Type': 'text/plain' },
body: payload,
cache: 'no-store'
});
ok = res.ok;
} catch (e) {
ok = false;
}
if (!ok) await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
}
if (!ok) UI.toast('Сигнал не доставлен — попробуйте переподключиться');
}
this.flushing = false;
}
};

const Session = {
mode: null,
roomId: null,
key: null,
pc: null,
dc: null,
iceServers: null,
pendingIce: [],
closedByUser: false,
restartTimer: null,
hasTurn: false,

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
this.mode = mode;
const derived = await CryptoSystem.deriveRoom(secret);
this.roomId = derived.roomId;
this.key = derived.key;
UI.diag({ room: this.roomId, sdp: '—', ice: 'idle' });
this.iceServers = await this.fetchIce();
this.hasTurn = this.iceServers.some(s => String(Array.isArray(s.urls) ? s.urls[0] : s.urls).startsWith('turn'));
UI.diag({ turn: this.hasTurn ? 'настроен' : 'нет (только STUN)' });
this.setupPeer();
const ok = await Net.connect(this.roomId, (raw) => this.onSignal(raw), (state) => this.onNetState(state));
if (!ok && !this.closedByUser) {
UI.diag({ signal: 'недоступен' });
UI.fatal('Сигнальный сервер недоступен. Откройте диагностику.');
}
},

async fetchIce() {
try {
const r = await fetch(SIGNAL_HTTP + '/turn', { cache: 'no-store' });
if (r.ok) {
const j = await r.json();
if (j.iceServers) return Array.isArray(j.iceServers) ? j.iceServers : [j.iceServers];
}
} catch (e) {}
return [
{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
{ urls: 'stun:stun.cloudflare.com:3478' }
];
},

onNetState(state) {
const labels = {
probe: 'проверка WebSocket…',
fallback: 'WebSocket недоступен → резервный канал',
ws: 'WebSocket',
sse: 'резервный канал (HTTPS)',
reconnect: 'переподключение…',
full: 'комната занята',
expired: 'комната истекла'
};
UI.diag({ signal: labels[state] || state });
if (state === 'full') { UI.fatal('Комната уже занята двумя устройствами'); return; }
if (state === 'expired') { UI.fatal('Срок действия комнаты истёк'); return; }
if ((state === 'ws' || state === 'sse') && this.mode === 'guest') this.send({ type: 'hello' });
UI.signalState(state === 'reconnect' ? 'waiting' : 'linked');
},

async send(obj) {
if (!this.key) return;
const envelope = await CryptoSystem.seal(this.key, obj);
Net.send(JSON.stringify(envelope));
},

async makeOffer() {
if (!this.pc || this.pc.localDescription) return;
await this.pc.setLocalDescription(await this.pc.createOffer());
UI.diag({ sdp: 'offer отправлен' });
this.send({ type: 'sdp', sdp: this.pc.localDescription.toJSON() });
},

async onSignal(raw) {
let m;
try { m = JSON.parse(raw); } catch (e) { return; }
if (m.type === 'peer-joined') {
UI.signalState('paired');
if (this.mode === 'host') await this.makeOffer();
else if (this.pc && !this.pc.remoteDescription) this.send({ type: 'hello' });
return;
}
if (m.type === 'peer-left') {
UI.peerLeft();
this.scheduleRestart();
return;
}
if (m.type === 'waiting') { UI.signalState('waiting'); return; }
if (m.type === 'room-full') { UI.fatal('Комната уже занята'); return; }
if (m.type === 'room-expired') { UI.fatal('Срок действия комнаты истёк'); return; }
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
UI.diag({ sdp: msg.sdp.type === 'offer' ? 'offer получен' : 'answer получен' });
for (const c of this.pendingIce) {
try { await this.pc.addIceCandidate(c); } catch (e) {}
}
this.pendingIce = [];
if (msg.sdp.type === 'offer') {
await this.pc.setLocalDescription(await this.pc.createAnswer());
this.send({ type: 'sdp', sdp: this.pc.localDescription.toJSON() });
}
} catch (e) {
UI.diag({ sdp: 'ошибка SDP' });
}
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
const policy = Settings.relayOnly && this.hasTurn ? 'relay' : 'all';
this.pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: policy });
this.pc.onicecandidate = (e) => {
if (e.candidate) this.send({ type: 'ice', candidate: e.candidate.toJSON() });
};
this.pc.oniceconnectionstatechange = () => {
UI.diag({ ice: this.pc.iceConnectionState });
if (this.pc.iceConnectionState === 'failed') this.scheduleRestart();
};
this.pc.onconnectionstatechange = () => {
UI.connState(this.pc.connectionState);
if (this.pc.connectionState === 'failed') this.scheduleRestart();
};
if (this.mode === 'host') {
this.bindChannel(this.pc.createDataChannel('0byte', { ordered: true }));
} else {
this.pc.ondatachannel = (e) => this.bindChannel(e.channel);
}
},

scheduleRestart() {
if (this.closedByUser) return;
clearTimeout(this.restartTimer);
this.restartTimer = setTimeout(() => this.restartPeer(), 700);
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
this.pc.oniceconnectionstatechange = null;
this.pc.onconnectionstatechange = null;
this.pc.ondatachannel = null;
try { this.pc.close(); } catch (e) {}
this.pc = null;
}
this.setupPeer();
if (this.mode === 'guest') this.send({ type: 'hello' });
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
if (!this.closedByUser) this.scheduleRestart();
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
clearTimeout(this.restartTimer);
Net.reset();
if (this.dc) {
this.dc.onopen = null;
this.dc.onclose = null;
this.dc.onmessage = null;
try { this.dc.close(); } catch (e) {}
}
if (this.pc) {
this.pc.onicecandidate = null;
this.pc.oniceconnectionstatechange = null;
this.pc.onconnectionstatechange = null;
this.pc.ondatachannel = null;
try { this.pc.close(); } catch (e) {}
}
this.dc = null;
this.pc = null;
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
