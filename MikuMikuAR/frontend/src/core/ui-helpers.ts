// [doc:architecture] UI Helpers — 通用 DOM 构建函数
// 从 scene-menu.ts 和 model-detail.ts 提取的统一版本

import { createIconifyIcon } from "./icons";

export function slideRow(container: HTMLElement, icon: string, label: string, hasArrow: boolean, onClick: () => void): void {
  const row = document.createElement("div");
  row.className = "slide-item";
  row.innerHTML = `<span class="slide-icon"><iconify-icon icon="${icon}"></iconify-icon></span><span class="slide-label">${label}</span>${hasArrow ? '<span class="slide-arrow">&gt;</span>' : ''}`;
  row.addEventListener("click", onClick);
  container.appendChild(row);
}

export function addToggleRow(container: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:10px;justify-content:space-between;";
  const lbl = document.createElement("span");
  lbl.style.cssText = "font-size:11px;color:var(--text-dim);";
  lbl.textContent = label;
  const toggleLabel = document.createElement("label");
  toggleLabel.className = "toggle";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = value;
  toggle.addEventListener("change", () => onChange(toggle.checked));
  const slider = document.createElement("span");
  slider.className = "slider";
  toggleLabel.appendChild(toggle);
  toggleLabel.appendChild(slider);
  row.appendChild(lbl);
  row.appendChild(toggleLabel);
  container.appendChild(row);
}

export function addSliderRow(container: HTMLElement, label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, icon?: string): void {
  let currentValue = value;
  const range = max - min;

  const row = document.createElement("div");
  row.className = "cs-row";

  const top = document.createElement("div");
  top.className = "cs-top";

  if (icon) {
    const iconBox = document.createElement("span");
    iconBox.className = "cs-icon";
    const iconEl = createIconifyIcon(icon);
    if (iconEl) iconBox.appendChild(iconEl);
    top.appendChild(iconBox);
  }

  const lbl = document.createElement("span");
  lbl.className = "cs-label";
  lbl.textContent = label;

  const val = document.createElement("span");
  val.className = "cs-value";
  val.textContent = step < 1 ? currentValue.toFixed(2) : String(Math.round(currentValue));

  top.appendChild(lbl);
  top.appendChild(val);

  const bar = document.createElement("div");
  bar.className = "cs-bar";

  const fill = document.createElement("div");
  fill.className = "cs-fill";
  const pct = ((currentValue - min) / range) * 100;
  fill.style.width = Math.max(0, Math.min(100, pct)) + "%";

  bar.appendChild(fill);

  function updateDisplay(v: number): void {
    currentValue = v;
    val.textContent = step < 1 ? v.toFixed(2) : String(Math.round(v));
    const newPct = ((v - min) / range) * 100;
    fill.style.width = Math.max(0, Math.min(100, newPct)) + "%";
  }

  row.addEventListener("click", (e) => {
    const rect = row.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    let delta: number;
    if (x < 0.25) delta = -0.5;
    else if (x < 0.5) delta = -0.1;
    else if (x < 0.75) delta = 0.1;
    else delta = 0.5;

    let newVal = currentValue + delta;
    newVal = Math.round(newVal / step) * step;
    newVal = Math.max(min, Math.min(max, newVal));

    updateDisplay(newVal);
    onChange(newVal);
  });

  row.appendChild(top);
  row.appendChild(bar);
  container.appendChild(row);
}

export function addModeRow<T extends string | number>(
  container: HTMLElement,
  label: string,
  options: Array<{ value: T; label: string }>,
  currentValue: T,
  onChange: (v: T) => void
): void {
  const row = document.createElement("div");
  row.className = "type-row";
  const lbl = document.createElement("span");
  lbl.className = "type-label";
  lbl.textContent = label;
  row.appendChild(lbl);
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.textContent = opt.label;
    btn.className = "mode-btn" + (currentValue === opt.value ? " active" : "");
    btn.addEventListener("click", () => onChange(opt.value));
    row.appendChild(btn);
  }
  container.appendChild(row);
}

export function addColorSliderRow(
  container: HTMLElement,
  label: string,
  color: [number, number, number],
  onChange: (v: [number, number, number]) => void
): void {
  const block = document.createElement("div");
  block.className = "clr-block";
  const header = document.createElement("div");
  header.className = "clr-header";
  const title = document.createElement("span");
  title.className = "clr-title";
  title.textContent = label;
  header.appendChild(title);
  const swatch = document.createElement("span");
  swatch.className = "clr-swatch";
  swatch.style.background = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
  header.appendChild(swatch);
  block.appendChild(header);
  const channelColors = ["#f66", "#6f6", "#66f"];
  const current: [number, number, number] = [color[0], color[1], color[2]];
  for (let ci = 0; ci < 3; ci++) {
    const sub = document.createElement("div");
    sub.className = "clr-row";
    const ch = document.createElement("span");
    ch.className = "clr-channel";
    ch.style.color = channelColors[ci];
    ch.textContent = ["R", "G", "B"][ci];
    sub.appendChild(ch);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    slider.value = String(color[ci]);
    slider.className = "clr-slider";
    const val = document.createElement("span");
    val.className = "clr-value";
    val.textContent = color[ci].toFixed(2);
    slider.addEventListener("input", () => {
      const v = parseFloat(slider.value);
      val.textContent = v.toFixed(2);
      current[ci] = v;
      swatch.style.background = `rgb(${Math.round(current[0] * 255)},${Math.round(current[1] * 255)},${Math.round(current[2] * 255)})`;
      onChange([current[0], current[1], current[2]]);
    });
    sub.appendChild(slider);
    sub.appendChild(val);
    block.appendChild(sub);
  }
  container.appendChild(block);
}

export function addModeSlider<T extends string | number>(
  container: HTMLElement,
  label: string,
  options: Array<{ value: T; label: string }>,
  currentValue: T,
  onChange: (v: T) => void,
  icon?: string
): void {
  const total = options.length;
  if (total === 0) return;

  let currentIndex = options.findIndex(o => o.value === currentValue);
  if (currentIndex < 0) currentIndex = 0;

  const row = document.createElement("div");
  row.className = "cs-row";

  const top = document.createElement("div");
  top.className = "cs-top";

  if (icon) {
    const iconBox = document.createElement("span");
    iconBox.className = "cs-icon";
    const iconEl = createIconifyIcon(icon);
    if (iconEl) iconBox.appendChild(iconEl);
    top.appendChild(iconBox);
  }

  const lbl = document.createElement("span");
  lbl.className = "cs-label";
  lbl.textContent = label;

  const val = document.createElement("span");
  val.className = "cs-value";
  val.textContent = options[currentIndex].label;

  top.appendChild(lbl);
  top.appendChild(val);

  const bar = document.createElement("div");
  bar.className = "cs-bar";

  const fill = document.createElement("div");
  fill.className = "cs-fill";
  const pct = total > 1 ? (currentIndex / (total - 1)) * 100 : 100;
  fill.style.width = Math.max(0, Math.min(100, pct)) + "%";

  bar.appendChild(fill);

  function updateDisplay(idx: number): void {
    currentIndex = idx;
    val.textContent = options[idx].label;
    const newPct = total > 1 ? (idx / (total - 1)) * 100 : 100;
    fill.style.width = Math.max(0, Math.min(100, newPct)) + "%";
  }

  row.addEventListener("click", (e) => {
    const rect = row.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;

    let newIdx: number;
    if (x < 0.25) newIdx = 0;
    else if (x < 0.5) newIdx = Math.max(0, currentIndex - 1);
    else if (x < 0.75) newIdx = Math.min(total - 1, currentIndex + 1);
    else newIdx = total - 1;

    if (newIdx !== currentIndex) {
      updateDisplay(newIdx);
      onChange(options[newIdx].value);
    }
  });

  row.appendChild(top);
  row.appendChild(bar);
  container.appendChild(row);
}
