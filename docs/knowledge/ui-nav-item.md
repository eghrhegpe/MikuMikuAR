---
tier: leaf
kind: ui_nav_item
name: 菜单导航项契约
category: core
scope:
  - frontend/src/core
source_files:
  - frontend/src/core/ui-nav-item.ts
adr:
  - ADR-153
symbols:
  - NAV_ITEM_ATTR
  - NAV_FOCUS_ATTR
  - NAV_ADJUST_ATTR
  - NAV_GROUP_ATTR
  - NAV_ITEM_SELECTOR
  - NavItemOptions
  - markNavItem
  - navFocusTarget
  - navHasHorizontalAdjust
  - navGroupSelector
  - navGroupMove
invariants:
  - 控件工厂在创建行后调用 markNavItem 一次即可，无需改 menu.ts
  - 组行（设 groupSelector）自动隐含 horizontalAdjust，←→ 让组内 roving
  - navGroupMove 在组内子项间循环移动焦点（mod 循环），不冒泡
  - 所有工具函数只读查询行属性，不修改 DOM 结构
tests: []
use_when:
  - 方向键导航
  - 键盘导航
  - 菜单控件
  - nav-item
---

# 菜单导航项契约
