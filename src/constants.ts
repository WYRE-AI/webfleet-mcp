export const SERVER_NAME = 'webfleet-mcp';
export const SERVER_VERSION = '0.1.0';

/** WEBFLEET.connect reference used for action names and the base URL. */
export const API_REFERENCE = 'WEBFLEET.connect 1.74.0';

/**
 * Current CSV/JSON host from the 1.74 reference ("The base URL").
 * Legacy hostname csv.telematics.tomtom.com predates the webfleet.com rebrand
 * and remains an explicit override only.
 */
export const DEFAULT_HOST = 'csv.webfleet.com';

export const ALLOWED_HOSTS = ['csv.webfleet.com', 'csv.telematics.tomtom.com'] as const;

export type WebfleetHost = (typeof ALLOWED_HOSTS)[number];

export const API_PATH = '/extern';

/** Documented CSV/JSON action names (WEBFLEET.connect 1.74 reference). */
export const ACTIONS = {
  objectReport: 'showObjectReportExtern',
  vehicleReport: 'showVehicleReportExtern',
  tripReport: 'showTripReportExtern',
} as const;

/**
 * CSV/JSON range_pattern values from the 1.74 general parameters.
 * SOAP uses a different spelling (Dm1, WF0, …); this server speaks CSV/JSON.
 */
export const RANGE_PATTERNS = [
  'd0',
  'd-1',
  'd-2',
  'd-3',
  'd-4',
  'd-5',
  'd-6',
  'w0',
  'w-1',
  'w-2',
  'w-3',
  'wf0',
  'wf-1',
  'wf-2',
  'wf-3',
  'm0',
  'm-1',
  'm-2',
  'm-3',
  'ud',
] as const;

export type RangePattern = (typeof RANGE_PATTERNS)[number];

/** Read-only action prefixes. Writes (send/insert/update/delete/…) are rejected. */
export const READ_ACTION_PATTERN = /^(show|get|pop|geocode|calc|download)[A-Za-z0-9]*$/;
