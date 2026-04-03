//! Generic YAML-frontmatter markdown parser and renderer.
//!
//! Frontmatter is delimited by `---` lines at the top of the document:
//!
//! ```text
//! ---
//! title: My Doc
//! ---
//! Body content here.
//! ```
//!
//! # Examples
//!
//! ```
//! use serde::Deserialize;
//!
//! #[derive(Deserialize)]
//! struct Meta { title: String }
//!
//! let (meta, body) = aghub_markdown::parse::<Meta>("---\ntitle: Hello\n---\nWorld").unwrap();
//! assert_eq!(meta.title, "Hello");
//! assert_eq!(body, "World");
//! ```

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors produced by this crate.
#[derive(Debug, Error)]
pub enum MarkdownError {
	/// The document does not start with a `---` frontmatter block.
	#[error("document has no YAML frontmatter")]
	NoFrontmatter,

	/// The frontmatter YAML could not be parsed or serialized.
	#[error("YAML error: {0}")]
	Yaml(#[from] serde_yaml::Error),
}

/// Split a document string into an optional frontmatter slice and the body.
///
/// Frontmatter must begin at the very start of the document (`---\n`) and
/// end at the next `\n---` sequence (with an optional following newline).
/// If no valid frontmatter delimiter is found the whole string is returned
/// as the body with `None` for the frontmatter.
fn split(content: &str) -> (Option<&str>, &str) {
	let Some(rest) = content.strip_prefix("---\n") else {
		return (None, content);
	};
	let Some(end) = rest.find("\n---") else {
		return (None, content);
	};
	let front = &rest[..end];
	let after = &rest[end + 4..]; // skip the "\n---" bytes
	let body = after.strip_prefix('\n').unwrap_or(after);
	(Some(front), body)
}

/// Parse a markdown document that **must** have YAML frontmatter.
///
/// Returns `(frontmatter, body_str)`.
///
/// # Errors
///
/// - [`MarkdownError::NoFrontmatter`] – no `---` delimiter found.
/// - [`MarkdownError::Yaml`] – frontmatter is not valid YAML for `T`.
pub fn parse<T: for<'de> Deserialize<'de>>(
	content: &str,
) -> Result<(T, &str), MarkdownError> {
	let (front_str, body) = split(content);
	let front = front_str.ok_or(MarkdownError::NoFrontmatter)?;
	let frontmatter = serde_yaml::from_str(front)?;
	Ok((frontmatter, body))
}

/// Parse a markdown document with **optional** YAML frontmatter.
///
/// Returns `(Option<frontmatter>, body_str)`.  When the document has no
/// `---` delimiter the frontmatter is `None` and the entire content is
/// returned as the body.
///
/// # Errors
///
/// Returns [`MarkdownError::Yaml`] only when a frontmatter block is
/// found but cannot be deserialized into `T`.
pub fn parse_opt<T: for<'de> Deserialize<'de>>(
	content: &str,
) -> Result<(Option<T>, &str), MarkdownError> {
	let (front_str, body) = split(content);
	let frontmatter = front_str
		.map(|f| serde_yaml::from_str::<T>(f))
		.transpose()?;
	Ok((frontmatter, body))
}

/// Render a document by serializing `frontmatter` as YAML and appending
/// `body`.
///
/// The output format is:
///
/// ```text
/// ---
/// <yaml>---
/// <body>
/// ```
///
/// # Errors
///
/// Returns [`MarkdownError::Yaml`] if `frontmatter` cannot be serialized.
pub fn render<T: Serialize>(
	frontmatter: &T,
	body: &str,
) -> Result<String, MarkdownError> {
	let yaml = serde_yaml::to_string(frontmatter)?;
	Ok(format!("---\n{yaml}---\n{body}"))
}

#[cfg(test)]
mod tests {
	use super::*;
	use serde::Deserialize;

	#[derive(Debug, Deserialize, PartialEq)]
	struct Meta {
		name: String,
		description: Option<String>,
	}

	#[test]
	fn parse_basic() {
		let (m, body) =
			parse::<Meta>("---\nname: foo\n---\nHello").unwrap();
		assert_eq!(m.name, "foo");
		assert_eq!(m.description, None);
		assert_eq!(body, "Hello");
	}

	#[test]
	fn parse_with_description() {
		let (m, body) =
			parse::<Meta>("---\nname: foo\ndescription: bar\n---\nBody")
				.unwrap();
		assert_eq!(m.description, Some("bar".to_string()));
		assert_eq!(body, "Body");
	}

	#[test]
	fn parse_no_frontmatter_error() {
		let result = parse::<Meta>("No frontmatter here");
		assert!(
			matches!(result, Err(MarkdownError::NoFrontmatter)),
			"expected NoFrontmatter"
		);
	}

	#[test]
	fn parse_opt_no_frontmatter() {
		let (fm, body) =
			parse_opt::<Meta>("No frontmatter here").unwrap();
		assert!(fm.is_none());
		assert_eq!(body, "No frontmatter here");
	}

	#[test]
	fn parse_opt_with_frontmatter() {
		let (fm, body) =
			parse_opt::<Meta>("---\nname: x\n---\nbody").unwrap();
		assert!(fm.is_some());
		assert_eq!(body, "body");
	}

	#[test]
	fn parse_empty_body() {
		let (m, body) = parse::<Meta>("---\nname: foo\n---\n").unwrap();
		assert_eq!(m.name, "foo");
		assert_eq!(body, "");
	}

	#[test]
	fn parse_empty_body_no_trailing_newline() {
		let (m, body) = parse::<Meta>("---\nname: foo\n---").unwrap();
		assert_eq!(m.name, "foo");
		assert_eq!(body, "");
	}

	#[test]
	fn render_and_parse_roundtrip() {
		#[derive(Serialize, Deserialize, PartialEq, Debug)]
		struct Fm {
			name: String,
			#[serde(skip_serializing_if = "Option::is_none")]
			description: Option<String>,
		}

		let orig = Fm {
			name: "hello".to_string(),
			description: Some("world: colon".to_string()),
		};
		let rendered = render(&orig, "body text").unwrap();
		let (parsed, body) = parse::<Fm>(&rendered).unwrap();
		assert_eq!(parsed, orig);
		assert_eq!(body, "body text");
	}
}
