/**
 * 診断スクリプト: 各段階の生データをダンプする。
 */

import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

import { extractMessages } from '../src/providers/niconico/ProtobufParser.js';

const liveId = process.argv[2];
const cookies = process.argv[3];

if (!liveId) {
  console.error('Usage: npx tsx scripts/dump-raw.ts <liveId> [cookies]');
  process.exit(1);
}

function dumpFields(label: string, data: Uint8Array, depth = 0): void {
  const indent = '  '.repeat(depth);
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (wireType === 0) {
      const val = reader.int64();
      const num = typeof val === 'number' ? val : Number(val);
      console.log(`${indent}${label} field=${field} wireType=varint value=${num}`);
    } else if (wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      // try to decode as string if short
      let strPreview = '';
      try {
        const decoded = new TextDecoder().decode(subData);
        if (decoded.length < 200 && /^[\x20-\x7e\u3000-\u9fff\uff00-\uffef]+$/.test(decoded)) {
          strPreview = ` str="${decoded}"`;
        }
      } catch {}
      console.log(`${indent}${label} field=${field} wireType=LD len=${len}${strPreview}`);
      if (depth < 4) {
        try {
          dumpFields(`${label}.f${field}`, subData, depth + 1);
        } catch {
          // not a valid protobuf submessage
        }
      }
    } else {
      console.log(`${indent}${label} field=${field} wireType=${wireType}`);
      reader.skipType(wireType);
    }
  }
}

async function main() {
  // 1. Fetch broadcast page
  console.log(`Fetching broadcast page for ${liveId}...`);
  const url = `https://live.nicovideo.jp/watch/${liveId}`;
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  if (cookies) headers['Cookie'] = cookies;

  const pageResp = await fetch(url, { headers });
  const html = await pageResp.text();
  const match = html.match(/id="embedded-data"\s+data-props="([^"]+)"/);
  if (!match) { console.error('embedded-data not found'); process.exit(1); }

  const propsJson = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const props = JSON.parse(propsJson);
  const wsUrl = props.site?.relive?.webSocketUrl;
  console.log('WebSocket URL:', wsUrl ? 'found' : 'NOT FOUND');

  // 2. Connect WebSocket and get messageServerUri
  const WebSocket = (await import('ws')).default;
  const ws = new WebSocket(wsUrl);

  const messageServerUri = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS timeout')), 10000);
    ws.on('open', () => {
      console.log('WebSocket connected');
      ws.send(JSON.stringify({ type: 'startWatching', data: { stream: { quality: 'abr', protocol: 'hls+fmp4', latency: 'low', chasePlay: false }, room: { protocol: 'webSocket', commentable: true }, reconnect: false } }));
    });
    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      console.log('WS message type:', msg.type);
      if (msg.type === 'messageServer') {
        clearTimeout(timeout);
        resolve(msg.data.viewUri);
      }
    });
    ws.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
  });

  console.log('Message server URI:', messageServerUri);

  // 3. Fetch message stream (ChunkedEntry)
  const msgUrl = `${messageServerUri}?at=now`;
  console.log(`\nFetching message stream: ${msgUrl}`);
  const msgResp = await fetch(msgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!msgResp.ok || !msgResp.body) {
    console.error('Message stream failed:', msgResp.status);
    process.exit(1);
  }

  const msgReader = msgResp.body.getReader();
  let msgBuffer = new Uint8Array(0);
  let segmentUri: string | undefined;
  let entryCount = 0;

  console.log('\n=== ChunkedEntry messages ===');
  readLoop: while (true) {
    const { done, value } = await msgReader.read();
    if (done) break;

    const combined = new Uint8Array(msgBuffer.length + value.length);
    combined.set(msgBuffer, 0);
    combined.set(value, msgBuffer.length);
    const { messages, remaining } = extractMessages(combined);
    msgBuffer = new Uint8Array(remaining);

    for (const msg of messages) {
      entryCount++;
      console.log(`\n--- ChunkedEntry #${entryCount} (${msg.length} bytes) ---`);
      dumpFields('CE', msg);

      // Extract segment URI from field 1 or 3
      const entryReader = new Reader(msg);
      while (entryReader.pos < entryReader.len) {
        const tag = entryReader.uint32();
        const field = tag >>> 3;
        const wireType = tag & 7;
        if ((field === 1 || field === 3) && wireType === 2) {
          const len = entryReader.uint32();
          const sub = entryReader.buf.slice(entryReader.pos, entryReader.pos + len);
          entryReader.pos += len;
          // find uri (field 3 string) in MessageSegment
          const subReader = new Reader(sub);
          while (subReader.pos < subReader.len) {
            const stag = subReader.uint32();
            const sf = stag >>> 3;
            const swt = stag & 7;
            if (sf === 3 && swt === 2) {
              segmentUri = subReader.string();
              console.log(`  -> segment URI found: ${segmentUri.substring(0, 80)}...`);
              break readLoop;
            }
            subReader.skipType(swt);
          }
        } else {
          entryReader.skipType(wireType);
        }
      }

      if (entryCount >= 10) break readLoop;
    }
  }

  await msgReader.cancel();

  if (!segmentUri) {
    console.error('No segment URI found');
    // Keep WS alive a bit
    ws.close();
    process.exit(1);
  }

  // 4. Fetch segment stream (ChunkedMessage)
  console.log(`\n=== ChunkedMessage from segment ===`);
  console.log(`Fetching: ${segmentUri.substring(0, 80)}...`);
  const segResp = await fetch(segmentUri, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!segResp.ok || !segResp.body) {
    console.error('Segment fetch failed:', segResp.status);
    ws.close();
    process.exit(1);
  }

  const segReader = segResp.body.getReader();
  let segBuffer = new Uint8Array(0);
  let cmCount = 0;

  while (true) {
    const { done, value } = await segReader.read();
    if (done) break;

    const combined = new Uint8Array(segBuffer.length + value.length);
    combined.set(segBuffer, 0);
    combined.set(value, segBuffer.length);
    const { messages, remaining } = extractMessages(combined);
    segBuffer = new Uint8Array(remaining);

    for (const msg of messages) {
      cmCount++;
      console.log(`\n--- ChunkedMessage #${cmCount} (${msg.length} bytes) ---`);
      dumpFields('CM', msg);

      if (cmCount >= 30) {
        console.log('\n(30 messages dumped, stopping)');
        ws.close();
        process.exit(0);
      }
    }
  }

  console.log(`\n(segment ended, ${cmCount} messages total)`);
  ws.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
