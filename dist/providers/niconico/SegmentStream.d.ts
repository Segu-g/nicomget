import { EventEmitter } from 'events';
/**
 * セグメントサーバーHTTPストリーミング。
 * セグメントURIに接続し ChunkedMessage を解析、各種メッセージを通知する。
 */
export declare class SegmentStream extends EventEmitter {
    private readonly segmentUri;
    private readonly cookies?;
    private buffer;
    private controller;
    constructor(segmentUri: string, cookies?: string | undefined);
    start(): Promise<void>;
    stop(): void;
    private readStream;
    /** @internal テスト用に公開 */
    handleData(chunk: Uint8Array): void;
}
//# sourceMappingURL=SegmentStream.d.ts.map