import protobuf from 'protobufjs/minimal.js';
const { Writer } = protobuf;

/**
 * Proto定義に基づくテストデータ生成ヘルパー。
 *
 * Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
 * NicoliveMessage { chat=1, simple_notification=7, gift=8, nicoad=9, overflow_chat=20 }
 * ChunkedMessage { meta=1, message=2(NicoliveMessage), state=4(NicoliveState), signal=5(Signal) }
 * MessageSegment { from=1, until=2, uri=3 }
 * ReadyForNext { at=1(int64) }
 * ChunkedEntry { segment=1(MessageSegment), backward=2, previous=3, next=4(ReadyForNext) }
 * SimpleNotification { emotion=3(string) }
 * Gift { item_id=1, advertiser_user_id=2, advertiser_name=3, point=4, message=5, item_name=6, contribution_rank=7 }
 * NicoliveState { marquee=4(Marquee) }
 * Marquee { display=1(Display) }
 * Display { operator_comment=1(OperatorComment) }
 * OperatorComment { content=1, name=2, modifier=3, link=4 }
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

/** NicoliveMessageでoverflow chatをラップ (field 20) */
export function createOverflowNicoliveMessage(chat: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((20 << 3) | 2); // field 20, length-delimited
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

// --- 新メッセージタイプのヘルパー ---

/** Emotion メッセージ (field 23) を生成: f1=type, f2=content, f4=flag */
export function createEmotionMessage(content: string, type: number = 2): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 0); // field 1 (type), varint
  writer.int32(type);
  writer.uint32((2 << 3) | 2); // field 2 (content), length-delimited
  writer.string(content);
  writer.uint32((4 << 3) | 0); // field 4 (flag), varint
  writer.int32(1);
  return writer.finish();
}

/** NicoliveMessageでEmotionをラップ (field 23) */
export function createEmotionNicoliveMessage(emotion: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((23 << 3) | 2); // field 23, length-delimited
  writer.bytes(emotion);
  return writer.finish();
}

/** SimpleNotification (emotion) を生成 */
export function createSimpleNotification(emotion: string): Uint8Array {
  const writer = new Writer();
  writer.uint32((3 << 3) | 2); // field 3 (emotion), length-delimited
  writer.string(emotion);
  return writer.finish();
}

/** NicoliveMessageでSimpleNotificationをラップ (field 7) */
export function createSimpleNotificationNicoliveMessage(notification: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((7 << 3) | 2); // field 7, length-delimited
  writer.bytes(notification);
  return writer.finish();
}

/** Giftメッセージを生成 */
export function createGiftMessage(options: {
  itemId?: string;
  advertiserUserId?: number;
  advertiserName?: string;
  point?: number;
  message?: string;
  itemName?: string;
  contributionRank?: number;
}): Uint8Array {
  const writer = new Writer();
  if (options.itemId) {
    writer.uint32((1 << 3) | 2); // field 1 (item_id), length-delimited
    writer.string(options.itemId);
  }
  if (options.advertiserUserId !== undefined) {
    writer.uint32((2 << 3) | 0); // field 2 (advertiser_user_id), varint
    writer.int64(options.advertiserUserId);
  }
  if (options.advertiserName) {
    writer.uint32((3 << 3) | 2); // field 3 (advertiser_name), length-delimited
    writer.string(options.advertiserName);
  }
  if (options.point !== undefined) {
    writer.uint32((4 << 3) | 0); // field 4 (point), varint
    writer.int64(options.point);
  }
  if (options.message) {
    writer.uint32((5 << 3) | 2); // field 5 (message), length-delimited
    writer.string(options.message);
  }
  if (options.itemName) {
    writer.uint32((6 << 3) | 2); // field 6 (item_name), length-delimited
    writer.string(options.itemName);
  }
  if (options.contributionRank !== undefined) {
    writer.uint32((7 << 3) | 0); // field 7 (contribution_rank), varint
    writer.int32(options.contributionRank);
  }
  return writer.finish();
}

/** NicoliveMessageでGiftをラップ (field 8) */
export function createGiftNicoliveMessage(gift: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((8 << 3) | 2); // field 8, length-delimited
  writer.bytes(gift);
  return writer.finish();
}

/** OperatorCommentメッセージを生成 */
export function createOperatorCommentMessage(options: {
  content: string;
  name?: string;
  link?: string;
}): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 2); // field 1 (content), length-delimited
  writer.string(options.content);
  if (options.name) {
    writer.uint32((2 << 3) | 2); // field 2 (name), length-delimited
    writer.string(options.name);
  }
  if (options.link) {
    writer.uint32((4 << 3) | 2); // field 4 (link), length-delimited
    writer.string(options.link);
  }
  return writer.finish();
}

/** Display > OperatorComment をラップ */
function createDisplay(operatorComment: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 2); // field 1, length-delimited
  writer.bytes(operatorComment);
  return writer.finish();
}

/** Marquee > Display をラップ */
function createMarquee(display: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((1 << 3) | 2); // field 1, length-delimited
  writer.bytes(display);
  return writer.finish();
}

/** NicoliveState > Marquee をラップ (field 4) */
function createNicoliveState(marquee: Uint8Array): Uint8Array {
  const writer = new Writer();
  writer.uint32((4 << 3) | 2); // field 4, length-delimited
  writer.bytes(marquee);
  return writer.finish();
}

/** OperatorComment を含む ChunkedMessage state (field 4) を生成 */
export function createOperatorCommentState(options: {
  content: string;
  name?: string;
  link?: string;
}): Uint8Array {
  const opComment = createOperatorCommentMessage(options);
  const display = createDisplay(opComment);
  const marquee = createMarquee(display);
  const state = createNicoliveState(marquee);
  const writer = new Writer();
  writer.uint32((4 << 3) | 2); // ChunkedMessage field 4 (state), length-delimited
  writer.bytes(state);
  return writer.finish();
}

/** Signal を含む ChunkedMessage (field 5) を生成 */
export function createSignalMessage(signalValue: number = 0): Uint8Array {
  const writer = new Writer();
  writer.uint32((5 << 3) | 0); // ChunkedMessage field 5 (signal), varint
  writer.int32(signalValue);
  return writer.finish();
}

/** 完全なGiftメッセージ (Length-Delimited) を生成 */
export function createFullGiftMessage(options: {
  itemId?: string;
  advertiserUserId?: number;
  advertiserName?: string;
  point?: number;
  message?: string;
  itemName?: string;
  contributionRank?: number;
}): Uint8Array {
  const gift = createGiftMessage(options);
  const nicoliveMessage = createGiftNicoliveMessage(gift);
  const chunkedMessage = createChunkedMessage(nicoliveMessage);
  return encodeLengthDelimited(chunkedMessage);
}

/** 完全なエモーションメッセージ (Length-Delimited) を生成 */
export function createFullEmotionMessage(emotion: string): Uint8Array {
  const emotionMsg = createEmotionMessage(emotion);
  const nicoliveMessage = createEmotionNicoliveMessage(emotionMsg);
  const chunkedMessage = createChunkedMessage(nicoliveMessage);
  return encodeLengthDelimited(chunkedMessage);
}

/** 完全なSimpleNotificationエモーション (Length-Delimited) を生成（旧形式） */
export function createFullSimpleNotificationEmotionMessage(emotion: string): Uint8Array {
  const notification = createSimpleNotification(emotion);
  const nicoliveMessage = createSimpleNotificationNicoliveMessage(notification);
  const chunkedMessage = createChunkedMessage(nicoliveMessage);
  return encodeLengthDelimited(chunkedMessage);
}

/** 完全なOperatorCommentメッセージ (Length-Delimited) を生成 */
export function createFullOperatorCommentMessage(options: {
  content: string;
  name?: string;
  link?: string;
}): Uint8Array {
  const state = createOperatorCommentState(options);
  return encodeLengthDelimited(state);
}

/** 完全なSignalメッセージ (Length-Delimited) を生成 */
export function createFullSignalMessage(signalValue: number = 0): Uint8Array {
  const signal = createSignalMessage(signalValue);
  return encodeLengthDelimited(signal);
}
