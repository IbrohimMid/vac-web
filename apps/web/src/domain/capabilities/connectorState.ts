// Connector row state (slice 13).
//
// Acceptance:
//   * Rows distinguish available / configured / connected / rate_limited
//     / not_wired.
//   * No UI claims external access before token/auth state exists.
//   * Write-capable connectors require explicit profile permission.
//
// `connectorRowStateFor()` is the single source of truth: it combines a
// connector definition with manifest gating, profile policy, and live
// health into a row-state enum the ConnectorsTab can render off.

export type ConnectorRowState =
	| 'not_wired'
	| 'available'
	| 'configured'
	| 'connected'
	| 'rate_limited'
	| 'disconnected'
	| 'unknown';

export interface ConnectorInput {
	readonly id: string;
	readonly featureWired?: boolean;
	readonly hasCredentials?: boolean;
	readonly health?: 'ok' | 'degraded' | 'rate_limited' | 'unknown' | 'disconnected';
	readonly writeCapable?: boolean;
	readonly profileGrantsWrite?: boolean;
}

export interface ConnectorRow {
	readonly state: ConnectorRowState;
	readonly label: string;
	readonly canConnect: boolean;
	readonly canDisconnect: boolean;
	readonly canWrite: boolean;
	readonly writeBlockedReason?: string | undefined;
}

export function connectorRowStateFor(c: ConnectorInput): ConnectorRow {
	if (c.featureWired === false) {
		return {
			state: 'not_wired',
			label: 'Not wired',
			canConnect: false,
			canDisconnect: false,
			canWrite: false,
			writeBlockedReason: 'Connector is not yet implemented in this build.',
		};
	}

	let state: ConnectorRowState;
	if (c.health === 'rate_limited') state = 'rate_limited';
	else if (c.health === 'ok') state = 'connected';
	else if (c.health === 'disconnected') state = 'disconnected';
	else if (c.hasCredentials) state = 'configured';
	else state = 'available';

	const canWrite = state === 'connected' && c.writeCapable === true && c.profileGrantsWrite === true;
	let writeBlockedReason: string | undefined;
	if (!canWrite) {
		if (c.writeCapable !== true) {
			writeBlockedReason = 'Connector does not advertise write capability.';
		} else if (c.profileGrantsWrite !== true) {
			writeBlockedReason = 'Active profile does not grant write access for this connector.';
		} else if (state !== 'connected') {
			writeBlockedReason = `Connector is ${state.replace('_', ' ')}; connect first.`;
		}
	}

	return {
		state,
		label: stateLabel(state),
		canConnect: state === 'available' || state === 'disconnected' || state === 'configured',
		canDisconnect: state === 'connected' || state === 'rate_limited',
		canWrite,
		writeBlockedReason,
	};
}

function stateLabel(state: ConnectorRowState): string {
	switch (state) {
		case 'not_wired':
			return 'Not wired';
		case 'available':
			return 'Available';
		case 'configured':
			return 'Configured';
		case 'connected':
			return 'Connected';
		case 'rate_limited':
			return 'Rate limited';
		case 'disconnected':
			return 'Disconnected';
		default:
			return 'Unknown';
	}
}
