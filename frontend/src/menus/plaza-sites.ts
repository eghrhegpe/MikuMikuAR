export interface PlazaSite {
    name: string;
    url: string;
    /** embed = 免登录展示站（内嵌反向代理浏览）；external = 需登录 SPA（系统浏览器打开） */
    mode: 'embed' | 'external';
    icon?: string;
}

// 首版占位站点。embed 站走 Go 反向代理内嵌 iframe（剥离 X-Frame / CSP）；
// external 站用系统浏览器打开，保留登录态，其下载由 ADR-003 方案 C 的
// fsnotify 监听 Downloads/MMDHub_Inbox 落库。后续可下沉到 Go config 做用户配置。
export const PLAZA_SITES: PlazaSite[] = [
    { name: 'Pixiv', url: 'https://www.pixiv.net/', mode: 'embed', icon: 'lucide:image' },
    { name: 'Booth', url: 'https://booth.pm/', mode: 'embed', icon: 'lucide:shopping-bag' },
    { name: 'GitHub', url: 'https://github.com/', mode: 'embed', icon: 'lucide:github' },
    { name: '模之屋', url: 'https://www.aplaybox.com/', mode: 'external', icon: 'lucide:box' },
];
