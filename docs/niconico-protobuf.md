# ニコニコ生放送 Protobuf プロトコルメモ

ニコニコ生放送のコメント取得で使用される protobuf メッセージの構造と、実装時に判明した注意点をまとめる。

## 参照元

- proto 定義: [n-air-app/nicolive-comment-protobuf](https://github.com/n-air-app/nicolive-comment-protobuf) (v2025.1117.170000)
- 参考実装: [tsukumijima/NDGRClient](https://github.com/tsukumijima/NDGRClient)
- 参考記事: [ニコニコ生放送コメントサーバー接続ガイド (Qiita)](https://qiita.com/DaisukeDaisuke/items/3938f245caec1e99d51e)

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
  → Chat / Gift / Notification / OperatorComment を取得
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

| Field | Type | 説明 | 対応状況 |
|-------|------|------|---------|
| 1 | Chat | 一般コメント | 対応済み |
| 7 | SimpleNotification | 通知（旧形式） | 対応済み（後方互換） |
| 8 | Gift | ギフト | 対応済み |
| 9 | Nicoad | ニコニ広告 | 未対応 |
| 13 | GameUpdate | ゲーム更新 | 未対応 |
| 17 | TagUpdated | タグ更新 | 未対応 |
| 18 | ModeratorUpdated | モデレーター更新 | 未対応 |
| 19 | SSNGUpdated | SSNG更新 | 未対応 |
| 20 | Chat | あふれコメント | 対応済み |
| 22 | ForwardedChat | クルーズ/コラボ転送コメント | 未対応 |
| **23** | **SimpleNotificationV2** | **各種通知（エモーション含む）** | **対応済み** |
| 24 | AkashicMessageEvent | ゲームイベント | 未対応 |

> reserved fields: 2-6, 10-12, 14-16, 21

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

### SimpleNotificationV2 (field 23)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | varint | NotificationType | 通知種別 |
| 2 | LD | string | メッセージ本文 |
| 3 | varint | bool | テロップ表示フラグ |
| 4 | varint | bool | リスト表示フラグ |

#### NotificationType enum

| Value | Name | 説明 | ライブラリの処理 |
|-------|------|------|----------------|
| 0 | UNKNOWN | 不明 | notification イベント |
| 1 | ICHIBA | 市場 | notification イベント |
| 2 | **EMOTION** | **エモーション** | **emotion イベント** |
| 3 | CRUISE | クルーズ | notification イベント |
| 4 | PROGRAM_EXTENDED | 延長 | notification イベント |
| 5 | RANKING_IN | ランクイン | notification イベント |
| 6 | VISITED | 来場 | notification イベント |
| 7 | SUPPORTER_REGISTERED | サポーター登録 | notification イベント |
| 8 | USER_LEVEL_UP | レベルアップ | notification イベント |
| 9 | USER_FOLLOW | フォロー | notification イベント |

> type=EMOTION(2) のみ `emotion` イベントとして発火し、それ以外は `notification` イベントとして発火する。

### SimpleNotification (field 7, 旧形式)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 3 | LD | string | エモーション |
| 5 | LD | string | 延長通知 |

> 実サーバーでは field 7 経由のエモーション送信は確認されていない。後方互換のためパーサーは維持。

### ForwardedChat (field 22, 未対応)

| Field | Wire Type | Type | 説明 |
|-------|-----------|------|------|
| 1 | LD | Chat | チャット本体 |
| 2 | LD | string | メッセージID |
| 3 | varint | int64 | 元の放送ID |
| 4 | varint | ForwardingMode | 転送モード (UNKNOWN=0, FROM_CRUISE=1, COLLAB_SHARING=2) |

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

### NicoliveState の全フィールド

| Field | Type | 説明 | 対応状況 |
|-------|------|------|---------|
| 1 | Statistics | 統計情報 | 未対応 |
| 2 | Enquete | アンケート | 未対応 |
| 3 | MoveOrder | 移動命令 | 未対応 |
| 4 | Marquee | 放送者コメント | 対応済み |
| 5 | CommentLock | コメントロック | 未対応 |
| 6 | CommentMode | コメントモード | 未対応 |
| 7 | TrialPanel | トライアルパネル | 未対応 |
| 9 | ProgramStatus | 番組ステータス | 未対応 |
| 10 | ModerationAnnouncement | モデレーション通知 | 未対応 |
| 11 | IchibaLauncherItemSet | 市場 | 未対応 |
| 12 | StreamStateChange | ストリーム状態変化 | 未対応 |
| 13 | AkashicStateRouting | ゲーム状態 | 未対応 |

## 実放送での検証結果

### lv349897488

| メッセージ種別 | 検証状況 | 備考 |
|---------------|---------|------|
| Chat (field 1) | 確認済み | 通常コメント |
| OperatorComment (state field 4) | 確認済み | 放送者コメント |
| SimpleNotificationV2 type=EMOTION (field 23) | 確認済み | 「調子どう？」等 |
| Signal.Flushed (signal field 5) | 確認済み | セグメント冒頭に毎回送信される |

### lv349896400

| メッセージ種別 | 検証状況 | 備考 |
|---------------|---------|------|
| Chat (field 1) | 確認済み | 通常コメント |
| SimpleNotificationV2 type=EMOTION (field 23) | 確認済み | 「初見」「おやすみ」「★」等 |
| SimpleNotificationV2 type=VISITED (field 23) | 確認済み | 「〜が好きな1人が来場しました」 |

## DoS対策

以下の防御策を実装済み:

| 対策 | 箇所 | 値 |
|------|------|-----|
| メッセージサイズ上限 | `ProtobufParser.readLengthDelimitedMessage` | 16 MB |
| バッファサイズ上限 | `SegmentStream.handleData`, `MessageStream.handleData` | 16 MB |
| HTTP接続タイムアウト | `SegmentStream.start`, `MessageStream.start` | 30秒 |
| ストリーミング無通信タイムアウト | `SegmentStream.readStream`, `MessageStream.readStream` | 60秒 |
| 放送ページ取得タイムアウト | `NiconicoProvider.fetchWebSocketUrl` | 30秒 |
| keepSeat間隔のclamp | `WebSocketClient.startKeepSeat` | 10〜300秒 |
| MessageStreamリスナー清掃 | `NiconicoProvider.replaceMessageStream` | `removeAllListeners()` |

## デバッグスクリプト

`scripts/debug/` に調査用スクリプトがある:

- `dump-messages.ts` — 全イベント（Chat/Gift/Emotion/Notification/OperatorComment）をコンソールに表示
- `dump-debug.ts` — ChunkedMessage の生 protobuf フィールドをダンプ（未知フィールドの調査用）
- `dump-raw.ts` — WebSocket → メッセージストリーム → セグメントの各段階の生データをダンプ

```bash
npx tsx scripts/debug/dump-messages.ts <liveId> [cookies]
npx tsx scripts/debug/dump-debug.ts <liveId> [cookies]
npx tsx scripts/debug/dump-raw.ts <liveId> [cookies]
```
