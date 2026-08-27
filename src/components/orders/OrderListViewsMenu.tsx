import { useState } from "react";
import { Check, Save, Star, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { OrderListSavedView } from "@/types/order-list";

type Props = {
  views: OrderListSavedView[];
  activeViewId: string | null;
  onApply: (view: OrderListSavedView) => void;
  onSave: (name: string) => void;
  onDelete: (view: OrderListSavedView) => void;
};

/** Per-user saved column/filter/sort layouts for the OrderList grid. */
export function OrderListViewsMenu({ views, activeViewId, onApply, onSave, onDelete }: Props) {
  const [name, setName] = useState("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8">
          <Star className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Views
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Saved views</DropdownMenuLabel>
        {views.length === 0 && (
          <DropdownMenuItem disabled className="text-xs text-muted-foreground">
            No saved views yet
          </DropdownMenuItem>
        )}
        {views.map((view) => (
          <DropdownMenuItem
            key={view.id}
            onSelect={(event) => {
              event.preventDefault();
              onApply(view);
            }}
            className="flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 truncate">
              {activeViewId === view.id && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              {view.view_name}
            </span>
            <button
              type="button"
              aria-label={`Delete view ${view.view_name}`}
              className="text-muted-foreground hover:text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(view);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 p-2">
          <Input
            value={name}
            aria-label="New view name"
            placeholder="Save current layout as..."
            className="h-8 text-xs"
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={name.trim().length === 0}
            onClick={() => {
              onSave(name.trim());
              setName("");
            }}
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default OrderListViewsMenu;
