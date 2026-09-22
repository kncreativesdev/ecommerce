import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Clock, Mail, MapPin, MessageCircleQuestion, Package, Phone, Send } from 'lucide-react';
import { Container } from '../components/ui/Container.jsx';
import { Breadcrumbs } from '../components/layout/Breadcrumbs.jsx';
import { FormField, SelectInput, TextArea, TextInput } from '../components/ui/FormField.jsx';
import { env } from '../config/env.js';

/**
 * Support (`/support`, public): contact cards (explicitly placeholder until
 * the company-info backend lands — GAP-01), honest query form (opens the
 * visitor's mail client via `mailto:` to the configured support address;
 * labeled as such), map slot (configurable embed URL, missing-config
 * state otherwise), static FAQ. No invented phone/address/coordinates.
 */

const FAQS = [
  {
    question: 'How do I pay for my order?',
    answer: 'Every order is Cash on Delivery. You pay in cash when your package arrives — no cards, UPI, or advance payment needed.',
  },
  {
    question: 'How can I track my order?',
    answer: 'Sign in and open My Account → Orders. Each order shows its live status plus an immutable snapshot receipt of items, prices, and addresses.',
  },
  {
    question: 'What if my item arrives damaged?',
    answer: 'Contact support with your order number (ORD-YYYY-NNNNNN) and a photo of the issue. We’ll make it right under our quality promise.',
  },
  {
    question: 'Can I change or cancel my order?',
    answer: 'Orders can’t be changed or cancelled from your account yet. Reach out as soon as possible and we’ll do our best before dispatch.',
  },
  {
    question: 'Do prices include taxes?',
    answer: 'Yes — the price you see is the price you pay in cash. Order totals always come from server-computed snapshots, never estimates.',
  },
];

export function SupportPage() {
  useEffect(() => {
    document.title = 'Support — Tech Pulse';
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { name: '', email: '', topic: 'order', message: '' },
  });

  const onSubmit = async (values) => {
    const subject = encodeURIComponent(`[Tech Pulse ${values.topic}] Support request from ${values.name}`);
    const body = encodeURIComponent(`${values.message}\n\n— ${values.name} (${values.email})`);
    // Honest submit path until a backend ticket API exists: the visitor's
    // own mail client sends to the configured support address.
    const anchor = document.createElement('a');
    anchor.href = `mailto:${env.supportEmail}?subject=${subject}&body=${body}`;
    anchor.click();
    toast.success('Opening your mail app to send the request.');
    reset();
  };

  return (
    <div className="flex flex-col">
      <section className="border-b border-header-border bg-header text-header-foreground">
        <Container className="py-12 sm:py-16">
          <div className="flex max-w-3xl flex-col items-start gap-4">
            <Breadcrumbs items={[{ label: 'Home', to: '/' }, { label: 'Support' }]} />
            <p className="inline-flex items-center gap-2 rounded-full border border-header-border bg-header-foreground/5 px-3.5 py-1.5 text-xs font-semibold text-header-muted">
              <MessageCircleQuestion size={14} aria-hidden="true" className="text-accent" />
              Help center
            </p>
            <h1 className="text-[32px] font-extrabold leading-[40px] tracking-tight sm:text-[40px] sm:leading-[44px]">
              How can we help?
            </h1>
            <p className="max-w-xl text-base leading-7 text-header-muted">
              Order questions, product advice, or anything else — start below and a
              real person replies.
            </p>
          </div>
        </Container>
      </section>

      <Container className="flex max-w-5xl flex-col gap-10 py-10 sm:py-14">
        <section aria-label="Contact options" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          <ContactCard
            icon={Phone}
            title="Phone"
            lines={['Support line coming soon.', 'Use the query form meanwhile.']}
          />
          <ContactCard
            icon={Mail}
            title="Email"
            lines={[env.supportEmail, 'Replies within 1–2 business days.']}
          />
          <ContactCard
            icon={MapPin}
            title="Visit us"
            lines={['Store address coming soon.', 'Online orders ship across India.']}
          />
        </section>

        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-label="Send a query" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold tracking-tight">Send a query</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This opens your mail app addressed to our support inbox — no ticket
              system yet, but every mail gets read.
            </p>
            <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-4 flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name" required error={errors.name?.message}>
                  {({ describedBy }) => (
                    <TextInput
                      type="text"
                      autoComplete="name"
                      aria-invalid={Boolean(errors.name)}
                      aria-describedby={describedBy}
                      {...register('name', { required: 'Name is required.' })}
                    />
                  )}
                </FormField>
                <FormField label="Email" required error={errors.email?.message}>
                  {({ describedBy }) => (
                    <TextInput
                      type="email"
                      autoComplete="email"
                      aria-invalid={Boolean(errors.email)}
                      aria-describedby={describedBy}
                      {...register('email', {
                        required: 'Email is required.',
                        pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address.' },
                      })}
                    />
                  )}
                </FormField>
              </div>
              <FormField label="Topic" required error={errors.topic?.message}>
                {({ describedBy }) => (
                  <SelectInput aria-describedby={describedBy} {...register('topic', { required: true })}>
                    <option value="order">Order question</option>
                    <option value="product">Product question</option>
                    <option value="sales">Sales / bulk enquiry</option>
                    <option value="other">Something else</option>
                  </SelectInput>
                )}
              </FormField>
              <FormField label="Message" required error={errors.message?.message}>
                {({ describedBy }) => (
                  <TextArea
                    aria-invalid={Boolean(errors.message)}
                    aria-describedby={describedBy}
                    placeholder="Include your order number (ORD-…) for order questions."
                    {...register('message', {
                      required: 'Message is required.',
                      minLength: { value: 10, message: 'Please add a little more detail (10+ characters).' },
                      maxLength: { value: 2000, message: 'Please keep it under 2000 characters.' },
                    })}
                  />
                )}
              </FormField>
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="inline-flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
              >
                <Send size={16} aria-hidden="true" />
                {isSubmitting ? 'Preparing…' : 'Send via email'}
              </button>
            </form>
          </section>

          <div className="flex flex-col gap-8">
            <section aria-label="Find us" className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              <div className="border-b border-border p-5">
                <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                  <MapPin size={18} aria-hidden="true" className="text-accent" />
                  Find us
                </h2>
              </div>
              {env.googleMapsEmbedUrl ? (
                <iframe
                  title="Tech Pulse store location map"
                  src={env.googleMapsEmbedUrl}
                  loading="lazy"
                  className="h-64 w-full border-0"
                />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center gap-2 bg-surface-muted px-6 text-center">
                  <MapPin size={28} aria-hidden="true" className="text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">Map coming soon</p>
                  <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                    Our store map appears here once the location embed is configured.
                  </p>
                </div>
              )}
            </section>

            <section aria-label="Good to know" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Clock size={18} aria-hidden="true" className="text-accent" />
                Good to know
              </h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                <li className="flex gap-2">
                  <Package size={15} aria-hidden="true" className="mt-1 shrink-0 text-accent" />
                  Availability is confirmed at checkout — adding to cart never reserves stock.
                </li>
                <li className="flex gap-2">
                  <Package size={15} aria-hidden="true" className="mt-1 shrink-0 text-accent" />
                  Keep your order number handy — it speeds up every support request.
                </li>
              </ul>
            </section>
          </div>
        </div>

        <section aria-label="Frequently asked questions" className="flex flex-col gap-3">
          <h2 className="text-xl font-bold tracking-tight">Frequently asked</h2>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group px-5 py-4">
                <summary className="cursor-pointer list-none text-sm font-semibold text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {faq.question}
                    <span aria-hidden="true" className="text-lg font-bold text-accent transition-transform duration-200 group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="pt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </Container>
    </div>
  );
}

function ContactCard({ icon: Icon, title, lines }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <span aria-hidden="true" className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-muted text-accent">
        <Icon size={22} />
      </span>
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      {lines.map((line) => (
        <p key={line} className="text-[13px] leading-5 text-muted-foreground">{line}</p>
      ))}
    </div>
  );
}
