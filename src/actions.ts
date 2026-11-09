/**
 * The only WEBFLEET.connect actions this server will ever send, with the
 * request limit the 1.76.0 reference documents for each ("Request limits" in
 * every action chapter). All are read-only reports. Nothing that inserts,
 * updates, deletes, sends to a driver terminal, or consumes a message queue
 * (pop*, ack*, createQueue*) is listed, so the client refuses it.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface ActionLimit {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
}

const perMinute = (limit: number): ActionLimit => ({ limit, windowMs: MINUTE });

export const ACTIONS = {
  showObjectReportExtern: perMinute(6),
  showVehicleReportExtern: perMinute(10),
  showObjectGroups: perMinute(10),
  showObjectGroupObjects: perMinute(10),
  showNearestVehicles: perMinute(10),
  showContracts: perMinute(6),
  getObjectFeatures: perMinute(10),
  showTripReportExtern: perMinute(1),
  showTripSummaryReportExtern: perMinute(10),
  showTracks: perMinute(10),
  showLogbook: perMinute(10),
  showStandStills: perMinute(6),
  showIdleExceptions: perMinute(10),
  showWorkingTimes: perMinute(6),
  showEventReportExtern: perMinute(1),
  showSpeedingEvents: perMinute(10),
  showAccelerationEvents: perMinute(10),
  showDriverReportExtern: perMinute(10),
  showDriverGroups: perMinute(10),
  showDriverGroupDrivers: perMinute(10),
  getObjectKPIs: perMinute(10),
  getDriverKPIs: perMinute(10),
  showAddressReportExtern: perMinute(6),
  showAddressGroupReportExtern: { limit: 900, windowMs: HOUR },
  showAddressGroupAddressReportExtern: { limit: 900, windowMs: HOUR },
  showOrderReportExtern: perMinute(6),
  showOrderWaypoints: perMinute(10),
  showMessages: perMinute(10),
} as const satisfies Record<string, ActionLimit>;

export type Action = keyof typeof ACTIONS;

export const ACTION_NAMES = Object.keys(ACTIONS) as Action[];

export function isAllowedAction(value: unknown): value is Action {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, value);
}

export function describeLimit(action: Action): string {
  const { limit, windowMs } = ACTIONS[action];
  const unit = windowMs === HOUR ? 'hour' : 'minute';
  return `${limit} request${limit === 1 ? '' : 's'}/${unit}`;
}
