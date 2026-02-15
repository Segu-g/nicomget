/** プラットフォーム共通のコメント型 */
export interface Comment {
  /** コメントID（プラットフォーム固有） */
  id: string;
  /** コメント本文 */
  content: string;
  /** ユーザーID（匿名の場合はundefined） */
  userId?: string;
  /** 投稿日時 */
  timestamp: Date;
  /** プラットフォーム名 */
  platform: string;
  /** プラットフォーム固有の生データ */
  raw: unknown;
}

/** 接続状態 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
