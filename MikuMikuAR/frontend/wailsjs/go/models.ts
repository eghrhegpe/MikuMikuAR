export namespace main {
	
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
	export class Config {
	    library_root: string;
	    external_paths: ExternalPath[];
	    blender_path: string;
	    display_name_priority: string;
	    download_watch_dir: string;
	    download_auto_import: boolean;
	    favorites: string[];
	    render_presets: RenderPreset[];
	    mmd_path: string;
	    tags: Record<string, Array<string>>;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.library_root = source["library_root"];
	        this.external_paths = this.convertValues(source["external_paths"], ExternalPath);
	        this.blender_path = source["blender_path"];
	        this.display_name_priority = source["display_name_priority"];
	        this.download_watch_dir = source["download_watch_dir"];
	        this.download_auto_import = source["download_auto_import"];
	        this.favorites = source["favorites"];
	        this.render_presets = this.convertValues(source["render_presets"], RenderPreset);
	        this.mmd_path = source["mmd_path"];
	        this.tags = source["tags"];
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
	
	export class SoftwareEntry {
	    name: string;
	    path: string;
	    icon: string;
	
	    static createFrom(source: any = {}) {
	        return new SoftwareEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.icon = source["icon"];
	    }
	}

}

