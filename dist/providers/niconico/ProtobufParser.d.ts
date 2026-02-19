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
export type NicoNotificationType = 'unknown' | 'ichiba' | 'cruise' | 'program_extended' | 'ranking_in' | 'visited' | 'supporter_registered' | 'user_level_up' | 'user_follow';
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
export declare function readLengthDelimitedMessage(buffer: Uint8Array): {
    message: Uint8Array;
    bytesRead: number;
} | null;
/**
 * バッファからすべてのLength-Delimitedメッセージを抽出する。
 * 残りのバッファも返す。
 */
export declare function extractMessages(buffer: Uint8Array): {
    messages: Uint8Array[];
    remaining: Uint8Array;
};
/**
 * ChunkedEntryをパースする。
 * メッセージサーバーから返るデータ。
 *
 * field 1: segment (MessageSegment) - セグメントURI
 * field 2: backward (BackwardSegment) - スキップ
 * field 3: previous (MessageSegment) - 過去セグメント
 * field 4: next (ReadyForNext) - 次のストリーム接続時刻
 */
export declare function parseChunkedEntry(data: Uint8Array): ChunkedEntryResult;
/**
 * ChunkedMessageをパースする。
 * セグメントサーバーから返るデータ。
 *
 * field 1: meta (Meta)
 * field 2: message (NicoliveMessage)
 * field 4: state (NicoliveState)
 * field 5: signal (Signal)
 */
export declare function parseChunkedMessage(data: Uint8Array): ChunkedMessageResult;
/**
 * PackedSegmentをパースする。
 * BackwardSegment の segment URI から取得される RAW protobuf データ。
 *
 * field 1: messages (repeated ChunkedMessage)
 * field 2: next (PackedSegment.Next) — 次のPackedSegment URI
 * field 3: snapshot (StateSnapshot) — スキップ
 */
export declare function parsePackedSegment(data: Uint8Array): PackedSegmentResult;
//# sourceMappingURL=ProtobufParser.d.ts.map