/**
 * デバッグスクリプト: ChunkedMessage の全フィールドをダンプ（emotion調査用）
 */

import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

import { NiconicoProvider } from '../../src/providers/niconico/NiconicoProvider.js';
import { SegmentStream } from '../../src/providers/niconico/SegmentStream.js';
import { extractMessages, parseChunkedMessage } from '../../src/providers/niconico/ProtobufParser.js';

const liveId = process.argv[2] ?? 'lv349897488';
const cookies = process.argv[3];

function dumpFields(data: Uint8Array, depth = 0): void {
  const indent = '  '.repeat(depth);
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (wireType === 0) {
      const val = reader.int64();
      const num = typeof val === 'number' ? val : Number(val);
      console.log(`${indent}f${field}=varint(${num})`);
    } else if (wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      let strPreview = '';
      try {
        const decoded = new TextDecoder().decode(subData);
        if (len < 200 && len > 0) strPreview = ` "${decoded.substring(0, 100)}"`;
      } catch {}
      console.log(`${indent}f${field}=LD(${len})${strPreview}`);
      if (depth < 5) {
        try { dumpFields(subData, depth + 1); } catch {}
      }
    } else {
      console.log(`${indent}f${field}=wt${wireType}`);
      reader.skipType(wireType);
    }
  }
}

// SegmentStream.handleData をパッチ
const origHandle = SegmentStream.prototype.handleData;
SegmentStream.prototype.handleData = function (chunk: Uint8Array) {
  const combined = new Uint8Array((this as any).buffer.length + chunk.length);
  combined.set((this as any).buffer, 0);
  combined.set(chunk, (this as any).buffer.length);

  const { messages } = extractMessages(combined);

  for (const msg of messages) {
    // field 2 (NicoliveMessage) の中身を確認
    const reader = new Reader(msg);
    while (reader.pos < reader.len) {
      const tag = reader.uint32();
      const field = tag >>> 3;
      const wireType = tag & 7;

      if (field === 2 && wireType === 2) {
        const len = reader.uint32();
        const nicoliveMsg = reader.buf.slice(reader.pos, reader.pos + len);
        reader.pos += len;

        // NicoliveMessage の oneof field を確認
        const nmReader = new Reader(nicoliveMsg);
        while (nmReader.pos < nmReader.len) {
          const nmTag = nmReader.uint32();
          const nmField = nmTag >>> 3;
          const nmWt = nmTag & 7;

          if (nmField !== 1) {
            // field 1 (chat) 以外をダンプ
            console.log(`\n[RAW] NicoliveMessage field=${nmField} wireType=${nmWt}`);
            if (nmWt === 2) {
              const nmLen = nmReader.uint32();
              const nmSub = nmReader.buf.slice(nmReader.pos, nmReader.pos + nmLen);
              nmReader.pos += nmLen;
              dumpFields(nmSub, 1);
            } else if (nmWt === 0) {
              const val = nmReader.int64();
              console.log(`  value=${typeof val === 'number' ? val : Number(val)}`);
            } else {
              nmReader.skipType(nmWt);
            }
          } else {
            nmReader.skipType(nmWt);
          }
        }
      } else if (field === 5 && wireType === 0) {
        // signal - skip
        reader.int32();
      } else if (field === 4 && wireType === 2) {
        const len = reader.uint32();
        const stateData = reader.buf.slice(reader.pos, reader.pos + len);
        reader.pos += len;
        console.log(`\n[RAW] ChunkedMessage.state (field 4):`);
        dumpFields(stateData, 1);
      } else {
        reader.skipType(wireType);
      }
    }
  }

  return origHandle.call(this, chunk);
};

const provider = new NiconicoProvider({ liveId, cookies });

provider.on('comment', (c) => console.log(`[CHAT] #${c.id}: ${c.content}`));
provider.on('gift', (g) => console.log(`[GIFT] ${g.userName} → ${g.itemName} (${g.point}pt)`));
provider.on('emotion', (e) => console.log(`[EMOTION] ${e.id}`));
provider.on('operatorComment', (o) => console.log(`[OPERATOR] ${o.content}`));
provider.on('end', () => console.log('[END]'));
provider.on('stateChange', (s) => console.log(`[STATE] ${s}`));
provider.on('error', (e) => console.log(`[ERROR] ${e.message}`));

console.log(`Monitoring ${liveId}... (Ctrl+C to stop)`);
provider.connect().catch((err) => {
  console.error(`Failed: ${(err as Error).message}`);
  process.exit(1);
});

setTimeout(() => {
  provider.disconnect();
  process.exit(0);
}, 180000); // 3分
