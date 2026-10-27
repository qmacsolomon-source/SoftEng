/**
 * Cost estimation engine.
 *
 * Basis: Fajardo, "Simplified Construction Estimate" - the estimate is driven by
 * the floor area in square metres multiplied by a rate per square metre, with
 * the rate split across the eight works so the client sees a per-work breakdown.
 *
 * Quick Quotation      total = floor area x package rate for each work
 * Customized Quotation total = floor area x (base work rate x material factor
 *                              x style multiplier) for each work
 *
 * Both paths then add optional labour and contingency.
 */
import { WORK_LABELS, WORK_TYPES } from './validation.js';

export const DEFAULT_LABOR_PCT = 15;

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const workLabel = (workType) => WORK_LABELS[workType] || workType;

/** Applies labour and contingency on top of a materials-and-installation subtotal. */
export function computeTotals({ subtotal, includeLabor, laborPct = DEFAULT_LABOR_PCT, contingencyPct = 0 }) {
  const base = round2(Math.max(0, Number(subtotal) || 0));
  const labor = includeLabor ? round2(base * (Math.max(0, laborPct) / 100)) : 0;
  const contingency = round2((base + labor) * (Math.max(0, contingencyPct) / 100));

  return {
    subtotal: base,
    labor_amount: labor,
    contingency_amount: contingency,
    total_amount: round2(base + labor + contingency),
  };
}

/**
 * Quick Quotation breakdown.
 * @param {object}   input
 * @param {number}   input.floorArea        floor area in sqm
 * @param {string[]} input.worksIncluded    work types the client ticked
 * @param {Array}    input.packageItems     rows from finish_package_items
 */
export function buildQuickBreakdown({
  floorArea,
  worksIncluded,
  packageItems,
  includeLabor = true,
  laborPct = DEFAULT_LABOR_PCT,
  contingencyPct = 0,
}) {
  const selected = new Set(worksIncluded?.length ? worksIncluded : WORK_TYPES);
  const area = Number(floorArea) || 0;

  const items = (packageItems || [])
    .filter((row) => selected.has(row.work_type))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((row) => {
      const rate = Number(row.rate_per_sqm) || 0;
      return {
        work_type: row.work_type,
        work_label: workLabel(row.work_type),
        material_id: row.material_id ?? null,
        description: row.description || workLabel(row.work_type),
        brand: row.brand || '',
        style_variant: row.style_variant || null,
        unit: 'sqm',
        quantity: round2(area),
        unit_price: round2(Number(row.unit_price) || 0),
        rate_per_sqm: round2(rate),
        line_total: round2(area * rate),
        sort_order: row.sort_order ?? 0,
      };
    });

  const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
  const totals = computeTotals({ subtotal, includeLabor, laborPct, contingencyPct });

  return { items, ...totals, floor_area_sqm: area, rate_per_sqm_total: round2(subtotal / (area || 1)) };
}

/**
 * Customized Quotation breakdown.
 * @param {object} input
 * @param {number} input.floorArea   floor area in sqm
 * @param {object} input.baseRates   { work_type: base rate per sqm } from the chosen base finish level
 * @param {object} input.selections  { work_type: { material_id, name, brand, unit_price,
 *                                       cost_factor, style_variant, style_code, style_label,
 *                                       style_multiplier } }
 */
export function buildDetailedBreakdown({
  floorArea,
  baseRates = {},
  selections = {},
  includeLabor = true,
  laborPct = DEFAULT_LABOR_PCT,
  contingencyPct = 0,
}) {
  const area = Number(floorArea) || 0;
  const missing = [];

  const items = WORK_TYPES.map((workType, index) => {
    const selection = selections[workType];
    const baseRate = Number(baseRates[workType]);

    if (selection === undefined || selection === null) return null;

    if (!Number.isFinite(baseRate) || baseRate <= 0) {
      missing.push(workType);
      return null;
    }

    const costFactor = Number(selection.cost_factor ?? 1) || 1;
    const styleMultiplier = Number(selection.style_multiplier ?? 1) || 1;
    const workRate = round2(baseRate * costFactor * styleMultiplier);

    return {
      work_type: workType,
      work_label: workLabel(workType),
      material_id: selection.material_id ?? null,
      description: selection.name || workLabel(workType),
      brand: selection.brand || '',
      style_variant: selection.style_label || selection.style_variant || null,
      style_code: selection.style_code ?? null,
      style_label: selection.style_label ?? null,
      unit: 'sqm',
      quantity: round2(area),
      unit_price: round2(Number(selection.unit_price) || 0),
      rate_per_sqm: workRate,
      base_rate_per_sqm: round2(baseRate),
      cost_factor: costFactor,
      style_multiplier: styleMultiplier,
      line_total: round2(area * workRate),
      sort_order: index + 1,
    };
  }).filter(Boolean);

  const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
  const totals = computeTotals({ subtotal, includeLabor, laborPct, contingencyPct });

  return {
    items,
    ...totals,
    floor_area_sqm: area,
    rate_per_sqm_total: round2(subtotal / (area || 1)),
    missingBaseRates: missing,
  };
}

/** PHP currency string used in PDF/print output and CSV exports. */
export function formatPeso(amount) {
  return `PHP ${Number(amount || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
