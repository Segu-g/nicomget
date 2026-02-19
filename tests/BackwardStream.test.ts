import { describe, it, expect, vi, afterEach } from 'vitest';
import { BackwardStream } from '../src/providers/niconico/BackwardStream.js';
import type {
  NicoChat,
  NicoGift,
  NicoEmotion,
  NicoNotification,
  NicoOperatorComment,
} from '../src/providers/niconico/ProtobufParser.js';
import {
  createChatMessage,
  createNicoliveMessage,
  createChunkedMessage,
  createGiftMessage,
  createGiftNicoliveMessage,
  createSimpleNotificationV2,
  createSimpleNotificationV2NicoliveMessage,
  createOperatorCommentState,
  createPackedSegment,
} from './helpers/protobufTestData.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(responses: Map<string, Uint8Array>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const data = responses.get(url);
    if (!data) {
      return new Response(null, { status: 404 });
    }
    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  });
}

describe('BackwardStream', () => {
  it('PackedSegmentからchatイベントを発火する', async () => {
    const chat = createChatMessage({ no: 10, content: '過去コメント' });
    const chunkedMsg = createChunkedMessage(createNicoliveMessage(chat));
    const packed = createPackedSegment({ messages: [chunkedMsg] });

    mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const chats: NicoChat[] = [];
    stream.on('chat', (c: NicoChat) => chats.push(c));

    await stream.start();

    expect(chats).toHaveLength(1);
    expect(chats[0].no).toBe(10);
    expect(chats[0].content).toBe('過去コメント');
  });

  it('nextUriチェーンを辿り時系列順（古→新）で発火する', async () => {
    // packed/1 = 新しいセグメント, packed/2 = 古いセグメント (nextで辿った先)
    const chatNew = createChatMessage({ no: 10, content: 'newer' });
    const chatOld = createChatMessage({ no: 1, content: 'older' });
    const packed1 = createPackedSegment({
      messages: [createChunkedMessage(createNicoliveMessage(chatNew))],
      nextUri: 'https://example.com/packed/2',
    });
    const packed2 = createPackedSegment({
      messages: [createChunkedMessage(createNicoliveMessage(chatOld))],
    });

    mockFetch(new Map([
      ['https://example.com/packed/1', packed1],
      ['https://example.com/packed/2', packed2],
    ]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const chats: NicoChat[] = [];
    stream.on('chat', (c: NicoChat) => chats.push(c));

    await stream.start();

    // 古い方 (packed/2) が先に発火される
    expect(chats).toHaveLength(2);
    expect(chats[0].content).toBe('older');
    expect(chats[0].no).toBe(1);
    expect(chats[1].content).toBe('newer');
    expect(chats[1].no).toBe(10);
  });

  it('giftイベントを発火する', async () => {
    const gift = createGiftMessage({
      itemId: 'g1',
      advertiserName: 'user',
      point: 100,
      message: 'hi',
      itemName: 'item',
    });
    const packed = createPackedSegment({
      messages: [createChunkedMessage(createGiftNicoliveMessage(gift))],
    });

    mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const gifts: NicoGift[] = [];
    stream.on('gift', (g: NicoGift) => gifts.push(g));

    await stream.start();

    expect(gifts).toHaveLength(1);
    expect(gifts[0].itemId).toBe('g1');
  });

  it('emotionイベントを発火する', async () => {
    const notif = createSimpleNotificationV2(2, '🎉');
    const packed = createPackedSegment({
      messages: [createChunkedMessage(createSimpleNotificationV2NicoliveMessage(notif))],
    });

    mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const emotions: NicoEmotion[] = [];
    stream.on('emotion', (e: NicoEmotion) => emotions.push(e));

    await stream.start();

    expect(emotions).toHaveLength(1);
    expect(emotions[0].content).toBe('🎉');
  });

  it('notificationイベントを発火する', async () => {
    const notif = createSimpleNotificationV2(4, '延長されました');
    const packed = createPackedSegment({
      messages: [createChunkedMessage(createSimpleNotificationV2NicoliveMessage(notif))],
    });

    mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const notifications: NicoNotification[] = [];
    stream.on('notification', (n: NicoNotification) => notifications.push(n));

    await stream.start();

    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('program_extended');
  });

  it('operatorCommentイベントを発火する', async () => {
    const opState = createOperatorCommentState({ content: '放送者コメント', name: '放送者' });
    const packed = createPackedSegment({ messages: [opState] });

    mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const comments: NicoOperatorComment[] = [];
    stream.on('operatorComment', (c: NicoOperatorComment) => comments.push(c));

    await stream.start();

    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('放送者コメント');
  });

  it('HTTPエラーでerrorイベントを発火する', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(null, { status: 500 });
    });

    const stream = new BackwardStream('https://example.com/packed/1');
    const errors: Error[] = [];
    stream.on('error', (e: Error) => errors.push(e));

    await stream.start();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('500');
  });

  it('stop()でイベント発火を中断できる', async () => {
    // 2セグメント: packed/2(古) → packed/1(新) の順で emit される
    const chatOld = createChatMessage({ no: 1, content: 'old' });
    const chatNew = createChatMessage({ no: 10, content: 'new' });
    const packed1 = createPackedSegment({
      messages: [createChunkedMessage(createNicoliveMessage(chatNew))],
      nextUri: 'https://example.com/packed/2',
    });
    const packed2 = createPackedSegment({
      messages: [createChunkedMessage(createNicoliveMessage(chatOld))],
    });

    mockFetch(new Map([
      ['https://example.com/packed/1', packed1],
      ['https://example.com/packed/2', packed2],
    ]));

    const stream = new BackwardStream('https://example.com/packed/1');
    const chats: NicoChat[] = [];
    let stopCalled = false;
    stream.on('chat', (c: NicoChat) => {
      chats.push(c);
      if (!stopCalled) {
        stopCalled = true;
        stream.stop(); // 最初の chat で stop
      }
    });

    await stream.start();

    // stop後は新しいセグメントの chat が発火されない
    expect(chats).toHaveLength(1);
    expect(chats[0].content).toBe('old');
  });

  it('endイベントを発火する', async () => {
    const packed = createPackedSegment({ messages: [] });
    mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1');
    let ended = false;
    stream.on('end', () => { ended = true; });

    await stream.start();

    expect(ended).toBe(true);
  });

  it('cookiesをリクエストヘッダーに含める', async () => {
    const packed = createPackedSegment({ messages: [] });
    const fetchSpy = mockFetch(new Map([['https://example.com/packed/1', packed]]));

    const stream = new BackwardStream('https://example.com/packed/1', 'session_id=abc123');
    await stream.start();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/packed/1',
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session_id=abc123' }),
      }),
    );
  });
});
