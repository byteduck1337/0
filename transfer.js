const Transfer = (() => {
const CHUNK = 65536;
const HEAD = 8;
const HIGH = 8388608;
const LOW = 1048576;
const MAX_SIZE = 68719476736;
const DISK_THRESHOLD = 268435456;
const out = new Map();
const inc = new Map();
let dc = null;

function attach(channel) {
dc = channel;
dc.bufferedAmountLowThreshold = LOW;
}

function newId() {
return crypto.getRandomValues(new Uint32Array(1))[0];
}

function control(obj) {
if (dc && dc.readyState === 'open') {
try { dc.send(JSON.stringify(obj)); } catch (e) {}
}
}

function waitDrain(channel) {
return new Promise((resolve) => {
const finish = () => {
channel.removeEventListener('bufferedamountlow', finish);
channel.removeEventListener('close', finish);
clearTimeout(timer);
resolve();
};
const timer = setTimeout(finish, 5000);
channel.addEventListener('bufferedamountlow', finish);
channel.addEventListener('close', finish);
});
}

async function send(file) {
if (!dc || dc.readyState !== 'open') {
UI.toast('Нет соединения');
return;
}
const channel = dc;
const id = newId();
const state = { cancelled: false };
out.set(id, state);
const mime = (file.type || 'application/octet-stream').slice(0, 100);
const ui = UI.fileBubble({ id, name: file.name, size: file.size, mime, mine: true, file });
control({ type: 'file-meta', id, name: file.name.slice(0, 255), size: file.size, mime });
let offset = 0;
let seq = 0;
const started = performance.now();
try {
while (offset < file.size) {
if (state.cancelled || channel.readyState !== 'open') {
control({ type: 'file-cancel', id });
ui.cancelled();
out.delete(id);
return;
}
if (channel.bufferedAmount > HIGH) await waitDrain(channel);
const slice = await file.slice(offset, offset + CHUNK - HEAD).arrayBuffer();
const packet = new ArrayBuffer(HEAD + slice.byteLength);
const view = new DataView(packet);
view.setUint32(0, id);
view.setUint32(4, seq);
new Uint8Array(packet, HEAD).set(new Uint8Array(slice));
channel.send(packet);
offset += slice.byteLength;
seq += 1;
const elapsed = (performance.now() - started) / 1000;
ui.progress(offset / file.size, elapsed > 0 ? offset / elapsed : 0);
}
if (state.cancelled) {
ui.cancelled();
out.delete(id);
return;
}
control({ type: 'file-done', id });
ui.done(null);
} catch (e) {
ui.failed();
}
out.delete(id);
}

function onMeta(m) {
const id = Number(m.id);
const size = Number(m.size);
if (!Number.isInteger(id) || !Number.isFinite(size) || size < 0 || size > MAX_SIZE || inc.has(id)) return;
const name = String(m.name || 'file').replace(/[\\/]/g, '_').slice(0, 255);
const mime = String(m.mime || 'application/octet-stream').slice(0, 100);
const t = {
id, name, size, mime,
received: 0,
parts: [],
writable: null,
pending: true,
cancelled: false,
started: performance.now()
};
t.ui = UI.fileBubble({ id, name, size, mime, mine: false });
inc.set(id, t);
t.ready = (async () => {
if (size > DISK_THRESHOLD && window.showSaveFilePicker) {
try {
const handle = await window.showSaveFilePicker({ suggestedName: name });
t.writable = await handle.createWritable();
while (t.parts.length && !t.cancelled) {
await t.writable.write(t.parts.shift());
}
} catch (e) {
t.writable = null;
}
}
t.pending = false;
})();
}

async function onChunk(buf) {
if (!(buf instanceof ArrayBuffer) || buf.byteLength < HEAD) return;
const view = new DataView(buf);
const t = inc.get(view.getUint32(0));
if (!t || t.cancelled) return;
const data = buf.slice(HEAD);
if (t.writable && !t.pending) {
try {
await t.writable.write(data);
} catch (e) {
t.writable = null;
t.parts.push(data);
}
} else {
t.parts.push(data);
}
t.received += data.byteLength;
const elapsed = (performance.now() - t.started) / 1000;
t.ui.progress(t.size ? t.received / t.size : 1, elapsed > 0 ? t.received / elapsed : 0);
}

async function onDone(id) {
const t = inc.get(Number(id));
if (!t) return;
await t.ready;
if (t.cancelled) return;
inc.delete(t.id);
if (t.received !== t.size) {
t.ui.failed();
if (t.writable) {
try { await t.writable.abort(); } catch (e) {}
}
return;
}
if (t.writable) {
try {
await t.writable.close();
t.ui.saved();
} catch (e) {
t.ui.failed();
}
return;
}
const blob = new Blob(t.parts, { type: t.mime });
t.parts = [];
t.ui.done(blob);
}

function dropIncoming(id) {
const t = inc.get(id);
if (!t) return false;
t.cancelled = true;
if (t.writable) {
try { t.writable.abort(); } catch (e) {}
}
t.parts = [];
t.ui.cancelled();
inc.delete(id);
return true;
}

function onCancel(id) {
const num = Number(id);
const o = out.get(num);
if (o) o.cancelled = true;
dropIncoming(num);
}

function cancel(id) {
const o = out.get(id);
if (o) {
o.cancelled = true;
return;
}
if (dropIncoming(id)) control({ type: 'file-cancel', id });
}

function abortAll() {
for (const state of out.values()) state.cancelled = true;
for (const t of inc.values()) {
t.cancelled = true;
if (t.writable) {
try { t.writable.abort(); } catch (e) {}
}
t.parts = [];
try { t.ui.cancelled(); } catch (e) {}
}
out.clear();
inc.clear();
dc = null;
}

return { attach, send, onMeta, onChunk, onDone, onCancel, cancel, abortAll };
})();
