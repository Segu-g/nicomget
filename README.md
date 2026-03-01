# nicomget

ニコニコ生放送のコメントをリアルタイムに取得する Node.js ライブラリ。

放送ページへの接続からコメントストリームの購読までを抽象化し、イベントベースの簡潔な API を提供します。

## Features

- ニコニコ生放送のコメントをリアルタイム取得
- 過去コメント（バックログ）の自動取得（時系列順）
- ギフト・エモーション・各種通知・放送者コメントの取得
- WebSocket 切断時の自動再接続（リトライ回数・間隔を設定可能）
- TypeScript / ESM・CJS 対応
- イベントベース API（`comment`, `gift`, `emotion`, `notification`, `operatorComment`, `stateChange`, `error`）
- protobuf デコードに [@n-air-app/nicolive-comment-protobuf](https://github.com/n-air-app/nicolive-comment-protobuf) を使用

## Install

```bash
npm install github:Segu-g/nicomget
```

## Usage

```typescript
import { NiconicoProvider } from 'nicomget';

const provider = new NiconicoProvider({
  liveId: 'lv123456789',
});

provider.on('comment', (comment) => {
  const tag = comment.isHistory ? '[過去]' : '[Live]';
  console.log(`${tag} ${comment.userId}: ${comment.content}`);
});

provider.on('gift', (gift) => {
  console.log(`${gift.userName} sent ${gift.itemName} (${gift.point}pt)`);
});

provider.on('emotion', (emotion) => {
  console.log(`Emotion: ${emotion.id}`);
});

provider.on('notification', (notification) => {
  console.log(`Notification [${notification.type}]: ${notification.message}`);
});

provider.on('operatorComment', (op) => {
  console.log(`Operator: ${op.content}`);
});

provider.on('metadata', (meta) => {
  console.log(`番組: ${meta.title} / 放送者: ${meta.broadcasterName}`);
});

provider.on('stateChange', (state) => {
  console.log(`状態: ${state}`);
});

provider.on('error', (error) => {
  console.error(error);
});

// connect() は NiconicoBroadcastMetadata を返す
const meta = await provider.connect();
console.log(meta.title, meta.status);

// 接続後はプロパティからも参照可能
console.log(provider.metadata?.broadcasterName);
```

### Options

```typescript
const provider = new NiconicoProvider({
  liveId: 'lv123456789',    // 放送ID（必須）
  cookies: 'user_session=...', // ログイン済みCookie（任意）
  maxRetries: 5,             // 再接続の最大試行回数（デフォルト: 5）
  retryIntervalMs: 5000,     // 再接続の間隔 ms（デフォルト: 5000）
  fetchBacklog: true,        // 過去コメント取得（デフォルト: true）
  backlogEvents: ['chat'],   // 過去コメントで取得するイベント種別（デフォルト: ['chat']）
});
```

#### `backlogEvents`

バックログで取得するイベント種別を配列で指定します。デフォルトは `['chat']`（チャットのみ）。

| 値 | 説明 |
|---|---|
| `'chat'` | コメント |
| `'gift'` | ギフト |
| `'emotion'` | エモーション |
| `'notification'` | 通知 |
| `'operatorComment'` | 放送者コメント |

全イベントを取得する場合:

```typescript
const provider = new NiconicoProvider({
  liveId: 'lv123456789',
  backlogEvents: ['chat', 'gift', 'emotion', 'notification', 'operatorComment'],
});
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `metadata` | `NiconicoBroadcastMetadata` | 接続成功時に1度だけ発火 |
| `comment` | `Comment` | コメントを受信した |
| `gift` | `Gift` | ギフトを受信した |
| `emotion` | `Emotion` | エモーションを受信した |
| `notification` | `Notification` | 通知を受信した（延長・ランクイン等） |
| `operatorComment` | `OperatorComment` | 放送者コメントを受信した |
| `stateChange` | `ConnectionState` | 接続状態が変化した |
| `error` | `Error` | エラーが発生した |

`metadata` は `connect()` の戻り値でも取得できます。また、接続後は `provider.metadata` プロパティからいつでも参照できます（切断後も最後の値を保持）。

### Types

```typescript
interface Comment {
  id: string;          // コメント番号
  content: string;     // コメント本文
  userId?: string;     // ユーザーID
  userName?: string;   // ユーザー名（匿名コメントの場合はundefined）
  userIcon?: string;   // ユーザーアイコンURL（匿名コメントの場合はundefined）
  timestamp: Date;     // 受信日時
  platform: string;    // "niconico"
  raw: unknown;        // プラットフォーム固有の生データ (NicoChat)
  isHistory?: boolean; // 過去コメントの場合 true
}

interface Gift {
  itemId: string;      // ギフトアイテムID
  itemName: string;    // ギフトアイテム名
  userId?: string;     // 贈り主ユーザーID
  userName?: string;   // 贈り主表示名
  point: number;       // ポイント数
  message: string;     // メッセージ
  timestamp: Date;     // 受信日時
  platform: string;    // "niconico"
  raw: unknown;        // プラットフォーム固有の生データ (NicoGift)
  isHistory?: boolean; // 過去コメントの場合 true
}

interface Emotion {
  id: string;          // エモーション内容
  timestamp: Date;     // 受信日時
  platform: string;    // "niconico"
  raw: unknown;        // プラットフォーム固有の生データ (NicoEmotion)
  isHistory?: boolean; // 過去コメントの場合 true
}

interface Notification {
  type: string;          // 通知タイプ ("ichiba" | "cruise" | "program_extended" | ...)
  message: string;       // メッセージ本文
  timestamp: Date;       // 受信日時
  platform: string;      // "niconico"
  raw: unknown;          // プラットフォーム固有の生データ (NicoNotification)
  isHistory?: boolean;   // 過去コメントの場合 true
}

interface OperatorComment {
  content: string;     // コメント本文
  name?: string;       // 投稿者名
  link?: string;       // リンクURL
  timestamp: Date;     // 受信日時
  platform: string;    // "niconico"
  raw: unknown;        // プラットフォーム固有の生データ (NicoOperatorComment)
  isHistory?: boolean; // 過去コメントの場合 true
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// プラットフォーム共通の放送メタデータ
interface BroadcastMetadata {
  title?: string;            // 番組タイトル
  description?: string;      // 番組説明（HTML含む）
  beginTime?: Date;          // 開始時刻
  endTime?: Date;            // 終了時刻（予定含む）
  thumbnailUrl?: string;     // サムネイルURL
  tags?: string[];           // タグ一覧
  watchCount?: number;       // 視聴者数
  commentCount?: number;     // コメント数
  broadcasterName?: string;  // 放送者名
  broadcasterUserId?: string;// 放送者ID
  broadcasterIconUrl?: string;// 放送者アイコンURL
}

// ニコニコ生放送固有の放送メタデータ（BroadcastMetadata を拡張）
interface NiconicoBroadcastMetadata extends BroadcastMetadata {
  status?: string;           // 番組ステータス ('ON_AIR' | 'ENDED' など)
  broadcasterType?: string;  // 放送者種別 ('user' | 'channel')
  socialGroupId?: string;    // コミュニティ/チャンネルID
  socialGroupName?: string;  // コミュニティ/チャンネル名
  socialGroupType?: string;  // コミュニティ/チャンネル種別 ('community' | 'channel')
}
```

### Raw Types

各イベントの `raw` フィールドには protobuf ライブラリのデコード結果がそのまま格納されます。

- `NicoChat` = `dwango.nicolive.chat.data.Chat` — `rawUserId` は `Long | null`、`name` / `hashedUserId` は `string | null`
- `NicoGift` = `dwango.nicolive.chat.data.Gift` — `point` は `number | Long`、`advertiserUserId` は `number | Long | null`
- `NicoOperatorComment` = `dwango.nicolive.chat.data.OperatorComment` — `name` / `link` は `string | null`

`Long` 値を数値に変換するには `Number()` を使用してください。

### Disconnect

```typescript
provider.disconnect();
```

`disconnect()` を呼ぶと自動再接続は行われません。

## Architecture

```
NiconicoProvider
  ├── WebSocketClient        # 放送ページからメッセージサーバーURL取得
  ├── MessageStream          # メッセージサーバーに接続し ChunkedEntry を解析
  ├── SegmentStream          # セグメントサーバーからリアルタイムコメント取得
  └── BackwardStream         # 過去コメント (PackedSegment) のチェーン取得
```

protobuf のデコードには `@n-air-app/nicolive-comment-protobuf` の `ChunkedEntry.decode()`, `ChunkedMessage.decode()`, `PackedSegment.decode()` を使用。ストリーミングのフレーミング層（Length-Delimited 分割）のみ `protobufjs/minimal.js` の `Reader` を使用。

## Requirements

- Node.js >= 18

## License

MIT
