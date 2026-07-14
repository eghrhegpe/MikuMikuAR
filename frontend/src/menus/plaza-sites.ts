export interface PlazaSite {
    id: string;
    name: string;
    url: string;
    /**
     * embed = 免登录展示站（Go 反向代理内嵌 iframe）
     * external = 需登录 / 强反爬（Wails 窗口 / 系统浏览器）
     */
    mode: 'embed' | 'external';
    icon?: string;
    desc?: string;
    group?: string;
    searchUrl?: string;
    presetSearches?: { label: string; q: string }[];
}

// MMD/PMX 模型资源站列表。
// embed 站走 Go 反向代理内嵌（剥离 X-Frame / CSP frame-ancestors + Cookie 中继）；
// external 站走 Wails 窗口或系统浏览器，保留完整登录态与防盗链上下文。
// 下载由 ADR-003 方案 C 的 fsnotify 监听落库，两条路在「落库」处会师。
// 参考 ysm-model-manager/workshop_sites.json。
export const PLAZA_SITES: PlazaSite[] = [
    {
        id: 'mzhouse',
        name: '模之屋',
        url: 'https://www.aplaybox.com/',
        mode: 'external',
        icon: 'lucide:box',
        desc: 'MMD/VRC 模型分享平台',
        group: 'search',
        searchUrl: 'https://www.aplaybox.com/search?value={{q}}',
        presetSearches: [
            { label: '碧蓝档案', q: '' },
            { label: '碧蓝航线', q: '' },
            { label: '崩坏3', q: '' },
            { label: '赛马娘', q: '' },
            { label: '明日方舟', q: '' },
            { label: '东方Project', q: '' },
            { label: 'MMD模型配布', q: '' },
        ],
    },
    {
        id: 'booth',
        name: 'BOOTH',
        url: 'https://booth.pm/zh-cn/browse/3D%20Models',
        mode: 'external',
        icon: 'lucide:shopping-bag',
        desc: '同人 3D 模型通贩市场，25万+ 作品',
        group: 'search',
        searchUrl: 'https://booth.pm/zh-cn/search/{{q}}',
        presetSearches: [{ label: '３Dモデル', q: '' }],
    },
    {
        id: 'bowlroll',
        name: 'Bowlroll',
        url: 'https://bowlroll.net/',
        mode: 'embed',
        icon: 'lucide:package',
        desc: '日系老牌 MMD 模型仓库',
        group: 'search',
        searchUrl: 'https://bowlroll.net/file/keyword/{{q}}',
        presetSearches: [
            { label: '热门日系模型', q: 'MMD' },
            { label: 'VRChat 模型', q: 'VRChat' },
            { label: '东方 Project', q: '東方' },
            { label: 'VOCALOID', q: 'VOCALOID' },
        ],
    },
    {
        id: 'nicovideo',
        name: 'NicoNico 3D',
        url: 'https://3d.nicovideo.jp/',
        mode: 'embed',
        icon: 'lucide:video',
        desc: '日系 3D 模型站，5000+ MMD/VRM',
        group: 'search',
        searchUrl: 'https://3d.nicovideo.jp/works/search?keyword={{q}}',
        presetSearches: [
            { label: 'VTuber', q: '' },
            { label: 'MMD', q: '' },
            { label: 'VRM', q: '' },
        ],
    },
    {
        id: 'vroid',
        name: 'VRoid Hub',
        url: 'https://hub.vroid.com/',
        mode: 'external',
        icon: 'lucide:bot',
        desc: 'VRM 角色模型市场',
        group: 'search',
        searchUrl: 'https://hub.vroid.com/en/search/{{q}}',
        presetSearches: [
            { label: 'VRChat', q: '' },
            { label: 'MMD', q: '' },
            { label: 'VTuber', q: '' },
        ],
    },
    {
        id: 'deviantart',
        name: 'DeviantArt',
        url: 'https://www.deviantart.com/',
        mode: 'external',
        icon: 'lucide:palette',
        desc: '海外 FBX/XPS 模型',
        group: 'search',
        searchUrl: 'https://www.deviantart.com/search?q={{q}}',
        presetSearches: [
            { label: 'MMD', q: '' },
            { label: 'fbx', q: '' },
        ],
    },
];
