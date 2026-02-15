import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from '../src/providers/niconico/WebSocketClient.js';
import WebSocket, { WebSocketServer } from 'ws';

describe('WebSocketClient', () => {
  let wss: WebSocketServer;
  let port: number;
  let serverMessages: string[];
  let serverWs: WebSocket | null;

  beforeEach(async () => {
    serverMessages = [];
    serverWs = null;

    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on('listening', resolve));
    port = (wss.address() as { port: number }).port;

    wss.on('connection', (ws) => {
      serverWs = ws;
      ws.on('message', (data) => {
        serverMessages.push(data.toString());
      });
    });
  });

  afterEach(() => {
    wss.close();
  });

  it('接続時にstartWatchingを送信する', async () => {
    const client = new WebSocketClient(`ws://localhost:${port}`);
    await client.connect();

    // サーバーがメッセージを受信するまで待つ
    await new Promise((r) => setTimeout(r, 50));

    expect(serverMessages).toHaveLength(1);
    const msg = JSON.parse(serverMessages[0]);
    expect(msg.type).toBe('startWatching');
    expect(msg.data.stream.quality).toBe('abr');

    client.disconnect();
  });

  it('pingに対してpongを返す', async () => {
    const client = new WebSocketClient(`ws://localhost:${port}`);
    await client.connect();

    // サーバーからping送信
    serverWs!.send(JSON.stringify({ type: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));

    // startWatching + pong
    expect(serverMessages).toHaveLength(2);
    const pong = JSON.parse(serverMessages[1]);
    expect(pong.type).toBe('pong');

    client.disconnect();
  });

  it('messageServerイベントでviewUriを通知する', async () => {
    const client = new WebSocketClient(`ws://localhost:${port}`);
    const viewUriPromise = new Promise<string>((resolve) => {
      client.on('messageServer', resolve);
    });

    await client.connect();

    serverWs!.send(
      JSON.stringify({
        type: 'messageServer',
        data: { viewUri: 'https://example.com/view' },
      }),
    );

    const viewUri = await viewUriPromise;
    expect(viewUri).toBe('https://example.com/view');

    client.disconnect();
  });

  it('seatイベントでkeepSeatを定期送信する', async () => {
    vi.useFakeTimers();

    const client = new WebSocketClient(`ws://localhost:${port}`);
    await client.connect();
    await vi.advanceTimersByTimeAsync(50);

    // seat with 1 second interval
    serverWs!.send(
      JSON.stringify({ type: 'seat', data: { keepIntervalSec: 1 } }),
    );
    await vi.advanceTimersByTimeAsync(50);

    // Clear initial messages
    serverMessages.length = 0;

    // Advance 1 second
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(50);

    const keepSeatMessages = serverMessages.filter((m) => {
      const parsed = JSON.parse(m);
      return parsed.type === 'keepSeat';
    });
    expect(keepSeatMessages.length).toBeGreaterThanOrEqual(1);

    client.disconnect();
    vi.useRealTimers();
  });

  it('disconnectで接続を閉じる', async () => {
    const client = new WebSocketClient(`ws://localhost:${port}`);
    const closePromise = new Promise<void>((resolve) => {
      client.on('close', resolve);
    });

    await client.connect();
    client.disconnect();

    await closePromise;
  });

  it('disconnectイベントを転送する', async () => {
    const client = new WebSocketClient(`ws://localhost:${port}`);
    const reasonPromise = new Promise<string>((resolve) => {
      client.on('disconnect', resolve);
    });

    await client.connect();

    serverWs!.send(
      JSON.stringify({ type: 'disconnect', data: { reason: 'END_PROGRAM' } }),
    );

    const reason = await reasonPromise;
    expect(reason).toBe('END_PROGRAM');

    client.disconnect();
  });
});
