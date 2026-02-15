import { EventEmitter } from 'events';
import type { Comment, ConnectionState } from './types.js';

/** プラットフォーム共通のコメントプロバイダーインターフェース */
export interface ICommentProvider extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;

  on(event: 'comment', listener: (comment: Comment) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'stateChange', listener: (state: ConnectionState) => void): this;

  emit(event: 'comment', comment: Comment): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'stateChange', state: ConnectionState): boolean;
}
