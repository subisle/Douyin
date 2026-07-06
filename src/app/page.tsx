import { LoginGate } from "@/components/auth/login-gate";
import { DesktopShell } from "@/components/desktop/shell";

export default function Home() {
  return (
    <LoginGate>
      <DesktopShell />
    </LoginGate>
  );
}
