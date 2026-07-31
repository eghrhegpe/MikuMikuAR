import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'

// 扩展默认主题：仅替换 Layout 以注入侧栏常驻逻辑，其余全部沿用默认主题。
export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme
