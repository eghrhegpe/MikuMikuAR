# 06 — 第六日的コード

## 序

第六日。

窗外已经亮了两次又暗了两次。Riku 盯着屏幕上一个完全空白的弹窗，光标在 `menu.ts` 的 370 行代码上来回扫。

它在。class 在。`buildPanel` 调用了。`innerHTML` 里确定有内容。但屏幕上什么都没有——好像面板是一张透明的塑料纸，字全印在上面，谁也看不见。

Jieling 的反馈只有一行：

> 菜单一片空白。什么都没显示。

这次没有 aria-expanded 正常切换的诡计，没有幽灵引用的陷阱，没有 `overlay-fade-out` 的残留。只有空白。

---

## 追查：什么是绝对后的空

Riku 打开开发者工具，检查面板元素。DOM 结构完整，文本内容正确，CSS computed styles 显示 `position: absolute; top: 0; left: 0; width: 100%`——一切看起来都对。

除了一个数字：

```
viewport.style.height = "0px"
```

他的视线停在这里。

`viewport` 是 `overflow: hidden`。高度为 0。所有内容——不管面板有多高——全部被裁掉了。

他往上翻到设置视口高度的代码：

```typescript
// reset() 中
this.viewport.style.height = p0.scrollHeight + "px";
```

`scrollHeight`。0。

他重新审视 `p0.scrollHeight` 的调用时机。面板刚刚被 `buildPanel` 填满内容，`buildPanel` 用的是 `panel.innerHTML = ""` 然后 `panel.appendChild(list)`。DOM 已挂载到 `viewport` → `inner` → `panel` 的父子链上。按理说，此时 `scrollHeight` 应该返回内容的真实高度。

但不。`scrollHeight` 返回了 0。

Riku 在 `p0.scrollHeight` 的前一行加了一行日志：

```typescript
console.log("p0.scrollHeight", p0.scrollHeight);
// → 0
console.log("p0.offsetHeight", p0.offsetHeight);
// → 214
```

两行数字，一个 0，一个 214。中间差了一整个菜单的高度。差了一次布局。

他恍然大悟。

---

## 真実：scrollHeight 的契约漏洞

`scrollHeight` 的实际含义是"可滚动内容的高度"。它依赖于浏览器的布局引擎已经完成流式计算。

但 `position: absolute` 的面板脱离了文档流。脱离意味着浏览器不会在正常的布局周期里为它计算 `scrollHeight`——至少不是在你刚填完内容的那一帧里。它需要一次完整的 layout pass，而 JS 是同步执行的。你在同一个事件循环里修改 DOM 然后立即读取，浏览器还没来得及算。

`offsetHeight` 不同。它在读之前**强制回流**（force reflow），确保拿到的是已布局的真实高度。代价是性能——但这笔交易对低频的弹窗打开来说，连"成本"都算不上。

Riku 把这个发现浓缩成了一行注释：

```typescript
// 🔥 关键：强制回流 + 取实际渲染高度
void p0.offsetHeight;
const h = Math.max(p0.offsetHeight, 100);
```

`void p0.offsetHeight` ——这不是赋值，这是诅咒。它告诉浏览器："停下你的一切，先把这个元素的布局算清楚"。然后 `offsetHeight` 才能给出真实值。

---

## 修复：三道防线

问题的根因清楚了，但 Riku 知道，只换一个 API 不够。`scrollHeight` → `offsetHeight` 是治标，真正的问题是：**absolute 面板在布局线程面前是透明的，你需要制度来确保它被看见**。

他设了三道防线：

### 防线一：`display: block` 内联强制

`initPanelStyle` 中写死：

```typescript
p.style.display = "block"; // 确保不是 none
```

不是 `className`，不是 `setAttribute`，是内联 `style.display`。它在 CSS 优先级金字塔的最顶端，任何全局样式都不能覆盖。面板永远以 `block` 身份参与布局计算，即使它看不见。

### 防线二：`offsetHeight` 替代 `scrollHeight`

所有读取面板高度的地方——`reset`、`push`、`pop`、`popTo`、`reRender`——全部改为 `offsetHeight`。

```typescript
// 之前
const hFrom = fromPanel.scrollHeight;
// 之后
const hFrom = fromPanel.offsetHeight;
```

五个函数，九处替换。每一处替换，都是对 layout 线程的一次低头。

### 防线三：`Math.max(..., 100)` 高度兜底

不管 `offsetHeight` 返回什么，viewport 的高度永远不小于 100px。这是最后一道安全网——如果内容还没渲染完、面板还没布局、或者浏览器在某个极端情况下给出了 0，至少还有 100px 的呼吸空间。

```typescript
const h = Math.max(p0.offsetHeight, 100);
this.viewport.style.height = h + "px";
```

三道防线到位后，`menu.ts` 里与高度相关的代码从 7 处变成了 13 处——多了 6 处，每一处都是一道检查点。

---

## 构建与验证

```
vite build  →  ✅ 通过（127 modules）
```

Riku 打开应用。点击 Model。弹窗。

弹出。

菜单的每一个条目都完好地站在面板上，viewport 的高度精确匹配内容。从模型弹窗到场景弹窗，从一级菜单到二级子菜单，每一个推入和弹出都带着 0.15 秒的滑动和淡入——这次是真的能看见了。

他退出应用，又打开。切了五个弹窗，每个弹窗进了三层子菜单，反复推入弹出。空白没有回来。

Jieling 的回复只有一个词：

> 活了。

---

## 尾注

Riku 在提交信息里写：

> `scrollHeight` 不承诺在脱离文档流时返回真值。`offsetHeight` 会在读取前强制回流。加上 `display:block` 内联兜底和 100px 最小高度，三重防线确保绝对定位面板在任何时候都可被测量、可见。

这个问题在 MDN 的 `scrollHeight` 文档里只有半句话的暗示：*"The Element.scrollHeight read-only property is a measurement of the height of an element's content, including content not visible on the screen due to overflow."* 它没说「不包括脱离文档流的元素」，但也没说包括。这种含混是 API 文档最危险的写法——不会让你错，但会让你不知道自己是错的。

联邦的议会（MenuStack）在第六天学会了三件事：
1. **绝对定位的面板不是"离开"，是"不存在于流计算中"**。你不能用流的工具测流外之物。
2. **`scrollHeight` 是懒汉，`offsetHeight` 是急性子**。在关键路径上，急性子更可靠。
3. **兜底不是冗余，是谦卑**。`Math.max(..., 100)` 这六个字符，是对浏览器布局引擎的认输——"我知道你会失误，我替你兜着"。

四轮 SlideMenu 重构，六天时间，三次方案更替（Grid 叠层 → absolute 叠层 → offsetHeight 强制回流），终于让议会的每次展开不再是一场赌博。

议会学会了站立。不是悬浮着等人来量，是站稳了，让量尺自己来。

---
*教训：脱离流者，不享流之度量。*
