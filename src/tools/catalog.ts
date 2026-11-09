/**
 * The WEBFLEET.connect read actions this server exposes, one tool each, all
 * read tier. Action names, parameter names, types, lengths, enums, and limits
 * follow the WEBFLEET.connect 1.76.0 Reference Guide; review changes against
 * the action's chapter ("Parameters specific to ...", "Request limits").
 * Parameters the reference marks "For future use" (externalid) are omitted.
 */
import { endpointTool, iso, type Endpoint, type Param } from './endpoint.js';
import type { ToolDef } from './types.js';

// ---- shared parameters ----------------------------------------------------

const objectno: Param = { type: 'string', maxLength: 10, description: 'Object (vehicle/asset) number, unique within the account, case-sensitive. Alternative to objectuid.' };
const objectuid: Param = { type: 'string', maxLength: 30, description: 'Unique, unchangeable object identifier. Alternative to objectno.' };
const objectgroupname: Param = { type: 'string', maxLength: 1000, description: 'Object group name (case-sensitive).' };
const driverno: Param = { type: 'string', maxLength: 1000, description: 'Driver number, unique within the account, case-sensitive. Alternative to driveruid.' };
const driveruid: Param = { type: 'string', maxLength: 30, description: 'Unique, unchangeable driver identifier. Alternative to driverno.' };
const drivergroupname: Param = { type: 'string', maxLength: 1000, description: 'Driver group name (case-sensitive).' };
const filterstring: Param = { type: 'string', maxLength: 1000, description: 'Arbitrary text matched against the record data.' };
const ungroupedonly = (what: string): Param => ({
  type: 'boolean',
  trueOnly: true,
  description: `true: only ${what} not assigned to any group (overrides the group name filter).`,
});
const tripid: Param = {
  type: 'string',
  maxLength: 20,
  pattern: /^\d+$/,
  patternHint: 'a non-negative integer',
  description: 'Highest tripid already processed (continuous replication): returns newer records only. Passed through as given; the server never pages.',
};
const orderid: Param = { type: 'string', maxLength: 20, description: 'Account-unique order id (case-sensitive, max 20 bytes).' };
const KPI_NAMES = ['tripstats', 'ecostats', 'optidrive', 'speedingevents', 'drivingevents', 'orders'] as const;
const kpinames: Param = { type: 'list', enum: KPI_NAMES, required: true, description: 'KPI groups to return (sent comma-separated).' };
const kpiLevel: Param = { type: 'string', enum: ['day', 'month', 'range'], description: 'Aggregation: day, month, or range (one KPI for the whole range; default).' };
const OBJECT = [['objectno'], ['objectuid']] as const;

const OBJECT_FEATURES = [
  'linkconnect', 'hdtracking', 'waypoints', 'tachodownload', 'drivingtime', 'plugins', 'orderscheduleoptimization',
  'fmsdirect', 'tpms', 'eld', 'video', 'vehiclechecklist', 'proappnav', 'coldchain', 'oemconnect',
] as const;

// ---- catalog --------------------------------------------------------------

const ENDPOINTS: Endpoint[] = [
  // Objects and vehicles
  {
    name: 'webfleet_objects_list',
    action: 'showObjectReportExtern',
    description: 'List all objects (vehicles and assets) with master data and latest position. Webfleet returns the full list (no paging).',
    params: { filterstring, objectgroupname, ungroupedonly: ungroupedonly('objects'), objectno, objectuid },
  },
  {
    name: 'webfleet_vehicles_list',
    action: 'showVehicleReportExtern',
    description: 'List vehicle master data (objects of type vehicle): plate, type, odometer, and similar.',
    params: { filterstring, objectgroupname, objectno, objectuid },
  },
  {
    name: 'webfleet_object_groups_list',
    action: 'showObjectGroups',
    description: 'List object groups and how many objects each contains.',
    params: {
      objectgroupname: { type: 'string', maxLength: 1000, description: 'Only groups with matching names. Alternative to objectgroupuid.' },
      objectgroupuid: { type: 'string', maxLength: 1000, description: 'Unique object group identifier. Alternative to objectgroupname.' },
    },
  },
  {
    name: 'webfleet_object_group_objects_list',
    action: 'showObjectGroupObjects',
    description: 'List which objects belong to which object groups (an object can be in none, one, or several).',
    params: { objectno, objectuid, objectgroupname },
  },
  {
    name: 'webfleet_nearest_vehicles',
    action: 'showNearestVehicles',
    description: 'List vehicles near an address or coordinates, sorted by object state and distance; the 8 nearest include routed distance and travel time.',
    params: {
      addrno: { type: 'string', maxLength: 10, description: 'Address number (unique within the account). Alternative to latitude + longitude.' },
      latitude: { type: 'integer', minimum: -90_000_000, maximum: 90_000_000, description: 'WGS84 latitude in micro-degrees (degrees x 1,000,000).' },
      longitude: { type: 'integer', minimum: -180_000_000, maximum: 180_000_000, description: 'WGS84 longitude in micro-degrees (degrees x 1,000,000).' },
      objectgroupname,
      priority: { type: 'integer', minimum: 1, maximum: 2, enum: [1, 2], description: 'Sort: 1 = state, distance, number (default); 2 = distance, number.' },
      maxdistance: { type: 'integer', minimum: 1, description: 'Maximum straight-line distance from the location, in meters.' },
    },
    requireOneOf: [['addrno'], ['latitude', 'longitude']],
  },
  {
    name: 'webfleet_contracts_list',
    action: 'showContracts',
    description: 'List telematics contract and device information per object.',
    params: { objectno, objectuid },
  },
  {
    name: 'webfleet_object_features',
    action: 'getObjectFeatures',
    description: 'List the features (additional services) available on each object.',
    params: { objectno, objectuid, feature: { type: 'string', enum: OBJECT_FEATURES, description: 'Only this feature.' } },
  },

  // Trips, tracks, and time
  {
    name: 'webfleet_trips',
    action: 'showTripReportExtern',
    description:
      'List trips. Use tripid for continuous replication (records newer than that id, at most 10000 per call) or a date range, which applies to the trip end time.',
    params: { objectno, objectuid, objectgroupname, driverno, driveruid, drivergroupname, tripid },
    dateRange: 'required',
    dateRangeUnless: 'tripid',
  },
  {
    name: 'webfleet_trip_summary',
    action: 'showTripSummaryReportExtern',
    description: 'Daily accumulated trip totals for one object (date range up to one year).',
    params: { objectno, objectuid },
    dateRange: 'required',
    requireOneOf: OBJECT,
  },
  {
    name: 'webfleet_tracks',
    action: 'showTracks',
    description: 'Position history (breadcrumbs) of one vehicle. The date range may not exceed 2 days.',
    params: { objectno, objectuid },
    dateRange: 'required',
    requireOneOf: OBJECT,
  },
  {
    name: 'webfleet_logbook',
    action: 'showLogbook',
    description: 'Logbook entries (trips with their logbook classification). The date range (max one year) applies to the trip end time.',
    params: { objectno, objectuid, tripid, modified_since: iso('Only trips manually edited after this time.') },
    dateRange: 'required',
    dateRangeUnless: 'tripid',
  },
  {
    name: 'webfleet_standstills',
    action: 'showStandStills',
    description: 'Standstill periods per object.',
    params: { objectno, objectuid },
    dateRange: 'required',
  },
  {
    name: 'webfleet_idle_exceptions',
    action: 'showIdleExceptions',
    description: 'Idling exceptions per object or driver.',
    params: { objectno, objectuid, objectgroupname, driverno, driveruid, drivergroupname },
    dateRange: 'required',
  },
  {
    name: 'webfleet_working_times',
    action: 'showWorkingTimes',
    description: 'Driver working time intervals.',
    params: {
      driverno,
      driveruid,
      objectno,
      objectuid,
      drivergroupname,
      objectgroupname,
      timelineType: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        enum: [1, 2, 3, 4],
        description: 'Timeline: 1 any (default), 2 tachograph, 3 PRO device / Work App, 4 verified tachograph (Remote Download).',
      },
    },
    dateRange: 'required',
    requireOneOf: [['driverno'], ['driveruid']],
  },

  // Events
  {
    name: 'webfleet_events',
    action: 'showEventReportExtern',
    description: 'Event and alarm notifications.',
    params: {
      objectno,
      objectuid,
      eventlevel_cur: {
        type: 'integer',
        minimum: 0,
        maximum: 5,
        enum: [0, 1, 2, 3, 4, 5],
        description: 'Event level: 0 message, 1 notice, 2 warning, 3 alarm 1, 4 alarm 2, 5 alarm 3.',
      },
      resolved: { type: 'boolean', description: 'Only resolved (true) or unresolved (false) events.' },
      acknowledged: { type: 'boolean', description: 'Only acknowledged (true) or unacknowledged (false) events.' },
    },
    dateRange: 'required',
  },
  {
    name: 'webfleet_speeding_events',
    action: 'showSpeedingEvents',
    description: 'Speeding events per object or driver.',
    params: { objectno, objectuid, driverno, driveruid, objectgroupname, drivergroupname },
    dateRange: 'required',
  },
  {
    name: 'webfleet_acceleration_events',
    action: 'showAccelerationEvents',
    description: 'Harsh acceleration, braking, and steering events per object or driver.',
    params: {
      objectno,
      objectuid,
      driverno,
      driveruid,
      drivergroupname,
      avg_accel: { type: 'integer', minimum: 0, description: 'Only events with a higher average acceleration, in milli-g (450-549 low, 550-649 medium, 650-749 high, 750+ very high severity).' },
      accelerationtypes: {
        type: 'list',
        enum: ['0', '1', '2', '3'],
        description: 'Types to include: 0 acceleration (on request), 1 brake, 2 steering left, 3 steering right. Default 1, 2, 3.',
      },
    },
    dateRange: 'required',
  },

  // Drivers
  {
    name: 'webfleet_drivers_list',
    action: 'showDriverReportExtern',
    description: 'List drivers (master data).',
    params: { filterstring, driverno, driveruid, ungroupedonly: ungroupedonly('drivers') },
  },
  {
    name: 'webfleet_driver_groups_list',
    action: 'showDriverGroups',
    description: 'List driver groups.',
    params: { drivergroupname: { type: 'string', maxLength: 1000, description: 'Only driver groups with matching names.' } },
  },
  {
    name: 'webfleet_driver_group_drivers_list',
    action: 'showDriverGroupDrivers',
    description: 'List which drivers belong to which driver groups.',
    params: { driverno, driveruid, drivergroupname },
  },

  // KPIs
  {
    name: 'webfleet_object_kpis',
    action: 'getObjectKPIs',
    description: 'KPIs (trip, eco, OptiDrive, speeding, driving events, orders) per object.',
    params: { objectno, objectuid, kpinames, level: kpiLevel },
    dateRange: 'required',
  },
  {
    name: 'webfleet_driver_kpis',
    action: 'getDriverKPIs',
    description: 'KPIs (trip, eco, OptiDrive, speeding, driving events, orders) per driver.',
    params: { driverno: { ...driverno, maxLength: 15 }, driveruid, kpinames, level: kpiLevel },
    dateRange: 'required',
  },

  // Addresses
  {
    name: 'webfleet_addresses_list',
    action: 'showAddressReportExtern',
    description: 'List addresses and points of interest.',
    params: {
      filterstring,
      addressgroupname: { type: 'string', maxLength: 1000, description: 'Address group name.' },
      ungroupedonly: ungroupedonly('addresses'),
      addrnr: { type: 'string', maxLength: 10, description: 'Address number (unique within the account).' },
      addruid: { type: 'string', maxLength: 1000, description: 'Unique, unchangeable address identifier.' },
    },
  },
  {
    name: 'webfleet_address_groups_list',
    action: 'showAddressGroupReportExtern',
    description: 'List address groups.',
    params: { filterstring: { type: 'string', maxLength: 1000, description: 'Text matched against the address group name.' } },
  },
  {
    name: 'webfleet_address_group_addresses_list',
    action: 'showAddressGroupAddressReportExtern',
    description: 'List which addresses belong to which address groups.',
    params: { filterstring: { type: 'string', maxLength: 1000, description: 'Text matched against the address group name.' } },
  },

  // Orders and messages
  {
    name: 'webfleet_orders_list',
    action: 'showOrderReportExtern',
    description: 'List orders and their status.',
    params: {
      objectno,
      objectuid,
      objectgroupname,
      orderid,
      ordertype: { type: 'integer', minimum: 1, maximum: 3, enum: [1, 2, 3], description: 'Order type: 1 service, 2 pickup, 3 delivery.' },
    },
    dateRange: 'required',
    dateRangeUnless: 'orderid',
  },
  {
    name: 'webfleet_order_waypoints',
    action: 'showOrderWaypoints',
    description: 'List the waypoints of one order.',
    params: { orderid: { ...orderid, required: true } },
  },
  {
    name: 'webfleet_messages_list',
    action: 'showMessages',
    description: 'Read text, order status, and text status messages exchanged with driver terminals (max 500 per call; the range may start at most 14 days back). Does not touch the message queue.',
    params: {
      objectno,
      objectuid,
      category: { type: 'integer', minimum: 1, maximum: 3, enum: [1, 2, 3], description: 'Category: 1 text messages, 2 order status messages, 3 text status messages.' },
    },
    dateRange: 'required',
  },
];

export const CATALOG_TOOLS: readonly ToolDef[] = ENDPOINTS.map(endpointTool);
