import { useEffect } from "react";
import { useLocation } from "wouter";

export function Redirect({ to }: { to: string }) {
	const [, setLocation] = useLocation();

	useEffect(() => {
		setLocation(to, { replace: true });
	}, [to, setLocation]);

	return null;
}