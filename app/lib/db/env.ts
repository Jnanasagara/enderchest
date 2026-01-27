export const dbEnv = {
  host: process.env.POSTGRES_HOST!,
  port: Number(process.env.POSTGRES_PORT!),
  database: process.env.POSTGRES_DB!,
  user: process.env.POSTGRES_USER!,
  password: process.env.POSTGRES_PASSWORD!,
};
