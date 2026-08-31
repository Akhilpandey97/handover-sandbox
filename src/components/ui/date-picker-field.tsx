import * as React from "react";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DatePickerFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

export function DatePickerField({ value, onChange, placeholder = "Pick a date", id }: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);

  const dateValue = React.useMemo(() => {
    if (!value) return undefined;
    try {
      return parse(value, "yyyy-MM-dd", new Date());
    } catch {
      return undefined;
    }
  }, [value]);

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      onChange(format(date, "yyyy-MM-dd"));
    }
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setOpen(false);
  };

  const handleToday = () => {
    onChange(format(new Date(), "yyyy-MM-dd"));
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal h-10",
            !value && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {dateValue ? format(dateValue, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleClear}>
            Clear
          </Button>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={handleToday}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
