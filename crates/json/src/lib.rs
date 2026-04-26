//! JSON and JSONC parsing/editing helpers.
//!
//! The editing helpers use `jsonc-parser`'s CST API so callers can update
//! managed fields while preserving comments and formatting around untouched
//! fields.

use std::collections::HashSet;

use jsonc_parser::cst::{CstInputValue, CstObject, CstRootNode};
use jsonc_parser::{parse_to_serde_value, ParseOptions};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

/// Errors produced by JSON/JSONC helpers.
#[derive(Debug, Error)]
pub enum JsonError {
	/// JSONC parsing failed.
	#[error("JSONC parse error: {0}")]
	Parse(#[from] jsonc_parser::errors::ParseError),

	/// Serialization into a JSON value failed.
	#[error("JSON serialization error: {0}")]
	Serialize(#[from] serde_json::Error),

	/// The root value must be an object for object patching.
	#[error("expected JSON object")]
	ExpectedObject,
}

/// Parse JSONC into an optional serde value.
///
/// Empty or whitespace-only input is returned as `None`, matching
/// `jsonc-parser`'s empty-input handling.
pub fn parse_jsonc_opt<T: DeserializeOwned>(
	content: &str,
) -> Result<Option<T>, JsonError> {
	Ok(parse_to_serde_value::<Option<T>>(
		content,
		&jsonc_parse_options(),
	)?)
}

/// Patch the root JSON object without reformatting the whole document.
///
/// Existing object properties are recursively patched. Properties absent from
/// `value` are removed; properties present in `value` are updated or appended.
pub fn patch_jsonc_object<T: Serialize>(
	content: Option<&str>,
	value: &T,
) -> Result<String, JsonError> {
	let value = serde_json::to_value(value)?;
	let Value::Object(map) = value else {
		return Err(JsonError::ExpectedObject);
	};

	let is_new_document = content.map(str::trim).unwrap_or("").is_empty();
	let root =
		CstRootNode::parse(content.unwrap_or(""), &jsonc_parse_options())?;
	let root_object = match root.object_value() {
		Some(object) => object,
		None if is_new_document => root.object_value_or_set(),
		None => return Err(JsonError::ExpectedObject),
	};
	patch_object(&root_object, &map);

	let mut output = root.to_string();
	if is_new_document && !output.ends_with('\n') {
		output.push('\n');
	}
	Ok(output)
}

fn jsonc_parse_options() -> ParseOptions {
	ParseOptions {
		allow_comments: true,
		allow_loose_object_property_names: false,
		allow_trailing_commas: true,
		allow_missing_commas: false,
		allow_single_quoted_strings: false,
		allow_hexadecimal_numbers: false,
		allow_unary_plus_numbers: false,
	}
}

fn patch_object(object: &CstObject, desired: &Map<String, Value>) {
	let desired_keys: HashSet<&str> =
		desired.keys().map(String::as_str).collect();
	for prop in object.properties() {
		let Some(name) = prop.name().and_then(|name| name.decoded_value().ok())
		else {
			continue;
		};
		if !desired_keys.contains(name.as_str()) {
			prop.remove();
		}
	}

	for (name, value) in desired {
		match object.get(name) {
			Some(prop) => {
				if let Value::Object(map) = value {
					if let Some(existing) = prop.object_value() {
						patch_object(&existing, map);
						continue;
					}
				}
				if prop.to_serde_value().as_ref() != Some(value) {
					prop.set_value(value_to_cst_input(value));
				}
			}
			None => {
				object.append(name, value_to_cst_input(value));
			}
		}
	}
}

fn value_to_cst_input(value: &Value) -> CstInputValue {
	match value {
		Value::Null => CstInputValue::Null,
		Value::Bool(value) => CstInputValue::Bool(*value),
		Value::Number(value) => CstInputValue::Number(value.to_string()),
		Value::String(value) => CstInputValue::String(value.clone()),
		Value::Array(values) => CstInputValue::Array(
			values.iter().map(value_to_cst_input).collect(),
		),
		Value::Object(values) => CstInputValue::Object(
			values
				.iter()
				.map(|(key, value)| (key.clone(), value_to_cst_input(value)))
				.collect(),
		),
	}
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;

	#[test]
	fn parse_jsonc_accepts_comments() {
		let parsed: Option<Value> =
			parse_jsonc_opt(r#"{ "value": 1 } // comment"#).unwrap();

		assert_eq!(parsed, Some(json!({ "value": 1 })));
	}

	#[test]
	fn parse_jsonc_rejects_missing_commas() {
		let result = parse_jsonc_opt::<Value>(r#"{ "a": 1 "b": 2 }"#);

		assert!(result.is_err());
	}

	#[test]
	fn patch_jsonc_object_rejects_existing_non_object() {
		let result = patch_jsonc_object(Some("[]"), &json!({ "a": 1 }));

		assert!(matches!(result, Err(JsonError::ExpectedObject)));
	}

	#[test]
	fn patch_jsonc_object_preserves_comments() {
		let output = patch_jsonc_object(
			Some(
				r#"{
  // user's note
  "provider": {
    "old": true
  },
  "keep": "value"
}"#,
			),
			&json!({
				"provider": {
					"old": false,
					"new": true
				},
				"keep": "value"
			}),
		)
		.unwrap();

		assert!(output.contains("// user's note"));
		assert!(output.contains(r#""old": false"#));
		assert!(output.contains(r#""new": true"#));
		assert!(output.contains(r#""keep": "value""#));
	}
}
