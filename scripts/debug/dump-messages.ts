/**
 * 調査スクリプト: 実放送のNicoliveMessage全フィールドをダンプする。
 *
 * Usage:
 *   npx tsx scripts/dump-messages.ts <liveId> [cookies]
 *
 * 例:
 *   npx tsx scripts/dump-messages.ts lv123456789
 *   npx tsx scripts/dump-messages.ts lv123456789 "user_session=xxx"
 */

import protobuf from 'protobufjs/minimal.js';
const { Reader } = protobuf;

import { NiconicoProvider } from '../../src/providers/niconico/NiconicoProvider.js';
import type { Comment, Gift, Emotion, Notification, OperatorComment } from '../../src/interfaces/types.js';

const liveId = process.argv[2];
const cookies = process.argv[3];

if (!liveId) {
  console.error('Usage: npx tsx scripts/dump-messages.ts <liveId> [cookies]');
  process.exit(1);
}

const provider = new NiconicoProvider({ liveId, cookies });

provider.on('comment', (comment: Comment) => {
  console.log(`[CHAT] #${comment.id} ${comment.userId ?? '(anon)'}: ${comment.content}`);
});

provider.on('gift', (gift: Gift) => {
  console.log(`[GIFT] ${gift.userName} sent ${gift.itemName} (${gift.point}pt): ${gift.message}`);
});

provider.on('emotion', (emotion: Emotion) => {
  console.log(`[EMOTION] ${emotion.id}`);
});

provider.on('notification', (notification: Notification) => {
  console.log(`[NOTIFICATION] [${notification.type}] ${notification.message}`);
});

provider.on('operatorComment', (op: OperatorComment) => {
  console.log(`[OPERATOR] ${op.name ?? '(unnamed)'}: ${op.content}${op.link ? ` [${op.link}]` : ''}`);
});

provider.on('end', () => {
  console.log('[END] 放送が終了しました');
  process.exit(0);
});

provider.on('stateChange', (state) => {
  console.log(`[STATE] ${state}`);
});

provider.on('error', (error) => {
  console.error(`[ERROR] ${error.message}`);
});

console.log(`Connecting to ${liveId}...`);
provider.connect().catch((err) => {
  console.error(`Failed to connect: ${err.message}`);
  process.exit(1);
});
