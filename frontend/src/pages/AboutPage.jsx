import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, Headset, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { siteConfig } from '../config/site.js';

/**
 * About Us (`/about`, public): Tech Pulse brand story, mission, and trust
 * sections. All copy is original, conservative placeholder content — no
 * invented founding dates, certifications, customer counts, or awards.
 * Static content, no backend dependency.
 */
export function AboutPage() {
  useEffect(() => {
    document.title = 'About Us — Tech Pulse';
  }, []);

  const values = [
    {
      icon: Banknote,
      title: 'Honest pricing',
      text: 'Every price shows its MRP beside it. Discounts are computed from real numbers, never staged markups.',
    },
    {
      icon: ShieldCheck,
      title: 'Quality-checked gadgets',
      text: 'We curate a focused catalog of audio, power, and desk essentials — breadth where it matters, no filler.',
    },
    {
      icon: Headset,
      title: 'Human support',
      text: 'Questions about an order or a product? A real person replies — before and after delivery.',
    },
  ];

  return (
    <div className="flex flex-col">
      <section className="border-b border-header-border bg-header text-header-foreground">
        <Container className="py-12 sm:py-16">
          <div className="flex max-w-3xl flex-col items-start gap-4">
          <Breadcrumbs
            items={[{ label: 'Home', to: '/' }, { label: 'About Us' }]}
          />
          <p className="inline-flex items-center gap-2 rounded-full border border-header-border bg-header-foreground/5 px-3.5 py-1.5 text-xs font-semibold text-header-muted">
            <Zap size={14} aria-hidden="true" className="text-accent" />
            {siteConfig.brandShortName} · {siteConfig.brandTagline}
          </p>
          <h1 className="text-[32px] font-extrabold leading-[40px] tracking-tight sm:text-[40px] sm:leading-[44px]">
            Gadgets you’ll actually use, from people who answer.
          </h1>
          <p className="max-w-xl text-base leading-7 text-header-muted">
            Tech Pulse is a single-brand electronics storefront built around a simple
            idea: clear prices, dependable products, and Cash on Delivery — so you
            can shop for everyday tech without second-guessing the fine print.
          </p>
        </div>
      </Container>
      </section>

      <Container className="flex max-w-3xl flex-col gap-10 py-10 sm:py-14">
        <section aria-label="What we sell" className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">What we sell</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Audio gear, power banks and chargers, cables, speakers, car accessories,
            and desk upgrades — the everyday-carry categories our catalog team
            curates from the live category list. If a product is listed, it’s
            active, priced in rupees, and ready to order.
          </p>
          <div>
            <Link
              to="/shop"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
            >
              Browse the catalog
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section aria-label="Our values" className="flex flex-col gap-4">
          <h2 className="text-xl font-bold tracking-tight">What we stand for</h2>
          <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            {values.map((value) => (
              <li key={value.title} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
                <span aria-hidden="true" className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-muted text-accent">
                  <value.icon size={22} />
                </span>
                <h3 className="text-sm font-bold text-foreground">{value.title}</h3>
                <p className="text-[13px] leading-6 text-muted-foreground">{value.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="How ordering works" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Sparkles size={20} aria-hidden="true" className="text-accent" />
            Ordering, simply
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>Pick your gadgets and check out with a saved address.</li>
            <li>We confirm availability before anything ships.</li>
            <li>Pay cash at your door — that’s the whole payment flow.</li>
            <li>Track every order from your account, with snapshot receipts.</li>
          </ol>
          <div className="flex flex-wrap gap-3 pt-1">
            <Link
              to="/shop"
              className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
            >
              Start shopping
            </Link>
            <Link
              to="/support"
              className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface px-6 text-sm font-semibold text-secondary-foreground transition-colors duration-200 hover:bg-surface-muted hover:no-underline"
            >
              Get support
            </Link>
          </div>
        </section>
      </Container>
    </div>
  );
}
