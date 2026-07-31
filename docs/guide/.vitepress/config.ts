import { defineConfig } from 'vitepress';

// 用户指南站（docs/guide）——部署于 GitHub Pages 子路径 /MikuMikuAR/guide/
// 主应用 web 入口保持根路径不动；本站产物由 web-pages.yml 拷入 dist-web/guide/。
export default defineConfig({
  // 子路径部署：与主应用 base=/MikuMikuAR/ 保持一致，仅追加 /guide/
  base: '/MikuMikuAR/guide/',
  lang: 'zh-CN',
  title: 'MikuMikuAR 用户指南',
  description: 'MikuMikuAR 功能使用手册：怎么打开、怎么操作、常见问题',
  // 内容源 = docs/guide/ 自身（README.md 保留给 GitHub 浏览，站点内排除）
  srcDir: '.',
  srcExclude: ['README.md'],
  // guide 页按规范刻意链接站外文档（docs/knowledge/ 等，AI 侧 md 不渲染进站），豁免死链检查
  ignoreDeadLinks: [/\.\.\/knowledge\//, /\.\.\/guide\//, /\.\.\/menu-how-to\.md$/],

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '功能指南', link: '/env-water' },
      { text: 'GitHub', link: 'https://github.com/eghrhegpe/MikuMikuAR' },
    ],
    sidebar: [
      {
        text: '功能指南',
        items: [{ text: '水面设置', link: '/env-water' }],
      },
    ],
    outline: { label: '本页导航', level: [2, 3] },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
  },
});
