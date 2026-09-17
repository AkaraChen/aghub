use gpui_kit::component::{Theme, ThemeRegistry};
use gpui_kit::*;

const THEMES: &str = include_str!("../themes/aghub.json");

pub fn init(cx: &mut App) {
	ThemeRegistry::global_mut(cx)
		.load_themes_from_str(THEMES)
		.expect("failed to load Aghub theme");

	let (light, dark) = {
		let registry = ThemeRegistry::global(cx);
		(
			registry
				.themes()
				.get("Aghub Light")
				.cloned()
				.expect("Aghub Light theme"),
			registry
				.themes()
				.get("Aghub Dark")
				.cloned()
				.expect("Aghub Dark theme"),
		)
	};

	let theme = Theme::global_mut(cx);
	theme.light_theme = light;
	theme.dark_theme = dark;
	Theme::sync_system_appearance(None, cx);
}
