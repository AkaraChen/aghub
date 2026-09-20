use std::borrow::Cow;

use gpui_kit::App;

pub const INSTRUMENT_SERIF: &str = "Instrument Serif";

pub fn init(cx: &App) {
	cx.text_system()
		.add_fonts(vec![
			Cow::Borrowed(include_bytes!(
				"../assets/fonts/AKRSansSCNFM-Regular.ttf"
			)),
			Cow::Borrowed(include_bytes!(
				"../assets/fonts/AKRSansSCNFM-Bold.ttf"
			)),
			Cow::Borrowed(include_bytes!(
				"../assets/fonts/InstrumentSerif-Regular.ttf"
			)),
		])
		.expect("load app fonts");
}
