import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

/**
 * Proto定義 (n-air-app/nicolive-comment-protobuf v2025.1117.170000):
 *   ChunkedEntry { oneof: segment=1(MessageSegment), backward=2(BackwardSegment), previous=3, next=4(ReadyForNext) }
 *   MessageSegment { from=1(Timestamp), until=2(Timestamp), uri=3(string) }
 *   ReadyForNext { at=1(int64) }
 *   BackwardSegment { until=1(Timestamp), segment=2(PackedSegment.Next), snapshot=3(StateSnapshot) }
 *   PackedSegment { messages=1(repeated ChunkedMessage), next=2(Next), snapshot=3(StateSnapshot) }
 *   PackedSegment.Next { uri=1(string) }
 *   ChunkedMessage { meta=1(Meta), oneof payload: message=2(NicoliveMessage), state=4(NicoliveState), signal=5(Signal) }
 *   NicoliveMessage { oneof data: chat=1, simple_notification=7, gift=8, nicoad=9,
 *     tag_updated=17, moderator_updated=18, ssng_updated=19, overflowed_chat=20,
 *     forwarded_chat=22, simple_notification_v2=23, akashic_message_event=24 }
 *   Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
 *   SimpleNotification { emotion=3(string), program_extension=5(string) }
 *   SimpleNotificationV2 { type=1(NotificationType), message=2(string), show_in_telop=3(bool), show_in_list=4(bool) }
 *   NotificationType { UNKNOWN=0, ICHIBA=1, EMOTION=2, CRUISE=3, PROGRAM_EXTENDED=4,
 *     RANKING_IN=5, VISITED=6, SUPPORTER_REGISTERED=7, USER_LEVEL_UP=8, USER_FOLLOW=9 }
 *   Gift { item_id=1, advertiser_user_id=2, advertiser_name=3, point=4, message=5, item_name=6, contribution_rank=7 }
 *   NicoliveState { statistics=1, enquete=2, move_order=3, marquee=4(Marquee), comment_lock=5,
 *     comment_mode=6, trial_panel=7, program_status=9, ... }
 *   Marquee { display=1(Display) }
 *   Display { operator_comment=1(OperatorComment) }
 *   OperatorComment { content=1, name=2, modifier=3, link=4 }
 *   Signal { FLUSHED=0 }
 */

/** メッセージサイズ上限 (16 MB) — これを超えるメッセージは破棄する */
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/** ニコニコ固有のChat生データ */
export interface NicoChat {
  no: number;
  vpos: number;
  content: string;
  name?: string;
  rawUserId?: number;
  hashedUserId?: string;
}

/** ニコニコ固有のGift生データ */
export interface NicoGift {
  itemId: string;
  advertiserUserId?: number;
  advertiserName: string;
  point: number;
  message: string;
  itemName: string;
  contributionRank?: number;
}

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

/** ニコニコ固有の放送者コメント */
export interface NicoOperatorComment {
  content: string;
  name?: string;
  link?: string;
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
      case 2: // backward (BackwardSegment)
        result.backward = parseBackwardSegment(subData);
        break;
      case 4: // next (ReadyForNext)
        result.nextAt = parseReadyForNext(subData);
        break;
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
  const result: ChunkedMessageResult = { chats: [], gifts: [], emotions: [], notifications: [] };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 2 && wireType === 2) {
      // message (NicoliveMessage)
      const len = reader.uint32();
      const msgData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      const msg = parseNicoliveMessage(msgData);
      if (msg) {
        if (msg.chat) result.chats.push(msg.chat);
        if (msg.gift) result.gifts.push(msg.gift);
        if (msg.emotion) result.emotions.push(msg.emotion);
        if (msg.notification) result.notifications.push(msg.notification);
      }
    } else if (field === 4 && wireType === 2) {
      // state (NicoliveState)
      const len = reader.uint32();
      const stateData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      const op = parseNicoliveState(stateData);
      if (op) result.operatorComment = op;
    } else if (field === 5 && wireType === 0) {
      // signal (Signal enum)
      const val = reader.int32();
      if (val === 0) result.signal = 'flushed';
    } else {
      reader.skipType(wireType);
    }
  }

  return result;
}

/** NicoliveMessage解析の中間結果 */
interface NicoliveMessageResult {
  chat?: NicoChat;
  gift?: NicoGift;
  emotion?: NicoEmotion;
  notification?: NicoNotification;
}

/**
 * NicoliveMessage: oneof data
 *   chat=1(Chat), simple_notification=7(SimpleNotification),
 *   gift=8(Gift), nicoad=9(Nicoad), overflow_chat=20(Chat),
 *   simple_notification_v2=23(SimpleNotificationV2)
 */
function parseNicoliveMessage(data: Uint8Array): NicoliveMessageResult | null {
  const reader = new Reader(data);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;

      switch (field) {
        case 1: // chat (Chat)
        case 20: // overflow_chat (Chat)
          return { chat: parseChat(subData) };
        case 7: // simple_notification (SimpleNotification)
          {
            const emotion = parseSimpleNotification(subData);
            if (emotion) return { emotion };
          }
          break;
        case 8: // gift (Gift)
          return { gift: parseGift(subData) };
        case 23: // simple_notification_v2 (SimpleNotificationV2)
          return parseSimpleNotificationV2(subData);
      }
    } else {
      reader.skipType(wireType);
    }
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

/**
 * SimpleNotification: oneof emotion=3(string)
 */
function parseSimpleNotification(data: Uint8Array): NicoEmotion | null {
  const reader = new Reader(data);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 3 && wireType === 2) {
      return { content: reader.string() };
    }
    reader.skipType(wireType);
  }

  return null;
}

/** NotificationType enum → NicoNotificationType 文字列マッピング */
const NOTIFICATION_TYPE_MAP: Record<number, NicoNotificationType> = {
  0: 'unknown',
  1: 'ichiba',
  // 2 = EMOTION → emotion として返すため含まない
  3: 'cruise',
  4: 'program_extended',
  5: 'ranking_in',
  6: 'visited',
  7: 'supporter_registered',
  8: 'user_level_up',
  9: 'user_follow',
};

/**
 * SimpleNotificationV2 (field 23):
 *   type=1(NotificationType), message=2(string), show_in_telop=3(bool), show_in_list=4(bool)
 *
 * type=EMOTION(2) → { emotion } を返す
 * その他 → { notification } を返す
 */
function parseSimpleNotificationV2(data: Uint8Array): NicoliveMessageResult | null {
  const reader = new Reader(data);
  let type = 0;
  let message = '';

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    switch (field) {
      case 1: // type (NotificationType enum)
        if (wireType === 0) {
          type = reader.int32();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 2: // message (string)
        if (wireType === 2) {
          message = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      default:
        reader.skipType(wireType);
        break;
    }
  }

  if (type === 2) {
    // EMOTION
    return { emotion: { content: message } };
  }

  const typeName = NOTIFICATION_TYPE_MAP[type] ?? 'unknown';
  return { notification: { type: typeName, message } };
}

/**
 * Gift: item_id=1, advertiser_user_id=2, advertiser_name=3, point=4, message=5, item_name=6, contribution_rank=7
 */
function parseGift(data: Uint8Array): NicoGift {
  const reader = new Reader(data);
  const gift: NicoGift = {
    itemId: '',
    advertiserName: '',
    point: 0,
    message: '',
    itemName: '',
  };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    switch (field) {
      case 1: // item_id (string)
        if (wireType === 2) {
          gift.itemId = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 2: // advertiser_user_id (int64, optional)
        if (wireType === 0) {
          const v = reader.int64();
          gift.advertiserUserId = typeof v === 'number' ? v : Number(v);
        } else {
          reader.skipType(wireType);
        }
        break;
      case 3: // advertiser_name (string)
        if (wireType === 2) {
          gift.advertiserName = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 4: // point (int64)
        if (wireType === 0) {
          const v = reader.int64();
          gift.point = typeof v === 'number' ? v : Number(v);
        } else {
          reader.skipType(wireType);
        }
        break;
      case 5: // message (string)
        if (wireType === 2) {
          gift.message = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 6: // item_name (string)
        if (wireType === 2) {
          gift.itemName = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 7: // contribution_rank (int32, optional)
        if (wireType === 0) {
          gift.contributionRank = reader.int32();
        } else {
          reader.skipType(wireType);
        }
        break;
      default:
        reader.skipType(wireType);
        break;
    }
  }

  return gift;
}

/**
 * NicoliveState: marquee=4(Marquee)
 */
function parseNicoliveState(data: Uint8Array): NicoOperatorComment | null {
  const reader = new Reader(data);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 4 && wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      return parseMarquee(subData);
    }
    reader.skipType(wireType);
  }

  return null;
}

/**
 * Marquee: display=1(Display)
 */
function parseMarquee(data: Uint8Array): NicoOperatorComment | null {
  const reader = new Reader(data);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 1 && wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      return parseDisplay(subData);
    }
    reader.skipType(wireType);
  }

  return null;
}

/**
 * Display: operator_comment=1(OperatorComment)
 */
function parseDisplay(data: Uint8Array): NicoOperatorComment | null {
  const reader = new Reader(data);

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 1 && wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      return parseOperatorComment(subData);
    }
    reader.skipType(wireType);
  }

  return null;
}

/**
 * OperatorComment: content=1, name=2, modifier=3, link=4
 */
function parseOperatorComment(data: Uint8Array): NicoOperatorComment {
  const reader = new Reader(data);
  const result: NicoOperatorComment = { content: '' };

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    switch (field) {
      case 1: // content (string)
        if (wireType === 2) {
          result.content = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 2: // name (string, optional)
        if (wireType === 2) {
          result.name = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      case 4: // link (string, optional)
        if (wireType === 2) {
          result.link = reader.string();
        } else {
          reader.skipType(wireType);
        }
        break;
      default:
        reader.skipType(wireType);
        break;
    }
  }

  return result;
}

/**
 * BackwardSegment: until=1(Timestamp), segment=2(PackedSegment.Next), snapshot=3(StateSnapshot)
 * PackedSegment.Next: { uri=1(string) }
 */
function parseBackwardSegment(data: Uint8Array): BackwardSegmentResult {
  const reader = new Reader(data);
  const result: BackwardSegmentResult = {};

  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;

    if (field === 2 && wireType === 2) {
      const len = reader.uint32();
      const subData = reader.buf.slice(reader.pos, reader.pos + len);
      reader.pos += len;
      result.segmentUri = parseUriField(subData);
    } else {
      reader.skipType(wireType);
    }
  }

  return result;
}

/**
 * URI サブメッセージ: { uri=1(string) }
 * PackedSegment.Next や BackwardSegment.segment で使用。
 */
function parseUriField(data: Uint8Array): string | undefined {
  const reader = new Reader(data);
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const field = tag >>> 3;
    const wireType = tag & 7;
    if (field === 1 && wireType === 2) {
      return reader.string();
    }
    reader.skipType(wireType);
  }
  return undefined;
}

/**
 * PackedSegmentをパースする。
 * BackwardSegment の segment URI から取得される RAW protobuf データ。
 *
 * field 1: messages (repeated ChunkedMessage)
 * field 2: next (PackedSegment.Next) — 次のPackedSegment URI
 * field 3: snapshot (StateSnapshot) — スキップ
 */
export function parsePackedSegment(data: Uint8Array): PackedSegmentResult {
  const reader = new Reader(data);
  const result: PackedSegmentResult = { messages: [] };

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
      case 1: // messages (repeated ChunkedMessage)
        result.messages.push(parseChunkedMessage(subData));
        break;
      case 2: // next (PackedSegment.Next)
        result.nextUri = parseUriField(subData);
        break;
      // field 3 (snapshot): skip
    }
  }

  return result;
}
