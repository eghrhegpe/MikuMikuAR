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
