import { EventEmitter } from 'events';
import type { ICommentProvider } from '../../interfaces/ICommentProvider.js';
import type { Comment, ConnectionState, Gift, Emotion, Notification, OperatorComment } from '../../interfaces/types.js';
import type { NicoChat, NicoGift, NicoEmotion, NicoNotification, NicoOperatorComment } from './ProtobufParser.js';
import { WebSocketClient } from './WebSocketClient.js';
import { MessageStream } from './MessageStream.js';
import { SegmentStream } from './SegmentStream.js';
import { BackwardStream } from './BackwardStream.js';

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
export class NiconicoProvider extends EventEmitter implements ICommentProvider {
  private readonly liveId: string;
  private readonly cookies?: string;
  private readonly maxRetries: number;
  private readonly retryIntervalMs: number;
  private readonly fetchBacklog: boolean;
  private readonly backlogEvents: Set<BacklogEventType>;
  private wsClient: WebSocketClient | null = null;
  private messageStream: MessageStream | null = null;
  private segmentStreams: SegmentStream[] = [];
  private fetchedSegments = new Set<string>();
  private backwardStream: BackwardStream | null = null;
  private seenChatNos = new Set<number>();
  private state: ConnectionState = 'disconnected';
  private intentionalDisconnect = false;
  private reconnectCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: NiconicoProviderOptions) {
    super();
    this.liveId = options.liveId;
    this.cookies = options.cookies;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryIntervalMs = options.retryIntervalMs ?? 5000;
    this.fetchBacklog = options.fetchBacklog ?? true;
    this.backlogEvents = new Set(options.backlogEvents ?? ['chat']);
  }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false;
    this.setState('connecting');

    try {
      // Step 1: 放送ページからWebSocket URLを取得
      const webSocketUrl = await this.fetchWebSocketUrl();

      await this.connectWebSocket(webSocketUrl);
      this.reconnectCount = 0;
      this.setState('connected');
    } catch (error) {
      this.setState('error');
      throw error;
    }
  }

  private async connectWebSocket(webSocketUrl: string): Promise<void> {
    this.wsClient = new WebSocketClient(webSocketUrl);

    this.wsClient.on('messageServer', (viewUri: string) => {
      this.startMessageStream(viewUri);
    });

    this.wsClient.on('disconnect', (reason: string) => {
      this.emit('error', new Error(`Disconnected: ${reason}`));
      this.setState('disconnected');
    });

    this.wsClient.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.wsClient.on('close', () => {
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      } else {
        this.setState('disconnected');
      }
    });

    await this.wsClient.connect();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.wsClient?.disconnect();
    this.messageStream?.stop();
    for (const s of this.segmentStreams) s.stop();
    this.segmentStreams = [];
    this.fetchedSegments.clear();
    this.backwardStream?.stop();
    this.backwardStream = null;
    this.seenChatNos.clear();
    this.wsClient = null;
    this.messageStream = null;
    this.setState('disconnected');
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit('stateChange', state);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectCount >= this.maxRetries) {
      this.emit('error', new Error(`Reconnection failed after ${this.maxRetries} attempts`));
      this.setState('disconnected');
      return;
    }

    this.reconnectCount++;
    this.setState('connecting');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        const webSocketUrl = await this.fetchWebSocketUrl();
        await this.connectWebSocket(webSocketUrl);
        this.reconnectCount = 0;
        this.setState('connected');
      } catch {
        this.scheduleReconnect();
      }
    }, this.retryIntervalMs);
  }

  /** 放送ページのHTMLからWebSocket URLを取得する */
  private async fetchWebSocketUrl(): Promise<string> {
    const url = `https://live.nicovideo.jp/watch/${this.liveId}`;
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    };
    if (this.cookies) headers['Cookie'] = this.cookies;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch broadcast page: ${response.status}`);
    }

    const html = await response.text();
    const match = html.match(/id="embedded-data"\s+data-props="([^"]+)"/);
    if (!match) {
      throw new Error('Could not find embedded data in the page');
    }

    const propsJson = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const props = JSON.parse(propsJson);
    const wsUrl = props.site?.relive?.webSocketUrl;
    if (!wsUrl) {
      throw new Error('WebSocket URL not found in broadcast data');
    }

    return wsUrl;
  }

  private startMessageStream(viewUri: string): void {
    this.replaceMessageStream(viewUri, 'now');
  }

  private replaceMessageStream(viewUri: string, at: string): void {
    if (this.messageStream) {
      this.messageStream.removeAllListeners();
      this.messageStream.stop();
    }
    this.messageStream = new MessageStream(viewUri, this.cookies);

    this.messageStream.on('segment', (segmentUri: string) => {
      this.startSegmentStream(segmentUri);
    });

    this.messageStream.on('backward', (backwardUri: string) => {
      if (this.fetchBacklog) {
        this.startBackwardStream(backwardUri);
      }
    });

    this.messageStream.on('next', (nextAt: string) => {
      this.replaceMessageStream(viewUri, nextAt);
    });

    this.messageStream.on('error', (error: Error) => {
      this.emit('error', error);
    });

    this.messageStream.on('end', () => {
      // ストリームが nextAt なしで終了した場合、現在時刻で再接続
      this.replaceMessageStream(viewUri, 'now');
    });

    this.messageStream.start(at).catch((err) => this.emit('error', err));
  }

  private startSegmentStream(segmentUri: string): void {
    if (this.fetchedSegments.has(segmentUri)) return;
    this.fetchedSegments.add(segmentUri);

    const segment = new SegmentStream(segmentUri, this.cookies);

    segment.on('chat', (chat: NicoChat) => {
      if (this.isDuplicateChat(chat)) return;
      this.emit('comment', this.mapChat(chat));
    });

    segment.on('gift', (nicoGift: NicoGift) => {
      this.emit('gift', this.mapGift(nicoGift));
    });

    segment.on('emotion', (nicoEmotion: NicoEmotion) => {
      this.emit('emotion', this.mapEmotion(nicoEmotion));
    });

    segment.on('notification', (nicoNotif: NicoNotification) => {
      this.emit('notification', this.mapNotification(nicoNotif));
    });

    segment.on('operatorComment', (nicoOp: NicoOperatorComment) => {
      this.emit('operatorComment', this.mapOperatorComment(nicoOp));
    });

    segment.on('error', (error: Error) => {
      this.emit('error', error);
    });

    segment.on('end', () => {
      const idx = this.segmentStreams.indexOf(segment);
      if (idx >= 0) this.segmentStreams.splice(idx, 1);
    });

    this.segmentStreams.push(segment);
    segment.start().catch((err) => this.emit('error', err));
  }

  private startBackwardStream(backwardUri: string): void {
    // 既に backward stream が動作中の場合はスキップ
    if (this.backwardStream) return;

    const backward = new BackwardStream(backwardUri, this.cookies);
    this.backwardStream = backward;

    if (this.backlogEvents.has('chat')) {
      backward.on('chat', (chat: NicoChat) => {
        if (this.isDuplicateChat(chat)) return;
        this.emit('comment', this.mapChat(chat, true));
      });
    }

    if (this.backlogEvents.has('gift')) {
      backward.on('gift', (nicoGift: NicoGift) => {
        this.emit('gift', this.mapGift(nicoGift, true));
      });
    }

    if (this.backlogEvents.has('emotion')) {
      backward.on('emotion', (nicoEmotion: NicoEmotion) => {
        this.emit('emotion', this.mapEmotion(nicoEmotion, true));
      });
    }

    if (this.backlogEvents.has('notification')) {
      backward.on('notification', (nicoNotif: NicoNotification) => {
        this.emit('notification', this.mapNotification(nicoNotif, true));
      });
    }

    if (this.backlogEvents.has('operatorComment')) {
      backward.on('operatorComment', (nicoOp: NicoOperatorComment) => {
        this.emit('operatorComment', this.mapOperatorComment(nicoOp, true));
      });
    }

    backward.on('error', (error: Error) => {
      this.emit('error', error);
    });

    backward.on('end', () => {
      if (this.backwardStream === backward) {
        this.backwardStream = null;
      }
    });

    backward.start().catch((err) => this.emit('error', err));
  }

  /** chat.no ベースの重複排除（no > 0 のみ対象） */
  private isDuplicateChat(chat: NicoChat): boolean {
    if (chat.no <= 0) return false;
    if (this.seenChatNos.has(chat.no)) return true;
    this.seenChatNos.add(chat.no);
    return false;
  }

  private mapChat(chat: NicoChat, isHistory?: boolean): Comment {
    const comment: Comment = {
      id: String(chat.no),
      content: chat.content,
      userId: chat.hashedUserId || (chat.rawUserId ? String(chat.rawUserId) : undefined),
      userName: chat.name?.startsWith('a:') ? undefined : chat.name,
      timestamp: new Date(),
      platform: 'niconico',
      raw: chat,
    };
    if (isHistory) comment.isHistory = true;
    return comment;
  }

  private mapGift(nicoGift: NicoGift, isHistory?: boolean): Gift {
    const gift: Gift = {
      itemId: nicoGift.itemId,
      itemName: nicoGift.itemName,
      userId: nicoGift.advertiserUserId ? String(nicoGift.advertiserUserId) : undefined,
      userName: nicoGift.advertiserName,
      point: nicoGift.point,
      message: nicoGift.message,
      timestamp: new Date(),
      platform: 'niconico',
      raw: nicoGift,
    };
    if (isHistory) gift.isHistory = true;
    return gift;
  }

  private mapEmotion(nicoEmotion: NicoEmotion, isHistory?: boolean): Emotion {
    const emotion: Emotion = {
      id: nicoEmotion.content,
      timestamp: new Date(),
      platform: 'niconico',
      raw: nicoEmotion,
    };
    if (isHistory) emotion.isHistory = true;
    return emotion;
  }

  private mapNotification(nicoNotif: NicoNotification, isHistory?: boolean): Notification {
    const notification: Notification = {
      type: nicoNotif.type,
      message: nicoNotif.message,
      timestamp: new Date(),
      platform: 'niconico',
      raw: nicoNotif,
    };
    if (isHistory) notification.isHistory = true;
    return notification;
  }

  private mapOperatorComment(nicoOp: NicoOperatorComment, isHistory?: boolean): OperatorComment {
    const operatorComment: OperatorComment = {
      content: nicoOp.content,
      name: nicoOp.name,
      link: nicoOp.link,
      timestamp: new Date(),
      platform: 'niconico',
      raw: nicoOp,
    };
    if (isHistory) operatorComment.isHistory = true;
    return operatorComment;
  }
}
