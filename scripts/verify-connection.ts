/**
 * 検証スクリプト: ニコニコ生放送クルーズからコメントを取得する
 *
 * Proto定義 (nicolive-comment-protobuf):
 *   ChunkedEntry { oneof: segment=1(MessageSegment), backward=2, previous=3, next=4(ReadyForNext) }
 *   MessageSegment { from=1(Timestamp), until=2(Timestamp), uri=3(string) }
 *   ReadyForNext { at=1(int64) }
 *   ChunkedMessage { meta=1(Meta), message=2(NicoliveMessage), state=4, signal=5 }
 *   NicoliveMessage { oneof: chat=1(Chat), ... }
 *   Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
 */

import WebSocket from 'ws';
import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

const LIVE_ID = process.argv[2] || 'lv349881238';

// ── Protobuf helpers ──

function readLengthDelimited(buf: Uint8Array): { message: Uint8Array; bytesRead: number } | null {
  if (buf.length === 0) return null;
  try {
    const r = new Reader(buf);
    const len = r.uint32();
    const hdr = r.pos;
    if (buf.length < hdr + len) return null;
    return { message: buf.slice(hdr, hdr + len), bytesRead: hdr + len };
  } catch { return null; }
}

function extractMessages(buf: Uint8Array): { messages: Uint8Array[]; remaining: Uint8Array } {
  const msgs: Uint8Array[] = [];
  let off = 0;
  while (off < buf.length) {
    const r = readLengthDelimited(buf.slice(off));
    if (!r) break;
    msgs.push(r.message);
    off += r.bytesRead;
  }
  return { messages: msgs, remaining: buf.slice(off) };
}

interface ProtoField { field: number; wireType: number; value: any }

function parseFields(data: Uint8Array): ProtoField[] {
  const r = new Reader(data);
  const fields: ProtoField[] = [];
  while (r.pos < r.len) {
    try {
      const tag = r.uint32();
      const field = tag >>> 3;
      const wt = tag & 7;
      let value: any;
      switch (wt) {
        case 0: { const v = r.int64(); value = typeof v === 'number' ? v : Number(v); break; }
        case 1: value = r.fixed64(); break; // 64-bit
        case 2: { const len = r.uint32(); value = r.buf.slice(r.pos, r.pos + len); r.pos += len; break; }
        case 5: value = r.fixed32(); break; // 32-bit
        default: r.skipType(wt); value = null; break;
      }
      fields.push({ field, wireType: wt, value });
    } catch { break; }
  }
  return fields;
}

function getString(data: Uint8Array): string | null {
  try {
    const s = new TextDecoder().decode(data);
    const ok = s.split('').filter(c => c.charCodeAt(0) >= 32 || c === '\n').length;
    return s.length > 0 && ok / s.length > 0.7 ? s : null;
  } catch { return null; }
}

// ── Protobuf parsers (正しいfield番号) ──

/** MessageSegment: from=1, until=2, uri=3 */
function parseMessageSegment(data: Uint8Array): string | undefined {
  for (const f of parseFields(data)) {
    if (f.field === 3 && f.wireType === 2 && f.value instanceof Uint8Array) {
      return getString(f.value) ?? undefined;
    }
  }
  return undefined;
}

/** ReadyForNext: at=1 (int64) */
function parseReadyForNext(data: Uint8Array): number | undefined {
  for (const f of parseFields(data)) {
    if (f.field === 1 && f.wireType === 0) return f.value;
  }
  return undefined;
}

/** ChunkedEntry: segment=1, backward=2, previous=3, next=4 */
function parseChunkedEntry(data: Uint8Array): { segmentUri?: string; nextAt?: number } {
  const result: { segmentUri?: string; nextAt?: number } = {};
  for (const f of parseFields(data)) {
    if (f.wireType !== 2 || !(f.value instanceof Uint8Array)) continue;
    switch (f.field) {
      case 1: // segment (MessageSegment)
      case 3: // previous (MessageSegment)
        if (!result.segmentUri) {
          result.segmentUri = parseMessageSegment(f.value);
        }
        break;
      case 4: // next (ReadyForNext)
        result.nextAt = parseReadyForNext(f.value);
        break;
    }
  }
  return result;
}

interface ChatInfo {
  content: string;
  name?: string;
  vpos: number;
  rawUserId?: number;
  hashedUserId?: string;
  no: number;
}

/** Chat: content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 */
function parseChat(data: Uint8Array): ChatInfo {
  const chat: ChatInfo = { content: '', vpos: 0, no: 0 };
  for (const f of parseFields(data)) {
    switch (f.field) {
      case 1: // content (string)
        if (f.wireType === 2 && f.value instanceof Uint8Array)
          chat.content = getString(f.value) ?? '';
        break;
      case 2: // name (string)
        if (f.wireType === 2 && f.value instanceof Uint8Array)
          chat.name = getString(f.value) ?? undefined;
        break;
      case 3: // vpos (int32)
        if (f.wireType === 0) chat.vpos = f.value;
        break;
      case 5: // raw_user_id (int64)
        if (f.wireType === 0) chat.rawUserId = f.value;
        break;
      case 6: // hashed_user_id (string)
        if (f.wireType === 2 && f.value instanceof Uint8Array)
          chat.hashedUserId = getString(f.value) ?? undefined;
        break;
      case 8: // no (int32)
        if (f.wireType === 0) chat.no = f.value;
        break;
    }
  }
  return chat;
}

/** NicoliveMessage: chat=1 (oneof) */
function parseNicoliveMessage(data: Uint8Array): ChatInfo | null {
  for (const f of parseFields(data)) {
    if (f.field === 1 && f.wireType === 2 && f.value instanceof Uint8Array) {
      return parseChat(f.value);
    }
  }
  return null;
}

/** ChunkedMessage: meta=1, message=2(NicoliveMessage), state=4, signal=5 */
function parseChunkedMessage(data: Uint8Array): ChatInfo | null {
  for (const f of parseFields(data)) {
    if (f.field === 2 && f.wireType === 2 && f.value instanceof Uint8Array) {
      return parseNicoliveMessage(f.value);
    }
  }
  return null;
}

// ── Main ──

async function main() {
  console.log(`=== NicomView 接続検証 ===`);
  console.log(`放送ID: ${LIVE_ID}\n`);

  // Step 1: 放送ページからWebSocket URL取得
  console.log('[1] 放送ページ取得...');
  const html = await (await fetch(`https://live.nicovideo.jp/watch/${LIVE_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  })).text();

  const match = html.match(/id="embedded-data"\s+data-props="([^"]+)"/);
  if (!match) throw new Error('embedded-data not found');
  const propsJson = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const props = JSON.parse(propsJson);
  const wsUrl = props.site?.relive?.webSocketUrl;
  if (!wsUrl) throw new Error('No webSocketUrl');
  console.log(`   wsUrl: ${wsUrl.substring(0, 80)}...`);

  // Step 2: WebSocket接続（Promise不使用、イベントベース）
  console.log('\n[2] WebSocket接続...');
  const ws = new WebSocket(wsUrl);
  let keepSeatTimer: ReturnType<typeof setInterval> | null = null;

  ws.on('open', () => {
    console.log('   接続成功');
    ws.send(JSON.stringify({
      type: 'startWatching',
      data: {
        stream: { quality: 'abr', protocol: 'hls', latency: 'low', chasePlay: false },
        room: { protocol: 'webSocket', commentable: false },
        reconnect: false,
      },
    }));
    console.log('   startWatching送信');
  });

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'seat':
        keepSeatTimer = setInterval(() => {
          ws.send(JSON.stringify({ type: 'keepSeat' }));
        }, (msg.data?.keepIntervalSec ?? 30) * 1000);
        break;
      case 'messageServer':
        console.log(`\n[3] messageServer受信`);
        console.log(`   viewUri: ${msg.data.viewUri.substring(0, 80)}...`);
        startMessageStream(msg.data.viewUri);
        break;
      case 'disconnect':
        console.log(`\n切断: ${msg.data?.reason}`);
        break;
    }
  });

  ws.on('error', (err) => console.error('WebSocketエラー:', err.message));
  ws.on('close', () => {
    if (keepSeatTimer) clearInterval(keepSeatTimer);
    console.log('WebSocket切断');
  });

  // Ctrl+C で終了
  process.on('SIGINT', () => {
    console.log('\n終了中...');
    ws.close();
    process.exit(0);
  });
}

// ── メッセージサーバーストリーミング ──

async function startMessageStream(viewUri: string): Promise<void> {
  const sep = viewUri.includes('?') ? '&' : '?';
  let at = 'now';

  while (true) {
    console.log(`\n[4] メッセージサーバー接続 (at=${at})`);
    const uri = `${viewUri}${sep}at=${at}`;

    const resp = await fetch(uri, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Priority': 'u=1, i',
      },
    });

    if (!resp.ok || !resp.body) {
      console.error(`   HTTP ${resp.status}`);
      break;
    }

    const reader = resp.body.getReader();
    let buffer = new Uint8Array(0);
    let nextAt: number | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const combined = new Uint8Array(buffer.length + value.length);
        combined.set(buffer, 0);
        combined.set(value, buffer.length);

        const { messages, remaining } = extractMessages(combined);
        buffer = new Uint8Array(remaining);

        for (const msg of messages) {
          const entry = parseChunkedEntry(msg);

          if (entry.segmentUri) {
            console.log(`   → セグメントURI取得`);
            // セグメントを非同期で取得（ブロックしない）
            fetchSegment(entry.segmentUri).catch(console.error);
          }
          if (entry.nextAt) {
            nextAt = entry.nextAt;
          }
        }
      }
    } catch (err: any) {
      console.error('   ストリームエラー:', err.message);
    }

    if (nextAt) {
      at = String(nextAt);
      console.log(`   → next: ${at}`);
    } else {
      console.log('   → nextAtなし、3秒後に再接続');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ── セグメントデータ取得 ──

async function fetchSegment(segmentUri: string): Promise<void> {
  try {
    const resp = await fetch(segmentUri, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!resp.ok || !resp.body) return;

    const body = new Uint8Array(await resp.arrayBuffer());
    const { messages } = extractMessages(body);

    for (const msg of messages) {
      const chat = parseChunkedMessage(msg);
      if (chat && chat.content) {
        const userId = chat.hashedUserId || (chat.rawUserId ? String(chat.rawUserId) : '匿名');
        console.log(`   💬 #${chat.no} [${userId}] ${chat.content}`);
      }
    }
  } catch (err: any) {
    console.error('   セグメント取得エラー:', err.message);
  }
}

main().catch(console.error);
