import { IInputs, IOutputs } from "./generated/ManifestTypes";
import { GanttViewControl, IGanttViewControlProps } from "./GanttViewControl";
import * as React from "react";

export class GanttView
  implements ComponentFramework.ReactControl<IInputs, IOutputs>
{
  private theComponent: ComponentFramework.ReactControl<IInputs, IOutputs>;
  private notifyOutputChanged: () => void;
  private selectedId: string | undefined; // output value (Items['id'])
  private selectedUid: string | undefined; // internal row uid for highlight
  private selectedRowType: string | undefined; // output value for row type
  // Paging state (auto-load all pages)
  private pagingInitialized: boolean = false;
  private pagingSafetyCounter: number = 0; // safety guard (40 * 500 = 20k)

  // No auxiliary drain function needed in simplified model

  /**
     * Empty constructor.
    
    constructor() { }
    */
  /**
   * Used to initialize the control instance. Controls can kick off remote server calls and other initialization actions here.
   * Data-set values are not initialized here, use updateView.
   * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to property names defined in the manifest, as well as utility functions.
   * @param notifyOutputChanged A callback method to alert the framework that the control has new outputs ready to be retrieved asynchronously.
   * @param state A piece of data that persists in one session for a single user. Can be set at any point in a controls life cycle by calling 'setControlState' in the Mode interface.
   */
  public init(
    context: ComponentFramework.Context<IInputs>,
    notifyOutputChanged: () => void,
    state: ComponentFramework.Dictionary
  ): void {
    this.notifyOutputChanged = notifyOutputChanged;
  }

  /**
   * Called when any value in the property bag has changed. This includes field values, data-sets, global values such as container height and width, offline status, control metadata values such as label, visible, etc.
   * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to names defined in the manifest, as well as utility functions
   * @returns ReactElement root react element for the control
   */
  public updateView(
    context: ComponentFramework.Context<IInputs>
  ): React.ReactElement {
  const records = context.parameters.records;
    // Simple sequential paging per provided reference snippet
    try {
      const paging: any = (records as any).paging;
      if (paging) {
        if (!this.pagingInitialized && typeof paging.setPageSize === 'function') {
          try { paging.setPageSize(500); } catch {}
          this.pagingInitialized = true;
        }
        if (typeof paging.hasNextPage === 'function' && paging.hasNextPage()) {
          if (this.pagingSafetyCounter < 40) {
            this.pagingSafetyCounter++;
            try { paging.loadNextPage(); } catch {}
          }
        }
      }
    } catch {}
    try { console.log('[GanttView] Record count (all pages loaded):', records.sortedRecordIds.length); } catch {}
    const colorsRaw = context.parameters as any; // colors may be undefined
    const colorsValue: string | undefined = colorsRaw.colors?.raw ?? undefined;

    const parseColors = (input?: string): string[] => {
      if (!input) return [];
      let val = input.trim();
      // Strip wrapping quotes
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.substring(1, val.length - 1).trim();
      }
      // JSON array style
      if (val.startsWith("[")) {
        try {
          const arr = JSON.parse(val);
          if (Array.isArray(arr)) {
            return arr
              .map((v) => String(v).trim())
              .filter((v) => v)
              .map((v) => v.replace(/^['"]|['"]$/g, ""));
          }
        } catch (e) {
          // fall through to manual parsing
        }
        // Remove brackets / quotes
        val = val.replace(/[\[\]"]/g, "");
      }
      // Split on common separators
      const parts = val
        .split(/[,;\n\|]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const cleaned: string[] = [];
      for (const p of parts) {
        // Accept formats like "project:#FFA", "tender=#00F", "color: orange"
        const kv = p.split(/[:=]/);
        let token = p;
        if (kv.length >= 2) {
          token = kv.slice(1).join(":"); // everything after first sep
        }
        token = token.replace(/^['"]|['"]$/g, "").trim();
        // Drop leading words like 'project' or 'tender'
        token = token.replace(/^(project|tender)\s*/i, "").trim();
        if (token) cleaned.push(token);
      }
      return cleaned;
    };

    let colors = parseColors(colorsValue);
    // If labels are present, prefer them for mapping
    const extractLabel = (
      src: string | undefined,
      label: string
    ): string | undefined => {
      if (!src) return undefined;
      const m = new RegExp(label + "\\s*[:=]\\s*([^,;\n|]+)", "i").exec(src);
      if (!m) return undefined;
      return m[1].replace(/^['"]|['"]$/g, "").trim();
    };
    const labeledProject = extractLabel(colorsValue, "project");
    const labeledTender = extractLabel(colorsValue, "tender");
    // If control property not provided, try dataset column 'colors' (first record)
    if (colors.length === 0 && records.sortedRecordIds.length) {
      try {
        const firstRow = records.records[records.sortedRecordIds[0]];
        const datasetColorsVal = firstRow.getFormattedValue("colors");
        if (datasetColorsVal) {
          colors = parseColors(datasetColorsVal);
        }
      } catch {}
    }
    // Ensure first two entries exist (project, tender) -> light orange, light blue
    // Respect user order strictly: colors[0] = project, colors[1] = tender.
    if (colors.length === 0 && !labeledProject && !labeledTender) {
      colors = ["#FFB74D", "#90CAF9"]; // defaults
    }
    // Build final ordered colors honoring labels and user order
    const projectColorFinal = labeledProject || colors[0] || "#FFB74D";
    const tenderColorFinal =
      labeledTender || colors.find((c) => c !== projectColorFinal) || "#90CAF9";
    colors = [
      projectColorFinal,
      tenderColorFinal,
      ...colors.filter(
        (c) => c !== projectColorFinal && c !== tenderColorFinal
      ),
    ];
    // Debug log final mapping
    try {
      console.log(
        "[GanttView] Raw colors input:",
        colorsValue,
        "Mapped project/tender colors:",
        colors[0],
        colors[1]
      );
    } catch (_) {}

    const parseDateOrNull = (val: any): Date | null => {
      const s = (val ?? "").toString().trim();
      if (!s) return null;
      const ms = Date.parse(s);
      if (isNaN(ms)) return null;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : d;
    };
    console.log("Hellooo");

  // Build data rows from dataset only
  const dataRows = records.sortedRecordIds.map((sortedRowID, i) => {
        var inputRow = records.records[sortedRowID];
        const recordId = (inputRow as any).getRecordId ? (inputRow as any).getRecordId() : String(sortedRowID || i);
        const sourceIdVal = inputRow.getFormattedValue("id");
        const parseDateOrNull = (val: any): Date | null => { const s = (val ?? '').toString().trim(); if (!s) return null; const ms = Date.parse(s); if (isNaN(ms)) return null; const d = new Date(ms); return isNaN(d.getTime()) ? null : d; };
        return {
          id: recordId,
          sourceId: sourceIdVal,
          name: inputRow.getFormattedValue("name"),
          assigned: inputRow.getFormattedValue("assigned"),
          startDate: parseDateOrNull(inputRow.getFormattedValue("startDate")),
          endDate: parseDateOrNull(inputRow.getFormattedValue("endDate")),
          rowType: ((): string => {
            const raw = inputRow.getFormattedValue("rowType");
            let norm = (raw || "").toString().trim().toLowerCase();
            norm = norm.replace(/[^a-z]/g, "");
            if (norm !== "project" && norm !== "tender" && norm !== "milestone") {
              const nameVal2 = (inputRow.getFormattedValue("name") || "").toLowerCase();
              if (nameVal2.includes("tender")) norm = "tender"; else norm = "unknown";
            }
            return norm;
          })(),
          progress: parseFloat(inputRow.getFormattedValue("progress")),
          parentId: inputRow.getFormattedValue("parentId") ? inputRow.getFormattedValue("parentId") : "",
          level: null,
          milestones: [],
        };
      });
    const props: IGanttViewControlProps = {
      name: "Project Tender Timeline",
      ganttStartDate: context.parameters.ganttStartDate.raw || new Date(),
      ganttEndDate: context.parameters.ganttEndDate.raw || new Date(),
      currentDate: context.parameters.currentDate.raw || new Date(),
      expandDetails: context.parameters.expandDetails.raw,
      columnViewCount:
        (context.parameters as any).columnViewCount?.raw ?? undefined,
  showFilters: (context.parameters as any).showFilters?.raw || false,
  filtersText: (context.parameters as any).filtersText?.raw || '',
  data: dataRows,
      colors: colors,
      selectedId: this.selectedUid,
      onSelect: (uid: string, dataId?: string, rowType?: string | null) => {
        this.selectedUid = uid; // highlight
        if (
          dataId !== undefined &&
          dataId !== null &&
          String(dataId).length > 0
        ) {
          this.selectedId = String(dataId);
        } else {
          // fallback to uid if source id is not present
          this.selectedId = uid;
        }
        this.selectedRowType = (rowType || undefined) as any;
        try {
          console.log(
            "[GanttView] Selected UID:",
            uid,
            "Output ID:",
            this.selectedId,
            "RowType:",
            this.selectedRowType
          );
        } catch {}
        this.notifyOutputChanged && this.notifyOutputChanged();
      },
    };

  return React.createElement(GanttViewControl, props);
  }

  /**
   * It is called by the framework prior to a control receiving new data.
   * @returns an object based on nomenclature defined in manifest, expecting object[s] for property marked as “bound” or “output”
   */
  public getOutputs(): IOutputs {
    return {
      selectedId: this.selectedId,
      selectedRowType: this.selectedRowType,
    } as any;
  }

  /**
   * Called when the control is to be removed from the DOM tree. Controls should use this call for cleanup.
   * i.e. cancelling any pending remote calls, removing listeners, etc.
   */
  public destroy(): void {
    // Add code to cleanup control if necessary
  }
}
