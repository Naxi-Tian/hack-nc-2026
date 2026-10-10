import LandingFX from "@/components/landing/LandingFX";
import LandingMarkup from "@/components/landing/LandingMarkup";
import "@/styles/landing.css";

export default function Home() {
  return (
    <div className="L">
      <LandingMarkup />
      <LandingFX />
    </div>
  );
}
