-- ==============================================================================
-- VAIDYA BOTANICALS: Initial Seed Data for Neon PostgreSQL 18
-- ==============================================================================

-- 1. SEED 6 CORE BOTANICAL PRODUCTS
INSERT INTO public.products (
    slug,
    name,
    category,
    health_segment,
    price,
    stock,
    unit,
    short_description,
    description,
    ingredients,
    usage_instructions,
    storage_precautions,
    badge,
    images,
    is_published,
    is_featured,
    sort_order
) VALUES
(
    'lemongrass-immunity-green-tea',
    'Lemongrass Immunity Green Tea',
    'tea',
    'Health Segment: Immunity',
    24.00,
    50,
    '/ 100g',
    'Hand-picked green tea leaves blended with aromatic pure lemongrass cut and ginger root for natural vitalizing immunity support.',
    'Our Lemongrass Immunity Green Tea is sourced from high-altitude estates where pure mountain mists encourage rich polyphenol content. Hand-blended with sun-dried organic lemongrass and warming ginger root, this blend is crafted to invigorate your senses while naturally fortifying your body''s immune defenses.',
    'Green Tea, Organic Lemongrass, Ginger Extract, Tulsi Leaves',
    'Brew 1 tsp in 85°C water for 3-4 minutes. Best enjoyed mid-morning or post-lunch.',
    'Store in a cool, dry place away from direct sunlight. Reseal pouch after opening.',
    'Best Seller',
    '[{"url": "", "alt": "Lemongrass Immunity Green Tea", "is_primary": true}]'::jsonb,
    true,
    true,
    1
),
(
    'organic-lemongrass-essential-oil',
    'Organic Lemongrass Essential Oil',
    'oil',
    'Health Segment: Stress Relief',
    28.00,
    35,
    '/ 15ml',
    'Steam-distilled Cymbopogon oil with a crisp citrusy aroma. Promotes mental clarity, relieves tension, and purifies air.',
    'Steam-distilled from fresh, organically cultivated Cymbopogon citratus grass. Revered for centuries in traditional wellness practices, this oil releases a crisp, uplifting citrus scent that cuts through mental fog, alleviates stress, and creates an invigorating sanctuary in any room.',
    '100% Pure Organic Lemongrass Oil (Cymbopogon citratus)',
    'Add 4-6 drops to diffuser or dilute with carrier oil for topical application.',
    'For external use only. Dilute before applying to skin. Keep out of reach of children.',
    'Pure Distillate',
    '[{"url": "", "alt": "Organic Lemongrass Essential Oil", "is_primary": true}]'::jsonb,
    true,
    true,
    2
),
(
    'botanical-cleanse-green-tea',
    'Botanical Cleanse Green Tea',
    'tea',
    'Health Segment: Digestion & Detox',
    22.00,
    45,
    '/ 100g',
    'Formulated with high-antioxidant sencha, dandelion root, and soothing peppermint for gentle daily digestive harmony.',
    'A thoughtfully balanced restorative infusion combining clean, fresh sencha green tea with roasted dandelion root and cooling field peppermint. Formulated to assist natural digestive rhythm and cellular detoxification without harsh stimulants.',
    'Japanese Sencha, Dandelion Root, Peppermint Leaves, Licorice',
    'Enjoy after meals. Steep 1 teaspoon for 3 minutes in hot water.',
    'Keep sealed in tin or airtight canister at room temperature.',
    'Detox Blend',
    '[{"url": "", "alt": "Botanical Cleanse Green Tea", "is_primary": true}]'::jsonb,
    true,
    true,
    3
),
(
    'highland-lavender-elixir-oil',
    'Highland Lavender Elixir Oil',
    'oil',
    'Health Segment: Deep Sleep',
    32.00,
    30,
    '/ 15ml',
    'Extracted from high-altitude lavender fields, enriched with bergamot notes to prepare your mind for restful sleep.',
    'Extracted from pesticide-free lavender cultivated at elevations over 1,000 meters. The cool mountain air yields an exceptionally high linalool concentration, imparting a soft, sweet floral bouquet that gently quietens the nervous system and signals deep sleep.',
    'Pure Highland Lavender & Wild Bergamot Distillate',
    'Diffuse in bedroom 30 minutes before rest, or add 2 drops to pillow corners.',
    'Keep bottle tightly sealed in a cool, dark drawer.',
    'Rest & Sleep',
    '[{"url": "", "alt": "Highland Lavender Elixir Oil", "is_primary": true}]'::jsonb,
    true,
    true,
    4
),
(
    'chamomile-lemongrass-zen',
    'Chamomile & Lemongrass Zen',
    'tea',
    'Health Segment: Calm & Focus',
    20.00,
    60,
    '/ 100g',
    'A soothing caffeine-free infusion designed to lower cortisol levels and restore inner calmness during busy workdays.',
    'Whole golden Egyptian chamomile blossoms coupled with hand-cut lemongrass ribbons. Naturally caffeine-free, this gentle brew is your evening ritual for releasing muscular tension and easing modern daily anxiety.',
    'Egyptian Chamomile Flowers, Cut Lemongrass, Lemon Balm',
    'Steep 1 tbsp for 5 minutes in freshly boiled water. Sip mindfully.',
    'Store in airtight container away from moisture.',
    'Caffeine Free',
    '[{"url": "", "alt": "Chamomile & Lemongrass Zen", "is_primary": true}]'::jsonb,
    true,
    true,
    5
),
(
    'eucalyptus-tea-tree-essence',
    'Eucalyptus & Tea Tree Essence',
    'oil',
    'Health Segment: Vitality & Respiratory',
    26.00,
    40,
    '/ 15ml',
    'Invigorating botanical blend designed for clear breathing, congestion relief, and refreshing home ambiance.',
    'An invigorating synergy of crisp Eucalyptus globulus and wild tea tree essence. Formulated to open airways, clear sinus congestion, and infuse your living space with the purity of an ancient eucalyptus forest.',
    'Organic Eucalyptus Globulus, Melaleuca Alternifolia',
    'Inhale vapors directly or use 5 drops in hot shower steam or ultrasonic diffuser.',
    'Avoid contact with eyes. Not recommended for infants.',
    'Breathe Easy',
    '[{"url": "", "alt": "Eucalyptus & Tea Tree Essence", "is_primary": true}]'::jsonb,
    true,
    true,
    6
)
ON CONFLICT (slug) DO UPDATE
SET
    name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock = EXCLUDED.stock,
    description = EXCLUDED.description,
    ingredients = EXCLUDED.ingredients,
    usage_instructions = EXCLUDED.usage_instructions;

-- 2. SEED INITIAL CMS SITE CONTENT
INSERT INTO public.site_content (key, data) VALUES
(
    'hero',
    '{
        "eyebrow": "Botanical Wellness & Pure Alchemy",
        "title": "Pure Botanical Remedies for Modern Life",
        "description": "Crafted with ancient Ayurvedic wisdom and modern clinical purity. Discover pure essential oils, single-estate green teas, and restorative health tonics.",
        "primary_cta_text": "Explore Formulations",
        "primary_cta_link": "#products",
        "secondary_cta_text": "Our Sourcing Promise",
        "secondary_cta_link": "#about",
        "badge_1": "100% Organically Grown",
        "badge_2": "Zero Synthetic Additives",
        "badge_3": "Direct Farm Trade"
    }'::jsonb
),
(
    'about',
    '{
        "eyebrow": "Our Philosophy",
        "title": "Rooted in Ayurvedic Wisdom, Proven by Modern Purity",
        "description": "At Vaidya Botanicals, we believe the human body is inherently attuned to the restorative powers of plants. We partner exclusively with sustainable, single-origin botanical estates to bring you therapeutic-grade wellness products free from parabens, synthetic fragrances, and artificial chemicals.",
        "stat_1_number": "100%",
        "stat_1_label": "Pure Botanical",
        "stat_2_number": "0%",
        "stat_2_label": "Synthetic Fragrance",
        "stat_3_number": "14+",
        "stat_3_label": "Tested Quality Checks"
    }'::jsonb
),
(
    'story',
    '{
        "title": "The Vaidya Story",
        "subtitle": "From Ancient Herbology to Daily Modern Rituals",
        "p1": "Vaidya was founded with a singular conviction: genuine wellness should be unadulterated, transparent, and restorative. Our name originates from the Sanskrit honorific for physician and master healer.",
        "p2": "We journeyed across remote tea valleys and pristine botanical groves to re-establish the sacred link between grower, plant, and consumer. We harvest only at peak medicinal potency, steam-distill at gentle pressures, and package in UV-protective glass.",
        "p3": "Every bottle of essential oil and packet of whole-leaf green tea is an invitation to step away from modern rush and re-center your vitality."
    }'::jsonb
),
(
    'support_info',
    '{
        "hours": "Monday - Friday, 9:00 AM - 6:00 PM IST",
        "email": "care@vaidyabotanicals.com",
        "phone": "+91 98765 43210",
        "address": "Vaidya Botanicals Wellness Labs, Dehradun, Uttarakhand, India",
        "faqs": [
            {
                "q": "How are your essential oils extracted?",
                "a": "All our essential oils are extracted via gentle, slow steam distillation without chemical solvents or artificial carrier diluents."
            },
            {
                "q": "Are your green teas caffeinated?",
                "a": "Our green teas contain mild, natural caffeine combined with L-theanine for sustained calm energy. Chamomile Zen is 100% caffeine-free."
            },
            {
                "q": "How long does shipping take?",
                "a": "Orders are processed within 24 hours. Metro deliveries typically arrive in 2-4 business days; rest of India within 4-7 business days."
            },
            {
                "q": "Can I return an opened product?",
                "a": "Due to sanitary considerations, opened wellness products cannot be returned unless damaged in transit. We offer full replacements for transit issues."
            }
        ]
    }'::jsonb
)
ON CONFLICT (key) DO UPDATE
SET data = EXCLUDED.data;

