export interface PlazaSite {
    name: string;
    url: string;
    /**
     * embed = 免登录展示站（Go 反向代理内嵌 iframe）
     * external = 需登录 / 强反爬（Wails 窗口 / 系统浏览器）
     */
    mode: 'embed' | 'external';
    icon?: string;
    desc?: string;
}

// MMD/PMX 模型资源站列表。
// embed 站走 Go 反向代理内嵌（剥离 X-Frame / CSP frame-ancestors + Cookie 中继）；
// external 站走 Wails 窗口或系统浏览器，保留完整登录态与防盗链上下文。
// 下载由 ADR-003 方案 C 的 fsnotify 监听落库，两条路在「落库」处会师。
// 参考 ysm-model-manager/workshop_sites.json。
export const PLAZA_SITES: PlazaSite[] = [
    {
        name: '模之屋',
        url: 'https://www.aplaybox.com/',
        mode: 'external',
        icon: 'lucide:box',
        desc: 'MMD/VRC 模型分享平台',
    },
    {
        name: 'BOOTH',
        url: 'https://booth.pm/zh-cn/browse/3D%20Models',
        mode: 'external',
        icon: 'lucide:shopping-bag',
        desc: '同人 3D 模型通贩市场',
    },
    {
        name: 'Bowlroll',
        url: 'https://bowlroll.net/',
        mode: 'embed',
        icon: 'lucide:package',
        desc: '日系老牌 MMD 模型仓库',
    },
    {
        name: 'NicoNico 3D',
        url: 'https://3d.nicovideo.jp/',
        mode: 'embed',
        icon: 'lucide:video',
        desc: '日系 3D 模型站，5000+ MMD/VRM',
    },
    {
        name: 'VRoid Hub',
        url: 'https://hub.vroid.com/',
        mode: 'external',
        icon: 'lucide:bot',
        desc: 'VRM 角色模型市场',
    },
    {
        name: 'DeviantArt',
        url: 'https://www.deviantart.com/',
        mode: 'external',
        icon: 'lucide:palette',
        desc: '海外 FBX/XPS 模型',
    },
];
