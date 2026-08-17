import test from 'node:test';
import assert from 'node:assert/strict';
import { tarjanScc, nontrivialSccs, sccSummary } from './scc.mjs';

/** 用邻接表建图：{ a: ['b'], b: ['a'] } */
function graphOf(adj) {
  const nodes = Object.keys(adj);
  return { nodes, succ: (n) => adj[n] || [] };
}

test('tarjanScc: 无环图 → 全是单节点 SCC', () => {
  const { nodes, succ } = graphOf({ a: ['b'], b: ['c'], c: [] });
  const sccs = tarjanScc(nodes, succ);
  assert.equal(sccs.length, 3);
  assert.deepEqual(nontrivialSccs(sccs), []);
  assert.deepEqual(sccSummary(sccs), { count: 0, files: 0, max: 0, sizes: [] });
});

test('tarjanScc: 双节点互指 → 1 个 size=2 的 SCC', () => {
  const { nodes, succ } = graphOf({ a: ['b'], b: ['a'] });
  const sccs = tarjanScc(nodes, succ);
  const big = nontrivialSccs(sccs);
  assert.equal(big.length, 1);
  assert.deepEqual(big[0].sort(), ['a', 'b']);
});

test('tarjanScc: 两个独立环 → 2 个 SCC（不合并）', () => {
  const { nodes, succ } = graphOf({ a: ['b'], b: ['a'], c: ['d'], d: ['c'] });
  const big = nontrivialSccs(tarjanScc(nodes, succ));
  assert.equal(big.length, 2);
  assert.deepEqual(big.map((c) => c.length), [2, 2]);
});

test('tarjanScc: 环 + 汇入的尾巴 → 尾巴不算 SCC 成员', () => {
  // a↔b 成环，c→a 但 a 不回 c
  const { nodes, succ } = graphOf({ a: ['b'], b: ['a'], c: ['a'] });
  const big = nontrivialSccs(tarjanScc(nodes, succ));
  assert.equal(big.length, 1);
  assert.deepEqual(big[0].sort(), ['a', 'b']);
});

test('tarjanScc: 深链不爆栈（10000 节点）', () => {
  const adj = {};
  for (let i = 0; i < 10000; i++) adj[`n${i}`] = i === 9999 ? ['n0'] : [`n${i + 1}`];
  const { nodes, succ } = graphOf(adj);
  const big = nontrivialSccs(tarjanScc(nodes, succ));
  assert.equal(big.length, 1);
  assert.equal(big[0].length, 10000);
});

test('tarjanScc: 大小降序排列', () => {
  const { nodes, succ } = graphOf({
    a: ['b'], b: ['a'],
    c: ['d'], d: ['e'], e: ['c'],
  });
  const sizes = nontrivialSccs(tarjanScc(nodes, succ)).map((c) => c.length);
  assert.deepEqual(sizes, [3, 2]);
});

test('sccSummary: 汇总读数', () => {
  const { nodes, succ } = graphOf({ a: ['b'], b: ['a'], c: ['d'], d: ['e'], e: ['c'], f: [] });
  const sum = sccSummary(tarjanScc(nodes, succ));
  assert.deepEqual(sum, { count: 2, files: 5, max: 3, sizes: [3, 2] });
});
