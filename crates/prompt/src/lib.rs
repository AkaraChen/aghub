//! # aghub-prompt
//!
//! Local prompt-library storage for aghub: a small domain model plus a
//! JSON-file-backed store for creating, editing, and deleting prompts.

pub mod error;
pub mod model;
pub mod store;
pub mod variables;

pub use error::{PromptError, Result};
pub use model::{NewPrompt, Prompt, PromptUpdate};
pub use store::{PromptStore, PROMPTS_FILE};
pub use variables::extract_variables;
