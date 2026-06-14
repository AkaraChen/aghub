use rocket::http::Status;
use rocket::request::{FromRequest, Outcome};
use rocket::Request;

pub const AUTHORIZATION_HEADER: &str = "Authorization";
pub const TOKEN_HEADER: &str = "X-AGHUB-API-Token";

pub struct ApiAuthState {
	pub token: String,
}

pub struct ApiAuth;

pub fn generate_auth_token() -> String {
	uuid::Uuid::new_v4().simple().to_string()
}

fn bearer_token(value: &str) -> Option<&str> {
	value.strip_prefix("Bearer ")
}

fn request_token(request: &Request<'_>) -> Option<String> {
	request
		.headers()
		.get_one(AUTHORIZATION_HEADER)
		.and_then(bearer_token)
		.or_else(|| request.headers().get_one(TOKEN_HEADER))
		.map(ToOwned::to_owned)
}

#[rocket::async_trait]
impl<'r> FromRequest<'r> for ApiAuth {
	type Error = ();

	async fn from_request(
		request: &'r Request<'_>,
	) -> Outcome<Self, Self::Error> {
		let Some(state) = request.rocket().state::<ApiAuthState>() else {
			return Outcome::Error((Status::InternalServerError, ()));
		};
		let Some(token) = request_token(request) else {
			return Outcome::Error((Status::Unauthorized, ()));
		};
		if token != state.token {
			return Outcome::Error((Status::Forbidden, ()));
		}
		Outcome::Success(ApiAuth)
	}
}
