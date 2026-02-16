import { EventEmitter } from 'events';
import type { Comment, ConnectionState, Gift, Emotion, OperatorComment } from './types.js';

/** プラットフォーム共通のコメントプロバイダーインターフェース */
export interface ICommentProvider extends EventEmitter {
  connect(): Promise<void>;
  disconnect(): void;

  on(event: 'comment', listener: (comment: Comment) => void): this;
  on(event: 'gift', listener: (gift: Gift) => void): this;
  on(event: 'emotion', listener: (emotion: Emotion) => void): this;
  on(event: 'operatorComment', listener: (comment: OperatorComment) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'stateChange', listener: (state: ConnectionState) => void): this;

  emit(event: 'comment', comment: Comment): boolean;
  emit(event: 'gift', gift: Gift): boolean;
  emit(event: 'emotion', emotion: Emotion): boolean;
  emit(event: 'operatorComment', comment: OperatorComment): boolean;
  emit(event: 'end'): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'stateChange', state: ConnectionState): boolean;
}
