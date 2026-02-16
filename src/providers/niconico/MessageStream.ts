import { EventEmitter } from 'events';
import {
  extractMessages,
  parseChunkedEntry,
  type ChunkedEntryResult,
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

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Priority: 'u=1, i',
      };
      if (this.cookies) headers['Cookie'] = this.cookies;

      const connectTimeout = AbortSignal.timeout(CONNECT_TIMEOUT_MS);
      const signal = AbortSignal.any([this.controller.signal, connectTimeout]);

      const response = await fetch(uri, {
        headers,
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Message server returned ${response.status}`);
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
      if ((error as Error).name !== 'AbortError' && (error as Error).name !== 'TimeoutError') {
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

    for (const msg of messages) {
      try {
        const entry = parseChunkedEntry(msg);
        this.emitEntry(entry);
      } catch {
        // malformed protobuf — skip
      }
    }
  }

  private emitEntry(entry: ChunkedEntryResult): void {
    if (entry.segmentUri) {
      this.emit('segment', entry.segmentUri);
    }
    if (entry.nextAt) {
      this.emit('next', entry.nextAt);
    }
  }
}
