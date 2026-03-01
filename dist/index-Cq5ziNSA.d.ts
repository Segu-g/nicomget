import { EventEmitter } from 'events';
import proto from '@n-air-app/nicolive-comment-protobuf';

/** プラットフォーム共通のコメント型 */
interface Comment {
    /** コメントID（プラットフォーム固有） */
    id: string;
    /** コメント本文 */
    content: string;
    /** ユーザーID（匿名の場合はundefined） */
    userId?: string;
    /** ユーザー名（匿名の場合はundefined） */
    userName?: string;
    /** ユーザーアイコンURL（匿名の場合はundefined） */
    userIcon?: string;
    /** 投稿日時 */
    timestamp: Date;
    /** プラットフォーム名 */
    platform: string;
    /** プラットフォーム固有の生データ */
    raw: unknown;
    /** 過去コメント（バックログ）かどうか */
    isHistory?: boolean;
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
    /** 過去コメント（バックログ）かどうか */
    isHistory?: boolean;
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
    /** 過去コメント（バックログ）かどうか */
    isHistory?: boolean;
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
    /** 過去コメント（バックログ）かどうか */
    isHistory?: boolean;
}
/** 通知 (SimpleNotificationV2 の EMOTION 以外) */
interface Notification {
    /** 通知タイプ */
    type: string;
    /** メッセージ本文 */
    message: string;
    /** 受信日時 */
    timestamp: Date;
    /** プラットフォーム名 */
    platform: string;
    /** プラットフォーム固有の生データ */
    raw: unknown;
    /** 過去コメント（バックログ）かどうか */
    isHistory?: boolean;
}
/** 接続状態 */
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
/** 放送メタデータ（接続成功時に一度だけ発火） */
interface BroadcastMetadata {
    /** 番組タイトル */
    title?: string;
    /** 番組説明 */
    description?: string;
    /** 番組開始時刻 */
    beginTime?: Date;
    /** 番組終了時刻（予定含む） */
    endTime?: Date;
    /** サムネイルURL */
    thumbnailUrl?: string;
    /** タグ一覧 */
    tags?: string[];
    /** 視聴者数 */
    watchCount?: number;
    /** コメント数 */
    commentCount?: number;
    /** 放送者名 */
    broadcasterName?: string;
    /** 放送者ID */
    broadcasterUserId?: string;
    /** 放送者アイコンURL */
    broadcasterIconUrl?: string;
}

/** プラットフォーム共通のコメントプロバイダーインターフェース */
interface ICommentProvider extends EventEmitter {
    connect(): Promise<BroadcastMetadata>;
    readonly metadata: BroadcastMetadata | null;
    disconnect(): void;
    on(event: 'comment', listener: (comment: Comment) => void): this;
    on(event: 'gift', listener: (gift: Gift) => void): this;
    on(event: 'emotion', listener: (emotion: Emotion) => void): this;
    on(event: 'notification', listener: (notification: Notification) => void): this;
    on(event: 'operatorComment', listener: (comment: OperatorComment) => void): this;
    on(event: 'metadata', listener: (metadata: BroadcastMetadata) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'stateChange', listener: (state: ConnectionState) => void): this;
    emit(event: 'comment', comment: Comment): boolean;
    emit(event: 'gift', gift: Gift): boolean;
    emit(event: 'emotion', emotion: Emotion): boolean;
    emit(event: 'notification', notification: Notification): boolean;
    emit(event: 'operatorComment', comment: OperatorComment): boolean;
    emit(event: 'metadata', metadata: BroadcastMetadata): boolean;
    emit(event: 'end'): boolean;
    emit(event: 'error', error: Error): boolean;
    emit(event: 'stateChange', state: ConnectionState): boolean;
}

/** バックログで取得するイベント種別 */
type BacklogEventType = 'chat' | 'gift' | 'emotion' | 'notification' | 'operatorComment';
/** ニコニコ生放送固有の放送メタデータ */
interface NiconicoBroadcastMetadata extends BroadcastMetadata {
    /** 番組ステータス ('ON_AIR' | 'ENDED' など、ニコ生固有の値) */
    status?: string;
    /** 放送者種別 ('user' | 'channel') */
    broadcasterType?: string;
    /** コミュニティ/チャンネルID */
    socialGroupId?: string;
    /** コミュニティ/チャンネル名 */
    socialGroupName?: string;
    /** コミュニティ/チャンネル種別 ('community' | 'channel') */
    socialGroupType?: string;
}
interface NiconicoProviderOptions {
    liveId: string;
    cookies?: string;
    maxRetries?: number;
    retryIntervalMs?: number;
    /** 過去コメント（バックログ）を取得するか（デフォルト: true） */
    fetchBacklog?: boolean;
    /** バックログで取得するイベント種別（デフォルト: ['chat'] — チャットのみ） */
    backlogEvents?: BacklogEventType[];
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
    private readonly fetchBacklog;
    private readonly backlogEvents;
    private wsClient;
    private messageStream;
    private segmentStreams;
    private fetchedSegments;
    private backwardStream;
    private seenChatNos;
    private state;
    private intentionalDisconnect;
    private _metadata;
    private reconnectCount;
    private reconnectTimer;
    get metadata(): NiconicoBroadcastMetadata | null;
    constructor(options: NiconicoProviderOptions);
    connect(): Promise<NiconicoBroadcastMetadata>;
    private connectWebSocket;
    disconnect(): void;
    private setState;
    private scheduleReconnect;
    /** 放送ページのHTMLからWebSocket URLと放送者情報を取得する */
    private fetchWebSocketUrl;
    private startMessageStream;
    private replaceMessageStream;
    private startSegmentStream;
    private startBackwardStream;
    /** chat.no ベースの重複排除（no > 0 のみ対象） */
    private isDuplicateChat;
    private mapChat;
    private mapGift;
    private mapEmotion;
    private mapNotification;
    private mapOperatorComment;
}

/** ニコニコ固有のChat — ライブラリの Chat クラスそのもの */
type NicoChat = proto.dwango.nicolive.chat.data.Chat;
/** ニコニコ固有のGift — ライブラリの Gift クラスそのもの */
type NicoGift = proto.dwango.nicolive.chat.data.Gift;
/** ニコニコ固有の放送者コメント — ライブラリの OperatorComment クラスそのもの */
type NicoOperatorComment = proto.dwango.nicolive.chat.data.OperatorComment;
/** ニコニコ固有のエモーション (SimpleNotificationV2 type=EMOTION) */
interface NicoEmotion {
    content: string;
}
/** SimpleNotificationV2 の通知タイプ (EMOTION 以外) */
type NicoNotificationType = 'unknown' | 'ichiba' | 'cruise' | 'program_extended' | 'ranking_in' | 'visited' | 'supporter_registered' | 'user_level_up' | 'user_follow';
/** ニコニコ固有の通知 (SimpleNotificationV2 type!=EMOTION) */
interface NicoNotification {
    type: NicoNotificationType;
    message: string;
}

export { type BacklogEventType as B, type Comment as C, type Emotion as E, type Gift as G, type ICommentProvider as I, type NicoChat as N, type OperatorComment as O, type NicoEmotion as a, type NicoGift as b, type NicoNotification as c, type NicoNotificationType as d, type NicoOperatorComment as e, type NiconicoBroadcastMetadata as f, NiconicoProvider as g, type NiconicoProviderOptions as h, type BroadcastMetadata as i, type ConnectionState as j, type Notification as k };
