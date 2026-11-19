import { ComingSoon } from "@/components/console/coming-soon";
import { FACILITIES } from "@/components/console/nav";

export default function Page() {
  return <ComingSoon facility={FACILITIES.find((f) => f.code === "GDE")!} />;
}
