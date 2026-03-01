/** プラットフォーム共通のコメント型 */
export interface Comment {
  /** コメントID（プラットフォーム固有） */
  id: string;
  /** コメント本文 */
  content: string;
  /** ユーザーID（匿名の場合はundefined） */
  userId?: string;
  /** ユーザー名（匿名の場合はundefined） */
  userName?: string;
  /** ユーザーアイコンURL（匿名の場合はundefined） */
  userIcon?: string;
  /** 投稿日時 */
  timestamp: Date;
  /** プラットフォーム名 */
  platform: string;
  /** プラットフォーム固有の生データ */
  raw: unknown;
  /** 過去コメント（バックログ）かどうか */
  isHistory?: boolean;
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
  /** 過去コメント（バックログ）かどうか */
  isHistory?: boolean;
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
  /** 過去コメント（バックログ）かどうか */
  isHistory?: boolean;
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
  /** 過去コメント（バックログ）かどうか */
  isHistory?: boolean;
}

/** 通知 (SimpleNotificationV2 の EMOTION 以外) */
export interface Notification {
  /** 通知タイプ */
  type: string;
  /** メッセージ本文 */
  message: string;
  /** 受信日時 */
  timestamp: Date;
  /** プラットフォーム名 */
  platform: string;
  /** プラットフォーム固有の生データ */
  raw: unknown;
  /** 過去コメント（バックログ）かどうか */
  isHistory?: boolean;
}

/** 接続状態 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/** 放送メタデータ（接続成功時に一度だけ発火） */
export interface BroadcastMetadata {
  /** 番組タイトル */
  title?: string;
  /** 番組ステータス ('ON_AIR' | 'ENDED' | etc.) */
  status?: string;
  /** 番組説明（HTML含む） */
  description?: string;
  /** 番組開始時刻 */
  beginTime?: Date;
  /** 番組終了時刻（予定含む） */
  endTime?: Date;
  /** サムネイルURL */
  thumbnailUrl?: string;
  /** タグ一覧 */
  tags?: string[];
  /** 視聴者数 */
  watchCount?: number;
  /** コメント数 */
  commentCount?: number;

  /** 放送者名 */
  broadcasterName?: string;
  /** 放送者ID (user: userId, channel: channelId) */
  broadcasterUserId?: string;
  /** 放送者種別 ('user' | 'channel') */
  broadcasterType?: string;
  /** 放送者アイコンURL */
  broadcasterIconUrl?: string;

  /** コミュニティ/チャンネルID */
  socialGroupId?: string;
  /** コミュニティ/チャンネル名 */
  socialGroupName?: string;
  /** コミュニティ/チャンネル種別 ('community' | 'channel') */
  socialGroupType?: string;
}
