export type NoticeTone = "idle" | "success" | "error" | "empty";

interface StatusNoticeProps {
  message: string;
  tone: NoticeTone;
}

export function StatusNotice({ message, tone }: StatusNoticeProps) {
  return (
    <div className={`notice notice-${tone}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}
