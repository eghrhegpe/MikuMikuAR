export namespace main {
	
	export class EnvState {
	    skyMode: string;
	    skyColorTop: number[];
	    skyColorMid: number[];
	    skyColorBot: number[];
	    skyTexture: string;
	    skyRotationY: number;
	    skyBrightness: number;
	    envIntensity: number;
	    groundVisible: boolean;
	    groundMode: string;
	    groundColor: number[];
	    groundAlpha: number;
	    windEnabled: boolean;
	    windDirection: number[];
	    windSpeed: number;
	    particleEnabled: boolean;
	    particleType: string;
	    cloudsEnabled: boolean;
	    cloudCover: number;
	    cloudScale: number;
	    fogEnabled: boolean;
	    fogColor: number[];
	    fogDensity: number;
	
	    static createFrom(source: any = {}) {
	        return new EnvState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.skyMode = source["skyMode"];
	        this.skyColorTop = source["skyColorTop"];
	        this.skyColorMid = source["skyColorMid"];
	        this.skyColorBot = source["skyColorBot"];
	        this.skyTexture = source["skyTexture"];
	        this.skyRotationY = source["skyRotationY"];
	        this.skyBrightness = source["skyBrightness"];
	        this.envIntensity = source["envIntensity"];
	        this.groundVisible = source["groundVisible"];
	        this.groundMode = source["groundMode"];
	        this.groundColor = source["groundColor"];
	        this.groundAlpha = source["groundAlpha"];
	        this.windEnabled = source["windEnabled"];
	        this.windDirection = source["windDirection"];
	        this.windSpeed = source["windSpeed"];
	        this.particleEnabled = source["particleEnabled"];
	        this.particleType = source["particleType"];
	        this.cloudsEnabled = source["cloudsEnabled"];
	        this.cloudCover = source["cloudCover"];
	        this.cloudScale = source["cloudScale"];
	        this.fogEnabled = source["fogEnabled"];
	        this.fogColor = source["fogColor"];
	        this.fogDensity = source["fogDensity"];
	    }
	}
	export class DanceSet {
	    name: string;
	    vmd_path: string;
	    audio_path: string;
	    audio_offset: number;
	    description: string;
	    thumbnail: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new DanceSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.vmd_path = source["vmd_path"];
	        this.audio_path = source["audio_path"];
	        this.audio_offset = source["audio_offset"];
	        this.description = source["description"];
	        this.thumbnail = source["thumbnail"];
	        this.source = source["source"];
	    }
	}
	export class SoftwareEntry {
	    name: string;
	    path: string;
	    kind: string;
	    args: string;
	    managed: boolean;
	    icon: string;
	
	    static createFrom(source: any = {}) {
	        return new SoftwareEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.kind = source["kind"];
	        this.args = source["args"];
	        this.managed = source["managed"];
	        this.icon = source["icon"];
	    }
	}
	export class RenderPreset {
	    name: string;
	    params: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new RenderPreset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.params = source["params"];
	    }
	}
	export class ExternalPath {
	    path: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ExternalPath(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	    }
	}
	export class UIState {
	    scale: number;
	    popupWidth: number;
	    accent: string;
	    fontFamily: string;
	    animations: boolean;
	    blurBg: boolean;
	
	    static createFrom(source: any = {}) {
	        return new UIState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scale = source["scale"];
	        this.popupWidth = source["popupWidth"];
	        this.accent = source["accent"];
	        this.fontFamily = source["fontFamily"];
	        this.animations = source["animations"];
	        this.blurBg = source["blurBg"];
	    }
	}
	export class Config {
	    ui_state: UIState;
	    library_root: string;
	    external_paths: ExternalPath[];
	    blender_path: string;
	    display_name_priority: string;
	    download_watch_dir: string;
	    download_auto_import: boolean;
	    favorites: string[];
	    render_presets: RenderPreset[];
	    mmd_path: string;
	    custom_software: SoftwareEntry[];
	    tags: Record<string, Array<string>>;
	    dance_sets: Record<string, DanceSet>;
	    recent_models: string[];
	    env?: EnvState;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ui_state = this.convertValues(source["ui_state"], UIState);
	        this.library_root = source["library_root"];
	        this.external_paths = this.convertValues(source["external_paths"], ExternalPath);
	        this.blender_path = source["blender_path"];
	        this.display_name_priority = source["display_name_priority"];
	        this.download_watch_dir = source["download_watch_dir"];
	        this.download_auto_import = source["download_auto_import"];
	        this.favorites = source["favorites"];
	        this.render_presets = this.convertValues(source["render_presets"], RenderPreset);
	        this.mmd_path = source["mmd_path"];
	        this.custom_software = this.convertValues(source["custom_software"], SoftwareEntry);
	        this.tags = source["tags"];
	        this.dance_sets = this.convertValues(source["dance_sets"], DanceSet, true);
	        this.recent_models = source["recent_models"];
	        this.env = this.convertValues(source["env"], EnvState);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class ExtractResult {
	    file_path: string;
	    dir: string;
	    cached: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ExtractResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file_path = source["file_path"];
	        this.dir = source["dir"];
	        this.cached = source["cached"];
	    }
	}
	export class ModelEntry {
	    dir: string;
	    file_path: string;
	    name_jp: string;
	    name_en: string;
	    comment: string;
	    has_thumb: boolean;
	    type: string;
	    format: string;
	    container: string;
	    zip_inner: string;
	    category: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.file_path = source["file_path"];
	        this.name_jp = source["name_jp"];
	        this.name_en = source["name_en"];
	        this.comment = source["comment"];
	        this.has_thumb = source["has_thumb"];
	        this.type = source["type"];
	        this.format = source["format"];
	        this.container = source["container"];
	        this.zip_inner = source["zip_inner"];
	        this.category = source["category"];
	        this.source = source["source"];
	    }
	}
	export class ModelMeta {
	    name_jp: string;
	    name_en: string;
	    comment: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name_jp = source["name_jp"];
	        this.name_en = source["name_en"];
	        this.comment = source["comment"];
	    }
	}
	
	

}

