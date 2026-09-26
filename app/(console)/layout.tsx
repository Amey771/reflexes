import { Suspense } from "react";
import ConsoleShell from "./shell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <ConsoleShell>{children}</ConsoleShell>
    </Suspense>
  );
}
