import { notFound } from "next/navigation";

// An unknown /admin address is a 404 inside the staff root layout. Without this the public catch-all would
// serve it, with the inKind script (ADR-0005).
export default function CatchAll() {
  notFound();
}
