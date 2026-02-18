/**
 * ビルド成果物の検証スクリプト
 *
 * dist/ の各エントリポイントが正しくインポートでき、
 * 期待するエクスポートが存在することを確認する。
 */

import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve(import.meta.dirname!, '..', 'dist');
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
      failed++;
    });
}

console.log('=== ビルド成果物検証 ===\n');

// --- ファイル存在チェック ---
console.log('[1] ファイル存在チェック');

const expectedFiles = [
  'index.js',
  'index.d.ts',
  'providers/niconico/index.js',
  'providers/niconico/index.d.ts',
];

for (const file of expectedFiles) {
  await test(`dist/${file} が存在する`, () => {
    assert.ok(existsSync(resolve(dist, file)), `${file} not found`);
  });
}

// --- メインエントリポイント ---
console.log('\n[2] メインエントリポイント (dist/index.js)');

const main = await import('../dist/index.js');

await test('NiconicoProvider がエクスポートされている', () => {
  assert.ok(main.NiconicoProvider, 'NiconicoProvider is undefined');
  assert.strictEqual(typeof main.NiconicoProvider, 'function');
});

await test('NiconicoProvider をインスタンス化できる', () => {
  const provider = new main.NiconicoProvider({ liveId: 'lv123' });
  assert.ok(provider);
  assert.strictEqual(typeof provider.connect, 'function');
  assert.strictEqual(typeof provider.disconnect, 'function');
  assert.strictEqual(typeof provider.on, 'function');
  assert.strictEqual(typeof provider.emit, 'function');
});

await test('デフォルトオプションが設定される', () => {
  const provider = new main.NiconicoProvider({ liveId: 'lv123' });
  // maxRetries=5, retryIntervalMs=5000 がデフォルト
  assert.strictEqual((provider as any).maxRetries, 5);
  assert.strictEqual((provider as any).retryIntervalMs, 5000);
});

await test('カスタムオプションが反映される', () => {
  const provider = new main.NiconicoProvider({
    liveId: 'lv456',
    maxRetries: 3,
    retryIntervalMs: 1000,
  });
  assert.strictEqual((provider as any).maxRetries, 3);
  assert.strictEqual((provider as any).retryIntervalMs, 1000);
});

// --- ニコニコサブパス ---
console.log('\n[3] ニコニコサブパス (dist/providers/niconico/index.js)');

const niconico = await import('../dist/providers/niconico/index.js');

await test('NiconicoProvider がサブパスからもエクスポートされている', () => {
  assert.ok(niconico.NiconicoProvider, 'NiconicoProvider is undefined');
  assert.strictEqual(typeof niconico.NiconicoProvider, 'function');
});

await test('メインとサブパスで同じクラスを参照している', () => {
  assert.strictEqual(main.NiconicoProvider, niconico.NiconicoProvider);
});

// --- イベント動作チェック ---
console.log('\n[4] イベント動作チェック');

await test('stateChange イベントが発火する', async () => {
  const provider = new main.NiconicoProvider({ liveId: 'lv123' });
  const states: string[] = [];
  provider.on('stateChange', (state: string) => states.push(state));
  // setState('connecting') をトリガーするため connect() を呼ぶ（失敗するが状態遷移は確認できる）
  provider.on('error', () => {});
  await provider.connect().catch(() => {});
  assert.ok(states.includes('connecting'));
});

await test('error イベントリスナーを登録できる', () => {
  const provider = new main.NiconicoProvider({ liveId: 'lv123' });
  provider.on('error', () => {});
  provider.on('comment', () => {});
  // リスナー登録でエラーにならないことを確認
});

// --- 結果 ---
console.log(`\n=== 結果: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
