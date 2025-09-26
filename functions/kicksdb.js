// KicksDB PRO Plan API Integration - Netlify Function
// Uses real-time endpoints available on the PRO plan

const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto para datos "en tiempo real"

function getCacheKey(sku, market = 'US') {
    return `${sku}-${market}`;
}

function isCacheValid(cacheEntry) {
    return cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL);
}

export const handler = async (event) => {
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

    const apiKey = process.env.KICKSDB_API_KEY;
    
    if (!apiKey) {
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'KICKSDB_API_KEY not configured' })
        };
    }

    try {
        console.log(`Fetching real-time data for SKU: ${sku}`);
        
        // ENDPOINT PRINCIPAL para Plan Pro - Busqueda directa por SKU
        const primaryEndpoint = `https://api.kicks.dev/v3/stockx/products?query=${encodeURIComponent(sku)}&limit=1`;
        
        console.log(`Trying primary endpoint: ${primaryEndpoint}`);
        
        const response = await fetch(primaryEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Courts-Pro-App/1.0'
            }
        });
        
        console.log(`Response status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log('API response received, processing...');
            
            if (data.data && data.data.length > 0) {
                const productData = normalizeProResponse(data.data[0], sku);
                
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
                // Fallback a búsqueda más amplia
                return await tryAlternativeSearch(sku, apiKey, cacheKey);
            }
        } else {
            console.log(`Primary endpoint failed: ${response.status}`);
            return await tryAlternativeSearch(sku, apiKey, cacheKey);
        }
        
    } catch (error) {
        console.error('Error fetching from KicksDB Pro API:', error);
        
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                error: 'Failed to fetch product data',
                message: error.message,
                sku: sku
            })
        };
    }
};

// Función alternativa de búsqueda
async function tryAlternativeSearch(sku, apiKey, cacheKey) {
    try {
        console.log('Trying alternative search endpoint...');
        
        // Endpoint alternativo para búsqueda más flexible
        const searchQuery = sku.split('/')[0].trim(); // Usar primera parte del SKU
        const searchEndpoint = `https://api.kicks.dev/v3/stockx/search?query=${encodeURIComponent(searchQuery)}&limit=5`;
        
        const response = await fetch(searchEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.data && data.data.length > 0) {
                // Encontrar la mejor coincidencia
                const bestMatch = findBestMatch(data.data, sku);
                const productData = normalizeProResponse(bestMatch, sku);
                
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
            }
        }
        
        throw new Error('No products found in search results');
        
    } catch (error) {
        throw new Error(`Alternative search also failed: ${error.message}`);
    }
}

// Encontrar mejor coincidencia del SKU
function findBestMatch(products, targetSku) {
    const targetParts = targetSku.toLowerCase().split('/').map(part => part.trim());
    
    return products.reduce((best, product) => {
        const productSku = (product.sku || '').toLowerCase();
        let score = 0;
        
        targetParts.forEach(part => {
            if (productSku.includes(part)) {
                score++;
            }
        });
        
        return score > best.score ? { product, score } : best;
    }, { product: products[0], score: 0 }).product;
}

// Dentro de kicksdb.js, función normalizeProResponse

// Normalizar respuesta del plan Pro
function normalizeProResponse(data, sku) {
    console.log('Normalizing Pro response:', JSON.stringify(data, null, 2));
    
    // Extraer información básica
    const title = data.title || data.name || data.product_name || getProductNameBySku(sku);
    let image = data.image || data.thumbnail || data.main_picture_url || getProductImageBySku(sku);
    
    // Si la imagen es de StockX, ya tiene los parámetros de tamaño. Si no, añadimos los parámetros de Netlify.
    if (image.includes('http') && !image.includes('stockx.com')) {
        image += '?nf_resize=fit&w=700&h=500';
    }
    
    // Precios oficiales específicos para cada producto
    const officialPrice = getOfficialPriceBySku(sku);
    // Extraer tallas de los variants
    const sizes = extractSizesFromVariants(data.variants, officialPrice);
    
    return {
        sku: sku,
        title: title,
        image: image,
        lastUpdated: new Date().toISOString(),
        regularPrice: officialPrice,
        sizes: sizes,
        _source: 'KicksDB Pro',
        _features: {
            realTimeData: true,
            marketPrices: true,
            availableSizes: sizes.filter(s => s.available).length
        }
    };
}

// Extraer tallas desde los variants
function extractSizesFromVariants(variants, basePrice) {
    if (!variants || !Array.isArray(variants)) {
        // Si no hay variants, generar tallas por defecto
        return generateOfficialSizes(basePrice);
    }
    
    const sizes = [];
    
    variants.forEach(variant => {
        // La talla puede venir como "8" o "8.5", etc. 
        // En el JSON de ejemplo, la talla está en variant.size y es un string numérico.
        const size = variant.size;
        // El precio es el lowest_ask, si es 0, no disponible
        const price = variant.lowest_ask > 0 ? variant.lowest_ask : basePrice;
        const available = variant.lowest_ask > 0;
        
        sizes.push({
            size: `US ${size}`,
            price: parseFloat(price),
            available: available
        });
    });
    
    return sizes;
}
function extractBestPrice(data) {
    // Priorizar lowest_ask
    if (data.lowest_ask && !isNaN(parseFloat(data.lowest_ask))) {
        return parseFloat(data.lowest_ask);
    }
    // Luego retail_price_cents
    if (data.retail_price_cents && !isNaN(data.retail_price_cents)) {
        return data.retail_price_cents / 100;
    }
    // Luego retailPrice
    if (data.retailPrice && !isNaN(parseFloat(data.retailPrice))) {
        return parseFloat(data.retailPrice);
    }
    // Si no, buscar en las tallas el precio más bajo
    if (data.prices && typeof data.prices === 'object') {
        let minPrice = Infinity;
        Object.values(data.prices).forEach(sizePrices => {
            Object.values(sizePrices).forEach(price => {
                if (price > 0 && price < minPrice) {
                    minPrice = price;
                }
            });
        });
        if (minPrice !== Infinity) {
            return minPrice;
        }
    }
    // Fallback
    return 120.00;
}

// Extraer tallas en tiempo real
function extractRealTimeSizes(data, basePrice) {
    const sizes = [];
    
    // Estructura de datos en tiempo real de KicksDB Pro
    if (data.prices && typeof data.prices === 'object') {
        Object.entries(data.prices).forEach(([currencySize, sizePrices]) => {
            Object.entries(sizePrices).forEach(([size, price]) => {
                if (price > 0) {
                    sizes.push({
                        size: `US ${size}`,
                        price: parseFloat(price),
                        available: true
                    });
                }
            });
        });
    }
    
    // Fallback a variantes si no hay precios directos
    if (sizes.length === 0 && data.variants) {
        data.variants.forEach(variant => {
            const price = variant.price || variant.lowest_ask || basePrice;
            sizes.push({
                size: variant.size || variant.us_size || 'Unknown',
                price: parseFloat(price),
                available: variant.available !== false
            });
        });
    }
    
    // Fallback final si no hay tallas
    if (sizes.length === 0) {
        const commonSizes = ['US 8', 'US 8.5', 'US 9', 'US 9.5', 'US 10', 'US 10.5', 'US 11'];
        commonSizes.forEach(size => {
            sizes.push({
                size: size,
                price: basePrice + (Math.random() * 40 - 20),
                available: Math.random() > 0.3
            });
        });
    }
    
    return sizes;
}

// Limpieza periódica de cache
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
}, 5 * 60 * 1000);
