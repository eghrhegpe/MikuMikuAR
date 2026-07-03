package app

// ======== Tag System ========

// AddTag adds a tag to a model identified by its libraryRef.
func (a *App) AddTag(libraryRef, tag string) error {
	return a.updateConfig(func(cfg *Config) {
		if cfg.Tags == nil {
			cfg.Tags = make(map[string][]string)
		}
		tags := cfg.Tags[libraryRef]
		for _, t := range tags {
			if t == tag {
				return // already exists
			}
		}
		cfg.Tags[libraryRef] = append(tags, tag)
	}, false)
}

// RemoveTag removes a tag from a model.
func (a *App) RemoveTag(libraryRef, tag string) error {
	return a.updateConfig(func(cfg *Config) {
		tags := cfg.Tags[libraryRef]
		var kept []string
		for _, t := range tags {
			if t != tag {
				kept = append(kept, t)
			}
		}
		if len(kept) == 0 {
			delete(cfg.Tags, libraryRef)
		} else {
			cfg.Tags[libraryRef] = kept
		}
	}, false)
}

// GetTagsByModel returns the tags for a specific model.
func (a *App) GetTagsByModel(libraryRef string) []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.Tags == nil {
		return nil
	}
	return cfg.Tags[libraryRef]
}

// GetAllTags returns a deduplicated list of all tags across all models.
func (a *App) GetAllTags() []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.Tags == nil {
		return nil
	}
	seen := make(map[string]bool)
	var result []string
	for _, tags := range cfg.Tags {
		for _, t := range tags {
			if !seen[t] {
				seen[t] = true
				result = append(result, t)
			}
		}
	}
	return result
}

// GetModelsByTag returns all libraryRefs that have a specific tag.
func (a *App) GetModelsByTag(tag string) []string {
	cfg, err := a.GetConfig()
	if err != nil || cfg == nil || cfg.Tags == nil {
		return nil
	}
	var result []string
	for ref, tags := range cfg.Tags {
		for _, t := range tags {
			if t == tag {
				result = append(result, ref)
				break
			}
		}
	}
	return result
}
