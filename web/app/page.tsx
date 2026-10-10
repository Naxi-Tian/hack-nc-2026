import LandingFX from "@/components/landing/LandingFX";
import LandingMarkup from "@/components/landing/LandingMarkup";
import ProtocolPanel from "@/components/landing/ProtocolPanel";
import "@/styles/landing.css";
import "@/styles/founders.css";

export default function Home() {
  return (
    <div className="L">
      <LandingMarkup />
      <LandingFX />
      <ProtocolPanel />
    </div>
  );
}
