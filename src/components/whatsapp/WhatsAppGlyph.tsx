/**
 * The WhatsApp mark as a stroke icon, sized and coloured like a lucide icon.
 * Prototype: whatsapp-agent-v1.html `I.wa`. Every WhatsApp affordance uses
 * it instead of a generic chat bubble, so a WhatsApp action never reads as
 * "a note" or "a call".
 */
export function WhatsAppGlyph({ size = 18, strokeWidth = 1.8, className = "" }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      data-icon="whatsapp"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="M4 20l1.3-3.8A8 8 0 1 1 8.2 19z" />
      <path d="M9.2 9.6c.3 2.4 2.4 4.5 4.8 4.8l.9-1.4-1.7-1-1 .8a5.7 5.7 0 0 1-1.4-1.4l.8-1-1-1.7z" />
    </svg>
  );
}
