-- =============================================================================
--  APA ENGINEERING SERVICES - PROJECT MANAGEMENT SYSTEM
--  File 04 of 04 : SEED DATA
--
--  Creates:
--    * the four finish packages (Standard, Elegant, Luxury, Bare)
--    * ~46 sample materials across the eight works
--    * the fixed material + rate-per-square-metre for every package/work pair
--
--  Prices are SAMPLE values that an Admin can edit in the Materials and Prices
--  screen. Estimation follows the Fajardo method (cost per square metre of
--  floor area) with brand/material take-off from the Wilcon Depot catalogue.
--
--  IDEMPOTENT: re-running refreshes the sample rows without creating duplicates.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FINISH PACKAGES
--    total_rate_per_sqm is derived by SUM() over finish_package_items.
--       Bare     = PHP 15,400 / sqm
--       Standard = PHP 23,400 / sqm
--       Elegant  = PHP 34,500 / sqm
--       Luxury   = PHP 54,700 / sqm
-- -----------------------------------------------------------------------------
insert into public.finish_packages (code, name, description, target_market, sort_order, is_active)
values
  ('bare', 'Bare', 'Structural shell with basic finishes. Painting, plain cement finishes and utility-grade fixtures only.',
   'Budget builds, warehouses, rental units', 1, true),
  ('standard', 'Standard', 'Reliable mid-range brands: Mariwasa tiles, HardieFlex ceiling, Boysen paint, aluminium windows.',
   'Typical residential house and lot', 2, true),
  ('elegant', 'Elegant', 'Upgraded finishes: porcelain tiles, Gyproc ceiling, solid narra doors, granite countertop.',
   'Two-storey homes, townhouses, small offices', 3, true),
  ('luxury', 'Luxury', 'Premium imported finishes: granite flooring, stone cladding, one-piece water closets, rain showers.',
   'High-end residences and commercial fit-outs', 4, true)
on conflict (code) do update
  set name          = excluded.name,
      description   = excluded.description,
      target_market = excluded.target_market,
      sort_order    = excluded.sort_order,
      is_active     = excluded.is_active;

-- -----------------------------------------------------------------------------
-- 2. MATERIALS AND PRICES  (sample catalogue)
--    unit_price is per "unit"; rate_per_sqm on the package decides the estimate.
-- -----------------------------------------------------------------------------
insert into public.materials
  (work_type, name, brand, sku, unit, unit_price, supplier, source_url, thumbnail_url, style_variant, notes)
values
  -- flooring -------------------------------------------------------------
  ('flooring', 'Ceramic Floor Tile 60x60cm Glossy', 'Mariwasa', 'FLO-001', 'pc', 145.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Glossy',
   'Entry-level ceramic floor tile, sold per piece.'),
  ('flooring', 'Porcelain Floor Tile 60x60cm Matte', 'Euro Tiles', 'FLO-002', 'pc', 185.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Matte',
   'Rectified porcelain, low water absorption.'),
  ('flooring', 'Vinyl Plank Flooring 6mm (Oak)', 'Wilcon', 'FLO-003', 'sqm', 780.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Oak',
   'Click-lock dry-back vinyl plank.'),
  ('flooring', 'Laminate Wood Flooring 8mm', 'Kronotex', 'FLO-004', 'sqm', 1250.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Walnut',
   'AC4 wear rating, floating installation.'),
  ('flooring', 'Granite Slab Flooring (Polished)', 'Stone Depot', 'FLO-005', 'sqm', 2450.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Polished',
   'Includes cutting allowance; installed with epoxy grout.'),
  ('flooring', 'Plain Cement Floor Finish', 'Local', 'FLO-006', 'sqm', 320.00,
   'Wilcon Depot', null, null, 'Troweled',
   'Bare package only. No tile or overlay.'),

  -- ceiling --------------------------------------------------------------
  ('ceiling', 'Fiber Cement Board Ceiling 4.5mm', 'HardieFlex', 'CEL-001', 'sheet', 620.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Smooth',
   '1.2m x 2.4m sheet on metal furring.'),
  ('ceiling', 'Gypsum Board Ceiling 9mm', 'Gyproc', 'CEL-002', 'sheet', 480.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Smooth',
   'With flush jointing compound and paper tape.'),
  ('ceiling', 'Metal Furring Ceiling Frame', 'Wilcon', 'CEL-003', 'length', 165.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Galvanised',
   'Carrying channel with clip and rod assembly.'),
  ('ceiling', 'PVC Ceiling Panel (White)', 'Wilcon', 'CEL-004', 'sqm', 420.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'White',
   'Moisture resistant; good for toilet and bath.'),
  ('ceiling', 'Exposed Concrete Ceiling with Latex Paint', 'Local', 'CEL-005', 'sqm', 260.00,
   'Wilcon Depot', null, null, 'Exposed',
   'Bare package only. No ceiling board.'),
  ('ceiling', 'Gypsum Ceiling with Concealed Cove Lighting', 'Gyproc', 'CEL-006', 'sheet', 890.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Cove lighting',
   'Drop ceiling with LED cove and pelmet detail.'),

  -- walls ----------------------------------------------------------------
  ('walls', 'CHB 100mm Hollow Block', 'Wilcon', 'WAL-001', 'pc', 22.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Load-bearing',
   'Used with class A mortar mix.'),
  ('walls', 'Latex Paint Semi-Gloss (Boysen)', 'Boysen', 'WAL-002', 'gal', 1180.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Semi-gloss',
   'Includes primer and putty system.'),
  ('walls', 'Acrylic Latex Paint (Davies)', 'Davies', 'WAL-003', 'gal', 1050.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Eggshell',
   'Low-VOC water-based finish.'),
  ('walls', 'Skimcoat / Wall Putty 25kg', 'ABC', 'WAL-004', 'bag', 480.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Fine',
   'Surface preparation before painting.'),
  ('walls', 'Decorative Stone Veneer Cladding', 'Wilcon', 'WAL-005', 'sqm', 1850.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Natural stone',
   'Feature walls and accent panels.'),
  ('walls', 'Plain Cement Plaster Finish', 'Local', 'WAL-006', 'sqm', 380.00,
   'Wilcon Depot', null, null, 'Rough',
   'Bare package only. Unpainted plaster.'),

  -- roofing --------------------------------------------------------------
  ('roofing', 'Pre-Painted Long Span Roofing Gauge 26', 'Wilcon', 'ROO-001', 'lm', 385.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Rib-type',
   'Cut to length; colour confirmed on site.'),
  ('roofing', 'Pre-Painted Rib-Type GI Sheet Gauge 26', 'Wilcon', 'ROO-002', 'lm', 285.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Corrugated',
   'Standard roof sheet with tek screws.'),
  ('roofing', 'Roof Insulation Foil 4mm', 'Wilcon', 'ROO-003', 'roll', 2450.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Double-sided',
   'Radiant barrier under roofing sheet.'),
  ('roofing', 'PVC Gutter and Downspout', 'Wilcon', 'ROO-004', 'lm', 320.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'White',
   'Complete with brackets and connectors.'),
  ('roofing', 'Tek Screw with Neoprene Washer', 'Wilcon', 'ROO-005', 'box', 480.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Self-drilling',
   '100 pieces per box.'),
  ('roofing', 'Polycarbonate Skylight Sheet', 'Wilcon', 'ROO-006', 'sheet', 1890.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Clear',
   'Optional for covered courts and carports.'),
  ('roofing', 'Corrugated GI Sheet Gauge 28 (Economy)', 'Wilcon', 'ROO-007', 'lm', 215.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Corrugated',
   'Economy roof sheet. Bare package default.'),

  -- doors and windows ----------------------------------------------------
  ('doors_windows', 'Narra Solid Panel Door 0.90 x 2.10m', 'Wilcon', 'DRW-001', 'set', 6800.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Panel',
   'Solid narra slab with jamb and casing.'),
  ('doors_windows', 'Metal Clad Flush Door 0.90 x 2.10m', 'Wilcon', 'DRW-002', 'set', 3200.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Flush',
   'Hollow core with metal cladding.'),
  ('doors_windows', 'PVC Door with Frame', 'Wilcon', 'DRW-003', 'set', 2450.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'PVC',
   'Moisture proof; suitable for toilet and bath.'),
  ('doors_windows', 'Aluminium Sliding Window (Clear Glass)', 'Wilcon', 'DRW-004', 'sqm', 3900.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Sliding',
   'White powder-coated frame with 6mm glass.'),
  ('doors_windows', 'Awning-Type Aluminium Window with Screen', 'Wilcon', 'DRW-005', 'sqm', 4600.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Awning',
   'Includes insect screen and jalousie option.'),

  -- toilet and bath ------------------------------------------------------
  ('toilet_bath', 'One-Piece Water Closet with Flush Valve', 'American Standard', 'TNB-001', 'set', 12500.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'One-piece',
   'S-trap; includes seat cover and fittings.'),
  ('toilet_bath', 'Two-Piece Water Closet', 'Wilcon', 'TNB-002', 'set', 6200.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Two-piece',
   'Includes flush tank and fittings.'),
  ('toilet_bath', 'Lavatory with Pedestal', 'Wilcon', 'TNB-003', 'set', 4800.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Pedestal',
   'Vitreous china with pop-up drain.'),
  ('toilet_bath', 'Rain Shower Set (Chrome)', 'Hafele', 'TNB-004', 'set', 8900.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Rain shower',
   'Overhead rain shower with hand-held spray.'),
  ('toilet_bath', 'Ceramic Wall and Floor Tile 30x60cm', 'Mariwasa', 'TNB-005', 'sqm', 620.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Glossy',
   'Wet area tiling with epoxy grout.'),
  ('toilet_bath', 'Waterproofing Membrane (Cementitious)', 'Wilcon', 'TNB-006', 'sqm', 380.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Cementitious',
   'Applied to floor and 300mm upstand.'),

  -- kitchen ---------------------------------------------------------------
  ('kitchen', 'Granite Countertop with Edge Profile', 'Stone Depot', 'KIT-001', 'lm', 7500.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Polished',
   '600mm depth; includes cut-out for sink.'),
  ('kitchen', 'Modular Kitchen Cabinet (Melamine Finish)', 'Wilcon', 'KIT-002', 'lm', 12500.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Melamine',
   'Upper and lower cabinets with soft-close hinges.'),
  ('kitchen', 'Stainless Steel Kitchen Sink (Double Bowl)', 'Wilcon', 'KIT-003', 'set', 5600.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Double bowl',
   '304 stainless; includes strainer and drain.'),
  ('kitchen', 'Kitchen Faucet (Chrome)', 'Hafele', 'KIT-004', 'set', 3400.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Chrome',
   'Single-lever mixer with ceramic cartridge.'),
  ('kitchen', 'Ceramic Backsplash Tile', 'Mariwasa', 'KIT-005', 'sqm', 720.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Subway',
   '600mm high backsplash above counter.'),

  -- electrical and lighting ----------------------------------------------
  ('electrical_lighting', 'THHN Copper Wire 3.5mm2', 'Phelps Dodge', 'ELL-001', 'roll', 4650.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Stranded',
   '150m roll; for convenience outlets.'),
  ('electrical_lighting', 'THHN Copper Wire 2.0mm2', 'Phelps Dodge', 'ELL-002', 'roll', 2980.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Stranded',
   '150m roll; for lighting circuits.'),
  ('electrical_lighting', 'Bolt-On Circuit Breaker 20A', 'Schneider', 'ELL-003', 'pc', 820.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, '20A',
   'Branch circuit protection.'),
  ('electrical_lighting', 'Wide Series Switch / Outlet', 'Panasonic', 'ELL-004', 'pc', 285.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Wide series',
   'Flush-mounted; white finish.'),
  ('electrical_lighting', 'LED Panel Downlight 12W (Slim)', 'Omni', 'ELL-005', 'pc', 480.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, 'Slim panel',
   'Cool white 6500K; recessed mounting.'),
  ('electrical_lighting', 'Panel Board with Main Breaker', 'Schneider', 'ELL-006', 'set', 8400.00,
   'Wilcon Depot', 'https://www.wilcon.com.ph/', null, '8-branch',
   'Flush-mounted with copper busbar.')
on conflict (sku) do update
  set work_type    = excluded.work_type,
      name         = excluded.name,
      brand        = excluded.brand,
      unit         = excluded.unit,
      unit_price   = excluded.unit_price,
      supplier     = excluded.supplier,
      source_url   = excluded.source_url,
      style_variant = excluded.style_variant,
      notes        = excluded.notes,
      is_active    = true,
      last_updated_at = now();

-- -----------------------------------------------------------------------------
-- 3. FIXED MATERIAL AND RATE PER SQUARE METRE FOR EVERY PACKAGE / WORK PAIR
-- -----------------------------------------------------------------------------
insert into public.finish_package_items
  (finish_package_id, work_type, material_id, description, brand, style_variant, unit, unit_price, rate_per_sqm, sort_order)
select
  fp.id,
  v.work_type,
  m.id,
  coalesce(m.name, v.fallback_description),
  coalesce(m.brand, ''),
  m.style_variant,
  'sqm',
  coalesce(m.unit_price, 0),
  v.rate_per_sqm,
  v.sort_order
from (values
  -- BARE  (arithmetic total = 15,400 / sqm)
  ('bare',     'flooring',            'FLO-006', 'Plain cement floor finish',        2600.00::numeric, 1),
  ('bare',     'ceiling',             'CEL-005', 'Exposed concrete ceiling',         1400.00::numeric, 2),
  ('bare',     'walls',               'WAL-006', 'Unpainted cement plaster',         2100.00::numeric, 3),
  ('bare',     'roofing',             'ROO-007', 'Corrugated GI sheet gauge 28',     3400.00::numeric, 4),
  ('bare',     'doors_windows',       'DRW-003', 'PVC doors, basic windows',         2200.00::numeric, 5),
  ('bare',     'toilet_bath',         'TNB-002', 'Two-piece WC, basic fittings',     1100.00::numeric, 6),
  ('bare',     'kitchen',             'KIT-003', 'Stainless sink only',               700.00::numeric, 7),
  ('bare',     'electrical_lighting', 'ELL-004', 'Basic switches and outlets',       1900.00::numeric, 8),

  -- STANDARD  (arithmetic total = 23,400 / sqm)
  ('standard', 'flooring',            'FLO-001', 'Mariwasa ceramic floor tile',      3800.00::numeric, 1),
  ('standard', 'ceiling',             'CEL-001', 'HardieFlex fibre cement ceiling',  2000.00::numeric, 2),
  ('standard', 'walls',               'WAL-002', 'Boysen latex paint system',        2900.00::numeric, 3),
  ('standard', 'roofing',             'ROO-002', 'Pre-painted rib-type GI sheet',    4200.00::numeric, 4),
  ('standard', 'doors_windows',       'DRW-002', 'Metal clad doors, alum. windows',  3200.00::numeric, 5),
  ('standard', 'toilet_bath',         'TNB-002', 'Two-piece WC, basic tiles',        2600.00::numeric, 6),
  ('standard', 'kitchen',             'KIT-003', 'Sink and backsplash',              1900.00::numeric, 7),
  ('standard', 'electrical_lighting', 'ELL-004', 'Panasonic wide series devices',    2800.00::numeric, 8),

  -- ELEGANT  (arithmetic total = 34,500 / sqm)
  ('elegant',  'flooring',            'FLO-002', 'Euro Tiles porcelain flooring',    5400.00::numeric, 1),
  ('elegant',  'ceiling',             'CEL-002', 'Gyproc gypsum ceiling',            3100.00::numeric, 2),
  ('elegant',  'walls',               'WAL-003', 'Davies acrylic latex finish',      4100.00::numeric, 3),
  ('elegant',  'roofing',             'ROO-001', 'Long span roofing gauge 26',       5600.00::numeric, 4),
  ('elegant',  'doors_windows',       'DRW-001', 'Solid narra doors',                4800.00::numeric, 5),
  ('elegant',  'toilet_bath',         'TNB-003', 'Lavatory set with tiling',         4200.00::numeric, 6),
  ('elegant',  'kitchen',             'KIT-001', 'Granite countertop',               3400.00::numeric, 7),
  ('elegant',  'electrical_lighting', 'ELL-005', 'LED panel downlights',             3900.00::numeric, 8),

  -- LUXURY  (arithmetic total = 54,700 / sqm)
  ('luxury',   'flooring',            'FLO-005', 'Polished granite slab flooring',   8200.00::numeric, 1),
  ('luxury',   'ceiling',             'CEL-006', 'Gypsum ceiling with cove lighting',5200.00::numeric, 2),
  ('luxury',   'walls',               'WAL-005', 'Stone veneer feature cladding',    6400.00::numeric, 3),
  ('luxury',   'roofing',             'ROO-001', 'Long span roofing with insulation',8100.00::numeric, 4),
  ('luxury',   'doors_windows',       'DRW-005', 'Awning windows with screens',      7600.00::numeric, 5),
  ('luxury',   'toilet_bath',         'TNB-001', 'One-piece WC and rain shower',     7200.00::numeric, 6),
  ('luxury',   'kitchen',             'KIT-002', 'Modular kitchen with granite',     6100.00::numeric, 7),
  ('luxury',   'electrical_lighting', 'ELL-006', 'Panel board and premium devices',  5900.00::numeric, 8)
) as v(package_code, work_type, sku, fallback_description, rate_per_sqm, sort_order)
join public.finish_packages fp on fp.code = v.package_code
left join public.materials m   on m.sku   = v.sku
on conflict (finish_package_id, work_type) do update
  set material_id   = excluded.material_id,
      description   = excluded.description,
      brand         = excluded.brand,
      style_variant = excluded.style_variant,
      unit_price    = excluded.unit_price,
      rate_per_sqm  = excluded.rate_per_sqm,
      sort_order    = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- 4. MATERIAL COST FACTORS
--    Multiplier against the base installed rate of the work. 1.000 = the
--    reference material for that work; lower is more economical, higher is an
--    upgrade. Used only by the Customized Quotation.
-- -----------------------------------------------------------------------------
update public.materials m
   set cost_factor = v.cost_factor
  from (values
    ('FLO-001', 0.850::numeric), ('FLO-002', 1.000::numeric), ('FLO-003', 0.950::numeric),
    ('FLO-004', 1.150::numeric), ('FLO-005', 1.450::numeric), ('FLO-006', 0.550::numeric),

    ('CEL-001', 0.900::numeric), ('CEL-002', 1.000::numeric), ('CEL-003', 0.750::numeric),
    ('CEL-004', 0.850::numeric), ('CEL-005', 0.600::numeric), ('CEL-006', 1.500::numeric),

    ('WAL-001', 0.800::numeric), ('WAL-002', 1.000::numeric), ('WAL-003', 0.950::numeric),
    ('WAL-004', 0.700::numeric), ('WAL-005', 1.550::numeric), ('WAL-006', 0.650::numeric),

    ('ROO-001', 1.000::numeric), ('ROO-002', 0.900::numeric), ('ROO-003', 1.080::numeric),
    ('ROO-004', 0.950::numeric), ('ROO-005', 0.850::numeric), ('ROO-006', 1.200::numeric),
    ('ROO-007', 0.750::numeric),

    ('DRW-001', 1.000::numeric), ('DRW-002', 0.800::numeric), ('DRW-003', 0.650::numeric),
    ('DRW-004', 1.050::numeric), ('DRW-005', 1.350::numeric),

    ('TNB-001', 1.500::numeric), ('TNB-002', 0.900::numeric), ('TNB-003', 1.050::numeric),
    ('TNB-004', 1.250::numeric), ('TNB-005', 0.850::numeric), ('TNB-006', 0.800::numeric),

    ('KIT-001', 1.150::numeric), ('KIT-002', 1.600::numeric), ('KIT-003', 0.850::numeric),
    ('KIT-004', 0.750::numeric), ('KIT-005', 0.800::numeric),

    ('ELL-001', 0.950::numeric), ('ELL-002', 0.900::numeric), ('ELL-003', 1.000::numeric),
    ('ELL-004', 0.850::numeric), ('ELL-005', 1.050::numeric), ('ELL-006', 1.550::numeric)
  ) as v(sku, cost_factor)
 where m.sku = v.sku;

-- -----------------------------------------------------------------------------
-- 5. STYLE / LAYOUT OPTIONS
--    Labour-and-complexity multiplier applied on top of the material cost
--    factor. Example: a herringbone floor lay costs more labour than a straight
--    lay of the same tile. Admin-editable in Materials and Prices.
-- -----------------------------------------------------------------------------
insert into public.style_options (work_type, code, label, description, multiplier, sort_order)
values
  ('flooring', 'straight',    'Straight lay',            'Standard grid installation.',                    1.000, 1),
  ('flooring', 'diagonal',    'Diagonal lay',            '45-degree layout; more cutting waste.',          1.120, 2),
  ('flooring', 'herringbone', 'Herringbone / patterned','Decorative pattern; highest labour content.',    1.250, 3),

  ('ceiling', 'flat',         'Flat ceiling',            'Single-level flush ceiling.',                    1.000, 1),
  ('ceiling', 'coffered',     'Coffered / drop',         'Recessed centre panel with border.',             1.180, 2),
  ('ceiling', 'cove',         'With cove lighting',      'Concealed LED cove and pelmet.',                 1.220, 3),

  ('walls', 'plain',          'Plain painted',           'Single-colour painted finish.',                  1.000, 1),
  ('walls', 'two_tone',       'Two-tone accent',         'Feature wall in a contrasting colour.',          1.060, 2),
  ('walls', 'stone_panel',    'Accent wall panelling',   'Stone veneer or decorative panel feature.',      1.150, 3),

  ('roofing', 'straight',     'Straight gable',          'Simple gable roof framing.',                     1.000, 1),
  ('roofing', 'hip',          'Hip roof',                'Four-slope framing; more cutting.',              1.100, 2),
  ('roofing', 'skylight',     'With skylight',           'Includes polycarbonate skylight panel.',         1.180, 3),

  ('doors_windows', 'standard',      'Standard openings',      'Standard door and window sizes.',          1.000, 1),
  ('doors_windows', 'with_grills',   'With window grills',     'Adds security grills to all windows.',     1.080, 2),
  ('doors_windows', 'floor_height',  'Floor-to-ceiling glass', 'Full-height glazing panels.',              1.200, 3),

  ('toilet_bath', 'standard',        'Standard layout',        'Basic WC, lavatory and shower point.',     1.000, 1),
  ('toilet_bath', 'enclosure',       'With shower enclosure',  'Glass shower enclosure and screen.',       1.140, 2),
  ('toilet_bath', 'full_tiling',     'Fully tiled',            'Wall and floor tiling to full height.',    1.200, 3),

  ('kitchen', 'basic',     'Basic galley',        'Single-run counter with base cabinets.',           1.000, 1),
  ('kitchen', 'island',    'With island counter', 'Adds a freestanding island counter.',              1.250, 2),
  ('kitchen', 'pantry',    'With walk-in pantry','Enclosed pantry with fitted shelving.',            1.350, 3),

  ('electrical_lighting', 'basic',   'Basic circuits',      'Standard lighting and outlet circuits.',    1.000, 1),
  ('electrical_lighting', 'ready',   'Smart-home ready',    'Provision for smart switches and LAN.',     1.200, 2),
  ('electrical_lighting', 'led_cove','All-LED with cove',   'Full LED fixtures with cove lighting.',     1.300, 3)
on conflict (work_type, code) do update
  set label       = excluded.label,
      description = excluded.description,
      multiplier  = excluded.multiplier,
      sort_order  = excluded.sort_order,
      is_active   = true;

-- -----------------------------------------------------------------------------
-- 6. FIRST ADMIN ACCOUNT
--    Step 1: Authentication -> Users -> "Add user" and create the owner account
--            (for example owner@apa-engineering.ph) with a strong password.
--            The auth trigger automatically creates the matching profile row.
--    Step 2: Run the statement below, replacing the email address.
-- -----------------------------------------------------------------------------
-- update public.profiles
--    set role = 'admin', full_name = 'APA Owner', is_active = true
--  where email = 'owner@apa-engineering.ph';

-- -----------------------------------------------------------------------------
-- 7. VERIFICATION
-- -----------------------------------------------------------------------------
-- select code, name, total_rate_per_sqm, works_count from public.v_finish_package_rates order by sort_order;
-- select work_type, count(*) from public.materials group by work_type order by work_type;
-- select work_type, count(*) from public.style_options group by work_type order by work_type;

-- =============================================================================
--  END OF 04_seed.sql  --  database setup complete
-- =============================================================================
