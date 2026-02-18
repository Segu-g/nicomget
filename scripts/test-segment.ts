/**
 * セグメントサーバーの生データをダンプしてprotobuf構造を理解するスクリプト
 */

import WebSocket from 'ws';
import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

function readLengthDelimitedMessage(buffer: Uint8Array): { message: Uint8Array; bytesRead: number } | null {
  if (buffer.length === 0) return null;
  try {
    const reader = new Reader(buffer);
    const messageLength = reader.uint32();
    const headerSize = reader.pos;
    if (buffer.length < headerSize + messageLength) return null;
    return { message: buffer.slice(headerSize, headerSize + messageLength), bytesRead: headerSize + messageLength };
  } catch { return null; }
}

function extractMessages(buffer: Uint8Array): { messages: Uint8Array[]; remaining: Uint8Array } {
  const messages: Uint8Array[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const result = readLengthDelimitedMessage(buffer.slice(offset));
    if (!result) break;
    messages.push(result.message);
    offset += result.bytesRead;
  }
  return { messages, remaining: buffer.slice(offset) };
}

function parseProtobufFields(data: Uint8Array): Array<{ field: number; wireType: number; value: any }> {
  const reader = new Reader(data);
  const fields: Array<{ field: number; wireType: number; value: any }> = [];
  while (reader.pos < reader.len) {
    try {
      const tag = reader.uint32();
      const field = tag >>> 3;
      const wireType = tag & 7;
      let value: any;
      switch (wireType) {
        case 0: value = reader.int64(); if (typeof value !== 'number') value = Number(value); break;
        case 2: { const len = reader.uint32(); value = reader.buf.slice(reader.pos, reader.pos + len); reader.pos += len; break; }
        default: reader.skipType(wireType); value = `<skipped wt=${wireType}>`; break;
      }
      fields.push({ field, wireType, value });
    } catch { break; }
  }
  return fields;
}

function tryDecodeString(data: Uint8Array): string | null {
  try {
    const str = new TextDecoder().decode(data);
    const printable = str.split('').filter(c => c.charCodeAt(0) >= 32 || c === '\n').length;
    if (str.length > 0 && printable / str.length > 0.8) return str;
  } catch {}
  return null;
}

function dumpProtobuf(data: Uint8Array, label: string, depth: number = 0): void {
  const indent = '  '.repeat(depth);
  const fields = parseProtobufFields(data);

  if (fields.length === 0 && data.length > 0) {
    const str = tryDecodeString(data);
    if (str) console.log(`${indent}${label}: "${str.substring(0, 200)}"`);
    else {
      const hex = Array.from(data.slice(0, 30)).map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`${indent}${label}: <${data.length} bytes> ${hex}`);
    }
    return;
  }

  console.log(`${indent}${label}:`);
  for (const f of fields) {
    if (f.wireType === 2 && f.value instanceof Uint8Array) {
      if (depth < 6) dumpProtobuf(f.value, `f${f.field}[${f.value.length}B]`, depth + 1);
      else {
        const str = tryDecodeString(f.value);
        console.log(`${indent}  f${f.field}: ${str || `<${f.value.length}B>`}`);
      }
    } else {
      console.log(`${indent}  f${f.field}(wt${f.wireType}): ${f.value}`);
    }
  }
}

/** セグメントURI群をChunkedEntryメッセージから全て抽出 */
function extractAllUris(msgs: Uint8Array[]): string[] {
  const uris: string[] = [];
  for (const msg of msgs) {
    collectUris(msg, uris);
  }
  return uris;
}

function collectUris(data: Uint8Array, uris: string[]): void {
  const fields = parseProtobufFields(data);
  for (const f of fields) {
    if (f.wireType === 2 && f.value instanceof Uint8Array) {
      const str = tryDecodeString(f.value);
      if (str && str.startsWith('http')) {
        uris.push(str);
      } else {
        collectUris(f.value, uris);
      }
    }
  }
}

async function main() {
  const LIVE_ID = 'lv349881238';
  console.log('=== セグメントデータ構造ダンプ ===\n');

  // Step 1: data-props取得
  console.log('1. 放送ページ取得...');
  const html = await (await fetch(`https://live.nicovideo.jp/watch/${LIVE_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })).text();
  const match = html.match(/id="embedded-data"\s+data-props="([^"]+)"/);
  if (!match) throw new Error('embedded-data not found');
  const propsJson = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const wsUrl = JSON.parse(propsJson).site?.relive?.webSocketUrl;
  console.log('   OK');

  // Step 2: WebSocket
  console.log('2. WebSocket接続...');
  const { ws, viewUri } = await new Promise<{ ws: WebSocket; viewUri: string }>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'startWatching',
        data: { stream: { quality: 'abr', protocol: 'hls', latency: 'low', chasePlay: false }, room: { protocol: 'webSocket', commentable: false }, reconnect: false },
      }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      if (msg.type === 'messageServer') resolve({ ws, viewUri: msg.data.viewUri });
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('timeout')), 15000);
  });
  console.log(`   viewUri: ${viewUri}`);

  // Step 3: メッセージサーバー at=now
  console.log('\n3. メッセージサーバー (at=now)...');
  const sep = viewUri.includes('?') ? '&' : '?';
  const resp1 = await fetch(`${viewUri}${sep}at=now`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Priority': 'u=1, i' },
  });
  const body1 = new Uint8Array(await resp1.arrayBuffer());
  const { messages: msgs1 } = extractMessages(body1);
  console.log(`   メッセージ数: ${msgs1.length}`);
  for (const msg of msgs1) dumpProtobuf(msg, 'ChunkedEntry');

  // nextAt取得
  let nextAt: string | null = null;
  for (const msg of msgs1) {
    const fields = parseProtobufFields(msg);
    for (const f of fields) {
      if (f.field === 4 && f.wireType === 2 && f.value instanceof Uint8Array) {
        const subFields = parseProtobufFields(f.value);
        for (const sf of subFields) {
          if (sf.field === 1 && sf.wireType === 0) nextAt = String(sf.value);
        }
      }
    }
  }
  console.log(`   nextAt: ${nextAt}`);

  // Step 4: メッセージサーバー at=nextAt
  if (nextAt) {
    console.log(`\n4. メッセージサーバー (at=${nextAt})...`);
    const resp2 = await fetch(`${viewUri}${sep}at=${nextAt}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Priority': 'u=1, i' },
    });
    const body2 = new Uint8Array(await resp2.arrayBuffer());
    const { messages: msgs2 } = extractMessages(body2);
    console.log(`   メッセージ数: ${msgs2.length}`);
    for (const msg of msgs2) dumpProtobuf(msg, 'ChunkedEntry');

    // 全URLを抽出
    const allUris = extractAllUris(msgs2);
    console.log(`\n   見つかったURL (${allUris.length}件):`);
    for (const uri of allUris) console.log(`     ${uri}`);

    // 各セグメントを取得してダンプ
    for (let i = 0; i < Math.min(allUris.length, 3); i++) {
      console.log(`\n5-${i + 1}. セグメントデータ取得: ${allUris[i].substring(0, 80)}...`);
      const segResp = await fetch(allUris[i], {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      console.log(`   HTTP Status: ${segResp.status}`);
      const segBody = new Uint8Array(await segResp.arrayBuffer());
      console.log(`   Total bytes: ${segBody.length}`);
      const { messages: segMsgs } = extractMessages(segBody);
      console.log(`   Length-Delimited messages: ${segMsgs.length}`);
      for (let j = 0; j < Math.min(segMsgs.length, 5); j++) {
        dumpProtobuf(segMsgs[j], `Msg_${j + 1}`, 1);
      }
      if (segMsgs.length > 5) {
        console.log(`   ... and ${segMsgs.length - 5} more messages`);
      }
    }
  }

  ws.close();
  console.log('\n=== 完了 ===');
}

main().catch(console.error);
