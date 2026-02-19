import { EventEmitter } from 'events';
export interface WebSocketClientEvents {
    messageServer: (viewUri: string) => void;
    disconnect: (reason: string) => void;
    error: (error: Error) => void;
    open: () => void;
    close: () => void;
}
/**
 * ニコニコ生放送の視聴WebSocket管理クラス。
 * startWatching送信、ping/pong応答、keepSeat定期送信を行う。
 */
export declare class WebSocketClient extends EventEmitter {
    private readonly webSocketUrl;
    private ws;
    private keepSeatInterval;
    constructor(webSocketUrl: string);
    connect(): Promise<void>;
    disconnect(): void;
    private sendStartWatching;
    private handleMessage;
    private startKeepSeat;
    private stopKeepSeat;
}
//# sourceMappingURL=WebSocketClient.d.ts.map