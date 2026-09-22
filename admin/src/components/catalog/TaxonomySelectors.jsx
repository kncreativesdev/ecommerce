import { Field, Select } from '../ui/Field.jsx';
import { getParentCategories, getSubcategories } from '../../utils/taxonomy.js';

/**
 * Reusable taxonomy selectors — the Parent Category → Subcategory
 * dependency, shared by the Product Form (and future filters). Reads the
 * SAME normalized category list as Category Management: no duplicated
 * trees, ever.
 *
 * Behavior contract:
 * - Parent options: top-level categories only (`parentId == null`).
 * - Subcategory options: ONLY children of the selected parent
 *   (`getSubcategories(categories, parentCategoryId)`). Never children of
 *   another parent — invalid combinations are unselectable by construction.
 * - Changing the parent clears the subcategory (single source of truth).
 * - Subcategory stays disabled until a parent is chosen.
 */
export function TaxonomySelectors({
  categories = [],
  parentCategoryId = '',
  subcategoryId = '',
  onParentChange,
  onSubcategoryChange,
  parentError,
  subcategoryError,
}) {
  const parents = getParentCategories(categories);
  const subcategories = getSubcategories(categories, parentCategoryId);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Parent Category" required error={parentError}>
        {({ errorId }) => (
          <Select
            value={parentCategoryId}
            onChange={(event) => {
              onParentChange(event.target.value);
              onSubcategoryChange('');
            }}
            aria-invalid={Boolean(parentError)}
            aria-describedby={errorId}
          >
            <option value="">Select parent category…</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Subcategory"
        hint={
          parentCategoryId
            ? 'Optional. Only subcategories of the selected parent are listed.'
            : 'Select a parent category first.'
        }
        error={subcategoryError}
      >
        {({ errorId }) => (
          <Select
            value={subcategoryId}
            onChange={(event) => onSubcategoryChange(event.target.value)}
            disabled={!parentCategoryId}
            aria-invalid={Boolean(subcategoryError)}
            aria-describedby={errorId}
          >
            <option value="">None</option>
            {subcategories.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}
