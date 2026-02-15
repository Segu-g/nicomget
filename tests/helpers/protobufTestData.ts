import protobuf from 'protobufjs/minimal.js';
const { Writer } = protobuf;

/**
 * Proto定義に基づくテストデータ生成ヘルパー。
 *
 * Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
 * NicoliveMessage { chat=1 }
 * ChunkedMessage { meta=1, message=2(NicoliveMessage), state=4, signal=5 }
 * MessageSegment { from=1, until=2, uri=3 }
 * ReadyForNext { at=1(int64) }
 * ChunkedEntry { segment=1(MessageSegment), backward=2, previous=3, next=4(ReadyForNext) }
 */

/** Length-Delimited形式でメッセージをエンコード */
export function encodeLengthDelimited(data: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32(data.length);
  const lengthBytes = writer.finish();
  const result = new Uint8Array(lengthBytes.length + data.length);
  result.set(lengthBytes, 0);
  result.set(data, lengthBytes.length);
  return result;
}

/** Chatメッセージを生成 */
export function createChatMessage(options: {
  no?: number;
  vpos?: number;
  content?: string;
  hashedUserId?: string;
  rawUserId?: number;
  name?: string;
}): Uint8Array {
  const writer = new Writer();
  if (options.content) {
    writer.uint32((1 << 3) | 2); // field 1 (content), length-delimited
    writer.string(options.content);
  }
  if (options.name) {
    writer.uint32((2 << 3) | 2); // field 2 (name), length-delimited
    writer.string(options.name);
  }
  if (options.vpos !== undefined) {
    writer.uint32((3 << 3) | 0); // field 3 (vpos), varint
    writer.int32(options.vpos);
  }
  if (options.rawUserId !== undefined) {
    writer.uint32((5 << 3) | 0); // field 5 (raw_user_id), varint
    writer.int64(options.rawUserId);
  }
  if (options.hashedUserId) {
    writer.uint32((6 << 3) | 2); // field 6 (hashed_user_id), length-delimited
    writer.string(options.hashedUserId);
  }
  if (options.no !== undefined) {
    writer.uint32((8 << 3) | 0); // field 8 (no), varint
    writer.int32(options.no);
  }
  return writer.finish();
}

/** NicoliveMessageでChatをラップ (field 1) */
export function createNicoliveMessage(chat: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 2); // field 1, length-delimited
  writer.bytes(chat);
  return writer.finish();
}

/** ChunkedMessageでNicoliveMessageをラップ (field 2) */
export function createChunkedMessage(message: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((2 << 3) | 2); // field 2, length-delimited
  writer.bytes(message);
  return writer.finish();
}

/** MessageSegmentメッセージを生成 (field 3 = uri) */
export function createMessageSegment(uri: string): Uint8Array {
  const writer = new Writer();
  writer.uint32((3 << 3) | 2); // field 3 (uri), length-delimited
  writer.string(uri);
  return writer.finish();
}

/** ChunkedEntryでMessageSegmentをラップ (field 1 = segment) */
export function createChunkedEntry(segment: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 2); // field 1 (segment), length-delimited
  writer.bytes(segment);
  return writer.finish();
}

/** ReadyForNextメッセージを生成 (field 1 = at, int64) */
export function createReadyForNext(at: number): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 0); // field 1 (at), varint
  writer.int64(at);
  return writer.finish();
}

/** ChunkedEntryでReadyForNextをラップ (field 4 = next) */
export function createChunkedEntryWithNext(next: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((4 << 3) | 2); // field 4 (next), length-delimited
  writer.bytes(next);
  return writer.finish();
}

/** 完全なコメントメッセージ (Length-Delimited) を生成 */
export function createFullCommentMessage(options: {
  no?: number;
  vpos?: number;
  content?: string;
  hashedUserId?: string;
  rawUserId?: number;
}): Uint8Array {
  const chat = createChatMessage(options);
  const nicoliveMessage = createNicoliveMessage(chat);
  const chunkedMessage = createChunkedMessage(nicoliveMessage);
  return encodeLengthDelimited(chunkedMessage);
}

/** Segment URIを含むChunkedEntry (Length-Delimited) を生成 */
export function createSegmentEntry(uri: string): Uint8Array {
  const segment = createMessageSegment(uri);
  const chunkedEntry = createChunkedEntry(segment);
  return encodeLengthDelimited(chunkedEntry);
}

/** Next atを含むChunkedEntry (Length-Delimited) を生成 */
export function createNextEntry(at: number): Uint8Array {
  const next = createReadyForNext(at);
  const chunkedEntry = createChunkedEntryWithNext(next);
  return encodeLengthDelimited(chunkedEntry);
}
