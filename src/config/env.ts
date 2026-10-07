import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  
  // Database connection
  DATABASE_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/prod_main'),
  DB_SSL: z.string().transform(v => v === 'true').default('false'),
  DB_MAX_CONNECTIONS: z.coerce.number().default(20),
  
  // Security
  ADMIN_API_KEY: z.string().min(8).default('eter_admin_secret_key_change_in_production'),
  
  // Gateway Guardrails
  DEFAULT_RATE_LIMIT_RPM: z.coerce.number().default(120),
  MAX_QUERY_LIMIT: z.coerce.number().default(100),
  QUERY_TIMEOUT_MS: z.coerce.number().default(5000),
});

export const config = envSchema.parse(process.env);
