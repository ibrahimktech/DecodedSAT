import { FoxMascot } from "@/components/FoxMascot";

export function Mission() {
  return (
    <section id="mission" className="mx-auto max-w-page px-5 py-10 sm:px-10">
      <div className="grid grid-cols-1 items-center gap-9 rounded-3xl bg-ink p-8 sm:p-13 lg:grid-cols-[1fr_12.5rem]">
        <div>
          <h2 className="text-[2rem] font-extrabold text-ink-inverse sm:text-[2.125rem]">
            Our mission
          </h2>
          <p className="mt-4.5 text-lg leading-relaxed text-muted-inverse sm:text-[1.1875rem]">
            I built DecodedSAT as a student, for students. I&rsquo;ve actually sat the
            SAT, and I know what it&rsquo;s like to keep missing the same type of question
            over and over without ever understanding why. Every &ldquo;study tool&rdquo; I
            tried just threw more questions at me and told me to grind harder.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-muted-inverse sm:text-[1.1875rem]">
            So I made the thing I wish I&rsquo;d had: something that tells you exactly what
            went wrong and visually shows and explains the specific error + the topic. That&rsquo;s it. You don&rsquo;t waste any time getting
            more questions wrong, you watch the video and understand it all.
          </p>
        </div>

        <div className="flex justify-center">
          <FoxMascot variant="head" className="h-auto w-[10.625rem]" />
        </div>
      </div>
    </section>
  );
}
