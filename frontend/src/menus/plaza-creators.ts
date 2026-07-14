export interface PlazaCreator {
    name: string;
    desc: string;
    tag: 'official' | 'creator' | 'vup' | 'oc';
    tier?: 'gold' | 'silver';
    /** 所属站点 id，用于按 tab 过滤 */
    site: string;
}

export const PLAZA_CREATORS: PlazaCreator[] = [
    // ── gold tier: 官方IP ──
    { name: '原神', desc: '官方模型、古风原型、现代换装', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '崩坏：星穹铁道', desc: '官方模型、古风礼服、现代制服', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '绝区零', desc: '官方模型、城市时尚', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '鸣潮', desc: '官方模型、早期修女服、旗袍', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '少女前线', desc: '官方模型、经典战术制服', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '异环', desc: '官方模型、城市休闲', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '卡拉彼丘', desc: '官方模型、露背礼服', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '华硕主板', desc: '官方模型、运动时尚', tag: 'official', tier: 'gold', site: 'mzhouse' },
    { name: '无限大', desc: '官方模型、城市探险', tag: 'official', tier: 'gold', site: 'mzhouse' },
    // ── silver tier: 官方IP ──
    { name: '战双帕弥什', desc: '官方模型、战斗装、休闲装', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '尘白禁区', desc: '官方模型、建模精美', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '幻塔', desc: '官方模型、学姐风格', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '深空之眼', desc: '官方模型、飘动服饰', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '交错战线', desc: '官方模型、黑色胶衣作战服', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '锚点降临', desc: '官方模型、露背超短裙', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '二重螺旋', desc: '官方模型、古风服饰', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '千年之旅', desc: '官方模型、泳装设计', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '依露希尔', desc: '官方模型、泳装设计', tag: 'official', tier: 'silver', site: 'mzhouse' },
    { name: '少女前线2：追放', desc: '官方模型、近未来战术', tag: 'official', tier: 'silver', site: 'mzhouse' },
    // ── vup ──
    { name: '冰糖', desc: 'VUP个人势虚拟主播', tag: 'vup', tier: 'silver', site: 'mzhouse' },
    { name: '東雪蓮', desc: 'VUP个人势虚拟主播', tag: 'vup', tier: 'silver', site: 'mzhouse' },
    { name: '泠鸢yousa', desc: 'VUP、临时映画', tag: 'vup', site: 'mzhouse' },
    { name: '嘉然', desc: 'A-SOUL女团VUP', tag: 'vup', site: 'mzhouse' },
    { name: '兰音', desc: '虚研社VUP、模型精致', tag: 'vup', site: 'mzhouse' },
    { name: '七海NANA', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '早稻叽', desc: 'ChaosLive VUP', tag: 'vup', site: 'mzhouse' },
    { name: '胡桃Usa', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '古堡龙姬', desc: 'CS:GO国服VUP', tag: 'vup', site: 'mzhouse' },
    { name: '咩栗', desc: 'MeUmy VUP', tag: 'vup', site: 'mzhouse' },
    { name: '诗乃鲤', desc: '乐园企划VUP', tag: 'vup', site: 'mzhouse' },
    { name: '幽刹', desc: '乐园企划VUP', tag: 'vup', site: 'mzhouse' },
    { name: '名乃_NAN0', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '雫るる', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '星宮Chino', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '雪狐桑', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '千铃SR', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '新月冰冰', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '青井葵aoi', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '小铃久绘', desc: 'VUP个人势', tag: 'vup', site: 'mzhouse' },
    { name: '相星澪', desc: '彩星社VUP', tag: 'vup', site: 'mzhouse' },
    { name: '四禧丸子', desc: 'VUP团体势', tag: 'vup', site: 'mzhouse' },
    { name: '星律动', desc: 'VUP团体势', tag: 'vup', site: 'mzhouse' },
    { name: 'psplive', desc: 'VUP团体势', tag: 'vup', site: 'mzhouse' },
    // ── official 其他 ──
    { name: '嗒啦啦', desc: 'TapTap VUP', tag: 'official', site: 'mzhouse' },
    { name: '音爆', desc: '晶核游戏', tag: 'official', site: 'mzhouse' },
    { name: '姵儿', desc: '模之屋官方模型', tag: 'official', site: 'mzhouse' },
    // ── creator ──
    { name: '一之濑志希', desc: '偶像大师', tag: 'creator', site: 'mzhouse' },
    // ── oc ──
    { name: 'Aika', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '克里斯提亚娜', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '刻', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '立花染', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '星千川', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '星月', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '荀异', desc: 'OC原创角色', tag: 'oc', site: 'mzhouse' },
    { name: '阎么么', desc: '原创角色模型', tag: 'oc', site: 'mzhouse' },
];
