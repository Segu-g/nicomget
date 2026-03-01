# Changelog

## [Unreleased]

## [2.2.4] - 2026-03-02

### Fixed

- `dist/` ビルド成果物が v2.2.1 のままで boolean flag 修正が反映されていなかった問題を修正
  （v2.2.2〜2.2.3 は `npm run build` を実行せずリリースしていたため修正が未反映だった）

## [2.2.3] - 2026-03-02

### Added

- `disconnect()` 後に再接続した場合、バックログが正しく再取得されることをテストで検証

## [2.2.2] - 2026-03-02

### Fixed

- `operatorComment` バックログの重複 emit を正しく修正
  （`processedBackwardUris` Set による URI 追跡では MessageStream 再接続ごとに異なる URI が来るため
  スキップできなかった。boolean フラグ `backlogFetched` に変更し、
  1セッションにつきバックログは初回1度のみ取得するように修正）

## [2.2.1] - 2026-03-02

### Fixed

- 同じ backward URI の再取得による `operatorComment` 重複 emit を修正
  （処理済みの backward URI を Set で管理し、2回目以降をスキップ）

## [2.2.0] - 2026-03-01

### Added

- `BroadcastMetadata` に番組・放送者・コミュニティ情報を追加:
  `title`, `description`, `beginTime`, `endTime`, `thumbnailUrl`, `tags`, `watchCount`, `commentCount`,
  `broadcasterName`, `broadcasterUserId`, `broadcasterIconUrl`
- `NiconicoBroadcastMetadata` 型を追加（`BroadcastMetadata` のニコ生固有拡張）:
  `status`, `broadcasterType`, `socialGroupId`, `socialGroupName`, `socialGroupType`
- `connect()` の戻り値を `Promise<NiconicoBroadcastMetadata>` に変更
- `provider.metadata` プロパティを追加（接続後にインスタンスから参照可能）

### Fixed

- `broadcasterUserId` が常に `undefined` になるバグを修正
  （`supplier.userId` → `supplier.programProviderId` に修正）

### Changed

- `BroadcastMetadata` をプラットフォーム共通フィールドのみに整理し、
  ニコ生固有フィールドを `NiconicoBroadcastMetadata` に分離

## [2.1.0] - 2026-03-01

### Added

- `metadata` イベントを追加（接続成功時に放送者情報を emit）
- `BroadcastMetadata` 型を追加（`broadcasterName`, `broadcasterUserId`）

## [2.0.0] - 2025

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
