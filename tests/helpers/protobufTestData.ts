import protobuf from 'protobufjs/minimal.js';
const { Writer } = protobuf;

import proto from '@n-air-app/nicolive-comment-protobuf';
const { ChunkedEntry, ChunkedMessage, PackedSegment, MessageSegment, BackwardSegment } =
  proto.dwango.nicolive.chat.service.edge;
const { NicoliveMessage, Chat, Gift, SimpleNotification } =
  proto.dwango.nicolive.chat.data;
const { SimpleNotificationV2 } = proto.dwango.nicolive.chat.data.atoms;

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
  return Chat.encode({
    content: options.content ?? '',
    vpos: options.vpos ?? 0,
    no: options.no ?? 0,
    accountStatus: 0,
    name: options.name,
    rawUserId: options.rawUserId,
    hashedUserId: options.hashedUserId,
  }).finish();
}

/** NicoliveMessageでChatをラップ (field 1) */
export function createNicoliveMessage(chat: Uint8Array): Uint8Array {
  return NicoliveMessage.encode({
    chat: Chat.decode(chat),
  }).finish();
}

/** NicoliveMessageでoverflow chatをラップ (field 20) */
export function createOverflowNicoliveMessage(chat: Uint8Array): Uint8Array {
  return NicoliveMessage.encode({
    overflowedChat: Chat.decode(chat),
  }).finish();
}

/** ChunkedMessageでNicoliveMessageをラップ (field 2) */
export function createChunkedMessage(message: Uint8Array): Uint8Array {
  return ChunkedMessage.encode({
    message: NicoliveMessage.decode(message),
  }).finish();
}

/** MessageSegmentメッセージを生成 (field 3 = uri) */
export function createMessageSegment(uri: string): Uint8Array {
  return MessageSegment.encode({ uri }).finish();
}

/** ChunkedEntryでMessageSegmentをラップ (field 1 = segment) */
export function createChunkedEntry(segment: Uint8Array): Uint8Array {
  return ChunkedEntry.encode({
    segment: MessageSegment.decode(segment),
  }).finish();
}

/** ReadyForNextメッセージを生成 (field 1 = at, int64) */
export function createReadyForNext(at: number): Uint8Array {
  return ChunkedEntry.ReadyForNext.encode({ at }).finish();
}

/** ChunkedEntryでReadyForNextをラップ (field 4 = next) */
export function createChunkedEntryWithNext(next: Uint8Array): Uint8Array {
  return ChunkedEntry.encode({
    next: ChunkedEntry.ReadyForNext.decode(next),
  }).finish();
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

/**
 * SimpleNotificationV2 メッセージを生成
 */
export function createSimpleNotificationV2(type: number, message: string): Uint8Array {
  return SimpleNotificationV2.encode({
    type,
    message,
    showInTelop: false,
    showInList: true,
  }).finish();
}

/** NicoliveMessageでSimpleNotificationV2をラップ (field 23) */
export function createSimpleNotificationV2NicoliveMessage(notification: Uint8Array): Uint8Array {
  return NicoliveMessage.encode({
    simpleNotificationV2: SimpleNotificationV2.decode(notification),
  }).finish();
}

/** SimpleNotification (emotion) を生成 */
export function createSimpleNotification(emotion: string): Uint8Array {
  return SimpleNotification.encode({ emotion }).finish();
}

/** NicoliveMessageでSimpleNotificationをラップ (field 7) */
export function createSimpleNotificationNicoliveMessage(notification: Uint8Array): Uint8Array {
  return NicoliveMessage.encode({
    simpleNotification: SimpleNotification.decode(notification),
  }).finish();
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
  return Gift.encode({
    itemId: options.itemId ?? '',
    advertiserName: options.advertiserName ?? '',
    point: options.point ?? 0,
    message: options.message ?? '',
    itemName: options.itemName ?? '',
    advertiserUserId: options.advertiserUserId,
    contributionRank: options.contributionRank,
  }).finish();
}

/** NicoliveMessageでGiftをラップ (field 8) */
export function createGiftNicoliveMessage(gift: Uint8Array): Uint8Array {
  return NicoliveMessage.encode({
    gift: Gift.decode(gift),
  }).finish();
}

/** OperatorCommentメッセージを生成 */
export function createOperatorCommentMessage(options: {
  content: string;
  name?: string;
  link?: string;
}): Uint8Array {
  const { OperatorComment } = proto.dwango.nicolive.chat.data;
  return OperatorComment.encode({
    content: options.content,
    name: options.name,
    link: options.link,
  }).finish();
}

/** OperatorComment を含む ChunkedMessage state (field 4) を生成 */
export function createOperatorCommentState(options: {
  content: string;
  name?: string;
  link?: string;
}): Uint8Array {
  return ChunkedMessage.encode({
    state: {
      marquee: {
        display: {
          operatorComment: {
            content: options.content,
            name: options.name,
            link: options.link,
          },
        },
      },
    },
  }).finish();
}

/** Signal を含む ChunkedMessage (field 5) を生成 */
export function createSignalMessage(signalValue: number = 0): Uint8Array {
  return ChunkedMessage.encode({
    signal: signalValue,
  }).finish();
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

/** 完全なエモーションメッセージ (Length-Delimited) を生成 (type=EMOTION=2) */
export function createFullEmotionMessage(emotion: string): Uint8Array {
  const notifMsg = createSimpleNotificationV2(2, emotion); // type=2 is EMOTION
  const nicoliveMessage = createSimpleNotificationV2NicoliveMessage(notifMsg);
  const chunkedMessage = createChunkedMessage(nicoliveMessage);
  return encodeLengthDelimited(chunkedMessage);
}

/** 完全な通知メッセージ (Length-Delimited) を生成 (type != EMOTION) */
export function createFullNotificationMessage(type: number, message: string): Uint8Array {
  const notifMsg = createSimpleNotificationV2(type, message);
  const nicoliveMessage = createSimpleNotificationV2NicoliveMessage(notifMsg);
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

// --- BackwardSegment / PackedSegment ヘルパー ---

/**
 * PackedSegment.Next メッセージを生成 { uri=1(string) }
 */
export function createPackedSegmentNext(uri: string): Uint8Array {
  return PackedSegment.Next.encode({ uri }).finish();
}

/**
 * BackwardSegment メッセージを生成
 */
export function createBackwardSegment(segmentUri: string): Uint8Array {
  return BackwardSegment.encode({
    segment: { uri: segmentUri },
  }).finish();
}

/** ChunkedEntry で BackwardSegment をラップ (field 2 = backward) */
export function createChunkedEntryWithBackward(backward: Uint8Array): Uint8Array {
  return ChunkedEntry.encode({
    backward: BackwardSegment.decode(backward),
  }).finish();
}

/** Backward URI を含む ChunkedEntry (Length-Delimited) を生成 */
export function createBackwardEntry(segmentUri: string): Uint8Array {
  const backward = createBackwardSegment(segmentUri);
  const entry = createChunkedEntryWithBackward(backward);
  return encodeLengthDelimited(entry);
}

/**
 * PackedSegment メッセージを生成（RAW protobuf, length-delimited ストリーミングではない）
 */
export function createPackedSegment(options: {
  messages: Uint8Array[];
  nextUri?: string;
}): Uint8Array {
  return PackedSegment.encode({
    messages: options.messages.map((m) => ChunkedMessage.decode(m)),
    next: options.nextUri ? { uri: options.nextUri } : undefined,
  }).finish();
}
