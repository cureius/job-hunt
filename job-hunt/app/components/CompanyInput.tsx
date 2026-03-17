"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

interface CompanyInputProps {
  companies: string[];
  onChange: (companies: string[]) => void;
  disabled?: boolean;
}

const MAX_COMPANIES = 10;

export default function CompanyInput({ companies, onChange, disabled }: CompanyInputProps) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addCompany(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (companies.length >= MAX_COMPANIES) return;
    if (companies.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
    onChange([...companies, trimmed]);
    setInputValue("");
  }

  function removeCompany(name: string) {
    onChange(companies.filter((c) => c !== name));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addCompany(inputValue);
    }
    if (e.key === "Backspace" && !inputValue && companies.length > 0) {
      removeCompany(companies[companies.length - 1]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Company names</label>
        {companies.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={disabled}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      <div
        className="min-h-[52px] w-full rounded-md border border-input bg-background px-3 py-2 flex flex-wrap gap-1.5 items-center cursor-text focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0"
        onClick={() => inputRef.current?.focus()}
      >
        {companies.map((company) => (
          <Badge
            key={company}
            variant="secondary"
            className="gap-1 pl-2 pr-1 text-xs font-medium"
          >
            {company}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeCompany(company);
              }}
              disabled={disabled}
              className="rounded-full hover:bg-muted-foreground/20 p-0.5 transition-colors"
            >
              <X size={10} />
            </button>
          </Badge>
        ))}

        {companies.length < MAX_COMPANIES && (
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder={
              companies.length === 0
                ? "Type a company name and press Enter…"
                : "Add another company…"
            }
            className="flex-1 min-w-[180px] border-0 p-0 h-auto shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60 text-sm bg-transparent"
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Press <kbd className="rounded border bg-muted px-1 py-0.5 text-xs font-mono">Enter</kbd>{" "}
          or <kbd className="rounded border bg-muted px-1 py-0.5 text-xs font-mono">,</kbd> to add
        </p>
        <span
          className={`text-xs ${
            companies.length >= MAX_COMPANIES ? "text-orange-500 font-medium" : "text-muted-foreground"
          }`}
        >
          {companies.length}/{MAX_COMPANIES}
        </span>
      </div>

      {inputValue.trim() && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => addCompany(inputValue)}
        >
          <Plus size={12} />
          Add &quot;{inputValue.trim()}&quot;
        </Button>
      )}
    </div>
  );
}
