import { NextResponse } from "next/server";

import {
  createGoogleCalendarEventFromRecord,
  deleteGoogleCalendarEvent,
  updateGoogleCalendarEventFromRecord,
} from "@/lib/cgmp/google-external-server";
import type { CGMPRecord } from "@/lib/cgmp/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { record?: CGMPRecord };
    if (!body.record?.id) {
      return NextResponse.json({ ok: false, error: "RECORD_REQUIRED" }, { status: 400 });
    }
    const result = await createGoogleCalendarEventFromRecord(body.record);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOOGLE_CALENDAR_CREATE_FAILED";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: message === "CALENDAR_DATE_REQUIRED" ? 400 : 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { record?: CGMPRecord };
    if (!body.record?.id) {
      return NextResponse.json({ ok: false, error: "RECORD_REQUIRED" }, { status: 400 });
    }
    const result = await updateGoogleCalendarEventFromRecord(body.record);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOOGLE_CALENDAR_UPDATE_FAILED";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: message === "CALENDAR_DATE_REQUIRED" ? 400 : 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      calendarId?: string;
      eventId?: string;
    };
    if (!body.calendarId || !body.eventId) {
      return NextResponse.json({ ok: false, error: "CALENDAR_DELETE_REQUEST_INVALID" }, { status: 400 });
    }
    const result = await deleteGoogleCalendarEvent({ calendarId: body.calendarId, eventId: body.eventId });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "GOOGLE_CALENDAR_DELETE_FAILED",
      },
      { status: 500 }
    );
  }
}
