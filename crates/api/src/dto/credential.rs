use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct CreateCredentialRequest {
	pub name: String,
	pub token: String,
}

/// Token is intentionally omitted from responses — write-only secret.
#[derive(Debug, Serialize)]
pub struct CredentialResponse {
	pub id: String,
	pub name: String,
}
