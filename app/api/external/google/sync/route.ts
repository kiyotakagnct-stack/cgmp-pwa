import { NextResponse } from "next/server";

import { getGoogleCalendarEventStatus, getGoogleTaskStatus } from "@/lib/cgmp/google-external-server";
import type { CGMPRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

type SyncResult = {
  recordId: string;
  ok: boolean;
  google_task_status?: string;
  google_task_updated_at?: string;
  google_calendar_updated_at?: string;
  google_calendar_status?: string;
  calendar_title?: string;
  calendar_location?: string;
  calendar_date?: string;
  calendar_time?: string;
  calendar_all_day?: boolean;
  calendar_duration_minutes?: number;
  error?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { records?: CGMPRecord[] };
    const records = Array.isArray(body.records) ? body.records : [];
    const results: SyncResult[] = [];

    for (const record of records) {
      const result: SyncResult = { recordId: record.id, ok: true };
      try {
        if (record.google_task_id && record.google_task_list_id) {
          const task = await getGoogleTaskStatus({
            taskListId: record.google_task_list_id,
            taskId: record.google_task_id,
          });
          result.google_task_status = task.status;
          result.google_task_updated_at = task.updatedAt;
        }
        if (record.google_calendar_event_id && record.google_calendar_id) {
          const event = await getGoogleCalendarEventStatus({
            calendarId: record.google_calendar_id,
            eventId: record.google_calendar_event_id,
          });
          result.google_calendar_status = event.status;
          result.google_calendar_updated_at = event.updatedAt;
          result.calendar_title = event.event.title;
          result.calendar_location = event.event.location;
          result.calendar_date = event.event.date;
          result.calendar_time = event.event.time;
          result.calendar_all_day = event.event.allDay;
          result.calendar_duration_minutes = event.event.durationMinutes;
        }
      } catch (error) {
        result.ok = false;
        result.error = error instanceof Error ? error.message : "GOOGLE_EXTERNAL_SYNC_ITEM_FAILED";
      }
      results.push(result);
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "GOOGLE_EXTERNAL_SYNC_FAILED",
      },
      { status: 500 }
    );
  }
}
