/**
 * Tarjan 强连通分量（迭代式，避免深递归爆栈）。
 *
 * [锐评 2026-10-23] 为什么耦合台账需要这个：
 * `check-circular` 报的「代表环」是**路径等价类计数**（全量简单环枚举后按节点集合归并），
 * 它的数值随任何一条边的增删剧烈波动，却不描述结构。实测模块层 14 个节点报 651 个环，
 * 而 Tarjan 给出的是 **1 个 size=14 的 SCC** —— 同一个拓扑事实，后者才能指导行动。
 *
 * SCC 回答的问题是「哪些节点必须一起理解/一起迁移」，环计数回答的是「有多少种走法」。
 * 前者是耦合单位，后者是记账噪声。
 */

/**
 * @param {Iterable<string>} nodes 全部节点
 * @param {(node: string) => Iterable<string>} successors 出边
 * @returns {string[][]} 每个 SCC 的成员数组（按大小降序）
 */
export function tarjanScc(nodes, successors) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const sccs = [];
  let counter = 0;

  for (const root of nodes) {
    if (index.has(root)) continue;

    // 显式帧栈：{ node, iter, parent }，替代递归
    const frames = [{ node: root, iter: null, parent: null }];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const { node } = frame;

      if (frame.iter === null) {
        index.set(node, counter);
        low.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
        frame.iter = successors(node)[Symbol.iterator]();
      }

      let advanced = false;
      for (;;) {
        const next = frame.iter.next();
        if (next.done) break;
        const succ = next.value;
        if (!index.has(succ)) {
          frames.push({ node: succ, iter: null, parent: node });
          advanced = true;
          break;
        }
        if (onStack.has(succ)) low.set(node, Math.min(low.get(node), index.get(succ)));
      }
      if (advanced) continue;

      // 本帧子节点全部处理完 → 回溯
      if (low.get(node) === index.get(node)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          comp.push(w);
        } while (w !== node);
        sccs.push(comp);
      }
      frames.pop();
      const parent = frame.parent;
      if (parent !== null) low.set(parent, Math.min(low.get(parent), low.get(node)));
    }
  }

  return sccs.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

/**
 * 只保留非平凡 SCC（成员 > 1）。单节点自环不计——本仓 `graph.get(x)` 不含自身，
 * 且单文件自循环不是耦合问题。
 * @param {string[][]} sccs tarjanScc 的返回
 */
export function nontrivialSccs(sccs) {
  return sccs.filter((c) => c.length > 1);
}

/**
 * SCC 汇总读数：数量 / 覆盖文件数 / 最大分量 / 成员分布。
 * @param {string[][]} sccs tarjanScc 的返回
 */
export function sccSummary(sccs) {
  const big = nontrivialSccs(sccs);
  const sizes = big.map((c) => c.length);
  return {
    count: big.length,
    files: sizes.reduce((a, b) => a + b, 0),
    max: sizes.length ? sizes[0] : 0,
    sizes,
  };
}
