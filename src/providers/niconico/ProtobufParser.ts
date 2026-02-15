import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

/**
 * Proto定義 (nicolive-comment-protobuf):
 *   ChunkedEntry { oneof: segment=1(MessageSegment), backward=2, previous=3, next=4(ReadyForNext) }
 *   MessageSegment { from=1(Timestamp), until=2(Timestamp), uri=3(string) }
 *   ReadyForNext { at=1(int64) }
 *   ChunkedMessage { meta=1(Meta), message=2(NicoliveMessage), state=4, signal=5 }
 *   NicoliveMessage { oneof: chat=1(Chat), ... }
 *   Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
 */

/** ニコニコ固有のChat生データ */
export interface NicoChat {
  no: number;
  vpos: number;
  content: string;
  name?: string;
  rawUserId?: number;
  hashedUserId?: string;
}

/** ChunkedEntryの解析結果 */
export interface ChunkedEntryResult {
  segmentUri?: string;
  nextAt?: string;
}

/** ChunkedMessageの解析結果 */
export interface ChunkedMessageResult {
  chats: NicoChat[];
}

/**
 * Length-Delimitedバッファから1メッセージを読み取る。
 * データ不足の場合はnullを返す。
 */
export function readLengthDelimitedMessage(
  buffer: Uint8Array,
): { message: Uint8Array; bytesRead: number } | null {
  if (buffer.length === 0) return null;

  try {
    const reader = new Reader(buffer);
    const messageLength = reader.uint32();
    const headerSize = reader.pos;

    if (buffer.length < headerSize + messageLength) return null;

    const message = buffer.slice(headerSize, headerSize + messageLength);
    return { message, bytesRead: headerSize + messageLength };
  } catch {
    return null;
  }
}

/**
 * バッファからすべてのLength-Delimitedメッセージを抽出する。
 * 残りのバッファも返す。
 */
export function extractMessages(
  buffer: Uint8Array,
): { messages: Uint8Array[]; remaining: Uint8Array } {
  const messages: Uint8Array[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const result = readLengthDelimitedMessage(buffer.slice(offset));
    if (!result) break;
    messages.push(result.message);
    offset += result.bytesRead;
  }

  return { messages, remaining: buffer.slice(offset) };
}

/**
 * ChunkedEntryをパースする。
 * メッセージサーバーから返るデータ。
 *
 * field 1: segment (MessageSegment) - セグメントURI
 * field 2: backward (BackwardSegment) - スキップ
 * field 3: previous (MessageSegment) - 過去セグメント
 * field 4: next (ReadyForNext) - 次のストリーム接続時刻
 */
export function parseChunkedEntry(data: Uint8Array): ChunkedEntryResult {
  const reader = new Reader(data);
  const result: ChunkedEntryResult = {};

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (wireType !== 2) {
      reader.skipType(wireType);
      continue;
    }

    const len = reader.uint32();
    const subData = reader.buf.slice(reader.pos, reader.pos + len);
    reader.pos += len;

    switch (field) {
      case 1: // segment (MessageSegment)
      case 3: // previous (MessageSegment)
        if (!result.segmentUri) {
          result.segmentUri = parseMessageSegmentUri(subData);
        }
        break;
      case 4: // next (ReadyForNext)
        result.nextAt = parseReadyForNext(subData);
        break;
      // field 2 (backward): skip
    }
  }

  return result;
}

/**
 * MessageSegment: from=1(Timestamp), until=2(Timestamp), uri=3(string)
 */
function parseMessageSegmentUri(data: Uint8Array): string | undefined {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 3 && wireType === 2) {
      return reader.string();
    }
    reader.skipType(wireType);
  }
  return undefined;
}

/**
 * ReadyForNext: at=1(int64)
 */
function parseReadyForNext(data: Uint8Array): string | undefined {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 0) {
      const v = reader.int64();
      const num = typeof v === 'number' ? v : Number(v);
      return String(num);
    }
    reader.skipType(wireType);
  }
  return undefined;
}

/**
 * ChunkedMessageをパースする。
 * セグメントサーバーから返るデータ。
 *
 * field 1: meta (Meta)
 * field 2: message (NicoliveMessage)
 * field 4: state (NicoliveState)
 * field 5: signal (Signal)
 */
export function parseChunkedMessage(data: Uint8Array): ChunkedMessageResult {
  const reader = new Reader(data);
  const result: ChunkedMessageResult = { chats: [] };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 2 && wireType === 2) {
      const len = reader.uint32();
      const msgData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      const chat = parseNicoliveMessage(msgData);
      if (chat) result.chats.push(chat);
    } else {
      reader.skipType(wireType);
    }
  }

  return result;
}

/**
 * NicoliveMessage: chat=1(Chat) (oneof data)
 */
function parseNicoliveMessage(data: Uint8Array): NicoChat | null {
  const reader = new Reader(data);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 1 && wireType === 2) {
      const len = reader.uint32();
      const chatData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      return parseChat(chatData);
    }
    reader.skipType(wireType);
  }

  return null;
}

/**
 * Chatメッセージをパースする。
 *
 * field 1: content (string)
 * field 2: name (string, optional)
 * field 3: vpos (int32)
 * field 4: account_status (enum)
 * field 5: raw_user_id (int64, optional)
 * field 6: hashed_user_id (string, optional)
 * field 7: modifier (Modifier)
 * field 8: no (int32)
 */
function parseChat(data: Uint8Array): NicoChat {
  const reader = new Reader(data);
  const chat: NicoChat = { no: 0, vpos: 0, content: '' };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    switch (field) {
      case 1: // content (string)
        if (wireType === 2) {
          chat.content = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 2: // name (string, optional)
        if (wireType === 2) {
          chat.name = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 3: // vpos (int32)
        if (wireType === 0) {
          chat.vpos = reader.int32();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 5: // raw_user_id (int64, optional)
        if (wireType === 0) {
          const v = reader.int64();
          chat.rawUserId = typeof v === 'number' ? v : Number(v);
        } else {
          reader.skipType(wireType);
        }
        break;
      case 6: // hashed_user_id (string, optional)
        if (wireType === 2) {
          chat.hashedUserId = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 8: // no (int32)
        if (wireType === 0) {
          chat.no = reader.int32();
        } else {
          reader.skipType(wireType);
        }
        break;
      default:
        reader.skipType(wireType);
        break;
    }
  }

  return chat;
}
