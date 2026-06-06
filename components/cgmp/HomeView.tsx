"use client";

import type { ImageAttachment } from "@/types/image";
import type { CGMPAction, CGMPDomain, CGMPPara, CGMPRecord } from "@/lib/cgmp/types";
import { normalizeAction, normalizeDomain, normalizePara } from "@/lib/cgmp/utils";
import { DOMAIN_FILTER_OPTIONS } from "@/lib/cgmp/client-utils";
import {
  getDomainColorVar,
  LabeledInput,
  LabeledSelect,
  panelClass,
  primaryButtonClass,
  secondaryButtonClass,
  SectionHeading,
  softPanelClass,
} from "@/components/cgmp/ui";
import { RecordCard } from "@/components/cgmp/RecordCards";

type SortKey = "updated_at" | "created_at" | "datetime";
type SearchMode = "text" | "semantic";

type HomeViewProps = {
  records: CGMPRecord[];
  selectedId: string | null;
  checkedRecordIds: string[];
  query: string;
  tagQuery: string;
  actionFilter: "all" | CGMPAction;
  domainFilter: "all" | CGMPDomain;
  paraFilter: "all" | CGMPPara;
  sortKey: SortKey;
  searchMode: SearchMode;
  semanticStatusText: string;
  isFilterOpen: boolean;
  activeFilterCount: number;
  externalProcessingKey: string;
  isPhotoProcessing: boolean;
  isBackupProcessing: boolean;
  onQueryChange: (value: string) => void;
  onTagQueryChange: (value: string) => void;
  onActionFilterChange: (value: "all" | CGMPAction) => void;
  onDomainFilterChange: (value: "all" | CGMPDomain) => void;
  onParaFilterChange: (value: "all" | CGMPPara) => void;
  onSortKeyChange: (value: SortKey) => void;
  onSearchModeChange: (value: SearchMode) => void;
  onFilterOpenChange: (value: boolean | ((current: boolean) => boolean)) => void;
  onGoCompose: () => void;
  onClearFilters: () => void;
  onOpenRecord: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onRegisterGoogleTask: (recordId: string) => void;
  onToggleGoogleTaskStatus: (recordId: string) => void;
  onRegisterGoogleCalendarEvent: (recordId: string) => void;
  onOpenImage: (attachment: ImageAttachment, imageUrl: string) => void;
  onReanalyzeAttachment: (recordId: string, attachmentId: string) => void;
  onDeleteAttachment: (recordId: string, attachmentId: string) => void;
  onAddPhotos: (recordId: string, files: File[]) => void;
  onSyncOne: (recordId: string) => void;
  onAnalyzeRecord: (recordId: string) => void;
  onShowBadgeInfo: Parameters<typeof RecordCard>[0]["onShowBadgeInfo"];
  onToggleCheck: (recordId: string) => void;
};

export function HomeView({
  records,
  selectedId,
  checkedRecordIds,
  query,
  tagQuery,
  actionFilter,
  domainFilter,
  paraFilter,
  sortKey,
  searchMode,
  semanticStatusText,
  isFilterOpen,
  activeFilterCount,
  externalProcessingKey,
  isPhotoProcessing,
  isBackupProcessing,
  onQueryChange,
  onTagQueryChange,
  onActionFilterChange,
  onDomainFilterChange,
  onParaFilterChange,
  onSortKeyChange,
  onSearchModeChange,
  onFilterOpenChange,
  onGoCompose,
  onClearFilters,
  onOpenRecord,
  onEdit,
  onDelete,
  onRegisterGoogleTask,
  onToggleGoogleTaskStatus,
  onRegisterGoogleCalendarEvent,
  onOpenImage,
  onReanalyzeAttachment,
  onDeleteAttachment,
  onAddPhotos,
  onSyncOne,
  onAnalyzeRecord,
  onShowBadgeInfo,
  onToggleCheck,
}: HomeViewProps) {
  return (
    <div className="grid min-w-0 gap-3 sm:gap-4">
      <section className={panelClass}>
        <SectionHeading eyebrow="Home" title="一覧・検索・フィルター" />

        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <LabeledInput label="Text search" value={query} onChange={onQueryChange} placeholder="title / summary / body" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onFilterOpenChange((open) => !open)}
              className={secondaryButtonClass}
              aria-expanded={isFilterOpen}
            >
              {isFilterOpen ? "フィルターを閉じる" : `フィルター${activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}`}
            </button>
            <button type="button" onClick={onGoCompose} className={primaryButtonClass}>
              新規入力へ
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {[
            { value: "text", label: "通常検索" },
            { value: "semantic", label: "意味検索" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onSearchModeChange(item.value as SearchMode)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                searchMode === item.value
                  ? "border-[color:var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]"
                  : "border-[color:var(--border)] bg-[var(--card-soft)] text-[var(--muted)]"
              }`}
            >
              {item.label}
            </button>
          ))}
          {searchMode === "semantic" ? <span className="text-xs text-[var(--muted)]">{semanticStatusText}</span> : null}
        </div>

        <div className="mt-3 min-w-0">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {DOMAIN_FILTER_OPTIONS.map((item) => {
              const isActive = domainFilter === item.value;
              const color = getDomainColorVar(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onDomainFilterChange(isActive ? "all" : item.value)}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
                    isActive ? "shadow-[0_8px_18px_var(--shadow-soft)]" : "opacity-70 hover:opacity-100"
                  }`}
                  style={{
                    color,
                    borderColor: color,
                    backgroundColor: isActive
                      ? `color-mix(in srgb, ${color} 18%, var(--card))`
                      : `color-mix(in srgb, ${color} 7%, var(--card))`,
                  }}
                  aria-pressed={isActive}
                  title={`${item.value}で絞り込み${isActive ? "を解除" : ""}`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`overflow-hidden transition-[max-height,opacity,margin-top] duration-300 ease-out ${
            isFilterOpen ? "mt-3 max-h-[32rem] opacity-100" : "mt-0 max-h-0 opacity-0"
          }`}
        >
          <div className="rounded-[20px] border border-[color:var(--border)] bg-[var(--card-soft)] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label="Tag search" value={tagQuery} onChange={onTagQueryChange} placeholder="例: 仕様" />
              <LabeledSelect
                label="並び順"
                value={sortKey}
                onChange={(value) => onSortKeyChange(value === "datetime" ? "datetime" : value === "created_at" ? "created_at" : "updated_at")}
                options={[
                  { value: "updated_at", label: "更新順" },
                  { value: "created_at", label: "作成順" },
                  { value: "datetime", label: "日時順" },
                ]}
              />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <LabeledSelect
                label="Action"
                value={actionFilter}
                onChange={(value) => onActionFilterChange(value === "all" ? "all" : normalizeAction(value))}
                options={[
                  { value: "all", label: "すべて" },
                  { value: "note", label: "note" },
                  { value: "reminder", label: "reminder" },
                  { value: "calendar", label: "calendar" },
                  { value: "unclear", label: "unclear" },
                ]}
              />
              <LabeledSelect
                label="Domain"
                value={domainFilter}
                onChange={(value) => onDomainFilterChange(value === "all" ? "all" : normalizeDomain(value))}
                options={[
                  { value: "all", label: "すべて" },
                  { value: "work", label: "work" },
                  { value: "family", label: "family" },
                  { value: "self", label: "self" },
                  { value: "health", label: "health" },
                  { value: "finance", label: "finance" },
                  { value: "learning", label: "learning" },
                  { value: "creation", label: "creation" },
                  { value: "life_admin", label: "life_admin" },
                  { value: "other", label: "other" },
                ]}
              />
              <LabeledSelect
                label="PARA"
                value={paraFilter}
                onChange={(value) => onParaFilterChange(value === "all" ? "all" : normalizePara(value))}
                options={[
                  { value: "all", label: "すべて" },
                  { value: "project", label: "project" },
                  { value: "area", label: "area" },
                  { value: "resource", label: "resource" },
                  { value: "archive", label: "archive" },
                ]}
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={onClearFilters} className={secondaryButtonClass}>
                クリア
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-3 overflow-hidden">
        {records.length > 0 ? (
          records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              onOpen={onOpenRecord}
              onEdit={onEdit}
              onDelete={onDelete}
              onRegisterGoogleTask={onRegisterGoogleTask}
              onToggleGoogleTaskStatus={onToggleGoogleTaskStatus}
              onRegisterGoogleCalendarEvent={onRegisterGoogleCalendarEvent}
              onOpenImage={onOpenImage}
              onReanalyzeAttachment={onReanalyzeAttachment}
              onDeleteAttachment={onDeleteAttachment}
              onAddPhotos={onAddPhotos}
              onSyncOne={onSyncOne}
              onAnalyzeRecord={onAnalyzeRecord}
              onShowBadgeInfo={onShowBadgeInfo}
              externalProcessingKey={externalProcessingKey}
              isPhotoProcessing={isPhotoProcessing}
              isBackupProcessing={isBackupProcessing}
              isChecked={checkedRecordIds.includes(record.id)}
              onToggleCheck={onToggleCheck}
              isSelected={record.id === selectedId}
            />
          ))
        ) : (
          <div className={`${softPanelClass} text-sm text-slate-500`}>
            条件に一致する記録がありません。まずは Compose で1件保存してみてください。
          </div>
        )}
      </section>
    </div>
  );
}
