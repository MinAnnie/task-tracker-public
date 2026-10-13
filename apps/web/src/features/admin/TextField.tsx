import { useId, type InputHTMLAttributes, type Ref } from "react";
import styles from "./Admin.module.css";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Persistent hint under the field. */
  help?: string;
  error?: string;
  optional?: boolean;
  mono?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

/** Labelled input whose hint and error describe it; the error is announced. */
export function TextField({ label, value, onChange, help, error, optional, mono, inputRef, className, ...rest }: TextFieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`${styles.field} ${className ?? ""}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className={styles.optional}> Optional</span>}
      </label>
      <input
        {...rest}
        id={id}
        ref={inputRef}
        className={`${styles.input} ${mono ? "mono" : ""}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {help && (
        <span id={helpId} className={styles.help}>
          {help}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className={styles.fieldError}>
          {error}
        </span>
      )}
    </div>
  );
}
