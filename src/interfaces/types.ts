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

/** ギフト（投げ銭） */
export interface Gift {
  /** ギフトアイテムID */
  itemId: string;
  /** ギフトアイテム名 */
  itemName: string;
  /** 贈り主ユーザーID */
  userId?: string;
  /** 贈り主表示名 */
  userName?: string;
  /** ポイント数 */
  point: number;
  /** メッセージ */
  message: string;
  /** 投稿日時 */
  timestamp: Date;
  /** プラットフォーム名 */
  platform: string;
  /** プラットフォーム固有の生データ */
  raw: unknown;
}

/** エモーション（スタンプ等） */
export interface Emotion {
  /** エモーションID */
  id: string;
  /** 投稿日時 */
  timestamp: Date;
  /** プラットフォーム名 */
  platform: string;
  /** プラットフォーム固有の生データ */
  raw: unknown;
}

/** 放送者コメント */
export interface OperatorComment {
  /** コメント本文 */
  content: string;
  /** 投稿者名 */
  name?: string;
  /** リンクURL */
  link?: string;
  /** 投稿日時 */
  timestamp: Date;
  /** プラットフォーム名 */
  platform: string;
  /** プラットフォーム固有の生データ */
  raw: unknown;
}

/** 接続状態 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
