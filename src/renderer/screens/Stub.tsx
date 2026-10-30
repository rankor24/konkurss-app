import { ScreenHead } from "../ui";

/** Honest placeholder for a step whose screen is built in a later phase. Shows no invented data. */
export function Stub({ title, what, why, phase }: { title: string; what: string; why?: string; phase: number }) {
	return (
		<div className="screen">
			<ScreenHead title={title} what={what} why={why} />
			<div className="card">
				<strong>Šis solis vēl nav gatavs.</strong>
				<span className="muted">App to pievienos {phase}. izstrādes posmā. Līdz tam šo darbu dari ārpus app.</span>
			</div>
		</div>
	);
}
