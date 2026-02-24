import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

import proto from '@n-air-app/nicolive-comment-protobuf';
const { ChunkedEntry, ChunkedMessage, PackedSegment } =
  proto.dwango.nicolive.chat.service.edge;
const { SimpleNotificationV2 } = proto.dwango.nicolive.chat.data.atoms;
const NotificationType = SimpleNotificationV2.NotificationType;

/** メッセージサイズ上限 (16 MB) — これを超えるメッセージは破棄する */
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/** ニコニコ固有のChat — ライブラリの Chat クラスそのもの */
export type NicoChat = proto.dwango.nicolive.chat.data.Chat;

/** ニコニコ固有のGift — ライブラリの Gift クラスそのもの */
export type NicoGift = proto.dwango.nicolive.chat.data.Gift;

/** ニコニコ固有の放送者コメント — ライブラリの OperatorComment クラスそのもの */
export type NicoOperatorComment = proto.dwango.nicolive.chat.data.OperatorComment;

/** ニコニコ固有のエモーション (SimpleNotificationV2 type=EMOTION) */
export interface NicoEmotion {
  content: string;
}

/** SimpleNotificationV2 の通知タイプ (EMOTION 以外) */
export type NicoNotificationType =
  | 'unknown'
  | 'ichiba'
  | 'cruise'
  | 'program_extended'
  | 'ranking_in'
  | 'visited'
  | 'supporter_registered'
  | 'user_level_up'
  | 'user_follow';

/** ニコニコ固有の通知 (SimpleNotificationV2 type!=EMOTION) */
export interface NicoNotification {
  type: NicoNotificationType;
  message: string;
}

/** BackwardSegmentの解析結果 */
export interface BackwardSegmentResult {
  segmentUri?: string;
}

/** ChunkedEntryの解析結果 */
export interface ChunkedEntryResult {
  segmentUri?: string;
  nextAt?: string;
  backward?: BackwardSegmentResult;
}

/** PackedSegmentの解析結果 */
export interface PackedSegmentResult {
  messages: ChunkedMessageResult[];
  nextUri?: string;
}

/** ChunkedMessageの解析結果 */
export interface ChunkedMessageResult {
  chats: NicoChat[];
  gifts: NicoGift[];
  emotions: NicoEmotion[];
  notifications: NicoNotification[];
  operatorComment?: NicoOperatorComment;
  signal?: 'flushed';
}

/** NotificationType enum → NicoNotificationType 文字列マッピング（EMOTION は除外） */
const NOTIFICATION_TYPE_MAP: Record<number, NicoNotificationType> =
  Object.fromEntries(
    Object.entries(NotificationType)
      .filter(([, v]) => typeof v === 'number' && v !== NotificationType.EMOTION)
      .map(([k, v]) => [v, k.toLowerCase() as NicoNotificationType]),
  );

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

    if (messageLength > MAX_MESSAGE_SIZE) {
      throw new Error(`Message size ${messageLength} exceeds limit ${MAX_MESSAGE_SIZE}`);
    }

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
 */
export function parseChunkedEntry(data: Uint8Array): ChunkedEntryResult {
  const entry = ChunkedEntry.decode(data);
  const result: ChunkedEntryResult = {};

  const seg = entry.segment ?? entry.previous;
  if (seg?.uri) result.segmentUri = seg.uri;

  if (entry.backward?.segment?.uri) {
    result.backward = { segmentUri: entry.backward.segment.uri };
  }

  if (entry.next?.at != null) {
    result.nextAt = String(Number(entry.next.at));
  }

  return result;
}

/**
 * ChunkedMessageをパースする。
 * セグメントサーバーから返るデータ。
 */
export function parseChunkedMessage(data: Uint8Array): ChunkedMessageResult {
  return convertChunkedMessage(ChunkedMessage.decode(data));
}

/** デコード済み ChunkedMessage を ChunkedMessageResult に変換する */
function convertChunkedMessage(
  msg: proto.dwango.nicolive.chat.service.edge.IChunkedMessage,
): ChunkedMessageResult {
  const result: ChunkedMessageResult = {
    chats: [],
    gifts: [],
    emotions: [],
    notifications: [],
  };
  const payload = (msg as { payload?: string }).payload;

  if (payload === 'message' && msg.message) {
    processNicoliveMessage(msg.message, result);
  } else if (payload === 'state' && msg.state) {
    const op = msg.state.marquee?.display?.operatorComment;
    if (op) result.operatorComment = op as NicoOperatorComment;
  } else if (
    payload === 'signal' &&
    msg.signal === ChunkedMessage.Signal.Flushed
  ) {
    result.signal = 'flushed';
  }

  return result;
}

/** NicoliveMessage から各データを抽出して result に格納する */
function processNicoliveMessage(
  nicoliveMsg: proto.dwango.nicolive.chat.data.INicoliveMessage,
  result: ChunkedMessageResult,
): void {
  const data = (nicoliveMsg as { data?: string }).data;

  if (data === 'chat' && nicoliveMsg.chat) {
    result.chats.push(nicoliveMsg.chat as NicoChat);
  } else if (data === 'overflowedChat' && nicoliveMsg.overflowedChat) {
    result.chats.push(nicoliveMsg.overflowedChat as NicoChat);
  } else if (data === 'simpleNotification' && nicoliveMsg.simpleNotification) {
    if (nicoliveMsg.simpleNotification.emotion) {
      result.emotions.push({ content: nicoliveMsg.simpleNotification.emotion });
    }
  } else if (data === 'gift' && nicoliveMsg.gift) {
    result.gifts.push(nicoliveMsg.gift as NicoGift);
  } else if (
    data === 'simpleNotificationV2' &&
    nicoliveMsg.simpleNotificationV2
  ) {
    const notif = nicoliveMsg.simpleNotificationV2;
    const type = notif.type ?? 0;
    if (type === NotificationType.EMOTION) {
      result.emotions.push({ content: notif.message ?? '' });
    } else {
      const typeName = NOTIFICATION_TYPE_MAP[type] ?? 'unknown';
      result.notifications.push({ type: typeName, message: notif.message ?? '' });
    }
  }
}

/**
 * PackedSegmentをパースする。
 * BackwardSegment の segment URI から取得される RAW protobuf データ。
 */
export function parsePackedSegment(data: Uint8Array): PackedSegmentResult {
  const packed = PackedSegment.decode(data);
  const result: PackedSegmentResult = { messages: [] };

  if (packed.messages) {
    for (const msg of packed.messages) {
      result.messages.push(convertChunkedMessage(msg));
    }
  }

  if (packed.next?.uri) {
    result.nextUri = packed.next.uri;
  }

  return result;
}
