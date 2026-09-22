import { MessageCircle } from 'lucide-react';
import { env } from '../../config/env.js';

/**
 * Floating WhatsApp action (FRONTEND_SPEC §4.1): fixed bottom-right
 * (`z-30`, clear of sticky bars/toasts), both themes, labeled, keyboard
 * reachable, hover lift + focus ring. Destination is configurable
 * (`VITE_WHATSAPP_LINK`); without a configured number it renders nothing
 * rather than a fake contact — no fabricated business data.
 */
export function WhatsAppFloat() {
  const link = env.whatsappLink;
  if (!link) return null;

  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with Tech Pulse on WhatsApp"
      title="Chat with Tech Pulse on WhatsApp"
      className="fixed bottom-6 right-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-success text-background shadow-lg transition-transform duration-200 hover:-translate-y-0.5 hover:no-underline focus-visible:outline-none"
    >
      <MessageCircle size={26} aria-hidden="true" />
    </a>
  );
}
