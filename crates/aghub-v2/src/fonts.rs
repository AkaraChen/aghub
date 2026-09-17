use std::borrow::Cow;

use gpui_kit::App;

pub const INSTRUMENT_SERIF: &str = "Instrument Serif";

pub fn init(cx: &App) {
	cx.text_system()
		.add_fonts(vec![Cow::Borrowed(include_bytes!(
			"../assets/fonts/InstrumentSerif-Regular.ttf"
		))])
		.expect("load Instrument Serif");
}
