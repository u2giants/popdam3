import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { type CustomCellRendererProps, type CustomHeaderProps } from "ag-grid-react";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getMg01Options, getMg02Options, getMg03Options } from "@/lib/mg-lookup";
import { cn } from "@/lib/utils";
import { type StyleRow, type DescriptionSectionKey, type DescriptionParts, type DescriptionEditorProps } from "./types";
import { APPROVED_LICENSOR_PROPERTY_OPTIONS, COMMON_SIZE_OPTIONS } from "./columns";
import { isUserCreatedRow, normalized, parseDescriptionParts, assembleDescription } from "./helpers";

export function DescriptionBuilderEditor(props: DescriptionEditorProps) {
  const options = props.options ?? {
    mg01: getMg01Options().map((option) => option.name),
    mg02: (mg01: string) => {
      const code = getMg01Options().find((option) => option.name === mg01)?.code;
      return getMg02Options(code).map((option) => option.name);
    },
    mg03: (mg01: string, mg02: string) => {
      const mg01Code = getMg01Options().find((option) => option.name === mg01)?.code;
      const mg02Code = getMg02Options(mg01Code).find((option) => option.name === mg02)?.code;
      return getMg03Options(mg01Code, mg02Code).map((option) => option.name);
    },
    licensorProperty: APPROVED_LICENSOR_PROPERTY_OPTIONS,
    size: COMMON_SIZE_OPTIONS,
  };
  const initialParts = useMemo(() => parseDescriptionParts(props.value ?? "", options), [options, props.value]);
  const [parts, setParts] = useState<DescriptionParts>(initialParts);
  const [activeSection, setActiveSection] = useState<DescriptionSectionKey>("mg01");
  const inputRefs = useRef<Record<DescriptionSectionKey, HTMLInputElement | null>>({
    mg01: null,
    mg02: null,
    mg03: null,
    licensorProperty: null,
    artDescription: null,
    size: null,
  });

  useEffect(() => {
    window.setTimeout(() => inputRefs.current.mg01?.focus(), 0);
  }, []);

  const updatePart = (section: DescriptionSectionKey, value: string) => {
    setParts((current) => {
      const next = { ...current, [section]: value };
      if (section === "mg01") {
        next.mg02 = "";
        next.mg03 = "";
      } else if (section === "mg02") {
        next.mg03 = "";
      }
      props.onValueChange(assembleDescription(next));
      return next;
    });
  };

  const activeOptions = activeSection === "artDescription"
    ? []
    : activeSection === "mg02"
      ? options.mg02(parts.mg01)
      : activeSection === "mg03"
        ? options.mg03(parts.mg01, parts.mg02)
        : options[activeSection];
  const activeValue = parts[activeSection];
  const filteredOptions = activeOptions
    .filter((option) => normalized(option).includes(normalized(activeValue)))
    .slice(0, 80);

  const selectOption = (option: string) => {
    updatePart(activeSection, option);
    inputRefs.current[activeSection]?.focus();
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      props.stopEditing();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      props.stopEditing(true);
    }
  };

  const sections: { key: DescriptionSectionKey; label: string; placeholder: string; className: string }[] = [
    { key: "mg01", label: "MG01", placeholder: "Product type", className: "min-w-[130px] flex-1" },
    { key: "mg02", label: "MG02", placeholder: "Construction", className: "min-w-[130px] flex-1" },
    { key: "mg03", label: "MG03", placeholder: "Feature", className: "min-w-[130px] flex-1" },
    { key: "licensorProperty", label: "Licensor + Property", placeholder: "Marvel Spider-Man", className: "min-w-[190px] flex-[1.05]" },
    { key: "artDescription", label: "Art Description", placeholder: "Building Hopping", className: "min-w-[190px] flex-1" },
    { key: "size", label: "Size", placeholder: "16x20\" x1.2\"", className: "min-w-[140px] flex-[0.75]" },
  ];

  return (
    <div className="w-[min(1180px,calc(100vw-2rem))] rounded-md border border-border bg-popover p-2 shadow-lg" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex min-h-14 overflow-hidden rounded-md border border-input bg-background">
        {sections.map((section, index) => (
          <label key={section.key} className={cn("flex flex-col justify-center gap-0.5 px-2 py-1.5", index > 0 && "border-l border-border/70", section.className)}>
            <span className="truncate text-[10px] font-medium uppercase text-muted-foreground">{section.label}</span>
            <input
              ref={(node) => {
                inputRefs.current[section.key] = node;
              }}
              value={parts[section.key]}
              onChange={(event) => updatePart(section.key, event.target.value)}
              onFocus={() => setActiveSection(section.key)}
              onKeyDown={onEditorKeyDown}
              className="h-6 min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/55"
              placeholder={section.placeholder}
              spellCheck={section.key === "artDescription"}
            />
          </label>
        ))}
      </div>
      {activeSection !== "artDescription" && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border bg-background p-1">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
              >
                <span className="min-w-0 truncate">{option}</span>
                {normalized(option) === normalized(activeValue) && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />}
              </button>
            ))
          ) : (
            <div className="px-2 py-2 text-xs text-muted-foreground">No approved values found</div>
          )}
        </div>
      )}
    </div>
  );
}

type RowNumberCellProps = CustomCellRendererProps<StyleRow, number | null> & {
  canDeleteRow?: boolean;
  onDeleteRow?: (row: StyleRow) => void;
};

export function RowNumberCell(params: RowNumberCellProps) {
  const { node, value } = params;
  const [selected, setSelected] = useState(() => node.isSelected() ?? false);

  useEffect(() => {
    const listener = () => setSelected(node.isSelected() ?? false);
    node.addEventListener("rowSelected", listener);
    return () => node.removeEventListener("rowSelected", listener);
  }, [node]);

  const deletable = Boolean(params.canDeleteRow && params.onDeleteRow && node.data && isUserCreatedRow(node.data));

  return (
    <div className="flex h-full items-center gap-2">
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => node.setSelected(checked === true)}
        onClick={(event) => event.stopPropagation()}
        aria-label="Select row"
      />
      <span className="font-mono text-muted-foreground">{value ?? ""}</span>
      {deletable && (
        <button
          type="button"
          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 opacity-60 transition-colors hover:bg-destructive/15 hover:text-destructive hover:opacity-100"
          title="Delete this row (user-created rows only)"
          aria-label="Delete row"
          onClick={(event) => {
            event.stopPropagation();
            if (node.data && params.onDeleteRow) params.onDeleteRow(node.data);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function RowNumberHeader(params: CustomHeaderProps<StyleRow>) {
  const { api } = params;
  const [checked, setChecked] = useState<boolean | "indeterminate">(false);

  const refresh = useCallback(() => {
    let total = 0;
    let selectedCount = 0;
    api.forEachNodeAfterFilter((node) => {
      total += 1;
      if (node.isSelected()) selectedCount += 1;
    });
    setChecked(total === 0 || selectedCount === 0 ? false : selectedCount === total ? true : "indeterminate");
  }, [api]);

  useEffect(() => {
    refresh();
    api.addEventListener("selectionChanged", refresh);
    api.addEventListener("modelUpdated", refresh);
    return () => {
      api.removeEventListener("selectionChanged", refresh);
      api.removeEventListener("modelUpdated", refresh);
    };
  }, [api, refresh]);

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => (value ? api.selectAll("filtered") : api.deselectAll("filtered"))}
        aria-label="Select all rows"
      />
      <span>#</span>
    </div>
  );
}

export function RfqGroupCell(params: CustomCellRendererProps<StyleRow>) {
  const groups = params.data?.rfq_groups ?? [];
  if (groups.length === 0) return null;

  const latest = groups[0];
  if (groups.length === 1) return <span className="block truncate">{latest.name}</span>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-full w-full min-w-0 items-center gap-1.5 text-left hover:text-primary"
          onClick={(event) => event.stopPropagation()}
          aria-label={`${latest.name}; show ${groups.length - 1} previous RFQ groups`}
        >
          <span className="min-w-0 flex-1 truncate">{latest.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{groups.length - 1}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2" onClick={(event) => event.stopPropagation()}>
        <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">RFQ group history</div>
        <div className="max-h-64 overflow-y-auto">
          {groups.map((group, index) => (
            <div key={group.id} className={cn("rounded px-2 py-1.5 text-sm", index === 0 && "bg-primary/10")}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                {index === 0 && <span className="text-[10px] font-medium uppercase text-primary">Latest</span>}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
