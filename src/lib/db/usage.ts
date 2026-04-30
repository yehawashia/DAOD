import { query } from "./client";

/**
 * Returns the number of scenes generated today for an authenticated user.
 */
export async function getUsageToday(userId: string): Promise<number> {
  const rows = await query<{ scene_count: string }>(
    `SELECT scene_count FROM usage
     WHERE user_id = $1 AND date = CURRENT_DATE`,
    [userId]
  );
  return rows.length > 0 ? parseInt(rows[0].scene_count, 10) : 0;
}

/**
 * Upserts a usage row for today, incrementing scene_count by 1.
 */
export async function incrementUsage(userId: string): Promise<void> {
  await query(
    `INSERT INTO usage (user_id, date, scene_count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (user_id, date)
     DO UPDATE SET scene_count = usage.scene_count + 1`,
    [userId]
  );
}

/**
 * Returns the number of scenes generated today for an unauthenticated IP.
 */
export async function getIpUsageToday(ip: string): Promise<number> {
  const rows = await query<{ scene_count: string }>(
    `SELECT scene_count FROM ip_usage
     WHERE ip_address = $1 AND date = CURRENT_DATE`,
    [ip]
  );
  return rows.length > 0 ? parseInt(rows[0].scene_count, 10) : 0;
}

/**
 * Upserts an IP usage row for today, incrementing scene_count by 1.
 */
export async function incrementIpUsage(ip: string): Promise<void> {
  await query(
    `INSERT INTO ip_usage (ip_address, date, scene_count)
     VALUES ($1, CURRENT_DATE, 1)
     ON CONFLICT (ip_address, date)
     DO UPDATE SET scene_count = ip_usage.scene_count + 1`,
    [ip]
  );
}
