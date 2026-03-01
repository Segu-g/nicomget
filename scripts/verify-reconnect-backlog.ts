/**
 * disconnect → connect 再接続後もバックログが正しく取得されるか検証
 *
 * シナリオ:
 * 1. connect() → バックログ取得（operatorComment 1件）
 * 2. disconnect()
 * 3. connect() → バックログが再取得されるか？（operatorComment 1件）
 *
 * 期待: 各接続で1件ずつ、計2件 emit される。
 */

import { NiconicoProvider } from '../src/providers/niconico/NiconicoProvider.js';
import {
  createOperatorCommentState,
  createPackedSegment,
} from '../tests/helpers/protobufTestData.js';
import { WebSocketServer } from 'ws';

// --- モック用 PackedSegment ---
const opState = createOperatorCommentState({ content: 'いらっしゃーい', name: '放送者' });
const packed = createPackedSegment({ messages: [opState] });

// --- WebSocket サーバーを起動してメッセージサーバー URL を返す ---
async function startWss(): Promise<{ wss: WebSocketServer; wsPort: number }> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.on('listening', resolve));
  const wsPort = (wss.address() as { port: number }).port;
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'startWatching') {
        ws.send(JSON.stringify({
          type: 'messageServer',
          data: { viewUri: 'http://localhost:1/view' },
        }));
      }
    });
  });
  return { wss, wsPort };
}

async function run() {
  const { wss, wsPort } = await startWss();

  // fetch をモック: backward URI → packed segment を返す
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === 'https://example.com/packed/1') {
      return new Response(packed, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    return new Response('Not Found', { status: 404 });
  };

  const provider = new NiconicoProvider({
    liveId: 'lv123',
    backlogEvents: ['operatorComment'],
  });
  provider.on('error', () => {});
  (provider as any).fetchWebSocketUrl = async () => ({
    wsUrl: `ws://localhost:${wsPort}`,
    metadata: {},
  });

  const emittedAll: string[] = [];
  provider.on('operatorComment', (op: any) => {
    emittedAll.push(`[session=${emittedAll.length < 10 ? 'A' : 'B'}] ${op.content}`);
  });

  // --- 1回目の接続 ---
  console.log('=== 1回目接続 ===');
  await provider.connect();
  console.log(`  backlogFetched after connect: ${(provider as any).backlogFetched}`);

  (provider as any).startBackwardStream('https://example.com/packed/1');
  const bs1 = (provider as any).backwardStream;
  if (bs1) {
    await new Promise<void>((resolve) => bs1.once('end', resolve));
  }
  const countAfterFirst = emittedAll.length;
  console.log(`  emit 数（1回目）: ${countAfterFirst} 件`);

  // 2回目の backward URI（同じセッション内、スキップされるべき）
  (provider as any).startBackwardStream('https://example.com/packed/1');
  await new Promise((resolve) => setTimeout(resolve, 20));
  console.log(`  emit 数（2回目 backward、スキップ期待）: ${emittedAll.length} 件`);

  // --- disconnect ---
  console.log('\n=== disconnect ===');
  provider.disconnect();
  console.log(`  backlogFetched after disconnect: ${(provider as any).backlogFetched}`);

  // --- 2回目の接続 ---
  console.log('\n=== 2回目接続 ===');
  const emittedSecond: string[] = [];
  provider.on('operatorComment', (op: any) => {
    emittedSecond.push(op.content);
  });

  await provider.connect();
  console.log(`  backlogFetched after 2nd connect: ${(provider as any).backlogFetched}`);

  (provider as any).startBackwardStream('https://example.com/packed/1');
  const bs2 = (provider as any).backwardStream;
  if (bs2) {
    await new Promise<void>((resolve) => bs2.once('end', resolve));
  }
  console.log(`  emit 数（2回目接続のバックログ）: ${emittedSecond.length} 件`);

  // 2回目接続後の重複チェック
  (provider as any).startBackwardStream('https://example.com/packed/1');
  await new Promise((resolve) => setTimeout(resolve, 20));
  console.log(`  emit 数（3回目 backward、スキップ期待）: ${emittedSecond.length} 件`);

  provider.disconnect();
  wss.close();
  globalThis.fetch = originalFetch;

  // --- 結果 ---
  console.log('\n=== 結果 ===');
  console.log(`1回目接続のバックログ: ${countAfterFirst} 件 ${countAfterFirst === 1 ? '✓' : '✗'}`);
  console.log(`2回目接続のバックログ: ${emittedSecond.length} 件 ${emittedSecond.length === 1 ? '✓' : '✗'}`);

  if (countAfterFirst === 1 && emittedSecond.length === 1) {
    console.log('\n✓ disconnect → reconnect 後もバックログが正しく取得される');
  } else {
    console.log('\n✗ 問題あり');
  }
}

run().catch(console.error);
