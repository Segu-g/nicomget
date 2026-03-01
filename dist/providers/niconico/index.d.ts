export { B as BacklogEventType, N as NicoChat, a as NicoEmotion, b as NicoGift, c as NicoNotification, d as NicoNotificationType, e as NicoOperatorComment, f as NiconicoProvider, g as NiconicoProviderOptions } from '../../index-NKFFnPEZ.js';
import { EventEmitter } from 'events';
import '@n-air-app/nicolive-comment-protobuf';

/**
 * 過去コメント (BackwardSegment) 取得ストリーム。
 * PackedSegment URI チェーンを全て取得し、時系列順（古→新）にイベントを発火する。
 *
 * チェーンは新→旧の順で返されるため、全セグメントをバッファリングした後
 * 逆順に emit することで時系列順を保証する。
 */
declare class BackwardStream extends EventEmitter {
    private readonly initialUri;
    private readonly cookies?;
    private stopped;
    constructor(initialUri: string, cookies?: string | undefined);
    start(): Promise<void>;
    stop(): void;
    private fetchSegment;
}

export { BackwardStream };
