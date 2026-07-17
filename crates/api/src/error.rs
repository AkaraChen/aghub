use aghub_cliproxy::GatewayError;
use aghub_core::errors::ConfigError;
use aghub_inference::{InferenceProviderError, ModelDiscoveryError};
use aghub_prompt::PromptError;
use rocket::http::{ContentType, Status};
use rocket::response::{self, Responder};
use rocket::serde::json::serde_json;
use serde::Serialize;

#[derive(Serialize)]
pub struct ErrorBody {
	pub error: String,
	pub code: &'static str,
}

pub struct ApiError {
	pub status: Status,
	pub body: ErrorBody,
}

impl ApiError {
	pub fn new(
		status: Status,
		error: impl Into<String>,
		code: &'static str,
	) -> Self {
		Self {
			status,
			body: ErrorBody {
				error: error.into(),
				code,
			},
		}
	}

	pub fn internal(error: impl Into<String>) -> Self {
		Self::new(Status::InternalServerError, error, "INTERNAL_ERROR")
	}

	pub fn bad_request(error: impl Into<String>) -> Self {
		Self::new(Status::BadRequest, error, "BAD_REQUEST")
	}

	pub fn not_found(error: impl Into<String>) -> Self {
		Self::new(Status::NotFound, error, "NOT_FOUND")
	}
}

impl From<ConfigError> for ApiError {
	fn from(e: ConfigError) -> Self {
		match e {
			ConfigError::ResourceNotFound {
				resource_type,
				name,
			} => ApiError::new(
				Status::NotFound,
				format!("{resource_type} '{name}' not found"),
				"RESOURCE_NOT_FOUND",
			),
			ConfigError::ResourceExists {
				resource_type,
				name,
			} => ApiError::new(
				Status::Conflict,
				format!("{resource_type} '{name}' already exists"),
				"RESOURCE_EXISTS",
			),
			ConfigError::ResourceChanged {
				resource_type,
				name,
			} => ApiError::new(
				Status::Conflict,
				format!("{resource_type} '{name}' changed since it was loaded"),
				"RESOURCE_CHANGED",
			),
			ConfigError::NotFound { path } => ApiError::new(
				Status::NotFound,
				format!("Config file not found: {}", path.display()),
				"CONFIG_NOT_FOUND",
			),
			ConfigError::UnsupportedOperation(msg) => ApiError::new(
				Status::UnprocessableEntity,
				msg,
				"UNSUPPORTED_OPERATION",
			),
			ConfigError::ValidationFailed(msg) => ApiError::new(
				Status::UnprocessableEntity,
				msg,
				"VALIDATION_FAILED",
			),
			ConfigError::InvalidConfig(msg) => {
				ApiError::new(Status::BadRequest, msg, "INVALID_CONFIG")
			}
			ConfigError::Json(e) => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"JSON_PARSE_ERROR",
			),
			ConfigError::Io(e) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"IO_ERROR",
			),
		}
	}
}

impl From<InferenceProviderError> for ApiError {
	fn from(e: InferenceProviderError) -> Self {
		match e {
			InferenceProviderError::EmptyName
			| InferenceProviderError::EmptyAgentProviderId
			| InferenceProviderError::EmptyModelName
			| InferenceProviderError::EmptyApiBaseUrl
			| InferenceProviderError::InvalidApiBaseUrl
			| InferenceProviderError::UnsupportedApiBaseUrl
			| InferenceProviderError::EmptyApiKey
			| InferenceProviderError::InvalidFormat(_)
			| InferenceProviderError::InvalidLatinName(_)
			| InferenceProviderError::UnsupportedAgentProviderCapability {
				..
			} => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"INVALID_PARAM",
			),
			InferenceProviderError::CredentialScopeChangeRequiresApiKey => {
				ApiError::new(
					Status::UnprocessableEntity,
					e.to_string(),
					"CREDENTIAL_SCOPE_MISMATCH",
				)
			}
			InferenceProviderError::InvalidAgentProviderConfig {
				agent_id,
				message,
				..
			} => ApiError::new(
				Status::BadRequest,
				format!("invalid {agent_id} provider config: {message}"),
				"INVALID_PARAM",
			),
			InferenceProviderError::InvalidAgentCredentialStore {
				agent_id,
				message,
				..
			} => ApiError::new(
				Status::BadRequest,
				format!("invalid {agent_id} credential store: {message}"),
				"INVALID_PARAM",
			),
			InferenceProviderError::AlreadyExists(_)
			| InferenceProviderError::ModelAlreadyExists(_) => ApiError::new(
				Status::Conflict,
				e.to_string(),
				"RESOURCE_EXISTS",
			),
			InferenceProviderError::NotFound(_) => ApiError::new(
				Status::NotFound,
				e.to_string(),
				"RESOURCE_NOT_FOUND",
			),
			InferenceProviderError::Keyring(_) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"KEYCHAIN_ERROR",
			),
			InferenceProviderError::Io(_)
			| InferenceProviderError::Database(_)
			| InferenceProviderError::AppDataDir(_)
			| InferenceProviderError::CredentialStateUnavailable => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"INFERENCE_PROVIDER_STORE_ERROR",
			),
		}
	}
}

impl From<ModelDiscoveryError> for ApiError {
	fn from(error: ModelDiscoveryError) -> Self {
		match error {
			ModelDiscoveryError::EmptyApiBaseUrl
			| ModelDiscoveryError::InvalidApiBaseUrl
			| ModelDiscoveryError::UnsupportedApiBaseUrl => ApiError::new(
				Status::BadRequest,
				error.to_string(),
				"INVALID_PARAM",
			),
			ModelDiscoveryError::Client(_) => {
				ApiError::internal(error.to_string())
			}
			ModelDiscoveryError::Timeout => ApiError::new(
				Status::GatewayTimeout,
				error.to_string(),
				"UPSTREAM_TIMEOUT",
			),
			ModelDiscoveryError::Request(_) => ApiError::new(
				Status::BadGateway,
				error.to_string(),
				"UPSTREAM_REQUEST_FAILED",
			),
			ModelDiscoveryError::UpstreamStatus(status) => {
				let (response_status, code) = match status {
					reqwest::StatusCode::UNAUTHORIZED
					| reqwest::StatusCode::PAYMENT_REQUIRED
					| reqwest::StatusCode::FORBIDDEN => {
						(Status::UnprocessableEntity, "UPSTREAM_ACCESS_DENIED")
					}
					reqwest::StatusCode::NOT_FOUND
					| reqwest::StatusCode::METHOD_NOT_ALLOWED => (
						Status::UnprocessableEntity,
						"MODEL_DISCOVERY_UNSUPPORTED",
					),
					reqwest::StatusCode::TOO_MANY_REQUESTS => {
						(Status::TooManyRequests, "UPSTREAM_RATE_LIMITED")
					}
					_ => (Status::BadGateway, "UPSTREAM_REQUEST_FAILED"),
				};
				ApiError::new(response_status, error.to_string(), code)
			}
			ModelDiscoveryError::ResponseTooLarge { .. }
			| ModelDiscoveryError::TooManyModels { .. }
			| ModelDiscoveryError::ModelIdTooLong { .. }
			| ModelDiscoveryError::TooManyPages { .. } => ApiError::new(
				Status::BadGateway,
				error.to_string(),
				"UPSTREAM_RESPONSE_TOO_LARGE",
			),
			ModelDiscoveryError::ReadResponse(_)
			| ModelDiscoveryError::InvalidResponse(_)
			| ModelDiscoveryError::MissingPaginationCursor
			| ModelDiscoveryError::RepeatedPaginationCursor => ApiError::new(
				Status::BadGateway,
				error.to_string(),
				"UPSTREAM_RESPONSE_FAILED",
			),
		}
	}
}

impl From<PromptError> for ApiError {
	fn from(e: PromptError) -> Self {
		match e {
			PromptError::NotFound(_) => ApiError::new(
				Status::NotFound,
				e.to_string(),
				"RESOURCE_NOT_FOUND",
			),
			PromptError::EmptyTitle => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"INVALID_PARAM",
			),
			PromptError::InvalidBackup(_)
			| PromptError::UnsupportedBackupVersion(_) => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"INVALID_PROMPT_BACKUP",
			),
			PromptError::Io(_) | PromptError::Json(_) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"PROMPT_STORE_ERROR",
			),
		}
	}
}

impl From<GatewayError> for ApiError {
	fn from(e: GatewayError) -> Self {
		match e {
			GatewayError::InstanceNotFound(_) => ApiError::new(
				Status::NotFound,
				e.to_string(),
				"RESOURCE_NOT_FOUND",
			),
			GatewayError::InstanceExists(_) => ApiError::new(
				Status::Conflict,
				e.to_string(),
				"RESOURCE_EXISTS",
			),
			GatewayError::Invalid(_) => ApiError::new(
				Status::BadRequest,
				e.to_string(),
				"INVALID_PARAM",
			),
			GatewayError::Management { .. } => ApiError::new(
				Status::BadGateway,
				e.to_string(),
				"GATEWAY_MANAGEMENT_ERROR",
			),
			GatewayError::Unreachable { .. } => ApiError::new(
				Status::ServiceUnavailable,
				e.to_string(),
				"GATEWAY_UNREACHABLE",
			),
			GatewayError::NotProvisioned(_) => ApiError::new(
				Status::UnprocessableEntity,
				e.to_string(),
				"GATEWAY_NOT_PROVISIONED",
			),
			GatewayError::Download(_) | GatewayError::ChecksumMismatch(_) => {
				ApiError::new(
					Status::BadGateway,
					e.to_string(),
					"GATEWAY_DOWNLOAD_ERROR",
				)
			}
			GatewayError::ConfigFile { .. } => ApiError::new(
				Status::UnprocessableEntity,
				e.to_string(),
				"GATEWAY_CONFIG_ERROR",
			),
			GatewayError::Keyring(_) => ApiError::new(
				Status::InternalServerError,
				e.to_string(),
				"KEYCHAIN_ERROR",
			),
			GatewayError::Extract(_)
			| GatewayError::Process(_)
			| GatewayError::Io(_)
			| GatewayError::Json(_)
			| GatewayError::Http(_) => ApiError::internal(e.to_string()),
		}
	}
}

impl<'r> Responder<'r, 'static> for ApiError {
	fn respond_to(
		self,
		_: &'r rocket::Request<'_>,
	) -> response::Result<'static> {
		let body = serde_json::to_string(&self.body).unwrap_or_else(|_| {
			r#"{"error":"Internal error","code":"INTERNAL_ERROR"}"#.to_string()
		});
		rocket::Response::build()
			.status(self.status)
			.header(ContentType::JSON)
			.sized_body(body.len(), std::io::Cursor::new(body))
			.ok()
	}
}

pub type ApiResult<T> = Result<rocket::serde::json::Json<T>, ApiError>;
pub type ApiCreated<T> =
	Result<(Status, rocket::serde::json::Json<T>), ApiError>;
pub type ApiNoContent = Result<rocket::response::status::NoContent, ApiError>;

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn model_discovery_timeout_maps_to_gateway_timeout() {
		let error = ApiError::from(ModelDiscoveryError::Timeout);

		assert_eq!(error.status, Status::GatewayTimeout);
		assert_eq!(error.body.code, "UPSTREAM_TIMEOUT");
	}

	#[test]
	fn model_response_limits_have_a_stable_error_code() {
		for source in [
			ModelDiscoveryError::ResponseTooLarge { limit: 1024 },
			ModelDiscoveryError::TooManyModels { limit: 1000 },
			ModelDiscoveryError::ModelIdTooLong { limit: 512 },
			ModelDiscoveryError::TooManyPages { limit: 10 },
		] {
			let error = ApiError::from(source);

			assert_eq!(error.status, Status::BadGateway);
			assert_eq!(error.body.code, "UPSTREAM_RESPONSE_TOO_LARGE");
		}
	}

	#[test]
	fn upstream_model_statuses_have_actionable_error_codes() {
		for (status, response_status, code) in [
			(
				reqwest::StatusCode::UNAUTHORIZED,
				Status::UnprocessableEntity,
				"UPSTREAM_ACCESS_DENIED",
			),
			(
				reqwest::StatusCode::FORBIDDEN,
				Status::UnprocessableEntity,
				"UPSTREAM_ACCESS_DENIED",
			),
			(
				reqwest::StatusCode::PAYMENT_REQUIRED,
				Status::UnprocessableEntity,
				"UPSTREAM_ACCESS_DENIED",
			),
			(
				reqwest::StatusCode::NOT_FOUND,
				Status::UnprocessableEntity,
				"MODEL_DISCOVERY_UNSUPPORTED",
			),
			(
				reqwest::StatusCode::METHOD_NOT_ALLOWED,
				Status::UnprocessableEntity,
				"MODEL_DISCOVERY_UNSUPPORTED",
			),
			(
				reqwest::StatusCode::TOO_MANY_REQUESTS,
				Status::TooManyRequests,
				"UPSTREAM_RATE_LIMITED",
			),
			(
				reqwest::StatusCode::INTERNAL_SERVER_ERROR,
				Status::BadGateway,
				"UPSTREAM_REQUEST_FAILED",
			),
		] {
			let error =
				ApiError::from(ModelDiscoveryError::UpstreamStatus(status));

			assert_eq!(error.status, response_status);
			assert_eq!(error.body.code, code);
		}
	}

	#[test]
	fn invalid_model_discovery_url_maps_to_bad_request() {
		let error = ApiError::from(ModelDiscoveryError::InvalidApiBaseUrl);

		assert_eq!(error.status, Status::BadRequest);
		assert_eq!(error.body.code, "INVALID_PARAM");
	}

	#[test]
	fn credential_scope_change_maps_to_unprocessable_entity() {
		let error = ApiError::from(
			InferenceProviderError::CredentialScopeChangeRequiresApiKey,
		);

		assert_eq!(error.status, Status::UnprocessableEntity);
		assert_eq!(error.body.code, "CREDENTIAL_SCOPE_MISMATCH");
	}
}
