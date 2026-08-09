const KV_NAMESPACE = SIGNALING_KV; // Bind this in wrangler.toml

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      // POST /signal - Save signal data (Offer/Answer)
      if (request.method === 'POST' && url.pathname === '/signal') {
        const { roomId, type, data, ttl } = await request.json();
        if (!roomId || !type || !data) return new Response('Missing fields', { status: 400, headers: corsHeaders });
        
        // Store with expiration (e.g., 1 hour)
        await env.SIGNALING_KV.put(`room:${roomId}:${type}`, JSON.stringify(data), { expirationTtl: ttl || 3600 });
        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // GET /signal?roomId=X&type=offer - Retrieve signal data
      if (request.method === 'GET' && url.pathname === '/signal') {
        const roomId = url.searchParams.get('roomId');
        const type = url.searchParams.get('type');
        if (!roomId || !type) return new Response('Missing params', { status: 400, headers: corsHeaders });

        const data = await env.SIGNALING_KV.get(`room:${roomId}:${type}`);
        if (!data) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: corsHeaders });
        
        return new Response(data, { headers: corsHeaders });
      }

      // POST /generate-room - Create short room ID
      if (request.method === 'POST' && url.pathname === '/generate-room') {
        const roomId = generateShortId();
        return new Response(JSON.stringify({ roomId }), { headers: corsHeaders });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (e) {
      return new Response(e.message, { status: 500, headers: corsHeaders });
    }
  }
};

function generateShortId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
  let result = '';
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 4; i++) result += chars[bytes[i] % chars.length];
  return result;
}
