// worker.js — Signaling-сервер для /0byte/ (stateful через in-memory Map)
// Деплой: wrangler publish (или Cloudflare Dashboard → Workers → Create)

const ROOM_TTL_MS = 15 * 60 * 1000; // 15 минут жизни комнаты
const rooms = new Map(); // code -> { offer?, answer?, createdAt }

// CORS
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function cleanup() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) rooms.delete(code);
  }
}

async function handleRequest(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  cleanup();
  const url = new URL(request.url);
  const path = url.pathname;

  // --- ХОСТ: создать комнату с offer ---
  if (path === '/api/room' && request.method === 'POST') {
    const { code, offer } = await request.json();
    if (!code || !offer) return error('code и offer обязательны');
    rooms.set(code, { offer, createdAt: Date.now() });
    return json({ ok: true, code });
  }

  // --- ГОСТЬ: получить offer по коду ---
  if (path === '/api/room' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) return error('code обязателен');
    const room = rooms.get(code);
    if (!room || !room.offer) return error('Комната не найдена или истекла', 404);
    return json({ offer: room.offer });
  }

  // --- ГОСТЬ: отправить answer ---
  if (path === '/api/answer' && request.method === 'POST') {
    const { code, answer } = await request.json();
    if (!code || !answer) return error('code и answer обязательны');
    const room = rooms.get(code);
    if (!room) return error('Комната не найдена', 404);
    room.answer = answer;
    room.answerAt = Date.now();
    return json({ ok: true });
  }

  // --- ХОСТ: получить answer (polling) ---
  if (path === '/api/answer' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    const room = rooms.get(code);
    if (!room || !room.answer) return json({ answer: null });
    return json({ answer: room.answer });
  }

  // --- Пинг ---
  if (path === '/api/ping') return json({ ok: true, rooms: rooms.size });

  return error('Неизвестный маршрут', 404);
}

function json(data) { return new Response(JSON.stringify(data), { headers: CORS_HEADERS }); }
function error(msg, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: CORS_HEADERS });
}

export default {
  async fetch(request) {
    try { return await handleRequest(request); }
    catch (e) { return error('Internal error: ' + e.message, 500); }
  }
};