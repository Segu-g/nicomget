# Changelog

## [Unreleased]

### Breaking Changes

- `NicoChat`, `NicoGift`, `NicoOperatorComment` の型が `@n-air-app/nicolive-comment-protobuf` ライブラリの protobuf クラスへの型エイリアスに変更
  - optional フィールド (`name`, `hashedUserId`, `link` 等) が `undefined` ではなく `null` を返すように
  - int64 フィールド (`rawUserId`, `advertiserUserId`, `point`) が `number` ではなく `Long | number` を返すように
  - `Long` 値を数値に変換するには `Number()` を使用

### Changed

- protobuf デコードを `@n-air-app/nicolive-comment-protobuf` ライブラリの `decode()` メソッドに移行
  - `ChunkedEntry.decode()`, `ChunkedMessage.decode()`, `PackedSegment.decode()` を使用
  - 手動の `Reader` ベースパーサー（約700行）を削除し、ライブラリの型変換コード（約200行）に置き換え
- `NOTIFICATION_TYPE_MAP` を `SimpleNotificationV2.NotificationType` enum から自動生成するように変更
- テストデータ生成を `Writer` ベースの手動エンコードからライブラリの `encode()` メソッドに移行
- ビルド設定で `@n-air-app/nicolive-comment-protobuf` を external に追加
- ビルド出力を型定義のみ (`dts: { only: true }`) に変更

### Removed

- `ProtobufParser.ts` の手動パース関数群を削除:
  `parseMessageSegmentUri`, `parseReadyForNext`, `parseNicoliveMessage`, `parseChat`, `parseGift`,
  `parseSimpleNotification`, `parseSimpleNotificationV2`, `parseNicoliveState`, `parseMarquee`,
  `parseDisplay`, `parseOperatorComment`, `parseBackwardSegment`, `parseUriField`
- `NicoChat`, `NicoGift`, `NicoOperatorComment` の自前インターフェース定義を削除（ライブラリの型エイリアスに置き換え）
- `convertChat`, `convertGift`, `extractOperatorComment` 変換関数を削除

## [0.1.0] - 2025

### Added

- ニコニコ生放送コメントのリアルタイム取得
- 過去コメント（バックログ）取得（時系列順）
- ギフト・エモーション・通知・放送者コメント対応
- WebSocket 自動再接続
- TypeScript / ESM・CJS 対応
- `Comment` 型に `userIcon` プロパティを追加
- `backlogEvents` オプションでバックログ取得対象を選択可能に
