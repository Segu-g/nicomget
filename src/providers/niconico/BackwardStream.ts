import { EventEmitter } from 'events';
import {
  parsePackedSegment,
  type ChunkedMessageResult,
} from './ProtobufParser.js';

/** チェーン追跡の最大深度 */
const MAX_CHAIN_DEPTH = 50;

/** リクエスト間の待機時間 (ms) */
const FETCH_DELAY_MS = 100;

/** レスポンスサイズ上限 (16 MB) */
const MAX_RESPONSE_SIZE = 16 * 1024 * 1024;

/** HTTP接続タイムアウト (30秒) */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * 過去コメント (BackwardSegment) 取得ストリーム。
 * PackedSegment URI チェーンを全て取得し、時系列順（古→新）にイベントを発火する。
 *
 * チェーンは新→旧の順で返されるため、全セグメントをバッファリングした後
 * 逆順に emit することで時系列順を保証する。
 */
export class BackwardStream extends EventEmitter {
  private stopped = false;

  constructor(
    private readonly initialUri: string,
    private readonly cookies?: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    // Phase 1: 全セグメントを取得（新→旧の順で蓄積される）
    const segments: ChunkedMessageResult[][] = [];

    let uri: string | undefined = this.initialUri;
    let depth = 0;

    while (uri && !this.stopped && depth < MAX_CHAIN_DEPTH) {
      try {
        const data = await this.fetchSegment(uri);
        const packed = parsePackedSegment(data);
        segments.push(packed.messages);

        uri = packed.nextUri;
        depth++;

        if (uri && !this.stopped) {
          await delay(FETCH_DELAY_MS);
        }
      } catch (error) {
        if (!this.stopped) {
          this.emit('error', error);
        }
        break;
      }
    }

    if (this.stopped) return;

    // Phase 2: 逆順に emit（古→新の時系列順）
    for (let i = segments.length - 1; i >= 0; i--) {
      for (const msg of segments[i]) {
        if (this.stopped) return;
        for (const chat of msg.chats) {
          this.emit('chat', chat);
        }
        for (const gift of msg.gifts) {
          this.emit('gift', gift);
        }
        for (const emotion of msg.emotions) {
          this.emit('emotion', emotion);
        }
        for (const notification of msg.notifications) {
          this.emit('notification', notification);
        }
        if (msg.operatorComment) {
          this.emit('operatorComment', msg.operatorComment);
        }
      }
    }

    if (!this.stopped) {
      this.emit('end');
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async fetchSegment(uri: string): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      };
      if (this.cookies) headers['Cookie'] = this.cookies;

      const response = await fetch(uri, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`Backward segment server returned ${response.status}`);
      }

      const buf = await response.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE_SIZE) {
        throw new Error(`Response size ${buf.byteLength} exceeds limit ${MAX_RESPONSE_SIZE}`);
      }

      return new Uint8Array(buf);
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
