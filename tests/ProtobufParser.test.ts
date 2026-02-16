import { describe, it, expect } from 'vitest';
import {
  readLengthDelimitedMessage,
  extractMessages,
  parseChunkedEntry,
  parseChunkedMessage,
} from '../src/providers/niconico/ProtobufParser.js';
import {
  encodeLengthDelimited,
  createChatMessage,
  createNicoliveMessage,
  createOverflowNicoliveMessage,
  createChunkedMessage,
  createMessageSegment,
  createChunkedEntry,
  createReadyForNext,
  createChunkedEntryWithNext,
  createFullCommentMessage,
  createSegmentEntry,
  createNextEntry,
  createGiftMessage,
  createGiftNicoliveMessage,
  createSimpleNotification,
  createSimpleNotificationNicoliveMessage,
  createSimpleNotificationV2,
  createSimpleNotificationV2NicoliveMessage,
  createOperatorCommentState,
  createSignalMessage,
} from './helpers/protobufTestData.js';

describe('readLengthDelimitedMessage', () => {
  it('空バッファからはnullを返す', () => {
    expect(readLengthDelimitedMessage(new Uint8Array(0))).toBeNull();
  });

  it('単一メッセージを読み取れる', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const encoded = encodeLengthDelimited(data);

    const result = readLengthDelimitedMessage(encoded);
    expect(result).not.toBeNull();
    expect(result!.message).toEqual(data);
    expect(result!.bytesRead).toBe(encoded.length);
  });

  it('データ不足の場合nullを返す', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03]);
    const encoded = encodeLengthDelimited(data);
    const incomplete = encoded.slice(0, encoded.length - 1);
    expect(readLengthDelimitedMessage(incomplete)).toBeNull();
  });

  it('長いvarintヘッダーを正しく処理する', () => {
    const data = new Uint8Array(200).fill(0x42);
    const encoded = encodeLengthDelimited(data);
    const result = readLengthDelimitedMessage(encoded);
    expect(result).not.toBeNull();
    expect(result!.message.length).toBe(200);
  });
});

describe('extractMessages', () => {
  it('複数メッセージを抽出できる', () => {
    const msg1 = new Uint8Array([0x01, 0x02]);
    const msg2 = new Uint8Array([0x03, 0x04, 0x05]);

    const buf = new Uint8Array([
      ...encodeLengthDelimited(msg1),
      ...encodeLengthDelimited(msg2),
    ]);

    const { messages, remaining } = extractMessages(buf);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(msg1);
    expect(messages[1]).toEqual(msg2);
    expect(remaining.length).toBe(0);
  });

  it('不完全なメッセージは残りバッファとして返す', () => {
    const msg1 = new Uint8Array([0x01, 0x02]);
    const msg2 = new Uint8Array([0x03, 0x04, 0x05]);
    const encoded2 = encodeLengthDelimited(msg2);

    const buf = new Uint8Array([
      ...encodeLengthDelimited(msg1),
      ...encoded2.slice(0, 2),
    ]);

    const { messages, remaining } = extractMessages(buf);
    expect(messages).toHaveLength(1);
    expect(remaining.length).toBe(2);
  });

  it('1バイトずつ供給しても正しく動作する', () => {
    const data = createFullCommentMessage({ no: 1, content: 'test' });

    let buffer = new Uint8Array(0);
    let allMessages: Uint8Array[] = [];

    for (let i = 0; i < data.length; i++) {
      const combined = new Uint8Array(buffer.length + 1);
      combined.set(buffer, 0);
      combined[buffer.length] = data[i];

      const { messages, remaining } = extractMessages(combined);
      allMessages = allMessages.concat(messages);
      buffer = remaining;
    }

    expect(allMessages).toHaveLength(1);
  });
});

describe('parseChunkedEntry', () => {
  it('Segmentエントリからsegment URIを抽出できる', () => {
    const segment = createMessageSegment('https://example.com/segment/1');
    const entry = createChunkedEntry(segment);

    const result = parseChunkedEntry(entry);
    expect(result.segmentUri).toBe('https://example.com/segment/1');
  });

  it('NextエントリからnextAtを抽出できる', () => {
    const next = createReadyForNext(1700000000);
    const entry = createChunkedEntryWithNext(next);

    const result = parseChunkedEntry(entry);
    expect(result.nextAt).toBe('1700000000');
  });

  it('不明なフィールドをスキップできる', async () => {
    const protobuf = await import('protobufjs/minimal.js');
    const Writer = protobuf.default.Writer;
    const writer = new Writer();
    // field 2 (backward) - ダミーデータ
    writer.uint32((2 << 3) | 2);
    writer.bytes(new Uint8Array([0x01, 0x02]));
    // field 1 (segment) with URI
    const segment = createMessageSegment('https://example.com/seg');
    writer.uint32((1 << 3) | 2);
    writer.bytes(segment);
    const entry = writer.finish();

    const result = parseChunkedEntry(entry);
    expect(result.segmentUri).toBe('https://example.com/seg');
  });
});

describe('parseChunkedMessage', () => {
  it('コメントメッセージからChatを抽出できる', () => {
    const chat = createChatMessage({
      no: 42,
      vpos: 100,
      content: 'こんにちは',
      hashedUserId: 'a:user123',
    });
    const msg = createNicoliveMessage(chat);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].no).toBe(42);
    expect(result.chats[0].vpos).toBe(100);
    expect(result.chats[0].content).toBe('こんにちは');
    expect(result.chats[0].hashedUserId).toBe('a:user123');
  });

  it('空のChunkedMessageからは空の配列を返す', () => {
    const result = parseChunkedMessage(new Uint8Array(0));
    expect(result.chats).toHaveLength(0);
    expect(result.gifts).toHaveLength(0);
    expect(result.emotions).toHaveLength(0);
  });

  it('日本語を含むコメントを正しくパースできる', () => {
    const chat = createChatMessage({
      content: '日本語テスト🎉',
      hashedUserId: 'a:テストユーザー',
    });
    const msg = createNicoliveMessage(chat);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.chats[0].content).toBe('日本語テスト🎉');
    expect(result.chats[0].hashedUserId).toBe('a:テストユーザー');
  });

  it('contentのみのChatもパースできる', () => {
    const chat = createChatMessage({ content: 'hello' });
    const msg = createNicoliveMessage(chat);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.chats[0].content).toBe('hello');
    expect(result.chats[0].no).toBe(0);
    expect(result.chats[0].hashedUserId).toBeUndefined();
  });

  it('複数のメッセージを連結してもパースできる', () => {
    const chat1 = createChatMessage({ no: 1, content: 'msg1' });
    const chat2 = createChatMessage({ no: 2, content: 'msg2' });

    const cm1 = encodeLengthDelimited(createChunkedMessage(createNicoliveMessage(chat1)));
    const cm2 = encodeLengthDelimited(createChunkedMessage(createNicoliveMessage(chat2)));

    const buf = new Uint8Array([...cm1, ...cm2]);
    const { messages } = extractMessages(buf);

    expect(messages).toHaveLength(2);
    const r1 = parseChunkedMessage(messages[0]);
    const r2 = parseChunkedMessage(messages[1]);
    expect(r1.chats[0].content).toBe('msg1');
    expect(r2.chats[0].content).toBe('msg2');
  });

  it('あふれコメント (field 20) をChatとしてパースできる', () => {
    const chat = createChatMessage({
      no: 99,
      content: 'overflow comment',
      hashedUserId: 'a:overflow',
    });
    const msg = createOverflowNicoliveMessage(chat);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].no).toBe(99);
    expect(result.chats[0].content).toBe('overflow comment');
  });
});

describe('parseChunkedMessage - Gift', () => {
  it('Giftメッセージをパースできる', () => {
    const gift = createGiftMessage({
      itemId: 'gift-001',
      advertiserUserId: 12345,
      advertiserName: 'テスト太郎',
      point: 500,
      message: 'がんばれ！',
      itemName: 'スーパーギフト',
      contributionRank: 3,
    });
    const msg = createGiftNicoliveMessage(gift);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.gifts).toHaveLength(1);
    expect(result.gifts[0].itemId).toBe('gift-001');
    expect(result.gifts[0].advertiserUserId).toBe(12345);
    expect(result.gifts[0].advertiserName).toBe('テスト太郎');
    expect(result.gifts[0].point).toBe(500);
    expect(result.gifts[0].message).toBe('がんばれ！');
    expect(result.gifts[0].itemName).toBe('スーパーギフト');
    expect(result.gifts[0].contributionRank).toBe(3);
  });

  it('最小限のGiftメッセージをパースできる', () => {
    const gift = createGiftMessage({
      itemId: 'gift-min',
      advertiserName: 'user',
      point: 100,
      message: '',
      itemName: 'basic',
    });
    const msg = createGiftNicoliveMessage(gift);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.gifts).toHaveLength(1);
    expect(result.gifts[0].itemId).toBe('gift-min');
    expect(result.gifts[0].advertiserUserId).toBeUndefined();
    expect(result.gifts[0].contributionRank).toBeUndefined();
  });
});

describe('parseChunkedMessage - SimpleNotification (emotion)', () => {
  it('エモーションメッセージをパースできる', () => {
    const notification = createSimpleNotification('🎉');
    const msg = createSimpleNotificationNicoliveMessage(notification);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.emotions).toHaveLength(1);
    expect(result.emotions[0].content).toBe('🎉');
  });

  it('日本語エモーションをパースできる', () => {
    const notification = createSimpleNotification('わこつ');
    const msg = createSimpleNotificationNicoliveMessage(notification);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.emotions).toHaveLength(1);
    expect(result.emotions[0].content).toBe('わこつ');
  });
});

describe('parseChunkedMessage - SimpleNotificationV2 (field 23)', () => {
  it('type=EMOTION(2) のメッセージを emotions に返す', () => {
    const notif = createSimpleNotificationV2(2, '調子どう？');
    const msg = createSimpleNotificationV2NicoliveMessage(notif);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.emotions).toHaveLength(1);
    expect(result.emotions[0].content).toBe('調子どう？');
    expect(result.notifications).toHaveLength(0);
  });

  it('type=EMOTION(2) の絵文字エモーションをパースできる', () => {
    const notif = createSimpleNotificationV2(2, '🎉');
    const msg = createSimpleNotificationV2NicoliveMessage(notif);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.emotions).toHaveLength(1);
    expect(result.emotions[0].content).toBe('🎉');
  });

  it('type=PROGRAM_EXTENDED(4) のメッセージを notifications に返す', () => {
    const notif = createSimpleNotificationV2(4, '延長されました');
    const msg = createSimpleNotificationV2NicoliveMessage(notif);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].type).toBe('program_extended');
    expect(result.notifications[0].message).toBe('延長されました');
    expect(result.emotions).toHaveLength(0);
  });

  it('type=RANKING_IN(5) のメッセージを notifications に返す', () => {
    const notif = createSimpleNotificationV2(5, 'ランクインしました');
    const msg = createSimpleNotificationV2NicoliveMessage(notif);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].type).toBe('ranking_in');
    expect(result.notifications[0].message).toBe('ランクインしました');
  });

  it('type=UNKNOWN(0) のメッセージを notifications に返す', () => {
    const notif = createSimpleNotificationV2(0, '不明な通知');
    const msg = createSimpleNotificationV2NicoliveMessage(notif);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].type).toBe('unknown');
    expect(result.notifications[0].message).toBe('不明な通知');
    expect(result.emotions).toHaveLength(0);
  });

  it('全NotificationTypeを正しくマッピングする', () => {
    const typeMap: [number, string][] = [
      [0, 'unknown'],
      [1, 'ichiba'],
      [3, 'cruise'],
      [4, 'program_extended'],
      [5, 'ranking_in'],
      [6, 'visited'],
      [7, 'supporter_registered'],
      [8, 'user_level_up'],
      [9, 'user_follow'],
    ];

    for (const [typeNum, typeName] of typeMap) {
      const notif = createSimpleNotificationV2(typeNum, `test-${typeName}`);
      const msg = createSimpleNotificationV2NicoliveMessage(notif);
      const chunked = createChunkedMessage(msg);

      const result = parseChunkedMessage(chunked);
      expect(result.notifications).toHaveLength(1);
      expect(result.notifications[0].type).toBe(typeName);
    }
  });
});

describe('parseChunkedMessage - OperatorComment', () => {
  it('放送者コメントをパースできる', () => {
    const state = createOperatorCommentState({
      content: '放送者からのお知らせ',
      name: '放送者',
    });

    const result = parseChunkedMessage(state);
    expect(result.operatorComment).toBeDefined();
    expect(result.operatorComment!.content).toBe('放送者からのお知らせ');
    expect(result.operatorComment!.name).toBe('放送者');
  });

  it('リンク付き放送者コメントをパースできる', () => {
    const state = createOperatorCommentState({
      content: 'リンクはこちら',
      link: 'https://example.com',
    });

    const result = parseChunkedMessage(state);
    expect(result.operatorComment).toBeDefined();
    expect(result.operatorComment!.content).toBe('リンクはこちら');
    expect(result.operatorComment!.link).toBe('https://example.com');
  });

  it('contentのみの放送者コメントをパースできる', () => {
    const state = createOperatorCommentState({
      content: 'シンプルなお知らせ',
    });

    const result = parseChunkedMessage(state);
    expect(result.operatorComment).toBeDefined();
    expect(result.operatorComment!.content).toBe('シンプルなお知らせ');
    expect(result.operatorComment!.name).toBeUndefined();
    expect(result.operatorComment!.link).toBeUndefined();
  });
});

describe('parseChunkedMessage - Signal', () => {
  it('Flushedシグナルをパースできる', () => {
    const signal = createSignalMessage(0);

    const result = parseChunkedMessage(signal);
    expect(result.signal).toBe('flushed');
  });

  it('シグナルなしのメッセージではsignalがundefined', () => {
    const chat = createChatMessage({ content: 'hello' });
    const msg = createNicoliveMessage(chat);
    const chunked = createChunkedMessage(msg);

    const result = parseChunkedMessage(chunked);
    expect(result.signal).toBeUndefined();
  });
});
