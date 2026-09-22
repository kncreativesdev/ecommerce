/**
 * Shared static site configuration.
 *
 * Only brand identity, announcement content, and temporary shell content
 * live here. All merchandising, category, and company content stays
 * backend- or config-driven in later milestones — never hardcoded as
 * live data.
 */
export const siteConfig = {
  brandName: 'Tech Pulse',
  brandShortName: 'TECH PULSE',
  /** Compact subtitle rendered under the wordmark in the header. */
  brandTagline: 'Gadget Store',
  tagline: 'Premium electronics, honestly priced.',
  announcementMessages: [
    'Cash on Delivery available across India',
    'New launches just dropped — explore the catalog',
    'Honest pricing in INR, no hidden charges',
  ],
  /**
   * Compact promotional strip above the main navigation. Original Tech
   * Pulse wording — edit copy here, never deep inside JSX.
   */
  announcement: {
    message: 'Get up to 40% off selected gadgets.',
  },
};
