export interface PlazaSite {
    id: string;
    name: string;
    url: string;
    mode: 'embed' | 'external';
    icon?: string;
    desc?: string;
    group?: string;
    searchUrl?: string;
    presetSearches?: { label: string; q?: string }[];
}

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
            { label: 'MMD模型配布', q: 'MMD' },
            { label: '原神', q: '原神' },
            { label: '崩坏：星穹铁道', q: '星穹铁道' },
            { label: '明日方舟', q: '明日方舟' },
            { label: '碧蓝档案', q: '碧蓝档案' },
            { label: '东方Project', q: '东方' },
        ],
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
        id: 'booth',
        name: 'BOOTH',
        url: 'https://booth.pm/zh-cn/browse/3D%20Models',
        mode: 'external',
        icon: 'lucide:shopping-bag',
        desc: '同人 3D 模型通贩市场',
        group: 'search',
        searchUrl: 'https://booth.pm/zh-cn/search/{{q}}',
        presetSearches: [
            { label: '3Dモデル', q: '3Dモデル' },
            { label: 'MMD', q: 'MMD' },
            { label: 'VRM', q: 'VRM' },
        ],
    },
];
