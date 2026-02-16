# ニコニコ生放送 Protobuf プロトコルメモ

ニコニコ生放送のコメント取得で使用される protobuf メッセージの構造と、実装時に判明した注意点をまとめる。

## 参照元

- proto 定義: [n-air-app/nicolive-comment-protobuf](https://github.com/n-air-app/nicolive-comment-protobuf)
- 参考実装: [tsukumijima/NDGRClient](https://github.com/tsukumijima/NDGRClient)

> **注意**: 実サーバーは proto 定義にないフィールドを送信することがある（後述の Emotion field 23）。

## 接続フロー

```
放送ページ HTML
  → embedded-data から WebSocket URL を取得

WebSocket (wss://a.live2.nicovideo.jp/...)
  → startWatching 送信
  → messageServer イベントで viewUri を取得

メッセージサーバー (HTTP streaming, viewUri?at=now)
  → ChunkedEntry のストリーム
  → segment URI / nextAt を取得

セグメントサーバー (HTTP streaming, segment URI)
  → ChunkedMessage のストリーム
  → Chat / Gift / Emotion / OperatorComment を取得
```

## ChunkedEntry (メッセージサーバー)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | MessageSegment | 現在のセグメント |
| 2 | LD | BackwardSegment | 過去セグメント（スキップ） |
| 3 | LD | MessageSegment | 前のセグメント |
| 4 | LD | ReadyForNext | 次のストリーム接続タイミング |

### MessageSegment

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | Timestamp | from |
| 2 | LD | Timestamp | until |
| 3 | LD | string | **セグメント URI** |

### ReadyForNext

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | varint | int64 | **次の接続時刻** (Unix timestamp) |

## ChunkedMessage (セグメントサーバー)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | Meta | メタデータ (id, timestamp, origin) |
| 2 | LD | NicoliveMessage | **コメント等のメッセージ** |
| 4 | LD | NicoliveState | **状態（放送者コメント含む）** |
| 5 | varint | Signal enum | シグナル |

> fields 2, 4, 5 は `oneof payload`。1つの ChunkedMessage には1つだけ含まれる。

### Signal enum

| Value | Name | 説明 |
|-------|------|------|
| 0 | Flushed | セグメント境界マーカー |

> **重要**: `Signal.Flushed` は **放送終了シグナルではない**。各セグメントの冒頭に送信される境界マーカーである。これを放送終了と解釈すると、接続直後に即切断される。NDGRClient も Signal を無視している。

## NicoliveMessage (oneof data)

proto 定義 (n-air-app) のフィールド:

| Field | Type | 説明 | 対応状況 |
|-------|------|------|---------|
| 1 | Chat | 一般コメント | 対応済み |
| 7 | SimpleNotification | 通知 | 対応済み（後方互換） |
| 8 | Gift | ギフト | 対応済み |
| 9 | Nicoad | ニコニ広告 | 未対応 |
| 13 | GameUpdate | ゲーム更新 | 未対応 |
| 17 | TagUpdated | タグ更新 | 未対応 |
| 18 | ModeratorUpdated | モデレーター更新 | 未対応 |
| 19 | SSNGUpdated | SSNG更新 | 未対応 |
| 20 | Chat | あふれコメント | 対応済み |

実サーバーで確認された追加フィールド:

| Field | Type | 説明 | 対応状況 |
|-------|------|------|---------|
| **23** | Emotion | **エモーション** | **対応済み** |

> **重要**: Emotion は proto 定義の `SimpleNotification.emotion` (field 7 → sub-field 3) ではなく、**NicoliveMessage field 23** で送信される。これは NDGRClient の proto 定義には記載されていない。実放送（lv349897488）で確認済み。

### Chat

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | string | コメント本文 |
| 2 | LD | string | 投稿者名（任意） |
| 3 | varint | int32 | vpos（動画位置 ×100） |
| 4 | varint | enum | アカウントステータス |
| 5 | varint | int64 | 生ユーザーID（任意） |
| 6 | LD | string | ハッシュ化ユーザーID（任意） |
| 7 | LD | Modifier | 修飾子 |
| 8 | varint | int32 | コメント番号 |

### Gift

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | string | アイテムID |
| 2 | varint | int64 | 贈り主ユーザーID（任意） |
| 3 | LD | string | 贈り主名 |
| 4 | varint | int64 | ポイント |
| 5 | LD | string | メッセージ |
| 6 | LD | string | アイテム名 |
| 7 | varint | int32 | 貢献ランク（任意） |

### Emotion (field 23, proto 未記載)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | varint | int32 | 種別（2=エモーション, 1=ゲーム通知等） |
| 2 | LD | string | **内容文字列**（例: 「調子どう？」） |
| 3 | varint | int32 | 不明フラグ（任意） |
| 4 | varint | int32 | 不明フラグ |

### SimpleNotification (field 7, 旧形式)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 3 | LD | string | エモーション |
| 5 | LD | string | 延長通知 |

> 実サーバーでは field 7 経由のエモーション送信は確認されていない。後方互換のためパーサーは維持。

## NicoliveState (放送者コメント経路)

放送者コメント（運営コメント）は NicoliveMessage の oneof には含まれず、ChunkedMessage の `state` (field 4) 経由で届く。

```
ChunkedMessage.state (field 4)
  → NicoliveState.marquee (field 4)
    → Marquee.display (field 1)
      → Display.operator_comment (field 1)
        → OperatorComment
```

### OperatorComment

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | string | コメント本文 |
| 2 | LD | string | 投稿者名（任意） |
| 3 | LD | Modifier | 修飾子 |
| 4 | LD | string | リンクURL（任意） |

### NicoliveState のその他フィールド

| Field | Wire Type | 説明 |
|-------|-----------|------|
| 1 | LD | 統計情報？（sub-field 1=varint, 2=varint が確認されている） |
| 4 | LD | Marquee（放送者コメント） |

## 実放送での検証結果 (lv349897488)

| メッセージ種別 | 検証状況 | 備考 |
|---------------|---------|------|
| Chat (field 1) | 確認済み | 通常コメント |
| OperatorComment (state field 4) | 確認済み | 放送者コメント |
| Emotion (field 23) | 確認済み | 「調子どう？」等 |
| Overflow Chat (field 20) | 未確認 | ユニットテストのみ |
| Gift (field 8) | 未確認 | ユニットテストのみ |
| Signal.Flushed (signal field 5) | 確認済み | セグメント冒頭に毎回送信される |

## デバッグスクリプト

`scripts/debug/` に調査用スクリプトがある:

- `dump-messages.ts` — 全イベント（Chat/Gift/Emotion/OperatorComment）をコンソールに表示
- `dump-debug.ts` — ChunkedMessage の生 protobuf フィールドをダンプ（未知フィールドの調査用）
- `dump-raw.ts` — WebSocket → メッセージストリーム → セグメントの各段階の生データをダンプ

```bash
npx tsx scripts/debug/dump-messages.ts <liveId> [cookies]
npx tsx scripts/debug/dump-debug.ts <liveId> [cookies]
npx tsx scripts/debug/dump-raw.ts <liveId> [cookies]
```
