<script setup lang="ts">
import { useRoute } from 'vitepress'
import { onMounted, onUnmounted, watch } from 'vue'

const route = useRoute()

// 与默认主题同一断点（is960 = min-width: 960px）：仅移动端侧栏为覆盖层，需要此逻辑；
// 桌面端侧栏常驻，不干预。
const isMobileSidebarMode = () =>
  !window.matchMedia('(min-width: 960px)').matches

// 默认主题 Layout.vue 注册了 watch(route.path, closeSidebar)，每次切页强制收起移动端侧栏，
// 连续翻阅多篇文档时每页都得重开汉堡菜单。本组件负责抵消这一自动折叠。
//
// 「导航前侧栏是否开着」不能靠 route watcher 里查 DOM 的 .open 类——切页渲染
// 可能先于本 watcher 执行、已把 .open 移除，导致误判为「本来就关着」。
// 可靠信号是：点击侧栏内链接这一动作本身（捕获阶段，早于一切路由/响应式链路）
// 就证明侧栏当时是开着的。记下这一事实，route 变化时据此重开。
//
// 用户手动点遮罩关闭时不会触发侧栏链接点击，标记保持 false——尊重用户意图：
// 「开着就保持开，关了就保持关」，禁止的只是 VitePress 的自动折叠。
let sidebarLinkClicked = false

function onDocClick(e: MouseEvent) {
  const target = e.target as Element | null
  if (target?.closest('.VPSidebar a')) {
    sidebarLinkClicked = true
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick, true)
})

watch(
  () => route.path,
  () => {
    if (!isMobileSidebarMode()) return
    if (!sidebarLinkClicked) return
    sidebarLinkClicked = false
    // 重新点击 Menu 按钮，抵消默认主题的关页收起
    document.querySelector<HTMLButtonElement>('.VPLocalNav .menu')?.click()
  }
)
</script>

<template>
  <!-- 纯逻辑组件，无 UI -->
</template>
