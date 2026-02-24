import { describe, it, expect } from 'vitest';
import { SegmentStream } from '../src/providers/niconico/SegmentStream.js';
import type {
  NicoChat,
  NicoGift,
  NicoEmotion,
  NicoNotification,
  NicoOperatorComment,
} from '../src/providers/niconico/ProtobufParser.js';
import {
  createFullCommentMessage,
  createFullGiftMessage,
  createFullEmotionMessage,
  createFullNotificationMessage,
  createFullOperatorCommentMessage,
  createFullSignalMessage,
} from './helpers/protobufTestData.js';

describe('SegmentStream', () => {
  it('ChunkedMessageからchatイベントを発火する', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const chats: NicoChat[] = [];
    stream.on('chat', (chat: NicoChat) => chats.push(chat));

    const data = createFullCommentMessage({
      no: 1,
      content: 'テスト',
      hashedUserId: 'a:user1',
    });
    stream.handleData(data);

    expect(chats).toHaveLength(1);
    expect(chats[0].no).toBe(1);
    expect(chats[0].content).toBe('テスト');
    expect(chats[0].hashedUserId).toBe('a:user1');
  });

  it('複数コメントを受信できる', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const chats: NicoChat[] = [];
    stream.on('chat', (chat: NicoChat) => chats.push(chat));

    const data1 = createFullCommentMessage({ no: 1, content: 'msg1' });
    const data2 = createFullCommentMessage({ no: 2, content: 'msg2' });

    const combined = new Uint8Array(data1.length + data2.length);
    combined.set(data1, 0);
    combined.set(data2, data1.length);

    stream.handleData(combined);

    expect(chats).toHaveLength(2);
    expect(chats[0].content).toBe('msg1');
    expect(chats[1].content).toBe('msg2');
  });

  it('分割されたデータをバッファリングする', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const chats: NicoChat[] = [];
    stream.on('chat', (chat: NicoChat) => chats.push(chat));

    const data = createFullCommentMessage({ no: 1, content: 'buffered' });

    // 1バイトずつ送信
    for (let i = 0; i < data.length; i++) {
      stream.handleData(data.slice(i, i + 1));
    }

    expect(chats).toHaveLength(1);
    expect(chats[0].content).toBe('buffered');
  });

  it('日本語と絵文字を含むコメントを処理できる', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const chats: NicoChat[] = [];
    stream.on('chat', (chat: NicoChat) => chats.push(chat));

    const data = createFullCommentMessage({
      content: '日本語コメント🎉✨',
      hashedUserId: 'a:ニコニコ太郎',
    });
    stream.handleData(data);

    expect(chats[0].content).toBe('日本語コメント🎉✨');
    expect(chats[0].hashedUserId).toBe('a:ニコニコ太郎');
  });

  it('giftイベントを発火する', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const gifts: NicoGift[] = [];
    stream.on('gift', (gift: NicoGift) => gifts.push(gift));

    const data = createFullGiftMessage({
      itemId: 'gift-001',
      advertiserName: 'テスト太郎',
      point: 500,
      message: 'がんばれ！',
      itemName: 'スーパーギフト',
    });
    stream.handleData(data);

    expect(gifts).toHaveLength(1);
    expect(gifts[0].itemId).toBe('gift-001');
    expect(Number(gifts[0].point)).toBe(500);
  });

  it('emotionイベントを発火する', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const emotions: NicoEmotion[] = [];
    stream.on('emotion', (emotion: NicoEmotion) => emotions.push(emotion));

    const data = createFullEmotionMessage('🎉');
    stream.handleData(data);

    expect(emotions).toHaveLength(1);
    expect(emotions[0].content).toBe('🎉');
  });

  it('operatorCommentイベントを発火する', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const comments: NicoOperatorComment[] = [];
    stream.on('operatorComment', (comment: NicoOperatorComment) => comments.push(comment));

    const data = createFullOperatorCommentMessage({
      content: '放送者からのお知らせ',
      name: '放送者',
    });
    stream.handleData(data);

    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('放送者からのお知らせ');
    expect(comments[0].name).toBe('放送者');
  });

  it('notificationイベントを発火する（type != EMOTION）', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const notifications: NicoNotification[] = [];
    stream.on('notification', (n: NicoNotification) => notifications.push(n));

    const data = createFullNotificationMessage(4, '延長されました');
    stream.handleData(data);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('program_extended');
    expect(notifications[0].message).toBe('延長されました');
  });

  it('type=EMOTIONはemotionイベントとして発火しnotificationには含まれない', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const emotions: NicoEmotion[] = [];
    const notifications: NicoNotification[] = [];
    stream.on('emotion', (e: NicoEmotion) => emotions.push(e));
    stream.on('notification', (n: NicoNotification) => notifications.push(n));

    const data = createFullEmotionMessage('🎉');
    stream.handleData(data);

    expect(emotions).toHaveLength(1);
    expect(emotions[0].content).toBe('🎉');
    expect(notifications).toHaveLength(0);
  });

  it('Signal.Flushedを無視する（セグメント境界マーカーであり放送終了ではない）', () => {
    const stream = new SegmentStream('https://example.com/seg', undefined);
    const signals: string[] = [];
    stream.on('signal', (signal: string) => signals.push(signal));

    const data = createFullSignalMessage(0);
    stream.handleData(data);

    expect(signals).toHaveLength(0);
  });
});
