/**
 * バックログ（過去コメント）取得の動作確認スクリプト。
 * Usage: npx tsx scripts/verify-backlog.ts <liveId> [cookies]
 */

import { NiconicoProvider } from '../src/providers/niconico/NiconicoProvider.js';
import type { Comment, Gift, Emotion, Notification, OperatorComment } from '../src/interfaces/types.js';

const liveId = process.argv[2];
const cookies = process.argv[3];

if (!liveId) {
  console.error('Usage: npx tsx scripts/verify-backlog.ts <liveId> [cookies]');
  process.exit(1);
}

let historyCount = 0;
let realtimeCount = 0;

const provider = new NiconicoProvider({ liveId, cookies, fetchBacklog: true, backlogEvents: ['chat'] });

provider.on('comment', (comment: Comment) => {
  const tag = comment.isHistory ? '[HISTORY]' : '[LIVE]';
  if (comment.isHistory) historyCount++; else realtimeCount++;
  console.log(`${tag} 💬 #${comment.id} [${comment.userId ?? 'anon'}] ${comment.content}`);
});

provider.on('gift', (gift: Gift) => {
  const tag = gift.isHistory ? '[HISTORY]' : '[LIVE]';
  if (gift.isHistory) historyCount++; else realtimeCount++;
  console.log(`${tag} 🎁 ${gift.userName} → ${gift.itemName} (${gift.point}pt)`);
});

provider.on('emotion', (emotion: Emotion) => {
  const tag = emotion.isHistory ? '[HISTORY]' : '[LIVE]';
  if (emotion.isHistory) historyCount++; else realtimeCount++;
  console.log(`${tag} 😊 ${emotion.id}`);
});

provider.on('notification', (notification: Notification) => {
  const tag = notification.isHistory ? '[HISTORY]' : '[LIVE]';
  if (notification.isHistory) historyCount++; else realtimeCount++;
  console.log(`${tag} 📢 [${notification.type}] ${notification.message}`);
});

provider.on('operatorComment', (op: OperatorComment) => {
  const tag = op.isHistory ? '[HISTORY]' : '[LIVE]';
  if (op.isHistory) historyCount++; else realtimeCount++;
  console.log(`${tag} 📌 ${op.name ?? ''}: ${op.content}`);
});

provider.on('stateChange', (state) => {
  console.log(`[STATE] ${state}`);
});

provider.on('error', (error) => {
  console.error(`[ERROR] ${error.message}`);
});

// 30秒後に集計して終了
setTimeout(() => {
  console.log('\n=== 集計 ===');
  console.log(`過去コメント (isHistory=true): ${historyCount}`);
  console.log(`リアルタイム (isHistory=false/undefined): ${realtimeCount}`);
  console.log(`合計: ${historyCount + realtimeCount}`);
  provider.disconnect();
  process.exit(0);
}, 30_000);

process.on('SIGINT', () => {
  console.log('\n=== 集計 ===');
  console.log(`過去コメント (isHistory=true): ${historyCount}`);
  console.log(`リアルタイム (isHistory=false/undefined): ${realtimeCount}`);
  console.log(`合計: ${historyCount + realtimeCount}`);
  provider.disconnect();
  process.exit(0);
});

console.log(`=== バックログ取得確認 ===`);
console.log(`放送ID: ${liveId}`);
console.log(`30秒間コメントを取得します...\n`);

provider.connect().catch((err) => {
  console.error('接続失敗:', err.message);
  process.exit(1);
});
