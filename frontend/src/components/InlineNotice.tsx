import clsx from "clsx";
import type { ReactNode } from "react";

type NoticeTone = "info" | "success" | "error";

interface InlineNoticeProps {
  tone?: NoticeTone;
  title?: string;
  description?: ReactNode;
}

const toneStyles: Record<NoticeTone, string> = {
  info: "bg-slate-100 text-slate-700 border-slate-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  error: "bg-rose-50 text-rose-700 border-rose-200",
};

export function InlineNotice({
  tone = "info",
  title,
  description,
}: InlineNoticeProps) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-4 py-3 text-sm",
        toneStyles[tone]
      )}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      {description ? (
        <div className={clsx(title && "mt-1")}>{description}</div>
      ) : null}
    </div>
  );
}





