/**
 * 統合テスト: 実際のニコニコ生放送に接続してコメントを取得する
 *
 * CI除外: vitest.config.ts で tests/integration/ を除外済み
 * 手動実行: npx vitest run tests/integration/
 */
import { describe, it, expect } from 'vitest';
import { NiconicoProvider } from '../../src/providers/niconico/NiconicoProvider.js';
import type { Comment } from '../../src/interfaces/types.js';

describe('Live Connection', () => {
  it(
    '生放送クルーズからコメントを取得できる',
    async () => {
      const provider = new NiconicoProvider({ liveId: 'lv349881238' });
      const comments: Comment[] = [];

      provider.on('comment', (comment) => {
        comments.push(comment);
      });

      await provider.connect();

      // 最大30秒待つ
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 30000);
        provider.on('comment', () => {
          if (comments.length >= 1) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      provider.disconnect();

      expect(comments.length).toBeGreaterThanOrEqual(1);
      expect(comments[0].platform).toBe('niconico');
      expect(comments[0].content).toBeTruthy();
    },
    { timeout: 60000 },
  );
});
