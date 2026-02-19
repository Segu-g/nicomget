import { EventEmitter } from 'events';
import {
  extractMessages,
  parseChunkedEntry,
} from './ProtobufParser.js';

/** バッファサイズ上限 (16 MB) */
const MAX_BUFFER_SIZE = 16 * 1024 * 1024;

/** HTTP接続タイムアウト (30秒) */
const CONNECT_TIMEOUT_MS = 30_000;

/** ストリーミング無通信タイムアウト (60秒) */
const INACTIVITY_TIMEOUT_MS = 60_000;

/**
 * メッセージサーバーHTTPストリーミング。
 * viewUri に接続し ChunkedEntry を解析、segmentUri と nextAt を通知する。
 */
export class MessageStream extends EventEmitter {
  private buffer = new Uint8Array(0);
  private controller: AbortController | null = null;

  constructor(
    private readonly viewUri: string,
    private readonly cookies?: string,
  ) {
    super();
  }

  /** ストリーミング開始（at パラメータ指定） */
  async start(at: string = 'now'): Promise<void> {
    const separator = this.viewUri.includes('?') ? '&' : '?';
    const uri = `${this.viewUri}${separator}at=${at}`;
    this.controller = new AbortController();

    // 接続フェーズのみのタイムアウト（ヘッダ受信後にクリア）
    const connectTimer = setTimeout(() => {
      this.controller?.abort();
    }, CONNECT_TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Priority: 'u=1, i',
      };
      if (this.cookies) headers['Cookie'] = this.cookies;

      const response = await fetch(uri, {
        headers,
        signal: this.controller.signal,
      });

      clearTimeout(connectTimer);

      if (!response.ok || !response.body) {
        throw new Error(`Message server returned ${response.status}`);
      }

      const reader = response.body.getReader();
      await this.readStream(reader);
    } catch (error) {
      clearTimeout(connectTimer);
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
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

    const resetInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        this.stop();
        this.emit('error', new Error('Stream inactivity timeout'));
      }, INACTIVITY_TIMEOUT_MS);
    };

    try {
      resetInactivityTimer();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetInactivityTimer();
        this.handleData(value);
      }
      this.emit('end');
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        this.emit('error', error);
      }
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
    }
  }

  /** @internal テスト用に公開 */
  handleData(chunk: Uint8Array): void {
    const combined = new Uint8Array(this.buffer.length + chunk.length);
    combined.set(this.buffer, 0);
    combined.set(chunk, this.buffer.length);

    const { messages, remaining } = extractMessages(combined);
    this.buffer = new Uint8Array(remaining);

    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer = new Uint8Array(0);
      this.emit('error', new Error(`Buffer size exceeded limit (${MAX_BUFFER_SIZE} bytes)`));
      this.stop();
      return;
    }

    let nextAt: string | undefined;

    for (const msg of messages) {
      try {
        const entry = parseChunkedEntry(msg);
        if (entry.segmentUri) {
          this.emit('segment', entry.segmentUri);
        }
        if (entry.backward?.segmentUri) {
          this.emit('backward', entry.backward.segmentUri);
        }
        if (entry.nextAt) {
          nextAt = entry.nextAt;
        }
      } catch {
        // malformed protobuf — skip
      }
    }

    // nextAt は全 segment を処理した後に発火
    // (next ハンドラが removeAllListeners() を呼ぶため)
    if (nextAt) {
      this.emit('next', nextAt);
    }
  }
}
