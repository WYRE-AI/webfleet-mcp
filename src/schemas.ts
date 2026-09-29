import { z } from 'zod';
import { RANGE_PATTERNS } from './constants.js';

const optionalText = z.string().trim().min(1).optional();

export const objectsListSchema = z
  .object({
    report: z.enum(['object', 'vehicle']).optional(),
    filterstring: optionalText,
    objectgroupname: optionalText,
    ungroupedonly: z.boolean().optional(),
    objectno: z.string().trim().min(1).max(10).optional(),
    objectuid: z.string().trim().min(1).max(30).optional(),
    externalid: optionalText,
    columnfilter: optionalText,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.report === 'vehicle' && value.ungroupedonly) {
      ctx.addIssue({
        code: 'custom',
        message: 'ungroupedonly applies to showObjectReportExtern only. Omit it when report is vehicle.',
      });
    }
  });

export type ObjectsListInput = z.infer<typeof objectsListSchema>;

const tripId = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);

export const tripsSchema = z
  .object({
    objectno: z.string().trim().min(1).max(10).optional(),
    objectuid: z.string().trim().min(1).max(30).optional(),
    objectgroupname: optionalText,
    driverno: optionalText,
    driveruid: optionalText,
    drivergroupname: optionalText,
    tripid: tripId.optional(),
    range_pattern: z.enum(RANGE_PATTERNS).optional(),
    rangefrom_string: optionalText,
    rangeto_string: optionalText,
    externalid: optionalText,
    columnfilter: optionalText,
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasTrip = value.tripid !== undefined;
    const hasPattern = value.range_pattern !== undefined;
    const hasFrom = value.rangefrom_string !== undefined;
    const hasTo = value.rangeto_string !== undefined;

    if (!hasTrip && !hasPattern && !hasFrom && !hasTo) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Provide tripid for continuous replication, or a date filter (range_pattern, or rangefrom_string and rangeto_string). showTripReportExtern requires one of these.',
      });
    }

    if (hasFrom !== hasTo) {
      ctx.addIssue({
        code: 'custom',
        message: 'rangefrom_string and rangeto_string must be provided together.',
      });
    }

    if (hasPattern && value.range_pattern !== 'ud' && (hasFrom || hasTo)) {
      ctx.addIssue({
        code: 'custom',
        message: 'range_pattern excludes rangefrom_string and rangeto_string unless range_pattern is ud.',
      });
    }

    if (value.range_pattern === 'ud' && (!hasFrom || !hasTo)) {
      ctx.addIssue({
        code: 'custom',
        message: 'range_pattern ud requires rangefrom_string and rangeto_string.',
      });
    }
  });

export type TripsInput = z.infer<typeof tripsSchema>;

export const rawRequestSchema = z
  .object({
    action: z.string().trim().min(1).max(80),
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

export type RawRequestInput = z.infer<typeof rawRequestSchema>;
