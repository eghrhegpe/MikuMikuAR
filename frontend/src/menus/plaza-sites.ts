export interface PlazaSite {
    name: string;
    url: string;
    /** embed = 免登录展示站（内嵌反向代理浏览）；external = 需登录 SPA（系统浏览器打开） */
    mode: 'embed' | 'external';
    icon?: string;
}

// 首版占位站点。
//  - external 站（登录态敏感 / 多 CDN + 防盗链，如 Pixiv/Booth/模之屋）：用系统
//    浏览器打开，保留登录态与防盗链上下文，其下载由 ADR-003 方案 C 的 fsnotify
//    监听 Downloads/MMDHub_Inbox 落库。
//  - embed 站（免登录、同域为主、无强防盗链，如 GitHub）：走 Go 反向代理内嵌
//    iframe（剥离 X-Frame / CSP frame-ancestors）。注意 StartProxy 是单目标代理
//    （proxyServerKey 复用端口），embed 站应保持「单一同域」；若要内嵌多个站，
//    需让 proxy.go 在 target 变化时重建代理。
// 后续可下沉到 Go config 做用户配置。
export const PLAZA_SITES: PlazaSite[] = [
    { name: 'GitHub', url: 'https://github.com/', mode: 'embed', icon: 'lucide:github' },
    { name: 'Pixiv', url: 'https://www.pixiv.net/', mode: 'external', icon: 'lucide:image' },
    { name: 'Booth', url: 'https://booth.pm/', mode: 'external', icon: 'lucide:shopping-bag' },
    { name: '模之屋', url: 'https://www.aplaybox.com/', mode: 'external', icon: 'lucide:box' },
];
