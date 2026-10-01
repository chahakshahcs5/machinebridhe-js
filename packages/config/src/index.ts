import { z } from 'zod';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional
  }
}

export const ConfigSchema = z.object({
  NODE_ENV: z.string().default('development'),
  EDGE_HOST: z.string().default('0.0.0.0'),
  EDGE_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z
    .string()
    .default('postgres://machinebridge:machinebridge@localhost:5432/machinebridge'),
  EDGE_REGISTRATION_TOKEN: z.string().min(16).default('change-this-registration-token'),
  EDGE_CLIENT_SECRET: z.string().min(16).default('change-this-client-secret'),
  MACHINEBRIDGE_API_KEY: z.string().default('machinebridge-dev-key'),
  MACHINEBRIDGE_DATA_DIR: z.string().default('.machinebridge'),
  MACHINEBRIDGE_MAX_SESSIONS: z.coerce.number().int().positive().default(8),
  MACHINEBRIDGE_MAX_BUFFER_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 1024 * 1024),
  MACHINEBRIDGE_MAX_MESSAGE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(1024 * 1024),
  MACHINEBRIDGE_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  MACHINEBRIDGE_CLOCK_SKEW_SECONDS: z.coerce.number().int().positive().default(60),
  MACHINEBRIDGE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  MACHINEBRIDGE_EXPOSE_TUNNEL: z.preprocess((val) => {
    if (typeof val === 'string') {
      return ['true', '1', 'yes'].includes(val.toLowerCase());
    }
    return Boolean(val);
  }, z.boolean().default(false)),
  MACHINEBRIDGE_TUNNEL_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse(env);
}
