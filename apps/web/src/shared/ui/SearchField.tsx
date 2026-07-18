import { Search } from "lucide-react";

interface SearchFieldProps {
  readonly ariaLabel: string;
  readonly dataTestId: string;
  readonly id: string;
  readonly inputClassName: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly value: string;
  readonly wrapperClassName: string;
}

export function SearchField({
  ariaLabel,
  dataTestId,
  id,
  inputClassName,
  name,
  onChange,
  placeholder,
  value,
  wrapperClassName
}: SearchFieldProps) {
  return (
    <search className="contents">
      <label className={wrapperClassName}>
        <Search className="size-4" aria-hidden="true" />
        <input
          aria-label={ariaLabel}
          className={inputClassName}
          data-testid={dataTestId}
          id={id}
          name={name}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </search>
  );
}
