export type CGMPAction = "note" | "reminder" | "calendar" | "unclear";

export type CGMPPara = "project" | "area" | "resource" | "archive" | "";

export type CGMPDomain =
  | "work"
  | "family"
  | "self"
  | "health"
  | "finance"
  | "learning"
  | "creation"
  | "life_admin"
  | "other"
  | "";

export type CGMPExtId = "calendar" | "reminder" | "";

export type CGMPExternalActionStatus =
  | "none"
  | "pending_confirmation"
  | "registered"
  | "skipped"
  | "failed";

export type CGMPAIStatus = "none" | "done" | "error" | "timeout" | "pending_ai";

export type CGMPAnalysis = {
  action: CGMPAction;
  para: CGMPPara;
  domain: CGMPDomain;
  title: string;
  body: string;
  date: string;
  time: string;
  duration_minutes: number;
  all_day: boolean;
  location: string;
  confirmation: string;
  note_tags: string;
  note_index_line: string;
  user_intent_summary: string;
  summary: string;
  tags: string[];
};

export type CGMPAnalysisResponse = {
  ok: boolean;
  model: string;
  generated_at: string;
  result: CGMPAnalysis;
  error?: string;
  raw_response_text?: string;
};

export type CGMPRecord = {
  schema_version: number;
  id: string;
  created_at: string;
  updated_at: string;
  raw_input: string;
  title: string;
  summary: string;
  body: string;
  action: CGMPAction;
  tags: string[];
  para: CGMPPara;
  domain: CGMPDomain;
  date: string;
  time: string;
  all_day: boolean;
  duration_minutes: number;
  location: string;
  confirmation: string;
  note_tags: string;
  note_index_line: string;
  user_intent_summary: string;
  ai_status: CGMPAIStatus;
  ai_error: string;
  external_action_status: CGMPExternalActionStatus;
  external_target: CGMPExtId;
  external_registered_at: string;
  ai: {
    model: string;
    generated_at: string;
    initial_title: string;
    initial_tags: string[];
    initial_date: string;
    initial_time: string;
    initial_action: CGMPAction;
    initial_para: CGMPPara;
    initial_domain: CGMPDomain;
    initial_summary: string;
  };
};

export type CGMPSettings = {
  id: "settings";
  schema_version: number;
  openai_model: string;
  timezone: string;
  created_at: string;
  updated_at: string;
};

export type CGMPRecordDraft = Pick<
  CGMPRecord,
  | "raw_input"
  | "title"
  | "summary"
  | "body"
  | "action"
  | "tags"
  | "para"
  | "domain"
  | "date"
  | "time"
  | "all_day"
  | "duration_minutes"
  | "location"
  | "confirmation"
  | "note_tags"
  | "note_index_line"
  | "user_intent_summary"
> & {
  ai_status?: CGMPAIStatus;
  ai_error?: string;
  external_action_status?: CGMPExternalActionStatus;
  external_target?: CGMPExtId;
  external_registered_at?: string;
};
