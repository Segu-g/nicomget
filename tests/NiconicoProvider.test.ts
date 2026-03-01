import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NiconicoProvider } from '../src/providers/niconico/NiconicoProvider.js';
import type { NiconicoBroadcastMetadata } from '../src/providers/niconico/NiconicoProvider.js';
import type { Comment, ConnectionState } from '../src/interfaces/types.js';
import WebSocket, { WebSocketServer } from 'ws';
import http from 'http';
import {
  createSegmentEntry,
  createFullCommentMessage,
} from './helpers/protobufTestData.js';

describe('NiconicoProvider', () => {
  let httpServer: http.Server;
  let wss: WebSocketServer;
  let httpPort: number;
  let wsPort: number;

  beforeEach(async () => {
    // HTTPサーバー（放送ページ + セグメントサーバー模擬）
    httpServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/watch/')) {
        // 放送ページ模擬
        const wsUrl = `ws://localhost:${wsPort}`;
        const props = JSON.stringify({
          site: { relive: { webSocketUrl: wsUrl } },
        }).replace(/"/g, '&quot;');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<div id="embedded-data" data-props="${props}"></div>`);
      } else if (req.url?.startsWith('/segment/')) {
        // セグメントサーバー模擬
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        const data = createFullCommentMessage({
          no: 1,
          content: 'テストコメント',
          hashedUserId: 'a:testuser',
        });
        res.end(Buffer.from(data));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    httpPort = (httpServer.address() as { port: number }).port;

    // WebSocketサーバー（視聴WS模擬）
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on('listening', resolve));
    wsPort = (wss.address() as { port: number }).port;

    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'startWatching') {
          // messageServerを返す
          const segmentUri = `http://localhost:${httpPort}/segment/1`;
          const viewUri = `http://localhost:${httpPort}/view?v=1`;

          // まずmessageServerを送信（実際にはこのviewUriへのHTTP接続が必要だが
          // テストではセグメントURIを直接返す形で簡略化）
          ws.send(
            JSON.stringify({
              type: 'messageServer',
              data: { viewUri },
            }),
          );
        }
      });
    });
  });

  afterEach(() => {
    wss.close();
    httpServer.close();
  });

  it('状態遷移: disconnected → connecting → connected', async () => {
    const states: ConnectionState[] = [];

    // fetchWebSocketUrlをモックして直接WebSocket URLを返す
    const provider = new NiconicoProvider({ liveId: 'lv123' });
    provider.on('stateChange', (state) => states.push(state));

    // エラーハンドラを追加（messageServer接続の404を無視）
    provider.on('error', () => {});

    // fetchWebSocketUrlをオーバーライド
    (provider as any).fetchWebSocketUrl = async () =>
      ({ wsUrl: `ws://localhost:${wsPort}`, metadata: {} });

    await provider.connect();

    expect(states).toContain('connecting');
    expect(states).toContain('connected');

    provider.disconnect();
    expect(states).toContain('disconnected');
  });

  it('disconnectで全接続が切断される', async () => {
    const provider = new NiconicoProvider({ liveId: 'lv123' });
    provider.on('error', () => {});
    (provider as any).fetchWebSocketUrl = async () =>
      ({ wsUrl: `ws://localhost:${wsPort}`, metadata: {} });

    await provider.connect();
    provider.disconnect();

    // 再度disconnectしてもエラーにならない
    provider.disconnect();
  });

  it('WebSocket切断後に再接続を試みる', async () => {
    const states: ConnectionState[] = [];
    const provider = new NiconicoProvider({
      liveId: 'lv123',
      retryIntervalMs: 50,
    });
    provider.on('stateChange', (state) => states.push(state));
    provider.on('error', () => {});
    (provider as any).fetchWebSocketUrl = async () =>
      ({ wsUrl: `ws://localhost:${wsPort}`, metadata: {} });

    await provider.connect();
    expect(states).toContain('connected');

    // サーバー側からWebSocketを切断
    for (const client of wss.clients) {
      client.close();
    }

    // 再接続を待つ
    await new Promise<void>((resolve) => {
      const onState = (state: ConnectionState) => {
        if (state === 'connected' && states.filter((s) => s === 'connected').length >= 2) {
          provider.off('stateChange', onState);
          resolve();
        }
      };
      provider.on('stateChange', onState);
    });

    expect(states.filter((s) => s === 'connecting').length).toBeGreaterThanOrEqual(2);
    expect(states.filter((s) => s === 'connected').length).toBeGreaterThanOrEqual(2);

    provider.disconnect();
  });

  it('maxRetries超過でエラー発火', async () => {
    const provider = new NiconicoProvider({
      liveId: 'lv123',
      maxRetries: 2,
      retryIntervalMs: 50,
    });
    provider.on('error', () => {});

    let connectCount = 0;
    (provider as any).fetchWebSocketUrl = async () => {
      connectCount++;
      if (connectCount === 1) {
        return { wsUrl: `ws://localhost:${wsPort}`, metadata: {} };
      }
      throw new Error('Connection refused');
    };

    await provider.connect();

    // サーバー側からWebSocketを切断
    for (const client of wss.clients) {
      client.close();
    }

    // エラーイベントを待つ
    const error = await new Promise<Error>((resolve) => {
      provider.on('error', (err: Error) => {
        if (err.message.includes('Reconnection failed')) {
          resolve(err);
        }
      });
    });

    expect(error.message).toBe('Reconnection failed after 2 attempts');

    provider.disconnect();
  });

  it('disconnect()後は再接続しない', async () => {
    const states: ConnectionState[] = [];
    const provider = new NiconicoProvider({
      liveId: 'lv123',
      retryIntervalMs: 50,
    });
    provider.on('stateChange', (state) => states.push(state));
    provider.on('error', () => {});
    (provider as any).fetchWebSocketUrl = async () =>
      ({ wsUrl: `ws://localhost:${wsPort}`, metadata: {} });

    await provider.connect();
    provider.disconnect();

    // 再接続が起こらないことを確認するため少し待つ
    await new Promise((resolve) => setTimeout(resolve, 150));

    // disconnected以降にconnectingが来ていないことを確認
    const disconnectIdx = states.lastIndexOf('disconnected');
    const statesAfterDisconnect = states.slice(disconnectIdx + 1);
    expect(statesAfterDisconnect).not.toContain('connecting');
  });

  it('放送ページからWebSocket URLを取得できる', async () => {
    const provider = new NiconicoProvider({ liveId: 'lv123' });

    // fetchWebSocketUrlの内部を直接テスト
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/watch/')) {
        const wsUrl = `ws://localhost:${wsPort}`;
        const props = JSON.stringify({
          site: { relive: { webSocketUrl: wsUrl } },
        }).replace(/"/g, '&quot;');
        return new Response(
          `<div id="embedded-data" data-props="${props}"></div>`,
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    };

    try {
      const { wsUrl } = await (provider as any).fetchWebSocketUrl();
      expect(wsUrl).toBe(`ws://localhost:${wsPort}`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fetchWebSocketUrl が program/socialGroup フィールドをメタデータとして抽出する', async () => {
    const provider = new NiconicoProvider({ liveId: 'lv123' });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/watch/')) {
        const props = JSON.stringify({
          site: { relive: { webSocketUrl: `ws://localhost:${wsPort}` } },
          program: {
            title: 'テスト番組',
            status: 'ON_AIR',
            description: '番組の説明文',
            beginTime: 1700000000,
            endTime: 1700003600,
            screenshot: { urlSet: { large: 'https://example.com/thumb.jpg' } },
            tag: { list: [{ text: 'ゲーム' }, { text: 'テスト' }] },
            statistics: { watchCount: 100, commentCount: 50 },
            supplier: {
              name: '放送者名',
              programProviderId: '12345',
              supplierType: 'user',
              icons: { uri150x150: 'https://example.com/icon.jpg' },
            },
          },
          socialGroup: {
            id: 'co12345',
            name: 'テストコミュニティ',
            type: 'community',
          },
        }).replace(/"/g, '&quot;');
        return new Response(
          `<div id="embedded-data" data-props="${props}"></div>`,
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    };

    try {
      const { wsUrl, metadata } = await (provider as any).fetchWebSocketUrl();
      expect(wsUrl).toBe(`ws://localhost:${wsPort}`);
      expect(metadata.title).toBe('テスト番組');
      expect(metadata.status).toBe('ON_AIR');
      expect(metadata.description).toBe('番組の説明文');
      expect(metadata.beginTime).toEqual(new Date(1700000000 * 1000));
      expect(metadata.endTime).toEqual(new Date(1700003600 * 1000));
      expect(metadata.thumbnailUrl).toBe('https://example.com/thumb.jpg');
      expect(metadata.tags).toEqual(['ゲーム', 'テスト']);
      expect(metadata.watchCount).toBe(100);
      expect(metadata.commentCount).toBe(50);
      expect(metadata.broadcasterName).toBe('放送者名');
      expect(metadata.broadcasterUserId).toBe('12345');
      expect(metadata.broadcasterType).toBe('user');
      expect(metadata.broadcasterIconUrl).toBe('https://example.com/icon.jpg');
      expect(metadata.socialGroupId).toBe('co12345');
      expect(metadata.socialGroupName).toBe('テストコミュニティ');
      expect(metadata.socialGroupType).toBe('community');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('connect() が NiconicoBroadcastMetadata を返す', async () => {
    const provider = new NiconicoProvider({ liveId: 'lv123' });
    provider.on('error', () => {});
    (provider as any).fetchWebSocketUrl = async () => ({
      wsUrl: `ws://localhost:${wsPort}`,
      metadata: { title: 'テスト番組', status: 'ON_AIR', broadcasterName: '放送者名' },
    });

    const meta = await provider.connect();
    expect(meta.title).toBe('テスト番組');
    expect(meta.status).toBe('ON_AIR');
    expect(meta.broadcasterName).toBe('放送者名');

    provider.disconnect();
  });

  it('接続前は provider.metadata が null で、接続後に参照できる', async () => {
    const provider = new NiconicoProvider({ liveId: 'lv123' });
    provider.on('error', () => {});
    (provider as any).fetchWebSocketUrl = async () => ({
      wsUrl: `ws://localhost:${wsPort}`,
      metadata: { title: 'テスト番組', broadcasterName: '放送者名' },
    });

    expect(provider.metadata).toBeNull();

    await provider.connect();

    expect(provider.metadata?.title).toBe('テスト番組');
    expect(provider.metadata?.broadcasterName).toBe('放送者名');

    provider.disconnect();
  });

  it('metadata イベントが接続時に発火する', async () => {
    const provider = new NiconicoProvider({ liveId: 'lv123' });
    provider.on('error', () => {});
    (provider as any).fetchWebSocketUrl = async () => ({
      wsUrl: `ws://localhost:${wsPort}`,
      metadata: { title: 'テスト番組', status: 'ON_AIR' },
    });

    const metaEvents: NiconicoBroadcastMetadata[] = [];
    provider.on('metadata', (m) => metaEvents.push(m));

    await provider.connect();

    expect(metaEvents).toHaveLength(1);
    expect(metaEvents[0].title).toBe('テスト番組');
    expect(metaEvents[0].status).toBe('ON_AIR');

    provider.disconnect();
  });
});
