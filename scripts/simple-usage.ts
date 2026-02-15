/**
 * ライブラリの簡単な使用例。
 * Usage: npx tsx scripts/simple-usage.ts [liveId]
 */

import { NiconicoProvider } from '../src/index.js';
import type { Comment } from '../src/index.js';

const liveId = process.argv[2] || 'lv349884869';

const provider = new NiconicoProvider({ liveId });

provider.on('comment', (comment: Comment) => {
  console.log(`💬 #${comment.id} [${comment.userId}] ${comment.content}`);
});

provider.on('stateChange', (state) => {
  console.log(`[状態] ${state}`);
});

provider.on('error', (err: Error) => {
  console.error(`[エラー] ${err.message}`);
});

process.on('SIGINT', () => {
  console.log('\n終了中...');
  provider.disconnect();
  process.exit(0);
});

console.log(`=== NicomView 使用例 ===`);
console.log(`放送ID: ${liveId}\n`);

provider.connect().catch((err) => {
  console.error('接続失敗:', err.message);
  process.exit(1);
});
