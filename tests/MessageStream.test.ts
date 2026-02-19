import { describe, it, expect, vi } from 'vitest';
import { MessageStream } from '../src/providers/niconico/MessageStream.js';
import {
  createSegmentEntry,
  createNextEntry,
  createBackwardEntry,
} from './helpers/protobufTestData.js';

describe('MessageStream', () => {
  it('ChunkedEntry(segment)からsegmentイベントを発火する', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const segments: string[] = [];
    stream.on('segment', (uri: string) => segments.push(uri));

    const data = createSegmentEntry('https://example.com/segment/1');
    stream.handleData(data);

    expect(segments).toEqual(['https://example.com/segment/1']);
  });

  it('ChunkedEntry(next)からnextイベントを発火する', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const nexts: string[] = [];
    stream.on('next', (at: string) => nexts.push(at));

    const data = createNextEntry(1700000000);
    stream.handleData(data);

    expect(nexts).toEqual(['1700000000']);
  });

  it('分割されたチャンクを正しくバッファリングする', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const segments: string[] = [];
    stream.on('segment', (uri: string) => segments.push(uri));

    const data = createSegmentEntry('https://example.com/segment/2');

    // 2つに分割して送信
    const mid = Math.floor(data.length / 2);
    stream.handleData(data.slice(0, mid));
    expect(segments).toHaveLength(0); // まだ完全じゃない

    stream.handleData(data.slice(mid));
    expect(segments).toEqual(['https://example.com/segment/2']);
  });

  it('複数メッセージを一度に受信できる', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const segments: string[] = [];
    stream.on('segment', (uri: string) => segments.push(uri));

    const data1 = createSegmentEntry('https://example.com/seg/1');
    const data2 = createSegmentEntry('https://example.com/seg/2');

    const combined = new Uint8Array(data1.length + data2.length);
    combined.set(data1, 0);
    combined.set(data2, data1.length);

    stream.handleData(combined);
    expect(segments).toEqual([
      'https://example.com/seg/1',
      'https://example.com/seg/2',
    ]);
  });

  it('ChunkedEntry(backward)からbackwardイベントを発火する', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const backwards: string[] = [];
    stream.on('backward', (uri: string) => backwards.push(uri));

    const data = createBackwardEntry('https://example.com/packed/1');
    stream.handleData(data);

    expect(backwards).toEqual(['https://example.com/packed/1']);
  });

  it('segment と backward を同時に含むデータを処理できる', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const segments: string[] = [];
    const backwards: string[] = [];
    stream.on('segment', (uri: string) => segments.push(uri));
    stream.on('backward', (uri: string) => backwards.push(uri));

    const seg = createSegmentEntry('https://example.com/seg/1');
    const back = createBackwardEntry('https://example.com/packed/1');

    const combined = new Uint8Array(seg.length + back.length);
    combined.set(seg, 0);
    combined.set(back, seg.length);

    stream.handleData(combined);

    expect(segments).toEqual(['https://example.com/seg/1']);
    expect(backwards).toEqual(['https://example.com/packed/1']);
  });

  it('stopでバッファがクリアされる', () => {
    const stream = new MessageStream('https://example.com/view', undefined);
    const segments: string[] = [];
    stream.on('segment', (uri: string) => segments.push(uri));

    const data = createSegmentEntry('https://example.com/seg/1');
    // 途中までだけ送信
    stream.handleData(data.slice(0, 3));

    stream.stop();

    // 残りを送信してもメッセージは完成しない（バッファがクリアされたため）
    stream.handleData(data.slice(3));
    expect(segments).toHaveLength(0);
  });
});
