import { describe, it, expect } from 'vitest';
import { SegmentStream } from '../src/providers/niconico/SegmentStream.js';
import type { NicoChat } from '../src/providers/niconico/ProtobufParser.js';
import { createFullCommentMessage } from './helpers/protobufTestData.js';

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
});
