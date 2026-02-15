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
/** 接続状態 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** プラットフォーム共通のコメントプロバイダーインターフェース */
interface ICommentProvider extends EventEmitter {
    connect(): Promise<void>;
    disconnect(): void;
    on(event: 'comment', listener: (comment: Comment) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'stateChange', listener: (state: ConnectionState) => void): this;
    emit(event: 'comment', comment: Comment): boolean;
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
 *   ChunkedMessage { meta=1(Meta), message=2(NicoliveMessage), state=4, signal=5 }
 *   NicoliveMessage { oneof: chat=1(Chat), ... }
 *   Chat { content=1, name=2, vpos=3, account_status=4, raw_user_id=5, hashed_user_id=6, modifier=7, no=8 }
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

export { NiconicoProvider };
export type { Comment as C, ICommentProvider as I, NicoChat, NiconicoProviderOptions, ConnectionState as a };
