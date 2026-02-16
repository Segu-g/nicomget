import { EventEmitter } from 'events';
import WebSocket from 'ws';

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
export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private keepSeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly webSocketUrl: string) {
    super();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.webSocketUrl);

      this.ws.on('open', () => {
        this.sendStartWatching();
        this.emit('open');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch {
          // ignore parse errors
        }
      });

      this.ws.on('error', (error) => {
        this.emit('error', error);
        reject(error);
      });

      this.ws.on('close', () => {
        this.stopKeepSeat();
        this.emit('close');
      });
    });
  }

  disconnect(): void {
    this.stopKeepSeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private sendStartWatching(): void {
    this.ws?.send(
      JSON.stringify({
        type: 'startWatching',
        data: {
          stream: {
            quality: 'abr',
            protocol: 'hls',
            latency: 'low',
            chasePlay: false,
          },
          room: {
            protocol: 'webSocket',
            commentable: false,
          },
          reconnect: false,
        },
      }),
    );
  }

  private handleMessage(message: { type: string; data?: any }): void {
    switch (message.type) {
      case 'messageServer':
        if (message.data?.viewUri) {
          this.emit('messageServer', message.data.viewUri);
        }
        break;
      case 'seat':
        this.startKeepSeat(message.data?.keepIntervalSec ?? 30);
        break;
      case 'ping':
        this.ws?.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'disconnect':
        this.emit('disconnect', message.data?.reason ?? 'unknown');
        break;
      case 'error':
        this.emit('error', new Error(message.data?.message ?? 'WebSocket error'));
        break;
    }
  }

  private startKeepSeat(intervalSec: number): void {
    this.stopKeepSeat();
    const clamped = Math.max(10, Math.min(300, Number(intervalSec) || 30));
    this.keepSeatInterval = setInterval(() => {
      this.ws?.send(JSON.stringify({ type: 'keepSeat' }));
    }, clamped * 1000);
  }

  private stopKeepSeat(): void {
    if (this.keepSeatInterval) {
      clearInterval(this.keepSeatInterval);
      this.keepSeatInterval = null;
    }
  }
}
