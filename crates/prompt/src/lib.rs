//! # aghub-prompt
//!
//! Local prompt-library storage for aghub: a small domain model plus a
//! JSON-file-backed store for creating, editing, and deleting prompts.

mod error;
mod model;
mod store;
mod variables;

pub use error::{PromptError, Result};
pub use model::{NewPrompt, Prompt, PromptUpdate};
pub use store::PromptStore;
pub use variables::extract_variables;
