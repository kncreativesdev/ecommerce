import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, ChevronLeft, ChevronRight, Headset, ShieldCheck, ShoppingBag, Sparkles } from 'lucide-react';
import { fetchProductImages, resolveImageUrl } from '../../services/media.service.js';
import { galleryForVariant, primaryImageFor } from '../../utils/variantMedia.js';
import { getDefaultVariant } from '../../utils/productAdapter.js';
import { HERO_MAX_SLIDES, selectHeroWatchProducts } from '../../utils/heroSlides.js';
import { discountPercentFromStrings, formatINR } from '../../lib/format.js';
import { env } from '../../config/env.js';
import { cn } from '../../lib/cn.js';
import { Container } from '../ui/Container.jsx';
import { Skeleton } from '../ui/Skeleton.jsx';

/**
 * Homepage hero carousel over REAL watch-product media.
 *
 * Data flow (no duplicate fetching):
 * - `products` arrives from the homepage's existing catalog cache
 *   (`useProducts` → product store, single-flight). This component never
 *   fetches products.
 * - Only per-product image lists are fetched (`GET
 *   /products/:productId/images`, one request per hero candidate — the same
 *   read `ProductGallery` performs), resolved through the shared
 *   `resolveImageUrl` (never hand-built URLs, never external hosts).
 * - The usable image for each product follows existing variant semantics:
 *   default variant's gallery (primary first), falling back to
 *   product-level images when the variant has none. A product with no
 *   usable image contributes no slide; a runtime load failure drops that
 *   slide instead of showing a broken image. Zero slides → static fallback.
 *
 * Variable slide count: `slides.length = min(3, valid images)`. Navigation
 * (prev/next/dots) and autoplay exist only when `slides.length > 1`; a
 * single slide renders statically with no timer and no controls.
 *
 * Autoplay: one 5s interval, restarted on manual navigation (fresh window),
 * paused while hovered/focused or when reduced motion is requested, cleaned
 * up on unmount. Transitions are CSS-only (`motion-reduce` disables them).
 */

export const HERO_AUTOPLAY_MS = 5000;

/** Presentation-only copy keyed by product slug (images stay data-driven). */
const HERO_COPY = {
  'yo-watch': {
    headline: 'Everyday time,',
    headlineAccent: 'done right.',
    badge: 'Premium Wearables',
  },
  'cool-watchh': {
    headline: 'Golden Black,',
    headlineAccent: 'made for every day.',
    badge: 'Premium Wearables',
  },
};

const HERO_TRUST = [
  { icon: 'cod', label: 'Cash on Delivery' },
  { icon: 'genuine', label: 'Genuine products' },
  { icon: 'support', label: 'Support that replies' },
];

function TrustIcon({ kind }) {
  if (kind === 'genuine') return <ShieldCheck size={15} aria-hidden="true" className="text-accent" />;
  if (kind === 'support') return <Headset size={15} aria-hidden="true" className="text-accent" />;
  return <Banknote size={15} aria-hidden="true" className="text-accent" />;
}

function slideCopy(product) {
  const override = HERO_COPY[product?.slug] ?? {};
  const variant = getDefaultVariant(product);
  const price = variant?.price != null ? formatINR(variant.price) : null;
  // MRP + discount render ONLY from real backend pricing: Yo Watch carries
  // a genuine compare-at price (1000 < 1200 → "17% off"); products priced
  // at/above MRP yield `null` and show no strikethrough or badge at all.
  const discount = discountPercentFromStrings(variant?.price, variant?.compareAtPrice);
  const compareAt = discount != null ? formatINR(variant.compareAtPrice) : null;
  return {
    eyebrow: [product?.brand, product?.category?.name].filter(Boolean).join(' · ') || 'Tech Pulse',
    headline: override.headline ?? product?.name ?? 'Featured watch',
    headlineAccent: override.headlineAccent ?? '',
    badge: override.badge ?? 'Featured',
    sub: product?.shortDescription ?? 'A Tech Pulse watch with Cash on Delivery.',
    price,
    compareAt,
    discount,
    priceNote: 'Cash on Delivery available',
    primaryCtaLabel: 'Buy Now',
    secondaryCtaLabel: 'Explore Collection',
    cardCtaLabel: 'View Product',
    ctaTo: `/product/${product?.id}`,
    alt: `${product?.name ?? 'Watch'} product photo`,
  };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function HeroCarousel({ products = [], isLoading = false }) {
  const candidates = selectHeroWatchProducts(products, HERO_MAX_SLIDES);
  const candidateIds = candidates.map((product) => product.id).join('|');

  const [imagesByProduct, setImagesByProduct] = useState({});
  const [failedUrls, setFailedUrls] = useState({});
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  // Touch swipe origin for finger gestures (clientX/Y of the first touch).
  // Pointer events are intentionally not used: touch events cover mobile
  // swipe, mouse users keep the always-visible arrows/dots, and
  // `touch-pan-y` below lets vertical page scroll pass through while
  // horizontal swipes change slides.
  const touchStartRef = useRef(null);

  // One image-list request per hero candidate (cached per product id for
  // the component lifetime — no refetch on slide changes or navigation).
  // Loading is DERIVED (every candidate resolved?) so the effect body only
  // subscribes to the external fetch and stores its result in the
  // completion callback — no synchronous setState, no cascading render.
  useEffect(() => {
    if (candidates.length === 0) return undefined;
    let cancelled = false;
    Promise.all(
      candidates.map((product) =>
        fetchProductImages(product.id)
          .then((list) => ({ id: product.id, list: Array.isArray(list) ? list : [] }))
          .catch(() => ({ id: product.id, list: [] })),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setImagesByProduct((prev) => {
        const next = { ...prev };
        for (const entry of entries) next[entry.id] = entry.list;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // Re-run only when the candidate id set changes (join keeps the dep
    // stable across catalog-array identities).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateIds]);

  const imagesReady =
    candidates.length > 0 && candidates.every((product) => product.id in imagesByProduct);

  // Usable slides: exactly one per candidate WITH a resolvable image —
  // never invented, never duplicated for count.
  const slides = candidates.flatMap((product) => {
    const allImages = imagesByProduct[product.id] ?? [];
    const variant = getDefaultVariant(product);
    const gallery = galleryForVariant(allImages, variant?.id ?? null);
    const primary = primaryImageFor(gallery);
    const url = resolveImageUrl(primary, env.mediaBaseUrl);
    if (!primary || !url || failedUrls[url]) return [];
    return [{ product, image: primary, url, copy: slideCopy(product) }];
  });

  const activeIndex = slides.length > 0 ? Math.min(index, slides.length - 1) : 0;
  const showControls = slides.length > 1;

  const goTo = (next) => {
    if (slides.length <= 1) return;
    setIndex(((next % slides.length) + slides.length) % slides.length);
    setCycle((value) => value + 1);
  };

  // Finger swipe: horizontal-dominant gestures past a small threshold change
  // slides; vertical or short gestures are ignored so page scrolling is
  // never hijacked. Autoplay pauses while the finger is down and resumes
  // after (goTo restarts the interval window via `cycle`).
  const handleTouchStart = (event) => {
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setPaused(true);
  };

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    setPaused(false);
    if (!start || slides.length <= 1) return;
    const touch = event.changedTouches?.[0] ?? event.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const SWIPE_THRESHOLD_PX = 40;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
    goTo(activeIndex + (dx < 0 ? 1 : -1));
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
    setPaused(false);
  };

  // Single autoplay interval: active only for multi-slide heroes while the
  // user is not interacting and motion is allowed. Restarted (not stacked)
  // on manual navigation via `cycle`; always cleaned up.
  useEffect(() => {
    if (!showControls || paused || reducedMotion) return undefined;
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, HERO_AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [showControls, paused, reducedMotion, cycle, slides.length]);

  const markFailed = (url) => {
    if (!url) return;
    setFailedUrls((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  };

  // Empty candidates skip loading entirely and fall through to the
  // static fallback below (no fake imagery, no spinner forever).
  if (isLoading || (candidates.length > 0 && !imagesReady)) {
    return (
      <section aria-label="Featured watches" className="border-b border-border bg-card">
        <Container className="py-10 sm:py-14">
          <div role="status" aria-label="Loading featured watches" className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
            <div className="flex flex-col gap-4">
              <Skeleton className="h-6 w-40 rounded-full" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-5 w-full max-w-md" />
              <Skeleton className="h-11 w-40 rounded-xl" />
            </div>
            <Skeleton className="aspect-[4/3] w-full rounded-3xl" />
          </div>
        </Container>
      </section>
    );
  }

  // Zero usable watch images: honest static fallback (no fake imagery).
  if (slides.length === 0) {
    return (
      <section aria-label="Tech Pulse introduction" className="border-b border-border bg-card">
        <Container className="flex flex-col items-start gap-5 py-12 sm:py-16">
          <h1 className="max-w-xl text-[32px] font-extrabold leading-[40px] tracking-tight text-foreground sm:text-[40px] sm:leading-[44px]">
            Premium electronics, honestly priced.
          </h1>
          <p className="max-w-md text-base leading-7 text-muted-foreground">
            Audio, power, and desk gear with clear pricing in rupees and Cash on Delivery.
          </p>
          <Link
            to="/shop"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 hover:no-underline"
          >
            Shop all products
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Container>
      </section>
    );
  }

  // Reference-composition dark hero. Only the slide SURFACE is redesigned —
  // data flow, selection, autoplay, and controls behavior are untouched.
  // Per-slide layers: (1) the ACTIVE slide's real image as a dimmed
  // atmospheric background, (2) left-weighted dark gradients, (3) left copy
  // (badge, headline, real price, dual CTAs), (4) right floating watch
  // showcase (red glow + contained product image + info card). The track
  // and section sit on `bg-header` (near-black in both themes) so no light
  // gap can flash through mid-transition.
  return (
    <section
      aria-label="Featured watches"
      aria-roledescription="carousel"
      className="overflow-hidden border-b border-border bg-header"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="relative touch-pan-y"
        data-testid="hero-carousel-viewport"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div
          className="relative flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {slides.map((slide, slideIndex) => {
            const isActive = slideIndex === activeIndex;
            return (
              <div
                key={slide.product.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${slideIndex + 1} of ${slides.length}`}
                aria-hidden={!isActive}
                className="relative w-full shrink-0 overflow-hidden"
              >
                {/* Layer 1: active slide image as atmosphere (dimmed, never
                    competing with the foreground watch or the copy). */}
                <img
                  src={slide.url}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  onError={() => markFailed(slide.url)}
                  className="pointer-events-none absolute inset-0 h-full w-full scale-105 object-cover object-center opacity-25"
                />
                {/* Layer 2: readability gradients — darkest left for text,
                    lifting right so the showcase stays luminous, plus a
                    bottom fade into the trust strip. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/30 sm:via-black/50 sm:to-black/20"
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/80 to-transparent"
                />

                {/* Layer 3: foreground content. */}
                <Container className="relative z-10">
                  <div className="grid items-center gap-10 py-14 sm:min-h-[520px] sm:py-16 lg:min-h-[600px] lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-20">
                    {/* Left: badge, headline, price, CTAs. */}
                    <div
                      key={isActive ? `hero-copy-${slide.product.id}` : `hero-copy-idle-${slide.product.id}`}
                      className={cn(
                        'flex max-w-xl flex-col items-start gap-5',
                        isActive && !reducedMotion && 'tp-hero-enter',
                      )}
                    >
                      <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-white/85 backdrop-blur-sm">
                        <Sparkles size={14} aria-hidden="true" className="text-accent" />
                        {slide.copy.badge}
                      </p>
                      <h2 className="text-[40px] font-black leading-[44px] tracking-tight text-white sm:text-6xl sm:leading-[64px]">
                        {slide.copy.headline}{' '}
                        {slide.copy.headlineAccent ? (
                          <span className="text-accent">{slide.copy.headlineAccent}</span>
                        ) : null}
                      </h2>
                      <p className="max-w-md text-[15px] leading-7 text-white/75">{slide.copy.sub}</p>
                      {slide.copy.price ? (
                        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-3xl font-extrabold tabular-nums text-white">
                            {slide.copy.price}
                          </span>
                          {slide.copy.compareAt ? (
                            <s className="text-lg font-semibold tabular-nums text-white/45">
                              {slide.copy.compareAt}
                            </s>
                          ) : null}
                          {slide.copy.discount != null ? (
                            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-accent-foreground">
                              {slide.copy.discount}% off
                            </span>
                          ) : null}
                        </p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-3">
                        <Link
                          to={slide.copy.ctaTo}
                          tabIndex={isActive ? undefined : -1}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-accent px-7 py-3 text-sm font-semibold text-accent-foreground transition-colors duration-200 hover:bg-accent-hover hover:no-underline focus-visible:outline-white"
                        >
                          <ShoppingBag size={16} aria-hidden="true" />
                          {slide.copy.primaryCtaLabel}
                        </Link>
                        <Link
                          to="/shop"
                          tabIndex={isActive ? undefined : -1}
                          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/25 bg-white/5 px-7 py-3 text-sm font-semibold text-white backdrop-blur-sm transition-colors duration-200 hover:bg-white/15 hover:no-underline focus-visible:outline-white"
                        >
                          {slide.copy.secondaryCtaLabel}
                        </Link>
                      </div>
                    </div>

                    {/* Right: floating watch showcase. */}
                    <div
                      key={isActive ? `hero-show-${slide.product.id}` : `hero-show-idle-${slide.product.id}`}
                      className={cn(
                        'relative mx-auto w-full max-w-md lg:max-w-none',
                        isActive && !reducedMotion && 'tp-hero-enter',
                      )}
                    >
                      {/* Red glow behind the product. Static, decorative. */}
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/25 blur-3xl sm:h-96 sm:w-96"
                      />
                      <img
                        src={slide.url}
                        alt={slide.copy.alt}
                        loading={slideIndex === 0 ? 'eager' : 'lazy'}
                        onError={() => markFailed(slide.url)}
                        className="relative z-10 h-[320px] w-full object-contain object-center drop-shadow-[0_35px_60px_rgba(0,0,0,0.65)] transition-transform duration-500 ease-out hover:scale-[1.03] motion-reduce:transition-none motion-reduce:hover:scale-100 sm:h-[420px] lg:h-[480px]"
                      />
                      {/* Compact info card overlapping the showcase base. */}
                      <div className="relative z-20 mx-4 -mt-14 rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur-md sm:mx-8">
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">
                              Featured Watch
                            </p>
                            <p className="mt-1 truncate text-base font-bold text-white">
                              {slide.product.name}
                            </p>
                            {slide.copy.price ? (
                              <p className="mt-0.5 text-sm font-bold tabular-nums text-white/85">
                                {slide.copy.price}
                              </p>
                            ) : null}
                          </div>
                          <Link
                            to={slide.copy.ctaTo}
                            tabIndex={isActive ? undefined : -1}
                            aria-label={`View ${slide.product.name}`}
                            className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground transition-colors duration-200 hover:bg-accent-hover hover:no-underline focus-visible:outline-white"
                          >
                            {slide.copy.cardCtaLabel}
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </Container>
              </div>
            );
          })}
        </div>

        {/* Edge arrows: vertically centered, clear of copy and showcase.
            Always visible (including mobile) — translucency plus the
            content's side padding keeps them off the text and product. */}
        {showControls ? (
          <>
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              aria-label="Previous slide"
              className="absolute left-2 top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-colors duration-200 hover:border-accent hover:text-white focus-visible:outline-white md:left-3 md:h-11 md:w-11"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => goTo(activeIndex + 1)}
              aria-label="Next slide"
              className="absolute right-2 top-1/2 z-20 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-colors duration-200 hover:border-accent hover:text-white focus-visible:outline-white md:right-3 md:h-11 md:w-11"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        ) : null}

        {/* Dots: centered pills, red active accent, spaced from hero content. */}
        {showControls ? (
          <div className="relative z-10 mt-4 flex items-center justify-center gap-2 pb-6" role="group" aria-label="Choose slide">
            {slides.map((slide, slideIndex) => (
              <button
                key={slide.product.id}
                type="button"
                onClick={() => goTo(slideIndex)}
                aria-label={`Go to slide ${slideIndex + 1}: ${slide.product.name}`}
                aria-current={slideIndex === activeIndex ? 'true' : undefined}
                className={cn(
                  'h-2 cursor-pointer rounded-full transition-all duration-300 motion-reduce:transition-none focus-visible:outline-white',
                  slideIndex === activeIndex
                    ? 'w-8 bg-accent'
                    : 'w-2 bg-white/35 hover:bg-white/65',
                )}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Bottom trust strip: verified site capabilities only. */}
      <div className="relative border-t border-white/10">
        <Container>
          <ul aria-label="Why shop with Tech Pulse" className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 py-4 sm:justify-between">
            {HERO_TRUST.map((item) => (
              <li key={item.label} className="inline-flex items-center gap-2 text-[13px] font-medium text-white/70">
                <TrustIcon kind={item.icon} />
                {item.label}
              </li>
            ))}
          </ul>
        </Container>
      </div>
    </section>
  );
}
