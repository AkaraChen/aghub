import { Spinner } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import { useEffect, useState } from "react";
import type { ServerProviderProps } from "../contexts/server";
import { ServerContext } from "../contexts/server";

interface ServerInfo {
	port: number;
	auth_token: string;
}

export function ServerProvider({ children }: ServerProviderProps) {
	const [server, setServer] = useState<ServerInfo | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		invoke<ServerInfo>("start_server")
			.then((value) => {
				void info(`Desktop API server started on port ${value.port}`);
				setServer(value);
			})
			.catch((e) => {
				console.error("Failed to start desktop API server:", e);
				setError(String(e));
			});
	}, []);

	if (error) {
		return (
			<div className="flex h-screen items-center justify-center">
				<p className="text-sm text-danger">
					Failed to start server: {error}
				</p>
			</div>
		);
	}

	if (server === null) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<ServerContext
			value={{
				port: server.port,
				baseUrl: `http://localhost:${server.port}/api/v1`,
				authToken: server.auth_token,
			}}
		>
			{children}
		</ServerContext>
	);
}
