/**
 * BackwardSegment チェーンの詳細ダンプ。
 * セグメントごとのメッセージ数・コメント番号範囲・next URI を表示する。
 *
 * Usage: npx tsx scripts/debug/dump-backward-chain.ts <liveId> [cookies]
 */

import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

import { WebSocketClient } from '../../src/providers/niconico/WebSocketClient.js';
import { extractMessages, parsePackedSegment } from '../../src/providers/niconico/ProtobufParser.js';

const liveId = process.argv[2];
const cookies = process.argv[3];

if (!liveId) {
  console.error('Usage: npx tsx scripts/debug/dump-backward-chain.ts <liveId> [cookies]');
  process.exit(1);
}

async function fetchWebSocketUrl(): Promise<string> {
  const url = `https://live.nicovideo.jp/watch/${liveId}`;
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'text/html',
  };
  if (cookies) headers['Cookie'] = cookies;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const html = await res.text();
  const match = html.match(/id="embedded-data"\s+data-props="([^"]+)"/);
  if (!match) throw new Error('embedded-data not found');
  const props = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  return props.site.relive.webSocketUrl;
}

function getBackwardUri(data: Uint8Array): string | undefined {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      if (field === 2) {
        // BackwardSegment → segment(field 2) → uri(field 1)
        const bReader = new Reader(subData);
        while (bReader.pos < bReader.len) {
          const t = bReader.uint32();
          const f = t >>> 3;
          const w = t & 7;
          if (f === 2 && w === 2) {
            const sLen = bReader.uint32();
            const sData = bReader.buf.slice(bReader.pos, bReader.pos + sLen);
            bReader.pos += sLen;
            const uReader = new Reader(sData);
            while (uReader.pos < uReader.len) {
              const ut = uReader.uint32();
              if ((ut >>> 3) === 1 && (ut & 7) === 2) return uReader.string();
              uReader.skipType(ut & 7);
            }
          } else { bReader.skipType(w); }
        }
      }
    } else { reader.skipType(wireType); }
  }
  return undefined;
}

function getNextAt(data: Uint8Array): string | undefined {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      if (field === 4) {
        const nReader = new Reader(subData);
        while (nReader.pos < nReader.len) {
          const t = nReader.uint32();
          if ((t >>> 3) === 1 && (t & 7) === 0) return String(nReader.int64());
          nReader.skipType(t & 7);
        }
      }
    } else { reader.skipType(wireType); }
  }
  return undefined;
}

async function fetchPackedSegment(uri: string): Promise<Uint8Array> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (cookies) headers['Cookie'] = cookies;
  const res = await fetch(uri, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function getBackwardUriFromStream(viewUri: string): Promise<string> {
  // Step 1: at=now → next
  const sep = viewUri.includes('?') ? '&' : '?';
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (cookies) headers['Cookie'] = cookies;

  const res1 = await fetch(`${viewUri}${sep}at=now`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res1.ok || !res1.body) throw new Error(`HTTP ${res1.status}`);

  let buffer = new Uint8Array(0);
  const reader1 = res1.body.getReader();
  let nextAt: string | undefined;

  while (!nextAt) {
    const { done, value } = await reader1.read();
    if (done) break;
    const combined = new Uint8Array(buffer.length + value.length);
    combined.set(buffer, 0);
    combined.set(value, buffer.length);
    const { messages, remaining } = extractMessages(combined);
    buffer = new Uint8Array(remaining);
    for (const msg of messages) {
      nextAt = getNextAt(msg);
      if (nextAt) break;
    }
  }
  reader1.cancel().catch(() => {});

  if (!nextAt) throw new Error('nextAt not found');
  console.log(`nextAt: ${nextAt}`);

  // Step 2: at=nextAt → backward
  const res2 = await fetch(`${viewUri}${sep}at=${nextAt}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res2.ok || !res2.body) throw new Error(`HTTP ${res2.status}`);

  buffer = new Uint8Array(0);
  const reader2 = res2.body.getReader();
  let backwardUri: string | undefined;

  const start = Date.now();
  while (!backwardUri && Date.now() - start < 15_000) {
    const { done, value } = await reader2.read();
    if (done) break;
    const combined = new Uint8Array(buffer.length + value.length);
    combined.set(buffer, 0);
    combined.set(value, buffer.length);
    const { messages, remaining } = extractMessages(combined);
    buffer = new Uint8Array(remaining);
    for (const msg of messages) {
      backwardUri = getBackwardUri(msg);
      if (backwardUri) break;
    }
  }
  reader2.cancel().catch(() => {});

  if (!backwardUri) throw new Error('backward URI not found');
  return backwardUri;
}

async function main() {
  console.log(`=== BackwardSegment チェーンダンプ ===`);
  console.log(`放送ID: ${liveId}\n`);

  const wsUrl = await fetchWebSocketUrl();
  const ws = new WebSocketClient(wsUrl);

  const viewUri = await new Promise<string>((resolve) => {
    ws.on('messageServer', resolve);
    ws.connect();
  });
  console.log(`viewUri: ${viewUri}\n`);

  const backwardUri = await getBackwardUriFromStream(viewUri);
  console.log(`\nbackward URI: ${backwardUri}\n`);

  // チェーンを辿る
  let uri: string | undefined = backwardUri;
  let depth = 0;
  const allChatNos: number[] = [];

  while (uri && depth < 10) {
    console.log(`--- Segment ${depth} ---`);
    console.log(`  URI: ${uri.substring(0, 80)}...`);

    const data = await fetchPackedSegment(uri);
    console.log(`  Size: ${data.byteLength} bytes`);

    const packed = parsePackedSegment(data);
    console.log(`  Messages: ${packed.messages.length}`);

    let chatCount = 0;
    let giftCount = 0;
    let notifCount = 0;
    let emotionCount = 0;
    let opCount = 0;
    const chatNos: number[] = [];

    for (const msg of packed.messages) {
      chatCount += msg.chats.length;
      giftCount += msg.gifts.length;
      notifCount += msg.notifications.length;
      emotionCount += msg.emotions.length;
      if (msg.operatorComment) opCount++;
      for (const c of msg.chats) chatNos.push(c.no);
    }

    console.log(`  Chats: ${chatCount}, Gifts: ${giftCount}, Notif: ${notifCount}, Emot: ${emotionCount}, Op: ${opCount}`);
    if (chatNos.length > 0) {
      console.log(`  Chat nos: ${chatNos[0]} ~ ${chatNos[chatNos.length - 1]} (${chatNos.length}件)`);
      let ordered = true;
      for (let i = 1; i < chatNos.length; i++) {
        if (chatNos[i] < chatNos[i - 1]) { ordered = false; break; }
      }
      console.log(`  Chat order: ${ordered ? '昇順 ✓' : '非昇順 ✗'}`);
    }
    console.log(`  nextUri: ${packed.nextUri ? packed.nextUri.substring(0, 60) + '...' : '(なし)'}`);
    console.log();

    allChatNos.push(...chatNos);
    uri = packed.nextUri;
    depth++;

    if (uri) await new Promise(r => setTimeout(r, 100));
  }

  console.log(`=== 全体集計 ===`);
  console.log(`総セグメント数: ${depth}`);
  console.log(`総チャット数: ${allChatNos.length}`);
  if (allChatNos.length > 0) {
    console.log(`Chat nos 全体: ${allChatNos[0]} ~ ${allChatNos[allChatNos.length - 1]}`);
    let globalOrdered = true;
    for (let i = 1; i < allChatNos.length; i++) {
      if (allChatNos[i] < allChatNos[i - 1]) {
        console.log(`  順序逆転: #${allChatNos[i - 1]} → #${allChatNos[i]} (segment boundary at index ${i})`);
        globalOrdered = false;
      }
    }
    console.log(`全体のChat順序: ${globalOrdered ? '昇順 ✓' : '非昇順 ✗'}`);
  }

  const uniqueNos = new Set(allChatNos);
  console.log(`ユニークChat数: ${uniqueNos.size} / ${allChatNos.length} (重複: ${allChatNos.length - uniqueNos.size})`);

  ws.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
