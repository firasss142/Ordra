// Re-export shim so existing imports keep working (`@/components/queue/OrderDetailPanel`).
// The real implementation lives at ./OrderDetailPanel/index.tsx.
export { OrderDetailPanel } from "./OrderDetailPanel/index";
export type { CallTerminatedContext } from "./OrderDetailPanel/index";
