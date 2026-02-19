import { EventEmitter } from 'events';
import type { ICommentProvider } from '../../interfaces/ICommentProvider.js';
/** バックログで取得するイベント種別 */
export type BacklogEventType = 'chat' | 'gift' | 'emotion' | 'notification' | 'operatorComment';
export interface NiconicoProviderOptions {
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
export declare class NiconicoProvider extends EventEmitter implements ICommentProvider {
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
//# sourceMappingURL=NiconicoProvider.d.ts.map