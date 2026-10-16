"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { format, parseISO, isValid } from "date-fns";
import { es } from "date-fns/locale";

import "react-day-picker/style.css";

type DatePickerProps = {
    name: string;
    defaultValue?: string;
    disabled?: boolean;
    allowEmpty?: boolean;
    placeholder?: string;
    ariaLabel?: string;
};

function getTodayInElSalvador() {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/El_Salvador",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());

    const get = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? "";

    return `${get("year")}-${get("month")}-${get("day")}`;
}

export function DatePicker({
    name,
    defaultValue,
    disabled = false,
    allowEmpty = false,
    placeholder = "Seleccionar fecha",
    ariaLabel = "Seleccionar fecha",
}: DatePickerProps) {
    const [selected, setSelected] = useState<Date | undefined>();
    const [open, setOpen] = useState(false);

    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // En filtros se permite dejar la fecha vacía; el formulario de
        // movimientos conserva el comportamiento anterior (hoy).
        const value = defaultValue || (allowEmpty ? "" : getTodayInElSalvador());
        const parsed = value ? parseISO(value) : undefined;

        setSelected(parsed && isValid(parsed) ? parsed : undefined);
    }, [defaultValue, allowEmpty]);

    useEffect(() => {
        if (!open) return;

        function handleClickOutside(event: PointerEvent) {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setOpen(false);
            }
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false);
            }
        }

        document.addEventListener("pointerdown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("pointerdown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [open]);

    const formattedValue = selected
        ? format(selected, "yyyy-MM-dd")
        : "";

    const visibleValue = selected
        ? format(selected, "dd 'de' MMMM 'de' yyyy", {
            locale: es,
        })
        : placeholder;

    return (
        <div ref={containerRef} className="relative min-w-0 w-full">
            <input
                type="hidden"
                name={name}
                value={formattedValue}
            />

            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen((previous) => !previous)}
                aria-expanded={open}
                aria-label={ariaLabel}
                aria-haspopup="dialog"
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-left text-sm text-white outline-none transition hover:border-emerald-500 disabled:opacity-50"
            >
                <span>{visibleValue}</span>
                <CalendarDays size={18} className="shrink-0 text-emerald-400" />
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Seleccionar fecha"
                    className="absolute right-0 top-full z-50 mt-2 w-[min(19rem,calc(100vw-3rem))] rounded-xl border border-slate-700 bg-slate-900 p-3 text-white shadow-2xl"
                >
                    <DayPicker
                        mode="single"
                        locale={es}
                        selected={selected}
                        onSelect={(date) => {
                            if (date) {
                                setSelected(date);
                                setOpen(false);
                            }
                        }}
                        defaultMonth={selected}
                        showOutsideDays
                        components={{
                            Chevron: ({ orientation }) =>
                                orientation === "left" ? (
                                    <ChevronLeft size={17} />
                                ) : (
                                    <ChevronRight size={17} />
                                ),
                        }}
                        classNames={{
                            root: "w-full text-sm",
                            months: "w-full",
                            month: "w-full",
                            month_caption:
                                "flex h-10 items-center justify-center font-semibold capitalize",
                            nav: "flex items-center gap-2",
                            button_previous:
                                "absolute left-3 top-3 rounded-lg p-1 hover:bg-slate-700",
                            button_next:
                                "absolute right-3 top-3 rounded-lg p-1 hover:bg-slate-700",
                            month_grid: "w-full table-fixed",
                            weekdays: "w-full",
                            weekday: "text-center text-xs text-slate-400",
                            week: "w-full",
                            day: "p-0 text-center",
                            day_button:
                                "mx-auto flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-slate-700",
                            selected:
                                "rounded-lg bg-emerald-500 text-slate-950 font-bold",
                            today: "font-bold text-emerald-400",
                            outside: "text-slate-600",
                        }}
                    />
                    {allowEmpty && selected && (
                        <button
                            type="button"
                            onClick={() => {
                                setSelected(undefined);
                                setOpen(false);
                            }}
                            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
                        >
                            Quitar fecha
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}