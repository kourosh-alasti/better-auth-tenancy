import type { ReactNode } from "react";

export function Container({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-3xl px-4 py-8">{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-neutral-200 bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  type = "button",
  variant = "primary",
  className = "",
  disabled,
  onClick,
}: {
  children: ReactNode;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const variants = {
    primary: "bg-neutral-900 text-white hover:bg-neutral-800",
    secondary: "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 focus:border-neutral-500 focus:outline-none"
      />
    </label>
  );
}

export function Textarea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      <textarea
        {...props}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 focus:border-neutral-500 focus:outline-none"
      />
    </label>
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </div>
  );
}

export function SuccessAlert({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
      {message}
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description ? <p className="mt-2 text-neutral-600">{description}</p> : null}
    </div>
  );
}
