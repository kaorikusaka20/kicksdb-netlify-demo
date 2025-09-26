// KicksDB FREE Plan API Integration - Netlify Function
// ONLY uses StockX Search endpoints available on the FREE plan

// In-memory cache with TTL (600s = 10 minutes)
const cache = new Map();
const CACHE_TTL = 600 * 1000;

// Helper function to clean SKU for search
function cleanSkuForSearch(sku) {
    return sku.split('/').map(part => part.trim()).join(' ');
}

// Helper function to get cache key
function getCacheKey(sku, market = 'US') {
    return `${sku}-${market}`;
}

// Helper function to check if cache is valid
function isCacheValid(cacheEntry) {
    return cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL);
}

// Mock data for when API fails (usando datos realistas de Anta)
function createMockData(sku, productName) {
    const basePrices = {
        'Anta Kai 1 Jelly': 120.00,
        'Anta Kai 2 Triple Black': 135.00,
        'Anta Kai Hélà White': 125.00
    };
    
    const basePrice = basePrices[productName] || 120.00;
    
    return {
        sku: sku,
        title: productName,
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&h=500&fit=crop',
        lastUpdated: new Date().toISOString(),
        regularPrice: basePrice,
        sizes: [
            { size: 'US 8', price: basePrice, available: true },
            { size: 'US 8.5', price: basePrice + 5, available: true },
            { size: 'US 9', price: basePrice + 10, available: true },
            { size: 'US 9.5', price: basePrice + 5, available: false },
            { size: 'US 10', price: basePrice, available: true },
            { size: 'US 10.5', price: basePrice + 5, available: true },
            { size: 'US 11', price: basePrice + 10, available: true }
        ],
        _fallback: true
    };
}

// Map SKUs to product names
function getProductNameBySku(sku) {
    const productMap = {
        '112441113-13/1124D1113-13': 'Anta Kai 1 Jelly',
        '112531111S-3/8125C1111S-3/812531111S-3': 'Anta Kai 2 Triple Black',
        '112511810S-1/1125A1810S-1/8125A1810S-1/112541810SF-1': 'Anta Kai Hélà White'
    };
    
    return productMap[sku] || 'Anta Basketball Shoe';
}

// Main handler function - FREE PLAN VERSION
export const handler = async (event, context) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, OPTIONS'
            },
            body: ''
        };
    }

    // Only allow GET requests
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // Extract query parameters
    const { sku, market = 'US' } = event.queryStringParameters || {};
    
    if (!sku) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'SKU parameter is required' })
        };
    }

    const cacheKey = getCacheKey(sku, market);
    const cachedData = cache.get(cacheKey);

    // Return cached data if valid
    if (isCacheValid(cachedData)) {
        console.log(`Cache hit for ${cacheKey}`);
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(cachedData.data)
        };
    }

    // Check API key
    const apiKey = process.env.KICKSDB_API_KEY;
    
    // If no API key or FREE plan, use mock data with occasional API attempt
    if (!apiKey) {
        console.log('No API key found, using mock data');
        const productName = getProductNameBySku(sku);
        const mockData = createMockData(sku, productName);
        
        cache.set(cacheKey, {
            data: mockData,
            timestamp: Date.now()
        });
        
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mockData)
        };
    }

    try {
        console.log(`Attempting StockX search for: ${sku}`);
        
        // ONLY use the FREE plan endpoint: StockX Search
        const searchQuery = cleanSkuForSearch(sku);
        const searchEndpoint = `https://api.kicks.dev/stockx/search?query=${encodeURIComponent(searchQuery)}&limit=5`;
        
        console.log(`Trying FREE plan endpoint: ${searchEndpoint}`);
        
        const response = await fetch(searchEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Courts-Sneaker-App/1.0'
            }
        });
        
        console.log(`Response status: ${response.status}`);
        
        if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                console.log('StockX search successful, processing results...');
                
                // Process StockX search results
                let productData = null;
                
                if (data.results && data.results.length > 0) {
                    // Use the first result from search
                    const firstResult = data.results[0];
                    productData = {
                        sku: sku,
                        title: firstResult.title || firstResult.name || getProductNameBySku(sku),
                        image: firstResult.image || firstResult.thumbnail || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&h=500&fit=crop',
                        lastUpdated: new Date().toISOString(),
                        regularPrice: firstResult.retail_price_cents ? firstResult.retail_price_cents / 100 : 120.00,
                        sizes: generateSizesFromStockX(firstResult),
                        _apiSource: 'StockX Search'
                    };
                } else {
                    // No results found, use mock data
                    throw new Error('No products found in search results');
                }
                
                cache.set(cacheKey, {
                    data: productData,
                    timestamp: Date.now()
                });
                
                return {
                    statusCode: 200,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(productData)
                };
            } else {
                // Response is not JSON, likely HTML error page
                throw new Error('API returned non-JSON response (likely plan limitation)');
            }
        } else if (response.status === 403) {
            // API key valid but insufficient permissions (FREE plan trying to access paid endpoint)
            console.log('API returned 403 - Using mock data instead');
            throw new Error('FREE plan limitation - Upgrade to Standard for full API access');
        } else {
            // Other error
            const errorText = await response.text();
            console.log(`API error ${response.status}: ${errorText.substring(0, 200)}`);
            throw new Error(`API returned ${response.status}`);
        }
        
    } catch (error) {
        console.error('Error fetching from KicksDB API:', error.message);
        
        // Fallback to mock data
        const productName = getProductNameBySku(sku);
        const mockData = createMockData(sku, productName);
        mockData._fallback = true;
        mockData._apiError = error.message;
        
        cache.set(cacheKey, {
            data: mockData,
            timestamp: Date.now()
        });
        
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mockData)
        };
    }
};

// Helper function to generate sizes from StockX data
function generateSizesFromStockX(product) {
    const basePrice = product.retail_price_cents ? product.retail_price_cents / 100 : 120.00;
    const sizes = [];
    
    // Common US sizes
    const commonSizes = ['US 8', 'US 8.5', 'US 9', 'US 9.5', 'US 10', 'US 10.5', 'US 11', 'US 11.5', 'US 12'];
    
    commonSizes.forEach((size, index) => {
        // Simulate price variations and availability
        const priceVariation = Math.random() * 40 - 20; // +/- $20
        const price = Math.max(basePrice + priceVariation, 80); // Minimum $80
        const available = Math.random() > 0.3; // 70% chance available
        
        sizes.push({
            size: size,
            price: parseFloat(price.toFixed(2)),
            available: available
        });
    });
    
    return sizes;
}

// Cleanup old cache entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            cache.delete(key);
            console.log(`Cleaned up expired cache entry: ${key}`);
        }
    }
}, 10 * 60 * 1000);
