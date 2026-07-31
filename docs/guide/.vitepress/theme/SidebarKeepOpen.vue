<script setup lang="ts">
import { useRoute } from 'vitepress'
import { watch } from 'vue'

const route = useRoute()

// 与默认主题同一断点（is960 = min-width: 960px）：仅移动端侧栏为覆盖层，需要此逻辑；
// 桌面端侧栏常驻，不干预。
const isMobileSidebarMode = () =>
  !window.matchMedia('(min-width: 960px)').matches

// 默认主题 Layout.vue 在 setup 中注册了 watch(route.path, closeSidebar)，
// 每次切页都会强制收起移动端侧栏——连续翻阅多篇文档时每页都得重开汉堡菜单。
//
// 本组件挂载为默认 Layout 的子组件（layout-bottom 插槽），watcher 注册在其后、
// 触发也在其后：同一 tick 内先检查「导航前侧栏是否开着」（此刻 DOM 尚未更新，
// .VPSidebar 仍保留 .open 类），若开着则重新点击 Menu 按钮抵消默认主题的关闭。
// isOpen 在同一次 flush 内 false→true，屏幕无闪烁、无过渡动画回放。
//
// 用户手动点遮罩关闭时，.open 类已不存在，此处不干预——尊重用户意图：
// 「开着就保持开，关了就保持关」，禁止的只是 VitePress 的自动折叠。
watch(
  () => route.path,
  () => {
    if (!isMobileSidebarMode()) return
    const wasOpen = document
      .querySelector('.VPSidebar')
      ?.classList.contains('open')
    if (!wasOpen) return
    document.querySelector<HTMLButtonElement>('.VPLocalNav .menu')?.click()
  }
)
</script>

<template>
  <!-- 纯逻辑组件，无 UI -->
</template>
