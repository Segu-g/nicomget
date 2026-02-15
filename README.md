# nicomget

ニコニコ生放送のコメントをリアルタイムに取得する Node.js ライブラリ。

放送ページへの接続からコメントストリームの購読までを抽象化し、イベントベースの簡潔な API を提供します。

## Features

- ニコニコ生放送のコメントをリアルタイム取得
- WebSocket 切断時の自動再接続（リトライ回数・間隔を設定可能）
- TypeScript / ESM 対応
- イベントベース API（`comment`, `stateChange`, `error`）

## Install

```bash
npm install nicomget
```

## Usage

```typescript
import { NiconicoProvider } from 'nicomget';

const provider = new NiconicoProvider({
  liveId: 'lv123456789',
});

provider.on('comment', (comment) => {
  console.log(`${comment.userId}: ${comment.content}`);
});

provider.on('stateChange', (state) => {
  console.log(`状態: ${state}`);
});

provider.on('error', (error) => {
  console.error(error);
});

await provider.connect();
```

### Options

```typescript
const provider = new NiconicoProvider({
  liveId: 'lv123456789',    // 放送ID（必須）
  cookies: 'user_session=...', // ログイン済みCookie（任意）
  maxRetries: 5,             // 再接続の最大試行回数（デフォルト: 5）
  retryIntervalMs: 5000,     // 再接続の間隔 ms（デフォルト: 5000）
});
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `comment` | `Comment` | コメントを受信した |
| `stateChange` | `ConnectionState` | 接続状態が変化した |
| `error` | `Error` | エラーが発生した |

### Types

```typescript
interface Comment {
  id: string;          // コメント番号
  content: string;     // コメント本文
  userId?: string;     // ユーザーID
  timestamp: Date;     // 受信日時
  platform: string;    // "niconico"
  raw: unknown;        // プラットフォーム固有の生データ
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
```

### Disconnect

```typescript
provider.disconnect();
```

`disconnect()` を呼ぶと自動再接続は行われません。

## Requirements

- Node.js >= 18

## License

MIT
