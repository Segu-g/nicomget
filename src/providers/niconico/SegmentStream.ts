import { EventEmitter } from 'events';
import {
  extractMessages,
  parseChunkedMessage,
  type NicoChat,
  type NicoGift,
  type NicoEmotion,
  type NicoOperatorComment,
} from './ProtobufParser.js';

/**
 * セグメントサーバーHTTPストリーミング。
 * セグメントURIに接続し ChunkedMessage を解析、各種メッセージを通知する。
 */
export class SegmentStream extends EventEmitter {
  private buffer = new Uint8Array(0);
  private controller: AbortController | null = null;

  constructor(
    private readonly segmentUri: string,
    private readonly cookies?: string,
  ) {
    super();
  }

  async start(): Promise<void> {
    this.controller = new AbortController();

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      };
      if (this.cookies) headers['Cookie'] = this.cookies;

      const response = await fetch(this.segmentUri, {
        headers,
        signal: this.controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Segment server returned ${response.status}`);
      }

      const reader = response.body.getReader();
      await this.readStream(reader);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
      }
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.buffer = new Uint8Array(0);
  }

  private async readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.handleData(value);
      }
      this.emit('end');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
      }
    }
  }

  /** @internal テスト用に公開 */
  handleData(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);

    const { messages, remaining } = extractMessages(combined);
    this.buffer = new Uint8Array(remaining);

    for (const msg of messages) {
      try {
        const result = parseChunkedMessage(msg);
        for (const chat of result.chats) {
          this.emit('chat', chat);
        }
        for (const gift of result.gifts) {
          this.emit('gift', gift);
        }
        for (const emotion of result.emotions) {
          this.emit('emotion', emotion);
        }
        if (result.operatorComment) {
          this.emit('operatorComment', result.operatorComment);
        }
        if (result.signal === 'flushed') {
          this.emit('signal', 'flushed');
        }
      } catch {
        // malformed protobuf — skip
      }
    }
  }
}
