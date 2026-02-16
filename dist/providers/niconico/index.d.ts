import { EventEmitter } from 'events';

/** プラットフォーム共通のコメント型 */
interface Comment {
    /** コメントID（プラットフォーム固有） */
    id: string;
    /** コメント本文 */
    content: string;
    /** ユーザーID（匿名の場合はundefined） */
    userId?: string;
    /** 投稿日時 */
    timestamp: Date;
    /** プラットフォーム名 */
    platform: string;
    /** プラットフォーム固有の生データ */
    raw: unknown;
}
/** ギフト（投げ銭） */
interface Gift {
    /** ギフトアイテムID */
    itemId: string;
    /** ギフトアイテム名 */
    itemName: string;
    /** 贈り主ユーザーID */
    userId?: string;
    /** 贈り主表示名 */
    userName?: string;
    /** ポイント数 */
    point: number;
    /** メッセージ */
    message: string;
    /** 投稿日時 */
    timestamp: Date;
    /** プラットフォーム名 */
    platform: string;
    /** プラットフォーム固有の生データ */
    raw: unknown;
}
/** エモーション（スタンプ等） */
interface Emotion {
    /** エモーションID */
    id: string;
    /** 投稿日時 */
    timestamp: Date;
    /** プラットフォーム名 */
    platform: string;
    /** プラットフォーム固有の生データ */
    raw: unknown;
}
/** 放送者コメント */
interface OperatorComment {
    /** コメント本文 */
    content: string;
    /** 投稿者名 */
    name?: string;
    /** リンクURL */
    link?: string;
    /** 投稿日時 */
    timestamp: Date;
    /** プラットフォーム名 */
    platform: string;
    /** プラットフォーム固有の生データ */
    raw: unknown;
}
/** 接続状態 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** プラットフォーム共通のコメントプロバイダーインターフェース */
interface ICommentProvider extends EventEmitter {
    connect(): Promise<void>;
    disconnect(): void;
    on(event: 'comment', listener: (comment: Comment) => void): this;
    on(event: 'gift', listener: (gift: Gift) => void): this;
    on(event: 'emotion', listener: (emotion: Emotion) => void): this;
    on(event: 'operatorComment', listener: (comment: OperatorComment) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'stateChange', listener: (state: ConnectionState) => void): this;
    emit(event: 'comment', comment: Comment): boolean;
    emit(event: 'gift', gift: Gift): boolean;
    emit(event: 'emotion', emotion: Emotion): boolean;
    emit(event: 'operatorComment', comment: OperatorComment): boolean;
    emit(event: 'end'): boolean;
    emit(event: 'error', error: Error): boolean;
    emit(event: 'stateChange', state: ConnectionState): boolean;
}

interface NiconicoProviderOptions {
    liveId: string;
    cookies?: string;
    maxRetries?: number;
    retryIntervalMs?: number;
}
/**
 * ニコニコ生放送コメントプロバイダー。
 * ICommentProvider を実装し、放送ページからコメントを取得する。
 */
declare class NiconicoProvider extends EventEmitter implements ICommentProvider {
    private readonly liveId;
    private readonly cookies?;
    private readonly maxRetries;
    private readonly retryIntervalMs;
    private wsClient;
    private messageStream;
    private segmentStreams;
    private fetchedSegments;
    private state;
    private intentionalDisconnect;
    private reconnectCount;
    private reconnectTimer;
    constructor(options: NiconicoProviderOptions);
    connect(): Promise<void>;
    private connectWebSocket;
    disconnect(): void;
    private setState;
    private scheduleReconnect;
    /** 放送ページのHTMLからWebSocket URLを取得する */
    private fetchWebSocketUrl;
    private startMessageStream;
    private setupMessageStreamHandlers;
    private startSegmentStream;
}

/**
 * Proto定義 (nicolive-comment-protobuf):
 *   ChunkedEntry { oneof: segment=1(MessageSegment), backward=2, previous=3, next=4(ReadyForNext) }
 *   MessageSegment { from=1(Timestamp), until=2(Timestamp), uri=3(string) }
 *   ReadyForNext { at=1(int64) }
 *   ChunkedMessage { meta=1(Meta), message=2(NicoliveMessage), state=4(NicoliveState), signal=5(Signal) }
 *   NicoliveMessage { oneof: chat=1(Chat), simple_notification=7(SimpleNotification), gift=8(Gift), nicoad=9(Nicoad), overflow_chat=20(Chat), emotion=23(Emotion) }
 *   Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
 *   SimpleNotification { oneof: emotion=3(string) }
 *   Gift { item_id=1, advertiser_user_id=2, advertiser_name=3, point=4, message=5, item_name=6, contribution_rank=7 }
 *   NicoliveState { marquee=4(Marquee) }
 *   Marquee { display=1(Display) }
 *   Display { operator_comment=1(OperatorComment) }
 *   OperatorComment { content=1, name=2, modifier=3, link=4 }
 *   Signal { FLUSHED=0 }
 */
/** ニコニコ固有のChat生データ */
interface NicoChat {
    no: number;
    vpos: number;
    content: string;
    name?: string;
    rawUserId?: number;
    hashedUserId?: string;
}
/** ニコニコ固有のGift生データ */
interface NicoGift {
    itemId: string;
    advertiserUserId?: number;
    advertiserName: string;
    point: number;
    message: string;
    itemName: string;
    contributionRank?: number;
}
/** ニコニコ固有のエモーション */
interface NicoEmotion {
    content: string;
}
/** ニコニコ固有の放送者コメント */
interface NicoOperatorComment {
    content: string;
    name?: string;
    link?: string;
}

export { NiconicoProvider };
export type { Comment as C, Emotion as E, Gift as G, ICommentProvider as I, NicoChat, NicoEmotion, NicoGift, NicoOperatorComment, NiconicoProviderOptions, OperatorComment as O, ConnectionState as a };
