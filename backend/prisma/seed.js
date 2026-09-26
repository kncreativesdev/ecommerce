/**
 * Tech Pulse catalog seed.
 *
 * BACKEND SEED DATA ONLY. Uses the existing Prisma schema exactly as-is
 * (no new fields, no new relations). Safe to run repeatedly: every record
 * is keyed by a deterministic unique field (role name, category slug,
 * product slug, variant SKU) and written with upsert / find-or-create.
 * Existing unrelated data is never deleted or modified, except that product
 * and variant rows matching the seed's own slugs/SKUs are updated in place.
 *
 * What this seeds:
 * - roles: CUSTOMER, ADMIN (upsert by name; harmless if already present)
 * - 8 categories (upsert by slug)
 * - 13 products (upsert by slug), each with 1-2 variants (upsert by SKU)
 * - 1 inventory row per variant (created once) + 1 INITIAL_STOCK ledger row
 *
 * What this deliberately does NOT seed:
 * - product images: storagePath values reference the local filesystem media
 *   store, so inserting remote URLs or invented paths would produce broken
 *   images. Media assets are a separate task.
 * - users, carts, wishlists, orders, reviews, coupons: left untouched.
 *
 * Run from backend/:  node prisma/seed.js
 */
const { prisma } = require("../src/config/database");

const BRAND = "Tech Pulse";

const CATEGORIES = [
  {
    slug: "power-banks",
    name: "Power Banks",
    description: "High-capacity portable chargers for phones, earbuds and more.",
    sortOrder: 10,
  },
  {
    slug: "chargers",
    name: "Chargers",
    description: "Fast wall and GaN chargers for phones, tablets and laptops.",
    sortOrder: 20,
  },
  {
    slug: "cables",
    name: "Cables",
    description: "Durable USB-C and multi-head charging cables.",
    sortOrder: 30,
  },
  {
    slug: "wireless-earbuds",
    name: "Wireless Earbuds",
    description: "True wireless earbuds with deep bass and clear calls.",
    sortOrder: 40,
  },
  {
    slug: "bluetooth-speakers",
    name: "Bluetooth Speakers",
    description: "Portable Bluetooth speakers for home and outdoors.",
    sortOrder: 50,
  },
  {
    slug: "car-accessories",
    name: "Car Accessories",
    description: "Car chargers and mounts for life on the road.",
    sortOrder: 60,
  },
  {
    slug: "smart-accessories",
    name: "Smart Accessories",
    description: "Trackers and everyday smart companions.",
    sortOrder: 70,
  },
  {
    slug: "desk-accessories",
    name: "Computer & Desk Accessories",
    description: "Hubs, stands and desk upgrades for work and play.",
    sortOrder: 80,
  },
];

const PRODUCTS = [
  {
    slug: "voltgo-10000",
    name: "Tech Pulse VoltGo 10000",
    categorySlug: "power-banks",
    shortDescription: "10000mAh pocket power bank with 22.5W fast charging.",
    description:
      "The Tech Pulse VoltGo 10000 packs 10000mAh of reliable backup power into a pocket-friendly body. It supports 22.5W fast charging over USB-C, charges two devices at once, and shows remaining charge on a clear LED indicator. Ideal for daily commutes and short trips.",
    isFeatured: true,
    variants: [
      {
        sku: "TP-VG10-BLK",
        name: "Onyx Black",
        price: "1299.00",
        compareAtPrice: "1999.00",
        barcode: "8908001000014",
        weight: "0.220",
        quantity: 240,
      },
      {
        sku: "TP-VG10-WHT",
        name: "Arctic White",
        price: "1349.00",
        compareAtPrice: "2099.00",
        barcode: "8908001000021",
        weight: "0.220",
        quantity: 180,
      },
    ],
  },
  {
    slug: "voltgo-20000",
    name: "Tech Pulse VoltGo 20000",
    categorySlug: "power-banks",
    shortDescription: "20000mAh power bank with 22.5W output and dual ports.",
    description:
      "The Tech Pulse VoltGo 20000 keeps phones, earbuds and accessories powered for days. With 20000mAh capacity, 22.5W fast output, dual USB ports and pass-through charging, it is built for travel, long workdays and power cuts.",
    isFeatured: true,
    variants: [
      {
        sku: "TP-VG20-BLK",
        name: "Onyx Black",
        price: "1999.00",
        compareAtPrice: "2999.00",
        barcode: "8908001000038",
        weight: "0.440",
        quantity: 200,
      },
      {
        sku: "TP-VG20-BLU",
        name: "Ocean Blue",
        price: "2099.00",
        compareAtPrice: "3099.00",
        barcode: "8908001000045",
        weight: "0.440",
        quantity: 120,
      },
    ],
  },
  {
    slug: "chargepro-33w",
    name: "Tech Pulse ChargePro 33W",
    categorySlug: "chargers",
    shortDescription: "33W dual-port fast wall charger for phones and earbuds.",
    description:
      "The Tech Pulse ChargePro 33W charges a phone to half in about 30 minutes. Its dual USB-C and USB-A ports share 33W intelligently, and built-in protection guards against overheating, overcurrent and short circuits.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-CP33",
        name: "33W Dual Port",
        price: "899.00",
        compareAtPrice: "1499.00",
        barcode: "8908001000052",
        weight: "0.080",
        quantity: 320,
      },
    ],
  },
  {
    slug: "chargepro-gan-65w",
    name: "Tech Pulse ChargePro GaN 65W",
    categorySlug: "chargers",
    shortDescription: "65W GaN charger that powers phones and laptops.",
    description:
      "The Tech Pulse ChargePro GaN 65W uses gallium-nitride technology to deliver laptop-grade 65W charging from a compact body. Dual USB-C ports plus USB-A cover every device, with automatic power distribution when all ports are in use.",
    isFeatured: true,
    variants: [
      {
        sku: "TP-CPG65-WHT",
        name: "Arctic White",
        price: "2299.00",
        compareAtPrice: "3299.00",
        barcode: "8908001000069",
        weight: "0.140",
        quantity: 150,
      },
      {
        sku: "TP-CPG65-BLK",
        name: "Onyx Black",
        price: "2299.00",
        compareAtPrice: "3299.00",
        barcode: "8908001000076",
        weight: "0.140",
        quantity: 110,
      },
    ],
  },
  {
    slug: "syncline-usbc-cable",
    name: "Tech Pulse SyncLine USB-C Cable",
    categorySlug: "cables",
    shortDescription: "60W braided USB-C cable in 1m and 2m lengths.",
    description:
      "The Tech Pulse SyncLine USB-C Cable pairs 60W fast-charging support with a tightly braided nylon jacket rated for thousands of bends. Available in 1m for desks and 2m for bedsides, it carries both power and high-speed data.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-SL1M",
        name: "1m",
        price: "399.00",
        compareAtPrice: "699.00",
        barcode: "8908001000083",
        weight: "0.040",
        quantity: 500,
      },
      {
        sku: "TP-SL2M",
        name: "2m",
        price: "549.00",
        compareAtPrice: "899.00",
        barcode: "8908001000090",
        weight: "0.060",
        quantity: 420,
      },
    ],
  },
  {
    slug: "syncline-3in1-cable",
    name: "Tech Pulse SyncLine 3-in-1 Cable",
    categorySlug: "cables",
    shortDescription: "One cable for USB-C, Lightning and Micro-USB devices.",
    description:
      "The Tech Pulse SyncLine 3-in-1 Cable ends cable clutter with USB-C, Lightning and Micro-USB heads on a single braided line. One charger powers the whole family of devices, making it a travel-bag essential.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-SL31",
        name: "1.2m 3-in-1",
        price: "599.00",
        compareAtPrice: "999.00",
        barcode: "8908001000106",
        weight: "0.050",
        quantity: 380,
      },
    ],
  },
  {
    slug: "airbeat-pro",
    name: "Tech Pulse AirBeat Pro",
    categorySlug: "wireless-earbuds",
    shortDescription: "Flagship TWS earbuds with ENC calls and 45H playtime.",
    description:
      "The Tech Pulse AirBeat Pro delivers punchy 13mm drivers, quad-mic ENC for clear calls, low-latency game mode and up to 45 hours of total playtime with the pocketable charging case. Touch controls and fast Type-C top-up complete the flagship package.",
    isFeatured: true,
    variants: [
      {
        sku: "TP-ABP-BLK",
        name: "Onyx Black",
        price: "2999.00",
        compareAtPrice: "4999.00",
        barcode: "8908001000113",
        weight: "0.055",
        quantity: 160,
      },
      {
        sku: "TP-ABP-WHT",
        name: "Arctic White",
        price: "2999.00",
        compareAtPrice: "4999.00",
        barcode: "8908001000120",
        weight: "0.055",
        quantity: 140,
      },
    ],
  },
  {
    slug: "airbeat-mini",
    name: "Tech Pulse AirBeat Mini",
    categorySlug: "wireless-earbuds",
    shortDescription: "Feather-light everyday earbuds with 30H playtime.",
    description:
      "The Tech Pulse AirBeat Mini is built for all-day comfort: feather-light buds, snug fit, balanced sound and up to 30 hours of total playtime. Perfect first pair for music, calls and online classes.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-ABM",
        name: "Graphite Grey",
        price: "1799.00",
        compareAtPrice: "2999.00",
        barcode: "8908001000137",
        weight: "0.050",
        quantity: 260,
      },
    ],
  },
  {
    slug: "soundpulse-go",
    name: "Tech Pulse SoundPulse Go",
    categorySlug: "bluetooth-speakers",
    shortDescription: "Pocket Bluetooth speaker with 16W sound and IPX7 build.",
    description:
      "The Tech Pulse SoundPulse Go fills the room with 16W of rich stereo sound from a go-anywhere body. IPX7 water resistance, 12-hour playtime and TWS pairing for true wireless stereo make it ready for pool parties and treks alike.",
    isFeatured: true,
    variants: [
      {
        sku: "TP-SPG-CH",
        name: "Charcoal",
        price: "2499.00",
        compareAtPrice: "3999.00",
        barcode: "8908001000144",
        weight: "0.680",
        quantity: 130,
      },
      {
        sku: "TP-SPG-TL",
        name: "Teal",
        price: "2699.00",
        compareAtPrice: "4199.00",
        barcode: "8908001000151",
        weight: "0.680",
        quantity: 90,
      },
    ],
  },
  {
    slug: "soundpulse-party-40w",
    name: "Tech Pulse SoundPulse Party 40W",
    categorySlug: "bluetooth-speakers",
    shortDescription: "40W party speaker with RGB lights and karaoke mic port.",
    description:
      "The Tech Pulse SoundPulse Party 40W turns any gathering up: 40W of deep-bass sound, rhythmic RGB lighting, a karaoke mic port and up to 8 hours of playtime. Dual pairing links two speakers for true stereo width.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-SPP40",
        name: "Midnight Black",
        price: "3999.00",
        compareAtPrice: "5999.00",
        barcode: "8908001000168",
        weight: "2.400",
        quantity: 75,
      },
    ],
  },
  {
    slug: "drivecharge-38w",
    name: "Tech Pulse DriveCharge 38W",
    categorySlug: "car-accessories",
    shortDescription: "38W dual-port car charger with all-metal body.",
    description:
      "The Tech Pulse DriveCharge 38W tops up two devices at full speed on the move. Its all-metal unibody survives hot dashboards, while intelligent charging matches each device and protects against voltage spikes.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-DC38",
        name: "Metal Grey",
        price: "899.00",
        compareAtPrice: "1499.00",
        barcode: "8908001000175",
        weight: "0.045",
        quantity: 300,
      },
    ],
  },
  {
    slug: "tagtrack-finder",
    name: "Tech Pulse TagTrack Finder",
    categorySlug: "smart-accessories",
    shortDescription: "Bluetooth tracker for keys, bags and wallets.",
    description:
      "The Tech Pulse TagTrack Finder ends lost-key panic. Clip it to keys, bags or wallets and ring them from your phone, or find your phone from the tag. A replaceable battery lasts up to a year, and separation alerts warn before you leave things behind.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-TTF",
        name: "Slate",
        price: "1299.00",
        compareAtPrice: "1999.00",
        barcode: "8908001000182",
        weight: "0.012",
        quantity: 220,
      },
    ],
  },
  {
    slug: "deskhub-6in1",
    name: "Tech Pulse DeskHub 6-in-1",
    categorySlug: "desk-accessories",
    shortDescription: "6-in-1 USB-C hub with 4K HDMI and 100W pass-through.",
    description:
      "The Tech Pulse DeskHub 6-in-1 turns one laptop port into a full workstation: 4K HDMI, 100W power pass-through, two USB-A 3.0 ports, SD/microSD readers and gigabit-class data speeds in an aluminium body that matches modern laptops.",
    isFeatured: false,
    variants: [
      {
        sku: "TP-DH6",
        name: "Space Grey",
        price: "2499.00",
        compareAtPrice: "3999.00",
        barcode: "8908001000199",
        weight: "0.120",
        quantity: 140,
      },
    ],
  },
];

async function seedRoles() {
  for (const name of ["CUSTOMER", "ADMIN"]) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

async function seedCategories() {
  const bySlug = {};
  for (const c of CATEGORIES) {
    const record = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        description: c.description,
        isActive: true,
        sortOrder: c.sortOrder,
      },
      create: {
        name: c.name,
        slug: c.slug,
        description: c.description,
        isActive: true,
        sortOrder: c.sortOrder,
      },
    });
    bySlug[c.slug] = record;
  }
  return bySlug;
}

async function seedProducts(categoriesBySlug) {
  let variantCount = 0;
  let inventoryCreated = 0;

  for (const p of PRODUCTS) {
    const category = categoriesBySlug[p.categorySlug];
    if (!category) {
      throw new Error(`Unknown category slug in seed data: ${p.categorySlug}`);
    }

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: {
        categoryId: category.id,
        name: p.name,
        description: p.description,
        shortDescription: p.shortDescription,
        brand: BRAND,
        isActive: true,
        isFeatured: p.isFeatured,
      },
      create: {
        categoryId: category.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        shortDescription: p.shortDescription,
        brand: BRAND,
        isActive: true,
        isFeatured: p.isFeatured,
      },
    });

    for (const v of p.variants) {
      const variant = await prisma.productVariant.upsert({
        where: { sku: v.sku },
        update: {
          productId: product.id,
          name: v.name,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          barcode: v.barcode,
          weight: v.weight,
          isActive: true,
        },
        create: {
          productId: product.id,
          sku: v.sku,
          name: v.name,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          barcode: v.barcode,
          weight: v.weight,
          isActive: true,
        },
      });
      variantCount += 1;

      // Inventory is created once per variant, mirroring the inventory
      // module's initialize-with-ledger pattern (INITIAL_STOCK entry).
      // Re-runs never duplicate inventory or ledger rows.
      const existing = await prisma.inventory.findUnique({
        where: { variantId: variant.id },
      });
      if (!existing) {
        const record = await prisma.inventory.create({
          data: {
            variantId: variant.id,
            quantity: v.quantity,
            reservedQuantity: 0,
          },
        });
        await prisma.inventoryTransaction.create({
          data: {
            variantId: variant.id,
            quantity: v.quantity,
            type: "INITIAL_STOCK",
            referenceType: "SEED",
            referenceId: record.id,
            note: `Seed stock for ${v.sku}`,
          },
        });
        inventoryCreated += 1;
      }
    }
  }

  return { variantCount, inventoryCreated };
}

async function main() {
  await seedRoles();
  const categoriesBySlug = await seedCategories();
  const { variantCount, inventoryCreated } = await seedProducts(categoriesBySlug);

  const [categoryCount, productCount, inventoryCount, ledgerCount] =
    await Promise.all([
      prisma.category.count(),
      prisma.product.count(),
      prisma.inventory.count(),
      prisma.inventoryTransaction.count({
        where: { type: "INITIAL_STOCK", referenceType: "SEED" },
      }),
    ]);

  console.log(
    JSON.stringify(
      {
        categories: categoryCount,
        products: productCount,
        variantsSeeded: variantCount,
        inventory: inventoryCount,
        seedLedgerEntries: ledgerCount,
        inventoryCreatedThisRun: inventoryCreated,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
