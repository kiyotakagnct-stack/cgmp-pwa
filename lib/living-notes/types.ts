export type Thread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
};

export type Note = {
  id: string;
  threadId: string;
  kind: "note";
  source: "user";
  content: string;
  previewTitle: string;
  createdAt: string;
  updatedAt: string;
  dateKey: string;
  timeKey: string;
  suggestedTags: string[];
  confirmedTags: string[];
  children: NoteChild[];
};

export type NoteChild = {
  id: string;
  parentNoteId: string;
  type: "ai_reply" | "user_reply" | "photo" | "tag" | "revision";
  status: "bud" | "branch";
  source: "ai" | "user";
  content: string;
  previewTitle?: string;
  createdAt: string;
  updatedAt: string;
  dateKey: string;
  timeKey: string;
  suggestedTags: string[];
  confirmedTags: string[];
  promotedReason?: "manual" | "replied" | "edited";
  updates: NoteChildUpdate[];
};

export type NoteChildUpdate = {
  id: string;
  childId: string;
  source: "user" | "ai";
  content: string;
  createdAt: string;
  updatedAt: string;
  dateKey: string;
  timeKey: string;
  suggestedTags: string[];
  confirmedTags: string[];
};
