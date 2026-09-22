import { Link } from 'react-router-dom';
import { CategoryImage } from './CategoryImage.jsx';

/**
 * Category discovery tile: uploaded category `image` when present (see
 * `CategoryImage`), otherwise the slug-mapped Lucide icon tile as the
 * decorative fallback. Navigates to `/category/:id` (backend UUID once
 * the taxonomy store carries ids; slug param while on fallback).
 */
export function CategoryTile({ category, to }) {
  return (
    <Link
      to={to}
      className="group flex h-full flex-col items-center gap-2.5 rounded-2xl border border-border bg-card p-4 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:no-underline sm:p-5"
    >
      <CategoryImage
        image={category?.image}
        name={category?.name}
        icon={category?.icon}
        className="h-12 w-12 rounded-full text-foreground transition-colors duration-200 group-hover:bg-accent group-hover:text-accent-foreground sm:h-14 sm:w-14 [&_svg]:size-6"
      />
      {/* Name reserves two lines so wrapped category names never resize
          sibling tiles. Independent of ProductCard sizing by design. */}
      <span className="line-clamp-2 min-h-8 w-full text-[13px] font-semibold leading-4 text-card-foreground">
        {category?.name ?? 'Category'}
      </span>
    </Link>
  );
}
