import { Button } from "@heroui/react";
import type { ReactNode } from "react";
import { Component } from "react";
import { captureException } from "../../lib/analytics";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./empty";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error) {
		captureException(error);
		return { error };
	}

	render() {
		if (this.state.error) {
			return (
				this.props.fallback ?? (
					<div className="flex h-full items-center justify-center p-6">
						<Empty>
							<EmptyHeader>
								<EmptyTitle>Something went wrong</EmptyTitle>
								<EmptyDescription>
									{this.state.error.message}
								</EmptyDescription>
							</EmptyHeader>
							<Button
								variant="outline"
								size="sm"
								onPress={() => this.setState({ error: null })}
							>
								Try again
							</Button>
						</Empty>
					</div>
				)
			);
		}
		return this.props.children;
	}
}
