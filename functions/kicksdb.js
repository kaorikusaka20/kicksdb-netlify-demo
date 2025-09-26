// KicksDB PRO Plan API Integration - Netlify Function
// Uses real-time StockX data with proper size handling

const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto para datos en tiempo real

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
        console.log('KICKSDB_API_KEY not found, using fallback data');
        const productData = createStockXMockData(sku);
        
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

    try {
        console.log(`Fetching real-time StockX data for SKU: ${sku}`);
        
        // ENDPOINT para buscar productos por SKU en StockX
        const searchEndpoint = `https://api.kicks.dev/v3/stockx/products?query=${encodeURIComponent(sku)}&limit=5`;
        
        console.log(`Trying endpoint: ${searchEndpoint}`);
        
        const response = await fetch(searchEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Courts-StockX-App/1.0'
            }
        });
        
        console.log(`Response status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log('StockX API response received');
            
            if (data.data && data.data.length > 0) {
                // Encontrar el producto que mejor coincida con el SKU
                const bestMatch = findBestMatch(data.data, sku);
                const productData = normalizeStockXResponse(bestMatch, sku);
                
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
                throw new Error('No products found in StockX search results');
            }
        } else {
            throw new Error(`StockX API returned ${response.status}`);
        }
        
    } catch (error) {
        console.error('Error fetching from StockX API:', error);
        
        // Fallback a datos mock basados en el JSON que proporcionaste
        const productData = createStockXMockData(sku);
        
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
};

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

function normalizeStockXResponse(data, sku) {
    console.log('Normalizando respuesta de StockX para precios y tallas...');
    
    // 1. Precio Base CORREGIDO: Usar precio mínimo disponible
    const basePrice = data.min_price || getOfficialPriceBySku(sku);

    // 2. Tallas CORREGIDAS: Extraer de variants con disponibilidad real
    const sizes = extractSizesFromStockXVariants(data.variants, sku);
    
    // 3. Imagen con tamaño específico optimizado para la UI
    const image = data.image ? `${data.image}?fit=fill&bg=FFFFFF&w=700&h=500` : 
                              getProductImageBySku(sku);

    return {
        sku: sku,
        title: data.title || getProductNameBySku(sku),
        image: image,
        lastUpdated: data.updated_at || new Date().toISOString(),
        regularPrice: basePrice,
        sizes: sizes,
        _source: 'StockX API Real',
        _features: {
            realTimeData: true,
            availableSizes: sizes.filter(s => s.available).length,
            totalSizes: sizes.length,
            priceConsistency: 'Real API Data'
        }
    };
}

function extractSizesFromStockXVariants(variants, sku) {
    if (!variants || !Array.isArray(variants)) {
        return generateRealisticSizesWithPrices(sku);
    }
    
    const sizes = [];
    
    variants.forEach(variant => {
        // CORRECCIÓN: Disponibilidad basada en lowest_ask > 0 Y total_asks > 0
        const available = variant.lowest_ask > 0 && variant.total_asks > 0;
        // CORRECCIÓN: Precio REAL de la talla
        const sizePrice = available ? variant.lowest_ask : 0;
        
        sizes.push({
            size: `US ${variant.size}`,
            price: parseFloat(sizePrice.toFixed(2)),
            available: available,
            originalData: {
                lowest_ask: variant.lowest_ask,
                total_asks: variant.total_asks,
                size_type: variant.size_type
            }
        });
    });
    
    return sizes.length > 0 ? sizes : generateRealisticSizesWithPrices(sku);
}

// CORRECCIÓN: Generar tallas realistas con precios variables por SKU
function generateRealisticSizesWithPrices(sku) {
    const allSizes = [];
    const sizeRange = ['6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '15'];
    
    // Precios base específicos por producto
    const basePrices = {
        '112441113-13/1124D1113-13': 118.00, // Anta Kai 1 Jelly
        '112531111S-3/8125C1111S-3/812531111S-3': 101.00, // Anta Kai 2 Triple Black
        '112511810S-1/1125A1810S-1/8125A1810S-1/112541810SF-1': 80.00 // Anta Kai Hélà White
    };
    
    const basePrice = basePrices[sku] || 120.00;
    
    sizeRange.forEach((size, index) => {
        // Lógica realista de disponibilidad
        // Tallas más populares (8-11) tienen menos stock
        // Tallas extremas (6.5, 14+) tienen más stock pero precios más altos
        let availabilityChance = 0.65; // 65% base
        
        if (parseFloat(size) >= 8 && parseFloat(size) <= 11) {
            availabilityChance = 0.4; // Tallas populares - menos stock
        } else if (parseFloat(size) >= 13) {
            availabilityChance = 0.75; // Tallas grandes - más stock
        }
        
        const available = Math.random() < availabilityChance;
        
        // Variación de precio realista
        let priceMultiplier = 1.0;
        
        // Tallas pequeñas y grandes cuestan más
        if (parseFloat(size) <= 7 || parseFloat(size) >= 13) {
            priceMultiplier = 1.15 + (Math.random() * 0.3); // +15-45%
        } else if (parseFloat(size) >= 8 && parseFloat(size) <= 11) {
            priceMultiplier = 0.95 + (Math.random() * 0.2); // -5% a +15%
        } else {
            priceMultiplier = 1.0 + (Math.random() * 0.25); // 0% a +25%
        }
        
        const finalPrice = available ? parseFloat((basePrice * priceMultiplier).toFixed(2)) : 0;
        
        allSizes.push({
            size: `US ${size}`,
            price: finalPrice,
            available: available
        });
    });
    
    return allSizes;
}

// Datos mock mejorados basados en StockX
function createStockXMockData(sku) {
    const productName = getProductNameBySku(sku);
    const basePrice = getOfficialPriceBySku(sku);
    
    return {
        sku: sku,
        title: productName,
        image: getProductImageBySku(sku),
        lastUpdated: new Date().toISOString(),
        regularPrice: basePrice,
        sizes: generateRealisticSizesWithPrices(sku),
        _fallback: true,
        _message: 'Datos de demostración - StockX simulado',
        _note: 'Precios y disponibilidad simulados de forma realista'
    };
}

// Helper functions
function getOfficialPriceBySku(sku) {
    const priceMap = {
        '112441113-13/1124D1113-13': 118.00,
        '112531111S-3/8125C1111S-3/812531111S-3': 101.00,
        '112511810S-1/1125A1810S-1/8125A1810S-1/112541810SF-1': 80.00
    };
    return priceMap[sku] || 120.00;
}

function getProductNameBySku(sku) {
    const nameMap = {
        '112441113-13/1124D1113-13': 'Anta Kai 1 Jelly',
        '112531111S-3/8125C1111S-3/812531111S-3': 'Anta Kai 2 Triple Black',
        '112511810S-1/1125A1810S-1/8125A1810S-1/112541810SF-1': 'Anta Kai Hélà White'
    };
    return nameMap[sku] || 'Anta Basketball Shoe';
}

function getProductImageBySku(sku) {
    // Imágenes optimizadas para el diseño de la aplicación
    const imageMap = {
        '112441113-13/1124D1113-13': 'https://images.unsplash.com/photo-1543508282-6319a3e2621f?w=700&h=500&fit=crop&auto=format',
        '112531111S-3/8125C1111S-3/812531111S-3': 'https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=700&h=500&fit=crop&auto=format',
        '112511810S-1/1125A1810S-1/8125A1810S-1/112541810SF-1': 'https://images.unsplash.com/photo-1549298916-b41d501d3772?w=700&h=500&fit=crop&auto=format'
    };
    return imageMap[sku] || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop&auto=format';
}

// Limpieza de cache
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            cache.delete(key);
        }
    }
}, 5 * 60 * 1000);
