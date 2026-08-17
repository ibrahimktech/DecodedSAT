import { CtaButton } from "@/components/CtaButton";
import { FoxMascot } from "@/components/FoxMascot";
import { links } from "@/lib/site";

export function Hero() {
  return (
    <section
      id="top"
      className="mx-auto grid max-w-page grid-cols-1 items-center gap-8 px-5 pt-10 pb-3 sm:px-10 lg:grid-cols-[1.15fr_0.85fr] lg:pt-14"
    >
      <div>
        <h1 className="text-[2.5rem] font-extrabold text-ink sm:text-5xl lg:text-[4rem]">
          Every wrong answer points to what to learn next.
        </h1>

        <p className="mt-4.5 max-w-[32.5rem] text-lg leading-relaxed text-muted sm:text-xl">
          DecodedSAT diagnoses your mistake and sends the <em className="font-semibold text-ink not-italic">exact video</em> that fixes it - no random practice sets
        </p>

        <div className="mt-8 flex flex-wrap items-end gap-4">
          <CtaButton href={links.getStarted}>Get started</CtaButton>

          <div className="flex flex-col items-start gap-1.5">
            <CtaButton href={links.signIn} variant="secondary">
              Sign in
            </CtaButton>
          </div>
        </div>
      </div>

      <div className="flex justify-center">
        <FoxMascot
          variant="full"
          alt="The DecodedSAT fox mascot, holding a graphing calculator and an 800 score tag"
          className="h-auto w-full max-w-[16rem] sm:max-w-[22.5rem]"
        />
      </div>
    </section>
  );
}
