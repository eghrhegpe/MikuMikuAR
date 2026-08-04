<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import SidebarKeepOpen from './SidebarKeepOpen.vue'
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-bottom>
      <!-- 渲染于 Layout 末尾：作为默认 Layout 的子组件注册 watcher，
           保证在默认主题的「切页关侧栏」watcher 之后触发 -->
      <SidebarKeepOpen />
    </template>
  </DefaultTheme.Layout>
</template>
