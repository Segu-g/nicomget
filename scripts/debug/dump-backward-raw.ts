/**
 * メッセージサーバーからの ChunkedEntry を全フィールドダンプする。
 * backward (field 2) の有無を確認する。nextAt で再接続もする。
 *
 * Usage: npx tsx scripts/debug/dump-backward-raw.ts <liveId> [cookies]
 */

import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

import { WebSocketClient } from '../../src/providers/niconico/WebSocketClient.js';
import { extractMessages } from '../../src/providers/niconico/ProtobufParser.js';

const liveId = process.argv[2];
const cookies = process.argv[3];

if (!liveId) {
  console.error('Usage: npx tsx scripts/debug/dump-backward-raw.ts <liveId> [cookies]');
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

function parseEntryFields(data: Uint8Array): { fields: number[], backwardUri?: string, segmentUri?: string, nextAt?: string } {
  const reader = new Reader(data);
  const result: { fields: number[], backwardUri?: string, segmentUri?: string, nextAt?: string } = { fields: [] };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    result.fields.push(field);

    if (wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;

      if (field === 2) {
        // BackwardSegment → segment field 2 → uri field 1
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
              const uf = ut >>> 3;
              const uw = ut & 7;
              if (uf === 1 && uw === 2) {
                result.backwardUri = uReader.string();
              } else { uReader.skipType(uw); }
            }
          } else { bReader.skipType(w); }
        }
      } else if (field === 1 || field === 3) {
        // MessageSegment → uri field 3
        const sReader = new Reader(subData);
        while (sReader.pos < sReader.len) {
          const t = sReader.uint32();
          const f = t >>> 3;
          const w = t & 7;
          if (f === 3 && w === 2) { result.segmentUri = sReader.string(); }
          else { sReader.skipType(w); }
        }
      } else if (field === 4) {
        // ReadyForNext → at field 1
        const nReader = new Reader(subData);
        while (nReader.pos < nReader.len) {
          const t = nReader.uint32();
          const f = t >>> 3;
          const w = t & 7;
          if (f === 1 && w === 0) { result.nextAt = String(nReader.int64()); }
          else { nReader.skipType(w); }
        }
      }
    } else {
      reader.skipType(wireType);
    }
  }
  return result;
}

async function streamEntries(baseUri: string, at: string, maxMs: number): Promise<void> {
  const separator = baseUri.includes('?') ? '&' : '?';
  const uri = `${baseUri}${separator}at=${at}`;

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (cookies) headers['Cookie'] = cookies;

  console.log(`\n--- Connecting at=${at} ---`);
  console.log(`URI: ${uri}\n`);

  const controller = new AbortController();
  const response = await fetch(uri, { headers, signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let entryCount = 0;
  let nextAt: string | undefined;

  const startTime = Date.now();
  while (Date.now() - startTime < maxMs) {
    const { done, value } = await reader.read();
    if (done) break;

    const combined = new Uint8Array(buffer.length + value.length);
    combined.set(buffer, 0);
    combined.set(value, buffer.length);

    const { messages, remaining } = extractMessages(combined);
    buffer = new Uint8Array(remaining);

    for (const msg of messages) {
      entryCount++;
      const parsed = parseEntryFields(msg);
      const fieldNames = parsed.fields.map(f => ({ 1: 'segment', 2: 'BACKWARD', 3: 'previous', 4: 'next' }[f] ?? `?${f}`));
      let detail = `  fields: [${fieldNames.join(', ')}]`;
      if (parsed.segmentUri) detail += `\n  segmentUri: ${parsed.segmentUri.substring(0, 80)}...`;
      if (parsed.backwardUri) detail += `\n  *** backwardUri: ${parsed.backwardUri.substring(0, 80)}...`;
      if (parsed.nextAt) { detail += `\n  nextAt: ${parsed.nextAt}`; nextAt = parsed.nextAt; }
      console.log(`[Entry ${entryCount}]\n${detail}\n`);
    }
  }

  controller.abort();
  reader.cancel().catch(() => {});
  console.log(`${entryCount} entries received (at=${at})`);

  if (nextAt && at === 'now') {
    // Follow next to see if backward appears in the second connection
    await streamEntries(baseUri, nextAt, 15_000);
  }
}

async function main() {
  console.log(`=== ChunkedEntry raw dump (with next follow) ===`);
  console.log(`放送ID: ${liveId}`);

  const wsUrl = await fetchWebSocketUrl();
  const ws = new WebSocketClient(wsUrl);

  const viewUri = await new Promise<string>((resolve) => {
    ws.on('messageServer', resolve);
    ws.connect();
  });
  console.log(`viewUri: ${viewUri}`);

  await streamEntries(viewUri, 'now', 15_000);

  ws.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
