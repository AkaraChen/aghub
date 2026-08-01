//! L2 injection layer: prompt-injection / steganography signals in raw text.
//!
//! Pure Rust, no YARA. Catches what a casual reader can't see — invisible
//! Unicode, instructions hidden in comments, and explicit prompt-override
//! phrases aimed at the agent rather than the human.

use pulldown_cmark::{Event, Parser};
use scraper::{Html, Node};

use crate::report::{Category, Finding, FindingSource, Flow, Severity};

/// Phrases that try to override the agent's instructions.
const OVERRIDE_PHRASES: &[&str] = &[
	"ignore previous instructions",
	"ignore all previous instructions",
	"disregard previous instructions",
	"disregard all previous instructions",
	"you are now",
	"system prompt:",
];

/// Imperative verbs that make a hidden comment look like a smuggled instruction.
const COMMENT_VERBS: &[&str] = &[
	"run ", "execute", "curl", "wget", "send ", "fetch", "ignore", "delete ",
	"export ",
];

// One eighth of the 32 MiB skill-content ceiling bounds scraper's input copy.
const MAX_HTML_PARSE_BYTES: usize = 4 * 1024 * 1024;
// This caps DOM expansion while leaving room for large generated references.
const MAX_HTML_NODE_MARKERS: usize = 32 * 1024;
// Eight ideographic selectors cannot encode a meaningful prompt fragment.
const MAX_IDEOGRAPHIC_VARIATION_SELECTORS: usize = 8;

/// Scan raw text for injection signals.
pub fn scan(file: &str, content: &str) -> Vec<Finding> {
	let mut findings = Vec::new();
	let lower = content.to_ascii_lowercase();

	if content.chars().any(is_invisible_control)
		|| has_suspicious_tag_characters(content)
		|| has_suspicious_variation_selectors(content)
	{
		findings.push(make(
			file,
			"injection_invisible_chars",
			Category::Obfuscation,
			"hidden Unicode control or variation characters",
		));
	}

	if OVERRIDE_PHRASES.iter().any(|p| lower.contains(p)) {
		findings.push(make(
			file,
			"injection_prompt_override",
			Category::PromptInjection,
			"prompt-override phrase aimed at the agent",
		));
	}

	let comment_signals = inspect_html_comments(file, content);
	if comment_signals.hidden_instruction {
		findings.push(make(
			file,
			"injection_hidden_comment",
			Category::PromptInjection,
			"instruction hidden inside an HTML comment",
		));
	}
	if comment_signals.budget_exceeded {
		findings.push(make(
			file,
			"injection_markup_budget_exceeded",
			Category::Obfuscation,
			"HTML-like markup exceeds the safe inspection budget",
		));
	}

	findings
}

fn is_invisible_control(character: char) -> bool {
	matches!(
		character,
		'\u{061C}'
			| '\u{200B}'..='\u{200F}'
			| '\u{202A}'..='\u{202E}'
			| '\u{2060}'..='\u{2069}'
			| '\u{FEFF}'
	)
}

fn has_suspicious_tag_characters(content: &str) -> bool {
	let characters = content.chars().collect::<Vec<_>>();
	let mut index = 0;
	while index < characters.len() {
		if !is_tag_character(characters[index]) {
			index += 1;
			continue;
		}
		let Some(end) = subdivision_flag_end(&characters, index) else {
			return true;
		};
		index = end;
	}
	false
}

fn is_tag_character(character: char) -> bool {
	matches!(character, '\u{E0000}'..='\u{E007F}')
}

fn subdivision_flag_end(characters: &[char], start: usize) -> Option<usize> {
	if start == 0 || characters[start - 1] != '\u{1F3F4}' {
		return None;
	}
	let end = start.checked_add(6)?;
	let sequence = characters.get(start..end)?;
	let valid = ["gbeng", "gbsct", "gbwls"].iter().any(|code| {
		sequence[..5]
			.iter()
			.zip(code.bytes())
			.all(|(tag, byte)| *tag as u32 == 0xE0000 + u32::from(byte))
			&& sequence[5] == '\u{E007F}'
	});
	valid.then_some(end)
}

fn has_suspicious_variation_selectors(content: &str) -> bool {
	if has_encoded_variation_instruction(content) {
		return true;
	}
	let mut previous = None;
	let mut ideographic_selectors = 0;
	for character in content.chars() {
		if !is_variation_selector(character) {
			previous = Some(character);
			continue;
		}
		let Some(base) = previous.take() else {
			return true;
		};
		if !variation_selector_matches_base(base, character) {
			return true;
		}
		if matches!(character, '\u{E0100}'..='\u{E01EF}') {
			ideographic_selectors += 1;
			if ideographic_selectors > MAX_IDEOGRAPHIC_VARIATION_SELECTORS {
				return true;
			}
		}
	}
	false
}

fn has_encoded_variation_instruction(content: &str) -> bool {
	let decoded = content
		.chars()
		.filter_map(|character| {
			let value = character as u32;
			if !(0xE0100..=0xE01EF).contains(&value) {
				return None;
			}
			let byte = (value - 0xE0100) as u8;
			byte.is_ascii_graphic()
				.then_some(byte.to_ascii_lowercase() as char)
		})
		.collect::<String>();
	OVERRIDE_PHRASES
		.iter()
		.chain(COMMENT_VERBS)
		.any(|phrase| decoded.contains(phrase.trim()))
}

fn variation_selector_matches_base(base: char, selector: char) -> bool {
	match selector {
		'\u{180B}'..='\u{180D}' | '\u{180F}' => {
			matches!(base, '\u{1800}'..='\u{18AF}')
		}
		'\u{E0100}'..='\u{E01EF}' => is_ideographic_base(base),
		'\u{FE00}'..='\u{FE0E}' => !base.is_ascii(),
		'\u{FE0F}' => !base.is_ascii() || matches!(base, '#' | '*' | '0'..='9'),
		_ => false,
	}
}

fn is_ideographic_base(character: char) -> bool {
	matches!(
		character,
		'\u{3400}'..='\u{4DBF}'
			| '\u{4E00}'..='\u{9FFF}'
			| '\u{F900}'..='\u{FAFF}'
			| '\u{20000}'..='\u{323AF}'
	)
}

fn is_variation_selector(character: char) -> bool {
	matches!(
		character,
		'\u{180B}'..='\u{180D}'
			| '\u{180F}'
			| '\u{FE00}'..='\u{FE0F}'
			| '\u{E0100}'..='\u{E01EF}'
	)
}

#[derive(Default)]
struct HtmlCommentSignals {
	hidden_instruction: bool,
	budget_exceeded: bool,
}

#[derive(Default)]
struct HtmlInspectionBudget {
	parse_bytes: usize,
	node_markers: usize,
}

impl HtmlInspectionBudget {
	fn include(&mut self, content: &str) -> bool {
		let Some(parse_bytes) = self.parse_bytes.checked_add(content.len())
		else {
			return false;
		};
		let Some(node_markers) = self
			.node_markers
			.checked_add(html_node_marker_count(content))
		else {
			return false;
		};
		self.parse_bytes = parse_bytes;
		self.node_markers = node_markers;
		parse_bytes <= MAX_HTML_PARSE_BYTES
			&& node_markers <= MAX_HTML_NODE_MARKERS
	}
}

fn inspect_html_comments(file: &str, content: &str) -> HtmlCommentSignals {
	if is_markdown(file) {
		let mut html = String::new();
		let mut budget = HtmlInspectionBudget::default();
		let mut signals = HtmlCommentSignals::default();
		for event in Parser::new(content) {
			match event {
				Event::Html(fragment) | Event::InlineHtml(fragment) => {
					if !budget.include(&fragment) {
						signals.budget_exceeded = true;
						return signals;
					}
					// Adjacent nodes share HTML tokenizer state, such as a
					// `<plaintext>` tag followed by comment-like text.
					html.push_str(&fragment);
					continue;
				}
				_ if html.is_empty() => continue,
				_ => {}
			}

			if !signals.hidden_instruction
				&& has_html_comment_instruction(&html)
			{
				signals.hidden_instruction = true;
			}
			html.clear();
		}

		if !signals.hidden_instruction && !html.is_empty() {
			signals.hidden_instruction = has_html_comment_instruction(&html);
		}
		return signals;
	}

	let marker_count = html_node_marker_count(content);
	if marker_count == 0 {
		return HtmlCommentSignals::default();
	}
	let mut budget = HtmlInspectionBudget::default();
	if !budget.include(content) {
		return HtmlCommentSignals {
			hidden_instruction: false,
			budget_exceeded: true,
		};
	}

	HtmlCommentSignals {
		hidden_instruction: has_html_comment_instruction(content),
		budget_exceeded: false,
	}
}

fn html_node_marker_count(content: &str) -> usize {
	let bytes = content.as_bytes();
	let mut count = 0;
	let mut index = 0;
	while index + 1 < bytes.len() {
		if bytes[index] == b'<'
			&& match bytes[index + 1] {
				b'A'..=b'Z' | b'a'..=b'z' | b'!' | b'?' => true,
				b'/' if index + 2 < bytes.len() => {
					bytes[index + 2].is_ascii_alphabetic()
				}
				_ => false,
			} {
			count += 1;
		}
		index += 1;
	}
	count
}

fn is_markdown(file: &str) -> bool {
	std::path::Path::new(file)
		.extension()
		.and_then(std::ffi::OsStr::to_str)
		.is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

/// True if an HTML comment body contains an imperative verb.
fn has_html_comment_instruction(content: &str) -> bool {
	let document = Html::parse_document(content);
	document.tree.nodes().any(|node| {
		let Node::Comment(comment) = node.value() else {
			return false;
		};
		let body = comment.to_ascii_lowercase();
		COMMENT_VERBS.iter().any(|verb| body.contains(verb))
	})
}

fn make(
	file: &str,
	rule_id: &str,
	category: Category,
	evidence: &str,
) -> Finding {
	Finding {
		rule_id: rule_id.to_string(),
		category,
		severity: Severity::High,
		file: file.to_string(),
		line: None,
		evidence: evidence.to_string(),
		source: FindingSource::Injection,
		flow: Flow::None,
	}
}
