const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function isSupabaseConfigured() {
    return Boolean(
        SUPABASE_URL &&
        !SUPABASE_URL.includes('placeholder-project') &&
        SUPABASE_SERVICE_ROLE_KEY &&
        !SUPABASE_SERVICE_ROLE_KEY.includes('placeholder')
    );
}

let supabaseAdmin = null;
let supabaseClient = null;

if (isSupabaseConfigured()) {
    try {
        supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: false }
        });
        console.log('[Supabase] Live client initialized.');
    } catch (err) {
        console.error('[Supabase] Initialization error:', err.message);
    }
} else {
    console.log('[Supabase] Running in local development fallback mode (no live credentials configured yet).');
}

// Local development fallback admin users (loaded securely from ignored local config if present)
let initialAdminUsers = [];
try {
    const fs = require('fs');
    const path = require('path');
    const localAdminPath = path.join(__dirname, '..', '.local-admin.json');
    if (fs.existsSync(localAdminPath)) {
        initialAdminUsers = JSON.parse(fs.readFileSync(localAdminPath, 'utf8'));
    }
} catch (e) {
    initialAdminUsers = [];
}

// Local mock database for development before live Supabase setup
const mockDb = {
    products: [
        {
            id: 'prod-001',
            slug: 'lemongrass-immunity-green-tea',
            name: 'Lemongrass Immunity Green Tea',
            category: 'tea',
            health_segment: 'Health Segment: Immunity',
            price: 24.00,
            stock: 50,
            unit: '/ 100g',
            short_description: 'Hand-picked green tea leaves blended with aromatic pure lemongrass cut and ginger root for natural vitalizing immunity support.',
            description: 'Our Lemongrass Immunity Green Tea is sourced from high-altitude estates where pure mountain mists encourage rich polyphenol content. Hand-blended with sun-dried organic lemongrass and warming ginger root, this blend is crafted to invigorate your senses while naturally fortifying your body immune defenses.',
            ingredients: 'Green Tea, Organic Lemongrass, Ginger Extract, Tulsi Leaves',
            usage_instructions: 'Brew 1 tsp in 85°C water for 3-4 minutes. Best enjoyed mid-morning or post-lunch.',
            storage_precautions: 'Store in a cool, dry place away from direct sunlight. Reseal pouch after opening.',
            badge: 'Best Seller',
            images: [{ url: '', alt: 'Lemongrass Immunity Green Tea', is_primary: true }],
            is_published: true,
            is_featured: true,
            is_archived: false,
            sort_order: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 'prod-002',
            slug: 'organic-lemongrass-essential-oil',
            name: 'Organic Lemongrass Essential Oil',
            category: 'oil',
            health_segment: 'Health Segment: Stress Relief',
            price: 28.00,
            stock: 35,
            unit: '/ 15ml',
            short_description: 'Steam-distilled Cymbopogon oil with a crisp citrusy aroma. Promotes mental clarity, relieves tension, and purifies air.',
            description: 'Steam-distilled from fresh, organically cultivated Cymbopogon citratus grass. Revered for centuries in traditional wellness practices, this oil releases a crisp, uplifting citrus scent that cuts through mental fog, alleviates stress, and creates an invigorating sanctuary in any room.',
            ingredients: '100% Pure Organic Lemongrass Oil (Cymbopogon citratus)',
            usage_instructions: 'Add 4-6 drops to diffuser or dilute with carrier oil for topical application.',
            storage_precautions: 'For external use only. Dilute before applying to skin. Keep out of reach of children.',
            badge: 'Pure Distillate',
            images: [{ url: '', alt: 'Organic Lemongrass Essential Oil', is_primary: true }],
            is_published: true,
            is_featured: true,
            is_archived: false,
            sort_order: 2,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 'prod-003',
            slug: 'botanical-cleanse-green-tea',
            name: 'Botanical Cleanse Green Tea',
            category: 'tea',
            health_segment: 'Health Segment: Digestion & Detox',
            price: 22.00,
            stock: 45,
            unit: '/ 100g',
            short_description: 'Formulated with high-antioxidant sencha, dandelion root, and soothing peppermint for gentle daily digestive harmony.',
            description: 'A thoughtfully balanced restorative infusion combining clean, fresh sencha green tea with roasted dandelion root and cooling field peppermint. Formulated to assist natural digestive rhythm and cellular detoxification without harsh stimulants.',
            ingredients: 'Japanese Sencha, Dandelion Root, Peppermint Leaves, Licorice',
            usage_instructions: 'Enjoy after meals. Steep 1 teaspoon for 3 minutes in hot water.',
            storage_precautions: 'Keep sealed in tin or airtight canister at room temperature.',
            badge: 'Detox Blend',
            images: [{ url: '', alt: 'Botanical Cleanse Green Tea', is_primary: true }],
            is_published: true,
            is_featured: true,
            is_archived: false,
            sort_order: 3,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 'prod-004',
            slug: 'highland-lavender-elixir-oil',
            name: 'Highland Lavender Elixir Oil',
            category: 'oil',
            health_segment: 'Health Segment: Deep Sleep',
            price: 32.00,
            stock: 30,
            unit: '/ 15ml',
            short_description: 'Extracted from high-altitude lavender fields, enriched with bergamot notes to prepare your mind for restful sleep.',
            description: 'Extracted from pesticide-free lavender cultivated at elevations over 1,000 meters. The cool mountain air yields an exceptionally high linalool concentration, imparting a soft, sweet floral bouquet that gently quietens the nervous system and signals deep sleep.',
            ingredients: 'Pure Highland Lavender & Wild Bergamot Distillate',
            usage_instructions: 'Diffuse in bedroom 30 minutes before rest, or add 2 drops to pillow corners.',
            storage_precautions: 'Keep bottle tightly sealed in a cool, dark drawer.',
            badge: 'Rest & Sleep',
            images: [{ url: '', alt: 'Highland Lavender Elixir Oil', is_primary: true }],
            is_published: true,
            is_featured: true,
            is_archived: false,
            sort_order: 4,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 'prod-005',
            slug: 'chamomile-lemongrass-zen',
            name: 'Chamomile & Lemongrass Zen',
            category: 'tea',
            health_segment: 'Health Segment: Calm & Focus',
            price: 20.00,
            stock: 60,
            unit: '/ 100g',
            short_description: 'A soothing caffeine-free infusion designed to lower cortisol levels and restore inner calmness during busy workdays.',
            description: 'Whole golden Egyptian chamomile blossoms coupled with hand-cut lemongrass ribbons. Naturally caffeine-free, this gentle brew is your evening ritual for releasing muscular tension and easing modern daily anxiety.',
            ingredients: 'Egyptian Chamomile Flowers, Cut Lemongrass, Lemon Balm',
            usage_instructions: 'Steep 1 tbsp for 5 minutes in freshly boiled water. Sip mindfully.',
            storage_precautions: 'Store in airtight container away from moisture.',
            badge: 'Caffeine Free',
            images: [{ url: '', alt: 'Chamomile & Lemongrass Zen', is_primary: true }],
            is_published: true,
            is_featured: true,
            is_archived: false,
            sort_order: 5,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 'prod-006',
            slug: 'eucalyptus-tea-tree-essence',
            name: 'Eucalyptus & Tea Tree Essence',
            category: 'oil',
            health_segment: 'Health Segment: Vitality & Respiratory',
            price: 26.00,
            stock: 40,
            unit: '/ 15ml',
            short_description: 'Invigorating botanical blend designed for clear breathing, congestion relief, and refreshing home ambiance.',
            description: 'An invigorating synergy of crisp Eucalyptus globulus and wild tea tree essence. Formulated to open airways, clear sinus congestion, and infuse your living space with the purity of an ancient eucalyptus forest.',
            ingredients: 'Organic Eucalyptus Globulus, Melaleuca Alternifolia',
            usage_instructions: 'Inhale vapors directly or use 5 drops in hot shower steam or ultrasonic diffuser.',
            storage_precautions: 'Avoid contact with eyes. Not recommended for infants.',
            badge: 'Breathe Easy',
            images: [{ url: '', alt: 'Eucalyptus & Tea Tree Essence', is_primary: true }],
            is_published: true,
            is_featured: true,
            is_archived: false,
            sort_order: 6,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }
    ],
    content: {
        hero: {
            eyebrow: 'Botanical Wellness & Pure Alchemy',
            title: 'Pure Botanical Remedies for Modern Life',
            description: 'Crafted with ancient Ayurvedic wisdom and modern clinical purity. Discover pure essential oils, single-estate green teas, and restorative health tonics.',
            badge_1: '100% Organically Grown',
            badge_2: 'Zero Synthetic Additives',
            badge_3: 'Direct Farm Trade'
        },
        about: {
            eyebrow: 'Our Philosophy',
            title: 'Rooted in Ayurvedic Wisdom, Proven by Modern Purity',
            description: 'At Vaidya Botanicals, we believe the human body is inherently attuned to the restorative powers of plants. We partner exclusively with sustainable, single-origin botanical estates to bring you therapeutic-grade wellness products free from parabens, synthetic fragrances, and artificial chemicals.',
            stat_1_number: '100%',
            stat_1_label: 'Pure Botanical',
            stat_2_number: '0%',
            stat_2_label: 'Synthetic Fragrance',
            stat_3_number: '14+',
            stat_3_label: 'Tested Quality Checks'
        },
        story: {
            title: 'The Vaidya Story',
            subtitle: 'From Ancient Herbology to Daily Modern Rituals',
            p1: 'Vaidya was founded with a singular conviction: genuine wellness should be unadulterated, transparent, and restorative. Our name originates from the Sanskrit honorific for physician and master healer.',
            p2: 'We journeyed across remote tea valleys and pristine botanical groves to re-establish the sacred link between grower, plant, and consumer. We harvest only at peak medicinal potency, steam-distill at gentle pressures, and package in UV-protective glass.',
            p3: 'Every bottle of essential oil and packet of whole-leaf green tea is an invitation to step away from modern rush and re-center your vitality.'
        },
        support_info: {
            hours: 'Monday - Friday, 9:00 AM - 6:00 PM IST',
            email: 'care@vaidyabotanicals.com',
            phone: '+91 98765 43210',
            address: 'Vaidya Botanicals Wellness Labs, Dehradun, Uttarakhand, India'
        }
    },
    orders: [],
    supportTickets: [],
    reviews: [],
    auditLogs: [],
    adminUsers: initialAdminUsers
};

module.exports = {
    isSupabaseConfigured,
    getSupabaseAdmin: () => supabaseAdmin,
    getSupabaseClient: () => supabaseClient,
    mockDb
};
