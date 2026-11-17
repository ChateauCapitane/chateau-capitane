import "server-only";
import type { Staff } from "./auth/staff-auth";
import { callRpc, type Configuration } from "./inquiries/persistence";

export const SUMMARY_MONTHS = 6;
export type MonthRow = {
  month: string; bookEn: number; bookRu: number; callEn: number; callRu: number;
};

/** Newest month first. Undefined when storage is unavailable or the reply is not the expected shape. */
export async function getMonthlySummary(configuration: Configuration, staff: Staff): Promise<MonthRow[] | undefined> {
  const rows = await callRpc(configuration, "staff_click_summary",
    { p_staff: staff.userId, p_months: SUMMARY_MONTHS }, 16 * 1024);
  const numbers = ["bookEn", "bookRu", "callEn", "callRu"] as const;
  const valid = Array.isArray(rows) && rows.every((row) => row && typeof row.month === "string" &&
    numbers.every((key) => Number.isInteger(row[key])));
  return valid ? (rows as MonthRow[]) : undefined;
}
