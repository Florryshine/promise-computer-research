import Link from "next/link";
import {createClient} from "@/lib/supabase/server";
import {getServicePresentation} from "@/lib/service-presentation";

export const dynamic = "force-dynamic";

export default async function Services() {
  const supabase = await createClient();
  const {data: services} = await supabase
    .from("services")
    .select("slug,title,category,description,price,price_type")
    .eq("active", true)
    .order("sort_order");

  const groupedJambSlugs = new Set(["jamb-original-result-printing","jamb-admission-letter-printing","jamb-admission-status-checking","jamb-reprinting","jamb-olevel-screenshot","jamb-email-phone-screenshot","jamb-profile-code-retrieval","jamb-registration-number-retrieval","jamb-indemnity-form"]);
  const visibleServices = (services ?? []).filter(service => !groupedJambSlugs.has(service.slug));

  return (
    <main>
      <section className="bg-[#f4f8ff] py-8 sm:py-10">
        <div className="container">
          <span className="eyebrow">Our services</span>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
            What do you need help with?
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Choose a service to get started.
          </p>
        </div>
      </section>

      <section className="py-6 sm:py-9">
        <div className="container">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 sm:gap-4 lg:grid-cols-5 xl:grid-cols-6">
            {visibleServices.map((service) => {
              const presentation = getServicePresentation(service.slug, service.category);
              return (
                <Link
                  key={service.slug}
                  href={`/services/${service.slug}`}
                  aria-label={service.title}
                  className="group flex min-h-[112px] flex-col items-center justify-center rounded-2xl border border-slate-100 bg-white px-2 py-4 text-center shadow-sm transition hover:border-blue-200 hover:shadow-md active:scale-[0.98] sm:min-h-[126px] sm:px-3"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[#f0f6ff] text-2xl sm:h-12 sm:w-12 sm:text-[26px]">
                    {presentation.icon}
                  </span>
                  <span className="mt-2.5 line-clamp-2 text-xs font-semibold leading-4 text-slate-800 sm:text-sm">
                    {service.title}
                  </span>
                </Link>
              );
            })}
          </div>
          {(!services || services.length === 0) && (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              Services are temporarily unavailable. Please contact us for assistance.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
