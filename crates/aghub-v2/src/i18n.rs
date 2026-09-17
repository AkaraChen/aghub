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

	#[test]
	fn maps_os_locale_to_english_or_chinese() {
		assert_eq!(locale_from_tag(Some("en-US")), "en");
		assert_eq!(locale_from_tag(Some("zh-CN")), "zh-CN");
	}
}
