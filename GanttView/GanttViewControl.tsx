import * as React from "react";

export interface IGanttViewControlProps {
  name?: string;
  ganttStartDate: Date;
  ganttEndDate: Date;
  currentDate: Date;
  expandDetails: boolean;
  adjustableEndDate?: boolean;
  columnViewCount?: number; // how many timeline columns to show at once
  fontColor?: string;
  fontSize?: number; // in px
  data: GanttRow[];
  colors?: string[]; // [project, tender]
  selectedId?: string; // currently selected row id (for highlight)
  onEndDateChange?: (rowId: string, newDate: Date) => void; // optional callback
  // onSelect provides internal row uid (record guid) and source data id from Items['id']
  onSelect?: (rowUid: string, dataId?: string, rowType?: string | null) => void;
  showFilters?: boolean;
  filtersText?: string;
}

type GanttRow = {
  id: string; // internal unique id (record GUID)
  sourceId?: string; // Items['id'] value to output to Canvas
  name: string;
  assigned: string | null;
  startDate: Date | null;
  endDate: Date | null;
  rowType: string | null;
  sourceRowType?: string | null; // original dataset value for rowType (pre-normalization)
  progress: number | null;
  parentId: string;
  level: number | null;
  milestones: GanttRow[];
};

interface EditingEndState {
  rowId: string;
  startX: number;
  rowLeftPct: number;
  startWidthPct: number;
  liveWidthPct: number;
  containerPx: number;
  winStart: Date;
  winEnd: Date;
}

interface IGanttViewState {
  nameWidth: number;
  startWidth: number;
  endWidth: number;
  editingEnd: EditingEndState | null;
  endDateOverrides: Record<string, Date>;
  zoomLevel: "month" | "week" | "year";
  containerWidth: number;
  sortField: "name" | "startDate" | "endDate";
  sortDir: "asc" | "desc";
}

export class GanttViewControl extends React.Component<
  IGanttViewControlProps,
  IGanttViewState
> {
  state: IGanttViewState = {
    nameWidth: 250,
    startWidth: 100, // increased by 10px
    endWidth: 100, // increased by 10px
    editingEnd: null,
    endDateOverrides: {},
    zoomLevel: "year",
    containerWidth: 0,
    sortField: "name",
    sortDir: "asc",
  };

  private nameResizeInfo?: { startX: number; startWidth: number };

  private onNameResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    this.nameResizeInfo = {
      startX: e.clientX,
      startWidth: this.state.nameWidth,
    };
    window.addEventListener("mousemove", this.onNameResizeMove as any);
    window.addEventListener("mouseup", this.onNameResizeEnd as any);
  };
  private onNameResizeMove = (e: MouseEvent) => {
    if (!this.nameResizeInfo) return;
    const delta = e.clientX - this.nameResizeInfo.startX;
    let w = this.nameResizeInfo.startWidth + delta;
  const MIN = 150;
  const MAX = 700; // updated maximum width per latest requirement
    if (w < MIN) w = MIN;
    if (w > MAX) w = MAX;
    if (w !== this.state.nameWidth) {
      this.setState({ nameWidth: w });
    }
  };
  private onNameResizeEnd = () => {
    this.nameResizeInfo = undefined;
    window.removeEventListener("mousemove", this.onNameResizeMove as any);
    window.removeEventListener("mouseup", this.onNameResizeEnd as any);
    // Recenter after resize (slight delay to allow layout settle)
    this.measureTimers.push(
      window.setTimeout(() => this.centerOnCurrentDate(), 60)
    );
  };

  private renderSortIcon(field: "name" | "startDate" | "endDate") {
    const active = this.state.sortField === field;
    const dir = this.state.sortDir;
    const baseStyle: React.CSSProperties = {
      width: 12,
      height: 12,
      display: "inline-block",
    };
    if (!active) {
      return (
        <span className="sort-icon inactive" aria-hidden="true">
          <svg viewBox="0 0 12 12" width={12} height={12} focusable="false">
            <path
              d="M6 8.2L3.2 4h5.6L6 8.2z"
              fill="currentColor"
              opacity="0.35"
            />
          </svg>
        </span>
      );
    }
    return (
      <span
        className={"sort-icon " + (dir === "asc" ? "asc" : "desc")}
        aria-hidden="true"
        style={baseStyle}
      >
        {dir === "asc" ? (
          <svg viewBox="0 0 12 12" width={12} height={12} focusable="false">
            <path d="M6 3.2L9.5 8H2.5L6 3.2z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" width={12} height={12} focusable="false">
            <path d="M6 8.8L2.5 4h7L6 8.8z" fill="currentColor" />
          </svg>
        )}
      </span>
    );
  }

  private formatDateDDMMYYYY(d: Date | null | undefined): string {
    if (!d || isNaN(new Date(d).getTime())) return "Blank";
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    const yr = d.getFullYear();
    return `${day}/${mon}/${yr}`;
  }

  private wrapperRef: React.RefObject<HTMLDivElement> = React.createRef();
  private lastCenterSignature?: string;
  private resizeObserver?: any;
  private measureTimers: number[] = [];

  private updateContainerWidth = () => {
    const el = this.wrapperRef.current;
    if (el) {
      // Measure parent width to avoid positive feedback with growing table width
      const parentW = el.parentElement ? el.parentElement.clientWidth : 0;
      const w = parentW || el.clientWidth || 0;
      // Prevent oscillation: only update if actual change >2px
      if (w && Math.abs(w - this.state.containerWidth) > 2) {
        this.setState({ containerWidth: w });
      } else if (!w) {
        // If width is 0 (not yet laid out), retry shortly
        this.measureTimers.push(
          window.setTimeout(() => {
            const ww = el.clientWidth || 0;
            if (ww && Math.abs(ww - this.state.containerWidth) > 2) {
              this.setState({ containerWidth: ww });
            }
          }, 30)
        );
      }
    }
  };

  componentDidMount(): void {
  // Initial measurement (initial nameWidth already 250 by default)
    this.updateContainerWidth();

    // Observe wrapper size changes using ResizeObserver when available
    const RO = (window as any).ResizeObserver;
    const el = this.wrapperRef.current;
    if (RO && el) {
      this.resizeObserver = new RO((entries: any[]) => {
        try {
          const entry = entries && entries[0];
          const w = entry?.contentRect?.width
            ? Math.floor(entry.contentRect.width)
            : el.clientWidth || 0;
          if (w && w !== this.state.containerWidth) {
            this.setState({ containerWidth: w });
          }
        } catch {}
      });
      try {
        this.resizeObserver.observe(el);
      } catch {}
    }

    // Fallback: also listen to window resize
    window.addEventListener("resize", this.updateContainerWidth);

    // Defer a couple extra measurements to catch late layout/font loads
    this.measureTimers.push(window.setTimeout(this.updateContainerWidth, 0));
    this.measureTimers.push(window.setTimeout(this.updateContainerWidth, 50));
    this.measureTimers.push(window.setTimeout(this.updateContainerWidth, 250));

    // Center to current date shortly after mount (once sizes stabilize)
    this.measureTimers.push(
      window.setTimeout(() => this.centerOnCurrentDate(), 100)
    );
  }

  componentWillUnmount(): void {
    window.removeEventListener("resize", this.updateContainerWidth);
    if (this.resizeObserver) {
      try {
        this.resizeObserver.disconnect();
      } catch {}
      this.resizeObserver = undefined;
    }
    // Clear any scheduled measurement timers
    this.measureTimers.forEach((id) => window.clearTimeout(id));
    this.measureTimers = [];
  }

  componentDidUpdate(
    prevProps: IGanttViewControlProps,
    prevState: IGanttViewState
  ): void {
    // Recenter when layout-affecting inputs change
    const signature = this.buildCenterSignature();
    if (signature !== this.lastCenterSignature) {
      this.centerOnCurrentDate();
      this.lastCenterSignature = signature;
    }
  }

  private buildCenterSignature() {
    const segLen = this.getSegments().length;
    return [
      this.state.zoomLevel,
      this.state.containerWidth,
      this.props.expandDetails ? 1 : 0,
      this.props.columnViewCount || 0,
      segLen,
      this.props.currentDate ? this.props.currentDate.toDateString() : "",
      this.state.sortField,
      this.state.sortDir,
    ].join("|");
  }

  private centerOnCurrentDate() {
    const wrapper = this.wrapperRef.current;
    if (!wrapper) return;
    const segments = this.getSegments();
    if (!segments.length) return;
    const { nameWidth, startWidth, endWidth } = this.state;
    // Detail columns are sticky; reserve their width so centering targets the timeline region only
    const fixedWidth =
      nameWidth + (this.props.expandDetails ? startWidth + endWidth : 0);
    const containerPx = this.state.containerWidth || wrapper.clientWidth || 0;
    const desiredVisible =
      this.state.zoomLevel === "week" || this.state.zoomLevel === "month"
        ? (() => {
            const base =
              this.props.columnViewCount && this.props.columnViewCount > 0
                ? this.props.columnViewCount
                : segments.length;
            // Week view shows double the month count
            return this.state.zoomLevel === "week" ? base * 2 : base;
          })()
        : segments.length; // year view shows all
    const visibleCount = Math.max(1, Math.min(segments.length, desiredVisible));
    const availablePx = Math.max(0, containerPx - fixedWidth);
    let segWidthPx = Math.max(8, Math.floor(availablePx / visibleCount));
    // For year view we distribute remainder pixels so total timeline width equals availablePx
    let timelineWidth: number;
    if (this.state.zoomLevel === "year") {
      timelineWidth = availablePx; // we'll allocate across columns below for centering calc
    } else {
      timelineWidth = segWidthPx * segments.length;
    }
    const tableWidthPx = fixedWidth + timelineWidth;
    let pct = this.calculateStartX(this.props.currentDate);
    if (pct < 0) {
      const { start, end } = this.getTimelineBounds();
      pct = this.props.currentDate < start ? 0 : 100;
    }
    const targetX = fixedWidth + (pct / 100) * timelineWidth;
    const viewport = wrapper.clientWidth || containerPx;
    const desiredScroll = Math.max(
      0,
      Math.min(tableWidthPx - viewport, Math.floor(targetX - viewport / 2))
    );
    try {
      wrapper.scrollLeft = desiredScroll;
    } catch {}
  }

  private colorFor(rowType: string | null | undefined) {
    const rt = (rowType || "").toLowerCase();
    if (rt === "tender") return this.props.colors?.[1];
    return this.props.colors?.[0];
  }

  // Column widths are static; no resize handlers

  private startBarEndEdit(
    e: React.MouseEvent,
    rowId: string,
    rowLeftPct: number,
    rowWidthPct: number,
    winStart: Date,
    winEnd: Date
  ) {
    if (!this.props.adjustableEndDate) return; // editing disabled
    e.preventDefault();
    e.stopPropagation();
    const cell =
      (e.currentTarget.closest(".gantt-bar-container") as HTMLElement) ||
      (e.currentTarget.parentElement as HTMLElement);
    const containerPx = cell ? cell.clientWidth : 1;
    this.setState({
      editingEnd: {
        rowId,
        startX: e.clientX,
        rowLeftPct,
        startWidthPct: rowWidthPct,
        liveWidthPct: rowWidthPct,
        containerPx,
        winStart,
        winEnd,
      },
    });
    window.addEventListener("mousemove", this.onBarDragMove as any);
    window.addEventListener("mouseup", this.onGlobalMouseUp);
  }
  private onBarDragMove = (e: MouseEvent) => {
    const edit = this.state.editingEnd;
    if (!edit) return;
    const deltaPx = e.clientX - edit.startX;
    const deltaPct = (deltaPx / edit.containerPx) * 100;
    let liveWidthPct = edit.startWidthPct + deltaPct;
    if (liveWidthPct < 1) liveWidthPct = 1;
    if (liveWidthPct > 100 - edit.rowLeftPct)
      liveWidthPct = 100 - edit.rowLeftPct;
    if (liveWidthPct !== edit.liveWidthPct)
      this.setState({ editingEnd: { ...edit, liveWidthPct } });
  };
  private onGlobalMouseUp = () => {
    if (this.state.editingEnd) {
      if (!this.props.adjustableEndDate) {
        this.setState({ editingEnd: null });
        window.removeEventListener("mousemove", this.onBarDragMove as any);
        window.removeEventListener("mouseup", this.onGlobalMouseUp);
        return;
      }
      const edit = this.state.editingEnd;
      const start = edit.winStart;
      const end = edit.winEnd;
      const totalMs = Number(end) - Number(start);
      const rightPct = edit.rowLeftPct + edit.liveWidthPct;
      const newEnd = new Date(Number(start) + (rightPct / 100) * totalMs);
      this.setState((prev) => ({
        editingEnd: null,
        endDateOverrides: { ...prev.endDateOverrides, [edit.rowId]: newEnd },
      }));
      window.removeEventListener("mousemove", this.onBarDragMove as any);
      window.removeEventListener("mouseup", this.onGlobalMouseUp);
      this.props.onEndDateChange &&
        this.props.onEndDateChange(edit.rowId, newEnd);
    }
  };

  /**
   * Takes the parameters and orders by parent child it and adds a level
   * @returns an ordered list of gantt rows
   */
  orderGanttRows = (): GanttRow[] => {
    const { sortField, sortDir } = this.state;
    const data = this.props.data.filter((r) => r.name !== "val");
    // Index children
    const childrenMap: Record<string, GanttRow[]> = {};
    data.forEach((r) => {
      const pid = r.parentId || "";
      if (!childrenMap[pid]) childrenMap[pid] = [];
      childrenMap[pid].push(r);
    });
    const compare = (a: GanttRow, b: GanttRow): number => {
      const dir = sortDir === "asc" ? 1 : -1;
      const valFor = (r: GanttRow): any => {
        if (sortField === "name") return (r.name || "").toLowerCase();
        if (sortField === "startDate")
          return r.startDate ? r.startDate.getTime() : Number.MAX_SAFE_INTEGER;
        if (sortField === "endDate")
          return r.endDate ? r.endDate.getTime() : Number.MAX_SAFE_INTEGER;
        return (r.name || "").toLowerCase();
      };
      const av = valFor(a);
      const bv = valFor(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // tie-breaker stable by name then id
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return a.id.localeCompare(b.id);
    };
    const sortList = (list: GanttRow[]) => list.sort(compare);
    const result: GanttRow[] = [];
    const process = (row: GanttRow, level: number) => {
      row.level = level;
      row.milestones = [];
      const kids = childrenMap[row.id] || [];
      // separate milestones
      const taskKids: GanttRow[] = [];
      kids.forEach((k) => {
        if ((k.rowType || "").toLowerCase() === "milestone")
          row.milestones.push(k);
        else taskKids.push(k);
      });
      sortList(taskKids);
      result.push(row);
      taskKids.forEach((child) => process(child, level + 1));
    };
    const roots = (childrenMap[""] || []).filter(
      (r) => (r.rowType || "").toLowerCase() !== "milestone"
    );
    sortList(roots);
    roots.forEach((r) => process(r, 0));
    return result;
  };

  private toggleSort = (field: "name" | "startDate" | "endDate") => {
    this.setState((prev) => {
      if (prev.sortField === field) {
        // toggle direction
        const newDir = prev.sortDir === "asc" ? "desc" : "asc";
        return { ...prev, sortDir: newDir };
      }
      return { ...prev, sortField: field, sortDir: "asc" };
    });
  };

  // Helpers for month-based scaling
  private getTimelineBounds(): { start: Date; end: Date; months: Date[] } {
    // Determine min start and max end from dataset
    let minStart: Date | null = null;
    let maxEnd: Date | null = null;
    this.props.data.forEach((r) => {
      if (r.startDate && (!minStart || r.startDate < minStart))
        minStart = r.startDate;
      if (r.endDate && (!maxEnd || r.endDate > maxEnd)) maxEnd = r.endDate;
      // include milestones
      r.milestones.forEach((m) => {
        if (m.startDate && (!minStart || m.startDate < minStart))
          minStart = m.startDate;
        if (m.endDate && (!maxEnd || m.endDate > maxEnd)) maxEnd = m.endDate;
      });
    });
    if (!minStart) minStart = this.props.ganttStartDate;
    if (!maxEnd) maxEnd = this.props.ganttEndDate;
    // Normalize to month starts
    const start = new Date(minStart.getFullYear(), minStart.getMonth(), 1);
    const lastMonthStart = new Date(maxEnd.getFullYear(), maxEnd.getMonth(), 1);
    const months: Date[] = [];
    let cursor = new Date(start.getTime());
    while (cursor <= lastMonthStart) {
      months.push(new Date(cursor.getTime()));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    if (months.length === 0) {
      months.push(start);
    }
    const end = new Date(
      lastMonthStart.getFullYear(),
      lastMonthStart.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    ); // inclusive end (last day of max month)
    return { start, end, months };
  }

  private getSegments(): { start: Date; label: string }[] {
    const { start, end } = this.getTimelineBounds();
    const segments: { start: Date; label: string }[] = [];
    const z = this.state.zoomLevel;
    if (z === "month") {
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        segments.push({
          start: new Date(cursor.getTime()),
          label:
            cursor.toLocaleString("default", { month: "short" }) +
            " " +
            (cursor.getFullYear() % 100).toString().padStart(2, "0"),
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    } else if (z === "week") {
      // Move cursor to Monday of starting week
      let cursor = new Date(start.getTime());
      const day = cursor.getDay();
      const diffToMonday = (day + 6) % 7; // 0 if Monday
      cursor.setDate(cursor.getDate() - diffToMonday);
      while (cursor <= end) {
        const wkStart = new Date(cursor.getTime());
        const oneJan = new Date(wkStart.getFullYear(), 0, 1);
        const weekNum = Math.ceil(
          (((wkStart as any) - (oneJan as any)) / 86400000 +
            oneJan.getDay() +
            1) /
            7
        );
        segments.push({ start: wkStart, label: "W" + weekNum });
        cursor.setDate(cursor.getDate() + 7);
      }
    } else if (z === "year") {
      // year segments
      let y = start.getFullYear();
      const lastY = end.getFullYear();
      while (y <= lastY) {
        const yStart = new Date(y, 0, 1);
        segments.push({ start: yStart, label: String(y) });
        y += 1;
      }
    }
    if (segments.length === 0) segments.push({ start, label: "" });
    return segments;
  }

  private setZoom = (z: "month" | "week" | "year") => {
    if (this.state.zoomLevel !== z) {
      this.setState({ zoomLevel: z }, () => {
        // Re-measure after zoom change for precise pixel widths.
        // In Canvas apps, layout can settle a tick later; schedule a few retries.
        this.measureTimers.push(
          window.setTimeout(this.updateContainerWidth, 0)
        );
        this.measureTimers.push(
          window.setTimeout(this.updateContainerWidth, 60)
        );
        this.measureTimers.push(
          window.setTimeout(this.updateContainerWidth, 200)
        );
        // Recentering after zoom once sizes are likely stable
        this.measureTimers.push(
          window.setTimeout(() => this.centerOnCurrentDate(), 120)
        );
      });
    }
  };

  calculateStartX = (date: Date | null) => {
    if (!date) {
      return -1;
    }
    const { start, end } = this.getTimelineBounds();
    if (date < start) {
      return 0;
    }
    if (date > end) {
      return -1;
    }
    const ratio =
      (Number(date) - Number(start)) / (Number(end) - Number(start));
    return ratio * 100; // percentage
  };

  private calculateStartXInWindow = (
    date: Date | null,
    winStart: Date,
    winEnd: Date
  ) => {
    if (!date) return -1;
    if (date < winStart) return 0;
    if (date > winEnd) return -1;
    const ratio =
      (Number(date) - Number(winStart)) / (Number(winEnd) - Number(winStart));
    return ratio * 100;
  };

  calculateEndWidth = (startDate: Date | null, endDate: Date | null) => {
    if (!startDate || !endDate) {
      return -1;
    }
    const { start, end } = this.getTimelineBounds();
    if (endDate < start || startDate > end) {
      return -1;
    }
    const clipStart = startDate < start ? start : startDate;
    const clipEnd = endDate > end ? end : endDate;
    if (clipEnd <= clipStart) {
      return 2;
    }
    const widthRatio =
      (Number(clipEnd) - Number(clipStart)) / (Number(end) - Number(start));
    return widthRatio * 100; // percentage
  };

  private calculateEndWidthInWindow = (
    startDate: Date | null,
    endDate: Date | null,
    winStart: Date,
    winEnd: Date
  ) => {
    if (!startDate || !endDate) return -1;
    if (endDate < winStart || startDate > winEnd) return -1;
    const clipStart = startDate < winStart ? winStart : startDate;
    const clipEnd = endDate > winEnd ? winEnd : endDate;
    if (clipEnd <= clipStart) return 2;
    const widthRatio =
      (Number(clipEnd) - Number(clipStart)) /
      (Number(winEnd) - Number(winStart));
    return widthRatio * 100;
  };

  /**
   * Creates the Gantt Table element.
   * @returns teh table elements with the gantt table in it.
   */
  GanttTable = () => {
    const { start, end } = this.getTimelineBounds();
    const segments = this.getSegments();
    const { nameWidth, startWidth, endWidth } = this.state;
    const isWeek = this.state.zoomLevel === "week";
    // Sticky detail columns: subtract their total width from available timeline space
    const fixedWidth =
      nameWidth + (this.props.expandDetails ? startWidth + endWidth : 0);
    // Determine visible column count: month uses columnViewCount; week uses double columnViewCount; year shows all
    const desiredVisible =
      this.state.zoomLevel === "week" || this.state.zoomLevel === "month"
        ? (() => {
            const base =
              this.props.columnViewCount && this.props.columnViewCount > 0
                ? this.props.columnViewCount
                : segments.length;
            return this.state.zoomLevel === "week" ? base * 2 : base;
          })()
        : segments.length;
    const visibleCount = Math.max(1, Math.min(segments.length, desiredVisible));
    // Compute per-segment width from available width in pixels (exact alignment)
    // Prefer measured state width, fallback to live wrapper width in case state is stale during zoom swaps
    const liveWrapper = this.wrapperRef.current;
    const containerPx =
      this.state.containerWidth ||
      (liveWrapper ? liveWrapper.clientWidth : 0) ||
      0;
    const availablePx = Math.max(0, containerPx - fixedWidth);
    // For week/month we want each segment sized so that exactly 'visibleCount' columns fit; remaining columns overflow (scrollable)
    let segWidthPx = Math.max(8, Math.floor(availablePx / visibleCount));
    if (segWidthPx > 160) segWidthPx = 160; // clamp
    let perSegWidths: number[];
    if (this.state.zoomLevel === "year") {
      // Fit year view exactly into available width with widths proportional to actual time span of each year
      const totalMs = Number(end) - Number(start) || 1;
      perSegWidths = segments.map((seg, i) => {
        const segStart = seg.start;
        const segEnd = i + 1 < segments.length ? segments[i + 1].start : end;
        const segMs = Math.max(0, Number(segEnd) - Number(segStart));
        const exact = (availablePx * segMs) / totalMs;
        return Math.max(8, Math.floor(exact));
      });
      // Distribute remainder pixels (due to flooring) so sum equals availablePx
      let sum = perSegWidths.reduce((a, b) => a + b, 0);
      let remainder = availablePx - sum;
      let ri = 0;
      while (remainder !== 0 && perSegWidths.length) {
        if (remainder > 0) {
          perSegWidths[ri] += 1;
          remainder--;
        } else if (remainder < 0 && perSegWidths[ri] > 8) {
          perSegWidths[ri] -= 1;
          remainder++;
        } else {
          // If we can't shrink further, break to avoid infinite loop
          break;
        }
        ri = (ri + 1) % perSegWidths.length;
      }
    } else {
      // Month & Week: create scrollable width (do NOT force sum to availablePx)
      perSegWidths = new Array(segments.length).fill(segWidthPx);
    }
    let tableWidthPx = fixedWidth + perSegWidths.reduce((a, b) => a + b, 0);
    const maxTableWidth = containerPx * 3 + fixedWidth;
    if (this.state.zoomLevel === 'year' && tableWidthPx > maxTableWidth) {
      // Only constrain year view to avoid excessive horizontal scroll
      const scale = (maxTableWidth - fixedWidth) / (tableWidthPx - fixedWidth);
      perSegWidths = perSegWidths.map(w => Math.max(8, Math.floor(w * scale)));
      const sum2 = perSegWidths.reduce((a,b)=>a+b,0);
      const target = maxTableWidth - fixedWidth;
      if (sum2 !== target && perSegWidths.length) {
        perSegWidths[perSegWidths.length-1] += (target - sum2);
      }
      tableWidthPx = fixedWidth + perSegWidths.reduce((a,b)=>a+b,0);
    }
    // Build year pixel map for precise date alignment
    let yearSegMeta: { start: Date; end: Date; width: number; cum: number }[] = [];
    let yearPixelTotal = 0;
    if (this.state.zoomLevel === 'year') {
      let cum = 0;
      yearSegMeta = segments.map((s, i) => {
        const segStart = s.start;
        const segEnd = i + 1 < segments.length ? segments[i + 1].start : end;
        const meta = { start: segStart, end: segEnd, width: perSegWidths[i], cum };
        cum += perSegWidths[i];
        return meta;
      });
      if (yearSegMeta.length) {
        const last = yearSegMeta[yearSegMeta.length - 1];
        yearPixelTotal = last.cum + last.width;
      }
    }
    const yearDateToPct = (d: Date | null): number => {
      if (!d || !yearSegMeta.length) return -1;
      if (d < yearSegMeta[0].start) return 0;
      if (d > end) return -1;
      for (let i = 0; i < yearSegMeta.length; i++) {
        const m = yearSegMeta[i];
        if (d < m.end || i === yearSegMeta.length - 1) {
          const segDur = Number(m.end) - Number(m.start) || 1;
          const inSeg = Math.min(segDur, Math.max(0, Number(d) - Number(m.start)));
          const px = m.cum + (m.width * inSeg) / segDur;
          return (px / (yearPixelTotal || 1)) * 100;
        }
      }
      return -1;
    };
    const yearRangeToPct = (s: Date | null, e: Date | null): { left: number; width: number } | null => {
      if (!s || !e || !yearSegMeta.length) return null;
      if (e < yearSegMeta[0].start || s > end) return null;
      const clipStart = s < yearSegMeta[0].start ? yearSegMeta[0].start : s;
      const clipEnd = e > end ? end : e;
      if (clipEnd <= clipStart) return null;
      const left = yearDateToPct(clipStart);
      const right = yearDateToPct(clipEnd);
      if (left < 0 || right < 0) return null;
      const width = Math.max(right - left, (2 / (yearPixelTotal || 1)) * 100);
      return { left, width };
    };
    const currentDateX = this.state.zoomLevel === 'year'
      ? yearDateToPct(this.props.currentDate)
      : this.calculateStartX(this.props.currentDate);

    // Compute per-segment totals: number of project and tender rows overlapping each segment
    const totals = segments.map((seg, i) => {
      const segStart = seg.start;
      const segEnd = i + 1 < segments.length ? segments[i + 1].start : end;
      let project = 0;
      let tender = 0;
      this.props.data.forEach((r) => {
        if (!r || !r.startDate || !r.endDate) return;
        const rType = (r.rowType || "").toLowerCase();
        if (rType === "milestone") return; // ignore milestones for totals
        if (rType === "unknown") return; // skip unknown types from per-segment totals
        const effectiveEnd = this.state.endDateOverrides[r.id] || r.endDate;
        // overlap if ranges intersect (inclusive)
        if (r.startDate <= segEnd && effectiveEnd >= segStart) {
          if (rType === "tender") tender += 1;
          else project += 1; // default bucket
        }
      });
      return { project, tender };
    });

    // Compute overall totals across the dataset (excluding milestones)
    const overall = this.props.data.reduce(
      (acc, r) => {
        if (!r) return acc;
        const t = (r.rowType || "").toLowerCase();
        if (t === "milestone" || t === "unknown") return acc;
        if (t === "tender") acc.tender += 1;
        else if (t === "project") acc.project += 1;
        return acc;
      },
      { project: 0, tender: 0 }
    );
    const overallTotal = overall.project + overall.tender;
    const overallPPct = overallTotal
      ? Math.round((overall.project / overallTotal) * 100)
      : 0;
    const overallTPct = overallTotal ? 100 - overallPPct : 0;
    const tableStyle: React.CSSProperties = {};
    // For year view always fix the table width to the computed pixel sum to keep headers/body/bars aligned.
    if (this.state.zoomLevel === 'year') {
      tableStyle.width = tableWidthPx + 'px';
    } else if (tableWidthPx > (this.state.containerWidth || 0)) {
      // In scrollable (month/week) only set explicit width when it exceeds container.
      tableStyle.width = tableWidthPx + 'px';
    }
    return (
      <table
        className={"gantt-view-table" + (isWeek ? " is-week" : "")}
        style={tableStyle}
      >
        <thead>
          <tr>
            <th
              className="sticky-col sticky-name"
              style={{
                width: nameWidth + "px",
                minWidth: 150,
                maxWidth: 700,
                position: "sticky",
                left: 0,
                zIndex: 5,
                userSelect: this.nameResizeInfo ? "none" : undefined,
              }}
            >
              <div
                className="sortable-header"
                style={{ position: "relative", width: "100%", paddingRight: 4 }}
                onClick={(e) => {
                  if (
                    !(e.target as HTMLElement).classList.contains(
                      "col-resize-handle"
                    ) &&
                    !(e.target as HTMLElement).classList.contains(
                      "col-resize-grip"
                    )
                  )
                    this.toggleSort("name");
                }}
                role="button"
                aria-label="Sort by Project / Tender"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this.toggleSort("name");
                  }
                }}
              >
                <span className="header-label">Project / Tender</span>
                {this.renderSortIcon("name")}
                <span
                  className="col-resize-handle"
                  onMouseDown={this.onNameResizeStart}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.preventDefault();
                      const delta = e.key === "ArrowLeft" ? -15 : 15;
                      let w = this.state.nameWidth + delta;
                      if (w < 150) w = 150;
                      if (w > 700) w = 700; // clamp to updated max
                      this.setState({ nameWidth: w }, () => {
                        this.measureTimers.push(
                          window.setTimeout(
                            () => this.centerOnCurrentDate(),
                            60
                          )
                        );
                      });
                    }
                  }}
                  title="Drag to resize column"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize Project / Tender column"
                >
                  <span className="col-resize-grip" />
                </span>
              </div>
            </th>
            {this.props.expandDetails && (
              <th
                className="sticky-col sticky-start"
                style={{
                  width: startWidth + "px",
                  position: "sticky",
                  left: nameWidth,
                  zIndex: 5,
                }}
              >
                <div
                  className="sortable-header"
                  onClick={() => this.toggleSort("startDate")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      this.toggleSort("startDate");
                    }
                  }}
                  aria-label="Sort by Start Date"
                >
                  <span className="header-label">Start Date</span>
                  {this.renderSortIcon("startDate")}
                </div>
              </th>
            )}
            {this.props.expandDetails && (
              <th
                className="sticky-col sticky-end"
                style={{
                  width: endWidth + "px",
                  position: "sticky",
                  left: nameWidth + startWidth,
                  zIndex: 5,
                }}
              >
                <div
                  className="sortable-header"
                  onClick={() => this.toggleSort("endDate")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      this.toggleSort("endDate");
                    }
                  }}
                  aria-label="Sort by End Date"
                >
                  <span className="header-label">End Date</span>
                  {this.renderSortIcon("endDate")}
                </div>
              </th>
            )}
            {segments.map((seg, i) => {
              const segWidthStyle: React.CSSProperties = {
                width: perSegWidths[i] + "px",
                padding: "0",
                fontSize: "0.7rem",
              };
              return (
                <th key={i} className="timeline-seg" style={segWidthStyle}>
                  {seg.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {this.orderGanttRows().map((row, i) => {
            const effectiveEnd = this.state.endDateOverrides[row.id] || row.endDate;
            let leftPct = this.calculateStartX(row.startDate);
            let widthPct = this.calculateEndWidth(row.startDate, effectiveEnd);
            if (this.state.zoomLevel === 'year') {
              const yr = yearRangeToPct(row.startDate, effectiveEnd);
              if (yr) { leftPct = yr.left; widthPct = yr.width; }
            }
            let liveWidth = widthPct;
            if (this.state.editingEnd && this.state.editingEnd.rowId === row.id)
              liveWidth = this.state.editingEnd.liveWidthPct;
            const isSelected = this.props.selectedId === row.id;
            return (
              <tr
                key={i}
                className={isSelected ? "active-row" : undefined}
                onClick={() =>
                  this.props.onSelect &&
                  this.props.onSelect(row.id, row.sourceId, row.rowType)
                }
              >
                <td
                  className="sticky-col sticky-name"
                  style={{
                    paddingLeft:
                      (isWeek ? 8 : 15) +
                      (row.level || 0) * (isWeek ? 14 : 20) +
                      "px",
                    width: nameWidth + "px",
                    minWidth: 150,
                    maxWidth: 700,
                    position: "sticky",
                    left: 0,
                    zIndex: 4,
                  }}
                  onClick={() =>
                    this.props.onSelect &&
                    this.props.onSelect(row.id, row.sourceId, row.rowType)
                  }
                >
                  {row.name}
                </td>
                {this.props.expandDetails && (
                  <td
                    className={
                      "sticky-col sticky-start" +
                      (!row.startDate ? " warn-blank" : "")
                    }
                    style={{
                      width: startWidth + "px",
                      position: "sticky",
                      left: nameWidth,
                      zIndex: 4,
                    }}
                  >
                    {this.formatDateDDMMYYYY(row.startDate)}
                  </td>
                )}
                {this.props.expandDetails && (
                  <td
                    className={
                      "sticky-col sticky-end" +
                      (!row.endDate ? " warn-blank" : "")
                    }
                    style={{
                      width: endWidth + "px",
                      position: "sticky",
                      left: nameWidth + startWidth,
                      zIndex: 4,
                    }}
                  >
                    {this.formatDateDDMMYYYY(row.endDate)}
                  </td>
                )}
                <td
                  colSpan={segments.length}
                  className="gantt-bar-container timeline-cell"
                  style={{ position: "relative", padding: 0, minHeight: 28 }}
                >
                  {leftPct != -1 && widthPct != -1 && (
                    <div
                      className={
                        "gantt-inline-bar" +
                        (this.state.editingEnd &&
                        this.state.editingEnd.rowId === row.id
                          ? " editing"
                          : "")
                      }
                      style={{
                        left: leftPct + "%",
                        width: liveWidth + "%",
                        background: this.colorFor(row.rowType),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        this.props.onSelect &&
                          this.props.onSelect(
                            row.id,
                            row.sourceId,
                            row.rowType
                          );
                      }}
                      title={`${row.name}\n${this.formatDateDDMMYYYY(
                        row.startDate
                      )} - ${this.formatDateDDMMYYYY(effectiveEnd)}`}
                    >
                      {this.props.adjustableEndDate && (
                        <span
                          className="bar-end-handle"
                          onMouseDown={(e) =>
                            this.startBarEndEdit(
                              e,
                              row.id,
                              leftPct,
                              liveWidth,
                              start,
                              end
                            )
                          }
                          role="slider"
                          aria-label="Adjust end date"
                          aria-valuetext={effectiveEnd?.toDateString()}
                        />
                      )}
                    </div>
                  )}
                  {row.milestones.map((m, mi) => {
                    let mLeft = this.calculateStartX(m.startDate);
                    let mWidth = this.calculateEndWidth(m.startDate, m.endDate);
                    if (this.state.zoomLevel === 'year') {
                      const mr = yearRangeToPct(m.startDate, m.endDate);
                      if (mr) { mLeft = mr.left; mWidth = mr.width; }
                    }
                    if (mLeft === -1 || mWidth === -1) return <div key={mi} />;
                    return (
                      <div key={mi} className="milestone-wrapper">
                        <div
                          className="milestone_bar"
                          style={{
                            left: mLeft + "%",
                            width: mWidth + "%",
                            backgroundColor:
                              this.colorFor(m.rowType) || undefined,
                          }}
                        />
                        <div
                          className="milestone_ends start"
                          style={{ left: mLeft + "%" }}
                        />
                        <div
                          className="milestone_ends end"
                          style={{ left: mLeft + mWidth + "%" }}
                        />
                      </div>
                    );
                  })}
                  {currentDateX != -1 && (
                    <div
                      className="currentdate"
                      style={{ left: currentDateX + "%" }}
                    />
                  )}
                  <div
                    className="timeline-grid"
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      pointerEvents: "none",
                    }}
                  >
                    {segments.map((_, gi) => (
                      <div
                        key={gi}
                        className="grid-seg"
                        style={{
                          width: perSegWidths[gi] + "px",
                          height: "100%",
                          position: "relative",
                        }}
                      />
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="gantt-totals-row">
            <td
              className="sticky-col sticky-name"
              style={{
                width: nameWidth + "px",
                minWidth: 150,
                maxWidth: 700,
                position: "sticky",
                left: 0,
                zIndex: 10,
                fontWeight: 600,
                background: "white",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "space-between",
                }}
              >
                <span>Totals</span>
                <div style={{ minWidth: 120 }}>
                  <div
                    className="tot-spark"
                    aria-label={`Overall P ${overall.project}, T ${overall.tender}`}
                  >
                    <div
                      className="tot-spark-part project"
                      style={{
                        width: overallPPct + "%",
                        background: this.props.colors?.[0] || "#FFB74D",
                      }}
                    />
                    <div
                      className="tot-spark-part tender"
                      style={{
                        width: overallTPct + "%",
                        background: this.props.colors?.[1] || "#90CAF9",
                      }}
                    />
                  </div>
                  <div
                    className="tot-merged-pill overall"
                    aria-label={`Totals Project ${overall.project} Tender ${overall.tender}`}
                  >
                    <span className="pill-label">P:</span>
                    <span className="pill-val">{overall.project}</span>
                    <span className="pill-sep" />
                    <span className="pill-label">T:</span>
                    <span className="pill-val">{overall.tender}</span>
                  </div>
                </div>
              </div>
            </td>
            {this.props.expandDetails && (
              <td
                className="sticky-col sticky-start"
                style={{
                  width: startWidth + "px",
                  position: "sticky",
                  left: nameWidth,
                  zIndex: 10,
                  background: "white",
                }}
              >
                {/* Spacer to keep alignment; could add label if desired */}
              </td>
            )}
            {this.props.expandDetails && (
              <td
                className="sticky-col sticky-end"
                style={{
                  width: endWidth + "px",
                  position: "sticky",
                  left: nameWidth + startWidth,
                  zIndex: 10,
                  background: "white",
                }}
              >
                {/* Spacer */}
              </td>
            )}
            {totals.map((t, i) => {
              const total = t.project + t.tender;
              const pPct = total ? Math.round((t.project / total) * 100) : 0;
              const tPct = total ? 100 - pPct : 0;
              const projectColor = this.props.colors?.[0] || "#FFB74D";
              const tenderColor = this.props.colors?.[1] || "#90CAF9";
              return (
                <td
                  key={i}
                  className="gantt-total-seg"
                  style={{
                    width: perSegWidths[i] + "px",
                    padding: "4px 4px",
                    textAlign: "center",
                    fontSize: "0.72rem",
                    background: "#f9fafb",
                  }}
                  title={`Project: ${t.project}  Tender: ${t.tender}`}
                >
                  <div
                    className="tot-spark"
                    aria-label={`P ${t.project}, T ${t.tender}`}
                  >
                    <div
                      className="tot-spark-part project"
                      style={{ width: pPct + "%", background: projectColor }}
                    />
                    <div
                      className="tot-spark-part tender"
                      style={{ width: tPct + "%", background: tenderColor }}
                    />
                  </div>
                  <div
                    className="tot-merged-pill"
                    aria-label={`Project ${t.project} Tender ${t.tender}`}
                  >
                    <span className="pill-label">P:</span>
                    <span className="pill-val">{t.project}</span>
                    <span className="pill-sep" />
                    <span className="pill-label">T:</span>
                    <span className="pill-val">{t.tender}</span>
                  </div>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    );
  };

  /**
   * Renders the the Gantt View element
   * @returns react node with the table element
   */
  render(): React.ReactNode {
    const projectColor = this.props.colors?.[0];
    const tenderColor = this.props.colors?.[1];
    // Compute overall totals for header banner
    const overallTotals = this.props.data.reduce(
      (acc, r) => {
        const t = (r.rowType || "").toLowerCase();
        if (t === "milestone" || t === "unknown") return acc;
        if (t === "tender") acc.tender += 1;
        else if (t === "project") acc.project += 1;
        else acc.project += 1; // default bucket
        return acc;
      },
      { project: 0, tender: 0 }
    );
    const grandTotal = overallTotals.project + overallTotals.tender;
    const projectPct = grandTotal
      ? (overallTotals.project / grandTotal) * 100
      : 0;
    const tenderPct = 100 - projectPct;
    const rootStyle: React.CSSProperties = {
      color: this.props.fontColor || undefined,
      fontSize: this.props.fontSize ? `${this.props.fontSize}px` : undefined,
    };
    return (
      <div className="gantt-shell" style={rootStyle}>
        <div className="gantt-header-bar">
          {this.props.showFilters && this.props.filtersText && (
            <div className="gantt-filter-banner" aria-label="Applied filter">
              <span className="filter-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    fill="currentColor"
                    d="M3 4h18v2l-7 8v5l-4 2v-7L3 6V4z"
                  />
                </svg>
              </span>
              <span className="filter-label">Applied filter:</span>
              <span className="filter-text" title={this.props.filtersText}>
                {this.props.filtersText}
              </span>
            </div>
          )}
          <div className="gantt-zoom-controls">
            {(["year", "month", "week"] as const).map((z) => (
              <button
                key={z}
                onClick={() => this.setZoom(z)}
                className={
                  "gantt-zoom-btn" +
                  (this.state.zoomLevel === z ? " active" : "")
                }
                type="button"
              >
                {z.charAt(0).toUpperCase() + z.slice(1)}
              </button>
            ))}
          </div>
          <div className="gantt-legend">
            <div className="gantt-legend-item">
              <span
                className="gantt-legend-swatch"
                style={{ background: projectColor }}
              />{" "}
              Project
            </div>
            <div className="gantt-legend-item">
              <span
                className="gantt-legend-swatch"
                style={{ background: tenderColor }}
              />{" "}
              Tender
            </div>
          </div>
          <div
            className="gantt-total-banner"
            aria-label={`Totals Project ${overallTotals.project} Tender ${overallTotals.tender}`}
            title={`Project: ${overallTotals.project}  Tender: ${overallTotals.tender}`}
            style={{
              background: grandTotal
                ? `linear-gradient(90deg, ${projectColor || "#FFB74D"} 0%, ${
                    projectColor || "#FFB74D"
                  } ${projectPct}%, ${
                    tenderColor || "#90CAF9"
                  } ${projectPct}%, ${tenderColor || "#90CAF9"} 100%)`
                : undefined,
            }}
          >
            <span className="tot-lab">P</span>
            <span
              className="tot-val"
              style={{ color: projectColor || "#FFB74D" }}
            >
              {overallTotals.project}
            </span>
            <span className="tot-sep" />
            <span className="tot-lab">T</span>
            <span
              className="tot-val"
              style={{ color: tenderColor || "#90CAF9" }}
            >
              {overallTotals.tender}
            </span>
          </div>
        </div>
        <div className="gantt-table-wrapper" ref={this.wrapperRef}>
          {this.GanttTable()}
        </div>
      </div>
    );
  }
}
