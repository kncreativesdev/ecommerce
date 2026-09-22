import {
  Archive,
  BatteryCharging,
  BatteryFull,
  Bluetooth,
  Cable,
  Droplets,
  Headphones,
  KeyRound,
  Laptop,
  Lightbulb,
  MapPin,
  Mic,
  Monitor,
  Music,
  Navigation,
  Plug,
  PlugZap,
  Radar,
  Radio,
  Smartphone,
  Speaker,
  Tag,
  Usb,
  Volume2,
  Zap,
} from 'lucide-react';
import { categoryIconForSlug } from '../utils/categoryAdapter.js';

/**
 * TEMPORARY frontend fallback taxonomy (presentation seam only).
 *
 * Top-level names, slugs, and descriptions mirror the seeded backend
 * categories (`backend/prisma/seed.js`) — they are NOT invented. Subcategory
 * groupings are derived from the seeded product families (VoltGo power
 * banks, ChargePro wall/GaN chargers, SyncLine cables, AirBeat earbuds,
 * SoundPulse speakers, DriveCharge car charger, TagTrack finder, DeskHub)
 * plus concise domain-standard siblings so the mega-menu reads like a real
 * electronics storefront.
 *
 * The backend exposes no dedicated subcategory-master API (no
 * hierarchy/subcategory contract in `backend/docs/`), so this file REMAINS
 * the navigation fallback. It must never be presented as backend-backed.
 * `stores/useCategoryStore.js` serves the backend-derived taxonomy when
 * `GET /categories` succeeds and falls back to this file otherwise; the
 * adapter (`utils/categoryAdapter.js`) normalizes both into one shape.
 *
 * Slugs are display metadata only (API calls must use UUIDs per
 * FRONTEND_SPEC §4.2). Top-level `id` is `null` until the catalog
 * milestone; the `:id` route param temporarily carries the slug so the
 * menu stays clickable and verifiable.
 *
 * Top-level icons resolve through the shared `categoryIconForSlug` map so
 * API-derived and fallback categories render identically. Each subcategory
 * carries `image: null` today — the thumbnail component renders the
 * configured Lucide icon until real media paths land, at which point
 * populating `image` requires no component change.
 */
export const categoryNavItems = [
  {
    id: null,
    slug: 'power-banks',
    name: 'Power Banks',
    description: 'High-capacity portable chargers for phones, earbuds and more.',
    icon: categoryIconForSlug('power-banks'),
    subcategories: [
      { slug: 'pocket-power-banks', name: 'Pocket Power Banks', blurb: 'Everyday 10000mAh backups', image: null, icon: BatteryCharging },
      { slug: 'fast-charging-power-banks', name: 'Fast-Charging Banks', blurb: '22.5W and faster top-ups', image: null, icon: Zap },
      { slug: 'high-capacity-power-banks', name: 'High-Capacity Banks', blurb: '20000mAh for long trips', image: null, icon: BatteryFull },
      { slug: 'mini-power-banks', name: 'Mini Power Banks', blurb: 'Lipstick-size emergency charge', image: null, icon: Smartphone },
    ],
  },
  {
    id: null,
    slug: 'chargers',
    name: 'Chargers',
    description: 'Fast wall and GaN chargers for phones, tablets and laptops.',
    icon: categoryIconForSlug('chargers'),
    subcategories: [
      { slug: 'wall-chargers', name: 'Wall Chargers', blurb: 'Compact fast-charge bricks', image: null, icon: Plug },
      { slug: 'gan-chargers', name: 'GaN Chargers', blurb: '65W gallium-nitride power', image: null, icon: PlugZap },
      { slug: 'multi-port-chargers', name: 'Multi-Port Chargers', blurb: 'Charge phone, buds and watch', image: null, icon: Zap },
      { slug: 'laptop-chargers', name: 'Laptop Chargers', blurb: 'High-watt USB-C adapters', image: null, icon: Laptop },
    ],
  },
  {
    id: null,
    slug: 'cables',
    name: 'Cables',
    description: 'Durable USB-C and multi-head charging cables.',
    icon: categoryIconForSlug('cables'),
    subcategories: [
      { slug: 'usb-c-cables', name: 'USB-C Cables', blurb: 'Everyday SyncLine essentials', image: null, icon: Cable },
      { slug: 'multi-head-cables', name: '3-in-1 Cables', blurb: 'One cable, every device', image: null, icon: Usb },
      { slug: 'fast-charge-cables', name: 'Fast-Charge Cables', blurb: 'High-current charging leads', image: null, icon: Zap },
      { slug: 'braided-cables', name: 'Braided Cables', blurb: 'Tangle-free nylon builds', image: null, icon: Cable },
    ],
  },
  {
    id: null,
    slug: 'wireless-earbuds',
    name: 'Wireless Earbuds',
    description: 'True wireless earbuds with deep bass and clear calls.',
    icon: categoryIconForSlug('wireless-earbuds'),
    subcategories: [
      { slug: 'everyday-earbuds', name: 'Everyday Earbuds', blurb: 'AirBeat Mini and friends', image: null, icon: Headphones },
      { slug: 'pro-earbuds', name: 'Pro Earbuds', blurb: 'Flagship sound and calls', image: null, icon: Music },
      { slug: 'calling-earbuds', name: 'Calling Earbuds', blurb: 'Clear-mic work companions', image: null, icon: Mic },
      { slug: 'sport-earbuds', name: 'Sport Earbuds', blurb: 'Secure fit for workouts', image: null, icon: Zap },
    ],
  },
  {
    id: null,
    slug: 'bluetooth-speakers',
    name: 'Bluetooth Speakers',
    description: 'Portable Bluetooth speakers for home and outdoors.',
    icon: categoryIconForSlug('bluetooth-speakers'),
    subcategories: [
      { slug: 'portable-speakers', name: 'Portable Speakers', blurb: 'SoundPulse Go and friends', image: null, icon: Speaker },
      { slug: 'party-speakers', name: 'Party Speakers', blurb: '40W room-filling sound', image: null, icon: Volume2 },
      { slug: 'mini-speakers', name: 'Mini Speakers', blurb: 'Pocket-size companions', image: null, icon: Radio },
      { slug: 'outdoor-speakers', name: 'Outdoor Speakers', blurb: 'Built for splash and dust', image: null, icon: Droplets },
    ],
  },
  {
    id: null,
    slug: 'car-accessories',
    name: 'Car Accessories',
    description: 'Car chargers and mounts for life on the road.',
    icon: categoryIconForSlug('car-accessories'),
    subcategories: [
      { slug: 'car-chargers', name: 'Car Chargers', blurb: 'DriveCharge fast charging', image: null, icon: BatteryCharging },
      { slug: 'car-bluetooth', name: 'Car Bluetooth', blurb: 'Hands-free audio adapters', image: null, icon: Bluetooth },
      { slug: 'mobile-holders', name: 'Mobile Holders', blurb: 'Dash and vent grips', image: null, icon: Smartphone },
      { slug: 'car-mounts', name: 'Car Mounts', blurb: 'Sturdy navigation mounts', image: null, icon: Navigation },
      { slug: 'car-audio', name: 'Car Audio', blurb: 'Louder drives', image: null, icon: Volume2 },
      { slug: 'other-car-accessories', name: 'More Car Gear', blurb: 'Everything else for the road', image: null, icon: MapPin },
    ],
  },
  {
    id: null,
    slug: 'smart-accessories',
    name: 'Smart Accessories',
    description: 'Trackers and everyday smart companions.',
    icon: categoryIconForSlug('smart-accessories'),
    subcategories: [
      { slug: 'item-trackers', name: 'Item Trackers', blurb: 'TagTrack finder and friends', image: null, icon: Radar },
      { slug: 'key-finders', name: 'Key Finders', blurb: 'Never lose keys again', image: null, icon: KeyRound },
      { slug: 'smart-tags', name: 'Smart Tags', blurb: 'Tag bags, wallets and more', image: null, icon: Tag },
      { slug: 'led-gadgets', name: 'LED Gadgets', blurb: 'Smart glow for your desk', image: null, icon: Lightbulb },
    ],
  },
  {
    id: null,
    slug: 'desk-accessories',
    name: 'Computer & Desk Accessories',
    description: 'Hubs, stands and desk upgrades for work and play.',
    icon: categoryIconForSlug('desk-accessories'),
    subcategories: [
      { slug: 'usb-hubs', name: 'USB Hubs', blurb: 'DeskHub multiport docks', image: null, icon: Usb },
      { slug: 'laptop-stands', name: 'Laptop Stands', blurb: 'Ergonomic desk risers', image: null, icon: Laptop },
      { slug: 'monitor-accessories', name: 'Monitor Accessories', blurb: 'Light bars and mounts', image: null, icon: Monitor },
      { slug: 'desk-organizers', name: 'Desk Organizers', blurb: 'Tidy cables and gear', image: null, icon: Archive },
    ],
  },
];

/**
 * Look up a top-level category in the FALLBACK taxonomy by slug. Used by the
 * shop filter seam until the catalog milestone switches it to the taxonomy
 * store — returns `undefined` for unknown slugs.
 */
export function findCategoryBySlug(slug) {
  return categoryNavItems.find((category) => category.slug === slug);
}
