"use client";

/** زر النظام الموحد — نكهة وحجم وحالة انشغال، والباقي على CSS.
 * نص الانشغال من القاموس الموحد — لا سلسلة صلبة. */

import { t, useLocale } from "@/lib/i18n";

export type ButtonVariant = "primary" | "green" | "red" | "ghost";
export type ButtonSize = "md" | "sm" | "lg";

export function Button(props: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  children: React.ReactNode;
  /** React 19: ref كمَلكيّة عادية — لنقل التركيز إلى أزرار التوكيد */
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const { locale } = useLocale();
  const variant = props.variant ?? "primary";
  const size = props.size ?? "md";
  return (
    <button
      ref={props.ref}
      type={props.type ?? "button"}
      className={`btn ${variant}${size === "md" ? "" : ` ${size}`}`}
      disabled={props.disabled === true || props.busy === true}
      aria-busy={props.busy === true ? "true" : undefined}
      onClick={props.onClick}
    >
      {props.busy === true ? t("common.busy", locale) : props.children}
    </button>
  );
}
