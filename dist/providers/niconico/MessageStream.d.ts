import { EventEmitter } from 'events';
/**
 * メッセージサーバーHTTPストリーミング。
 * viewUri に接続し ChunkedEntry を解析、segmentUri と nextAt を通知する。
 */
export declare class MessageStream extends EventEmitter {
    private readonly viewUri;
    private readonly cookies?;
    private buffer;
    private controller;
    constructor(viewUri: string, cookies?: string | undefined);
    /** ストリーミング開始（at パラメータ指定） */
    start(at?: string): Promise<void>;
    stop(): void;
    private readStream;
    /** @internal テスト用に公開 */
    handleData(chunk: Uint8Array): void;
}
//# sourceMappingURL=MessageStream.d.ts.map