import { sql } from "drizzle-orm";

type LockingDb = {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
};

/**
 * Shared serialization boundary for every operation that can create, move,
 * approve, or invalidate a booking. Facilities are always acquired before
 * users, and each group is sorted, so multi-resource operations cannot invert
 * lock order.
 */
export async function lockBookingResources(
  db: LockingDb,
  resources: {
    facilityIds?: Iterable<string | null | undefined>;
    userIds?: Iterable<string | null | undefined>;
  },
): Promise<void> {
  const lock = async (namespace: "facility" | "user", id: string) => {
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`booking:${namespace}:${id}`}))`,
    );
  };
  const facilities = [...new Set(resources.facilityIds ?? [])]
    .filter((id): id is string => !!id)
    .sort();
  const users = [...new Set(resources.userIds ?? [])]
    .filter((id): id is string => !!id)
    .sort();
  for (const id of facilities) await lock("facility", id);
  for (const id of users) await lock("user", id);
}
