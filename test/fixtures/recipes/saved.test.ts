import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractArticleFromHtml } from '../../../src/tools/extract.js';
import type { StructuredContent } from '../../../src/tools/output-schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'saved.html');
const pageUrl = 'https://kitchen.example.com/recipes/choc-chip-cookies';

describe('recipe fixture: JSON-LD Recipe surfaces as metadata.structured', () => {
  it('populates structured with the Recipe node and preserves data fields', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as StructuredContent;
    expect(structured.diagnostics.fallbackUsed).toBe(false);

    const recipe = structured.metadata.structured;
    expect(recipe).toBeDefined();
    expect(recipe?.['@type']).toBe('Recipe');
    expect(recipe?.['name']).toBe('Classic Chocolate Chip Cookies');
    expect(recipe?.['cookTime']).toBe('PT10M');
    expect(recipe?.['recipeYield']).toBe('24 cookies');
    expect(recipe?.['recipeIngredient']).toEqual([
      '2 cups all-purpose flour',
      '1 cup unsalted butter, softened',
      '3/4 cup granulated sugar',
      '3/4 cup packed brown sugar',
      '2 large eggs',
      '2 cups semi-sweet chocolate chips',
    ]);
    expect(recipe?.['recipeInstructions']).toHaveLength(4);
    expect(recipe?.['nutrition']).toMatchObject({
      calories: '150 kcal',
    });
    // @context stripped, @id-style keys intact.
    expect(recipe).not.toHaveProperty('@context');
  });

  it('emits the recipe prose as the article body, not the JSON-LD block', () => {
    const html = readFileSync(fixturePath, 'utf8');
    const result = extractArticleFromHtml({ html, baseUrl: pageUrl });
    const first = result.content[0];
    const text = first && 'text' in first ? first.text : '';
    expect(text).toContain('Classic Chocolate Chip Cookies');
    expect(text).toContain('Cream butter and sugars');
    expect(text).not.toContain('"@type":"Recipe"');
  });
});
