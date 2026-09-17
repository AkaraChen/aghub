const FALLBACK: &str = "en";
const CHINESE: &str = "zh-CN";

/// Apply the OS language to both app copy and GPUI Kit components.
pub fn init() {
	rust_i18n::set_locale(locale_from_tag(sys_locale::get_locale().as_deref()));
}

/// Map a BCP-47 tag onto the locales this app actually ships.
fn locale_from_tag(tag: Option<&str>) -> &'static str {
	match tag {
		Some(tag) if is_chinese(tag) => CHINESE,
		_ => FALLBACK,
	}
}

fn is_chinese(tag: &str) -> bool {
	let primary = tag.split(['-', '_']).next().unwrap_or(tag);
	primary.eq_ignore_ascii_case("zh")
}

#[cfg(test)]
mod tests {
	use super::*;
	use rust_i18n::t;

	#[test]
	fn unknown_or_missing_tags_use_english() {
		assert_eq!(locale_from_tag(None), "en");
		assert_eq!(locale_from_tag(Some("")), "en");
		assert_eq!(locale_from_tag(Some("en")), "en");
		assert_eq!(locale_from_tag(Some("en-US")), "en");
		assert_eq!(locale_from_tag(Some("ja-JP")), "en");
		assert_eq!(locale_from_tag(Some("fr")), "en");
	}

	#[test]
	fn any_chinese_tag_uses_simplified_chinese() {
		assert_eq!(locale_from_tag(Some("zh")), "zh-CN");
		assert_eq!(locale_from_tag(Some("zh-CN")), "zh-CN");
		assert_eq!(locale_from_tag(Some("zh-Hans-CN")), "zh-CN");
		assert_eq!(locale_from_tag(Some("zh_CN")), "zh-CN");
		assert_eq!(locale_from_tag(Some("zh-TW")), "zh-CN");
		assert_eq!(locale_from_tag(Some("zh-HK")), "zh-CN");
		assert_eq!(locale_from_tag(Some("ZH-cn")), "zh-CN");
	}

	#[test]
	fn nav_copy_follows_locale_and_falls_back_to_english() {
		assert_eq!(t!("nav.home", locale = "en"), "Home");
		assert_eq!(t!("nav.home", locale = "zh-CN"), "主页");
		assert_eq!(t!("nav.plugins", locale = "zh-CN"), "插件");
		assert_eq!(t!("nav.manage", locale = "zh-CN"), "管理");
		assert_eq!(t!("nav.settings", locale = "zh-CN"), "设置");
		assert_eq!(t!("nav.home", locale = "fr"), "Home");
	}
}
