/**
 * boolean flag 修正方針の検証スクリプト
 *
 * 問題：MessageStream が ~30秒ごとに再接続し、毎回異なる backward URI を送ってくる。
 * 各 URI で BackwardStream が起動され、その時点までの全 operatorComment 履歴を再 emit する。
 *
 * 現状の修正（processedBackwardUris Set）：初回 URI のみ管理しているが、
 * 再接続のたびに異なる URI が来るためスキップされない。
 *
 * 提案修正（boolean flag）：一度バックログを取得したら以降はすべてスキップ。
 *
 * このスクリプトでは:
 * 1. 現在の動作（修正前）のシミュレーション
 * 2. boolean flag 修正後のシミュレーション
 * を比較し、どちらが正しいかを確認する。
 */

import { NiconicoProvider } from '../src/providers/niconico/NiconicoProvider.js';
import {
  createOperatorCommentState,
  createPackedSegment,
} from '../tests/helpers/protobufTestData.js';

// テスト用 operatorComment データ（5件）
const OP_COMMENTS = [
  { content: 'いらっしゃーい', name: '放送者' },
  { content: 'よろしく！', name: '放送者' },
  { content: 'ありがとう！', name: '放送者' },
  { content: 'がんばります', name: '放送者' },
  { content: 'ご視聴ありがとう', name: '放送者' },
];

/**
 * PackedSegment のバイナリを生成（nextUri のチェーンあり or なし）
 */
function buildPackedSegment(
  comments: typeof OP_COMMENTS,
  nextUri?: string,
): Uint8Array {
  const messages = comments.map((c) => createOperatorCommentState(c));
  return createPackedSegment({ messages, nextUri });
}

/**
 * fetch をモックして複数の backward URI チェーンをシミュレートする。
 *
 * シナリオ:
 * - backward URI A: チェーン = [A → B → C]
 *   A: 5件, B: 3件, C: 2件（計10件）
 * - backward URI D（30秒後の再接続）: チェーン = [D → B → C]
 *   D: 1件（新しい1件のみ）, B・C は共有セグメント（計3件でBとCは重複）
 *
 * 期待される正しい動作:
 * - boolean flag: AのチェーンのみOK（10件emit） → Dはスキップ
 * - URI Set 方式: AのチェーンOK（10件）、DはDのみ取得（B・C は既知でstop → 1件追加）
 *   合計11件（重複なし）
 * - 修正なし（現状）: AのチェーンOK（10件）、Dのチェーン全部（3件追加= 重複2件）
 *   合計13件（B・C の2件が重複）
 *
 * 注: 実際の問題では backward URI は毎回完全に異なるため
 *     Dのチェーンは [D → E → F → ...] と全て新しいURLになる可能性もある。
 *     その場合、URI Set 方式は機能しない（共有セグメントがない）。
 *     boolean flag 方式はどちらの場合も確実に動作する。
 */

// セグメントデータ（URI → PackedSegment バイト列）
const SEGMENT_MAP: Record<string, Uint8Array> = {
  'https://segment.example.com/packed/A': buildPackedSegment(
    OP_COMMENTS.slice(0, 5),
    'https://segment.example.com/packed/B',
  ),
  'https://segment.example.com/packed/B': buildPackedSegment(
    OP_COMMENTS.slice(0, 3),
    'https://segment.example.com/packed/C',
  ),
  'https://segment.example.com/packed/C': buildPackedSegment(
    OP_COMMENTS.slice(0, 2),
  ),
  // 30秒後に来る新しい backward URI（先頭セグメントのみ異なる、以降はBとCを共有）
  'https://segment.example.com/packed/D': buildPackedSegment(
    [{ content: '新コメ！', name: '放送者' }],
    'https://segment.example.com/packed/B',
  ),
  // 完全に独立した新しいチェーン（URI全体が異なる場合のシミュレーション）
  'https://segment.example.com/packed/X': buildPackedSegment(
    OP_COMMENTS,
    'https://segment.example.com/packed/Y',
  ),
  'https://segment.example.com/packed/Y': buildPackedSegment(
    OP_COMMENTS.slice(0, 3),
  ),
};

function mockFetch(segmentMap: Record<string, Uint8Array>): void {
  (globalThis as any).fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const data = segmentMap[url];
    if (data) {
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    return new Response('Not Found', { status: 404 });
  };
}

function restoreFetch(original: typeof fetch): void {
  globalThis.fetch = original;
}

// --------------------------------------------------
// テスト実行
// --------------------------------------------------

async function runScenario(
  name: string,
  backwardUris: string[],
  applyFix: boolean,
): Promise<{ emitted: number; calls: string[] }> {
  const originalFetch = globalThis.fetch;
  mockFetch(SEGMENT_MAP);

  const provider = new NiconicoProvider({
    liveId: 'lv123',
    backlogEvents: ['operatorComment'],
  });

  // boolean flag フィールドを注入（修正後の動作をシミュレート）
  if (applyFix) {
    (provider as any).backlogFetched = false;
    const origStart = (provider as any).startBackwardStream.bind(provider);
    (provider as any).startBackwardStream = function (uri: string) {
      if ((provider as any).backlogFetched) {
        console.log(`  [boolean flag] スキップ: ${uri}`);
        return;
      }
      (provider as any).backlogFetched = true;
      return origStart(uri);
    };
  }

  const emittedContents: string[] = [];
  provider.on('operatorComment', (op: any) => {
    emittedContents.push(op.content);
  });

  // 各 backward URI を順番に呼び出す（実際には MessageStream が送ってくる）
  for (const uri of backwardUris) {
    console.log(`  startBackwardStream('${uri.split('/').pop()}')`);
    (provider as any).startBackwardStream(uri);

    // BackwardStream の終了を待つ
    if ((provider as any).backwardStream) {
      await new Promise<void>((resolve) => {
        const bs = (provider as any).backwardStream;
        if (bs) {
          bs.once('end', resolve);
          // すでに終了している場合のフォールバック
          setTimeout(resolve, 500);
        } else {
          resolve();
        }
      });
    }
    // 次の backward URI は少し後に来る（実際には30秒後）
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  restoreFetch(originalFetch);
  return { emitted: emittedContents.length, calls: emittedContents };
}

// --------------------------------------------------
// メイン
// --------------------------------------------------

async function main() {
  console.log('=== operatorComment 重複 emit 検証スクリプト ===\n');

  console.log('シナリオ1: 共有セグメントありのチェーン');
  console.log('  backward URI A [→B→C] (10件) + D [→B→C] (3件、BとCは重複)');
  const urisWithShared = [
    'https://segment.example.com/packed/A',
    'https://segment.example.com/packed/D',
  ];

  console.log('\n[修正なし（現状）]');
  const r1 = await runScenario('修正なし', urisWithShared, false);
  console.log(`  emit 数: ${r1.emitted} 件 (期待: 10 件、重複なし)`);
  const r1Contents = [...r1.calls];

  console.log('\n[boolean flag 修正後]');
  const r2 = await runScenario('boolean flag', urisWithShared, true);
  console.log(`  emit 数: ${r2.emitted} 件 (期待: 10 件、重複なし)`);

  console.log('\n---');
  console.log('シナリオ2: 完全に独立したチェーン（URLが全て異なる）');
  console.log('  backward URI A [→B→C] (10件) + X [→Y] (8件、全て異なるURL、同じ内容)');
  const urisFullyDifferent = [
    'https://segment.example.com/packed/A',
    'https://segment.example.com/packed/X',
  ];

  console.log('\n[修正なし（現状）]');
  const r3 = await runScenario('修正なし', urisFullyDifferent, false);
  console.log(`  emit 数: ${r3.emitted} 件 (期待: 10 件、重複なし)`);

  console.log('\n[boolean flag 修正後]');
  const r4 = await runScenario('boolean flag', urisFullyDifferent, true);
  console.log(`  emit 数: ${r4.emitted} 件 (期待: 10 件、重複なし)`);

  console.log('\n=== まとめ ===');
  console.log(`シナリオ1（共有セグメント）:`);
  console.log(`  修正なし:        ${r1.emitted} 件 ${r1.emitted === 10 ? '✓' : '✗ 重複あり'}`);
  console.log(`  boolean flag:   ${r2.emitted} 件 ${r2.emitted === 10 ? '✓' : '✗'}`);

  console.log(`\nシナリオ2（独立チェーン = 実際の状況）:`);
  console.log(`  修正なし:        ${r3.emitted} 件 ${r3.emitted === 10 ? '✓' : '✗ 重複あり'}`);
  console.log(`  boolean flag:   ${r4.emitted} 件 ${r4.emitted === 10 ? '✓' : '✗'}`);

  const booleanFlagWorks = r2.emitted === 10 && r4.emitted === 10;
  console.log(`\n結論: boolean flag 修正は ${booleanFlagWorks ? '✓ 有効' : '✗ 無効'}`);
}

main().catch(console.error);
