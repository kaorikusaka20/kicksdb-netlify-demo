// KicksDB PRO Plan API Integration - Netlify Function
// Uses real-time StockX data with proper ID/SKU handling

const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto para datos en tiempo real

function getCacheKey(query, market = 'US') {
    return `${query}-${market}`;
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

    const { sku, id, market = 'US' } = event.queryStringParameters || {};
    
    if (!sku && !id) {
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'SKU or ID parameter is required' })
        };
    }

    // CORRECCIÓN: Priorizar ID sobre SKU
    const queryParam = id || sku;
    const isIdQuery = !!id;
    const cacheKey = getCacheKey(queryParam, market);
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
        console.log('KICKSDB_API_KEY not found, using enhanced fallback data');
        const productData = createEnhancedStockXMockData(queryParam, isIdQuery);
        
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
        console.log(`Fetching real-time StockX data for: ${isIdQuery ? `ID: ${id}` : `SKU: ${sku}`}`);
        
        // CORRECCIÓN: Endpoints correctos según el tipo de consulta
        let apiEndpoint;
        if (isIdQuery) {
            // Consulta por ID específico
            apiEndpoint = `https://api.kicks.dev/v3/stockx/products/${id}`;
        } else {
            // Búsqueda por SKU
            apiEndpoint = `https://api.kicks.dev/v3/stockx/products?query=${encodeURIComponent(sku)}&limit=3`;
        }
        
        console.log(`Using endpoint: ${apiEndpoint}`);
        
        const response = await fetch(apiEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Courts-StockX-App/1.2'
            }
        });
        
        console.log(`Response status: ${response.status}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log('StockX API response received successfully');
            
            let productData;
            if (isIdQuery && data.product) {
                // Respuesta directa por ID
                productData = normalizeStockXResponse(data.product, queryParam, true);
            } else if (!isIdQuery && data.data && data.data.length > 0) {
                // Búsqueda por SKU - encontrar mejor coincidencia
                const bestMatch = findBestSkuMatch(data.data, sku);
                productData = normalizeStockXResponse(bestMatch, queryParam, false);
            } else {
                throw new Error('No product data found in API response');
            }
            
            console.log(`✅ Processed product: ${productData.title} with ${productData.sizes.filter(s => s.available).length} available sizes`);
            
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
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`StockX API returned ${response.status}: ${errorData.message || 'Unknown error'}`);
        }
        
    } catch (error) {
        console.error('Error fetching from StockX API:', error.message);
        
        // Fallback a datos mock pero con información mejorada
        const productData = createEnhancedStockXMockData(queryParam, isIdQuery);
        
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

// CORRECCIÓN: Mejor algoritmo de coincidencia para SKUs
function findBestSkuMatch(products, targetSku) {
    const targetParts = targetSku.toLowerCase().split('/').map(part => part.trim());
    let bestMatch = products[0];
    let bestScore = 0;
    
    products.forEach(product => {
        const productSku = (product.sku || '').toLowerCase();
        let score = 0;
        
        // Puntuación por coincidencias exactas
        targetParts.forEach(part => {
            if (productSku.includes(part)) {
                score += 2;
            }
        });
        
        // Puntuación adicional por coincidencia de título
        const productTitle = (product.title || '').toLowerCase();
        if (productTitle.includes('anta') && productTitle.includes('kai')) {
            score += 1;
        }
        
        if (score > bestScore) {
            bestScore = score;
            bestMatch = product;
        }
    });
    
    console.log(`Best match for SKU "${targetSku}": "${bestMatch.title}" with score ${bestScore}`);
    return bestMatch;
}

// CORRECCIÓN: Normalización usando estructura REAL del JSON de StockX
function normalizeStockXResponse(product, queryParam, isDirectId = false) {
    console.log(`Normalizing ${isDirectId ? 'direct ID' : 'search'} response from StockX API...`);
    
    // 1. TÍTULO: Usar el título real de la API StockX
    const title = product.title || `Producto ${queryParam}`;
    
    // 2. SKU: Usar el SKU real de la API
    const sku = product.sku || queryParam;
    
    // 3. PRECIO BASE: Usar min_price de StockX
    const basePrice = product.min_price || 120;
    
    // 4. IMAGEN: Usar imagen real de StockX
    const image = product.image || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop';
    
    // 5. TALLAS: Extraer variantes reales usando estructura correcta
    const sizes = extractRealStockXVariants(product.variants || [], basePrice);
    
    // 6. METADATOS: Información adicional de StockX
    const lastUpdated = product.updated_at || new Date().toISOString();

    return {
        sku: sku,
        title: title, // TÍTULO REAL de la API
        image: image,
        lastUpdated: lastUpdated,
        regularPrice: basePrice,
        sizes: sizes,
        _source: 'StockX API - Datos en Tiempo Real',
        _apiData: {
            realTimeData: true,
            availableSizes: sizes.filter(s => s.available).length,
            totalSizes: sizes.length,
            minPrice: product.min_price,
            maxPrice: product.max_price,
            weeklyOrders: product.weekly_orders,
            totalOrders: product.weekly_orders
        }
    };
}

// CORRECCIÓN: Extracción usando estructura REAL del JSON
function extractRealStockXVariants(variants, fallbackBasePrice) {
    if (!variants || !Array.isArray(variants)) {
        console.log('No variants found, generating realistic fallback data');
        return generateRealisticSizeData(fallbackBasePrice);
    }
    
    console.log(`Processing ${variants.length} real variants from StockX API`);
    const sizes = [];
    
    variants.forEach(variant => {
        // ESTRUCTURA REAL del JSON StockX:
        const sizeUS = variant.size || 'N/A';
        const lowestAsk = variant.lowest_ask || 0;
        const totalAsks = variant.total_asks || 0;
        const sales15Days = variant.sales_count_15_days || 0;
        
        // LÓGICA REAL de disponibilidad:
        // - lowest_ask > 0 significa que hay precio disponible
        // - total_asks > 0 significa que hay ofertas activas
        const available = lowestAsk > 0 && totalAsks > 0;
        
        console.log(`Size US ${sizeUS}: ${lowestAsk}, ${totalAsks} asks, ${sales15Days} sales, available: ${available}`);
        
        sizes.push({
            size: `US ${sizeUS}`,
            price: available ? parseFloat(lowestAsk.toFixed(2)) : 0,
            available: available,
            stockxData: {
                lowest_ask: lowestAsk,
                total_asks: totalAsks,
                sales_15_days: sales15Days,
                sales_30_days: variant.sales_count_30_days || 0,
                sales_60_days: variant.sales_count_60_days || 0,
                previous_lowest_ask: variant.previous_lowest_ask || 0
            }
        });
    });
    
    // Ordenar por talla numéricamente
    sizes.sort((a, b) => {
        const sizeA = parseFloat(a.size.replace('US ', ''));
        const sizeB = parseFloat(b.size.replace('US ', ''));
        return sizeA - sizeB;
    });
    
    console.log(`Processed ${sizes.length} sizes, ${sizes.filter(s => s.available).length} available`);
    return sizes;
}

// CORRECCIÓN: Solo IDs en mock data
function createEnhancedStockXMockData(queryParam, isIdQuery = false) {
    console.log(`Creating enhanced mock data for ${isIdQuery ? 'ID' : 'query'}: ${queryParam}`);
    
    // Solo generar nombres temporales si no tenemos datos reales
    const fallbackTitle = isIdQuery ? `Zapatilla ${queryParam.slice(-1)}` : `Producto ${queryParam}`;
    
    return {
        sku: queryParam,
        title: fallbackTitle,
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop',
        lastUpdated: new Date().toISOString(),
        regularPrice: 120.00,
        sizes: generateRealisticSizeData(120.00),
        _fallback: true,
        _message: 'Datos de demostración - StockX simulado'
    };
}

// CORRECCIÓN: Tallas realistas sin hardcodear productos específicos
function generateRealisticSizeData(basePrice = 120) {
    const allSizes = [];
    const sizeRange = ['6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '15'];
    
    sizeRange.forEach((size) => {
        // Algoritmo realista de disponibilidad basado en popularidad
        let availabilityChance = 0.65; // 65% base
        const sizeFloat = parseFloat(size);
        
        // Tallas más populares (8-11) tienen menor disponibilidad
        if (sizeFloat >= 8 && sizeFloat <= 11) {
            availabilityChance = 0.35; // 35% - alta demanda
        } else if (sizeFloat >= 11.5 && sizeFloat <= 13) {
            availabilityChance = 0.55; // 55% - demanda media
        } else if (sizeFloat >= 13.5) {
            availabilityChance = 0.80; // 80% - menor demanda
        } else if (sizeFloat <= 7.5) {
            availabilityChance = 0.75; // 75% - menor demanda
        }
        
        const available = Math.random() < availabilityChance;
        
        // Variación de precio realista basada en escasez y demanda
        let priceMultiplier = 1.0;
        
        if (sizeFloat <= 7 || sizeFloat >= 13.5) {
            // Tallas extremas: más caras por escasez
            priceMultiplier = 1.20 + (Math.random() * 0.40); // +20% a +60%
        } else if (sizeFloat >= 8 && sizeFloat <= 10.5) {
            // Tallas populares: premium por demanda
            priceMultiplier = 1.10 + (Math.random() * 0.30); // +10% a +40%
        } else {
            // Tallas normales: variación menor
            priceMultiplier = 0.95 + (Math.random() * 0.25); // -5% a +20%
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
        _apiData: {
            realTimeData: true,
            availableSizes: sizes.filter(s => s.available).length,
            totalSizes: sizes.length,
            lowestPrice: product.lowest_price,
            highestPrice: product.highest_price,
            weeklyOrders: product.weekly_orders,
            totalOrders: product.total_orders
        }
    };
}

// CORRECCIÓN: Extracción mejorada de variantes con precios reales
function extractStockXVariants(variants, queryParam) {
    if (!variants || !Array.isArray(variants)) {
        console.log('No variants found, generating realistic fallback data');
        return generateRealisticSizeData(queryParam);
    }
    
    console.log(`Processing ${variants.length} real variants from StockX API`);
    const sizes = [];
    
    variants.forEach(variant => {
        // Datos reales de StockX: lowest_ask, total_asks, sales data
        const lowestAsk = variant.lowest_ask || variant.price || 0;
        const totalAsks = variant.total_asks || variant.asks || 0;
        const sales15Days = variant.sales_count_15_days || 0;
        
        // Lógica de disponibilidad mejorada:
        // - Debe tener precio válido (> 0)
        // - Debe tener ofertas disponibles O ventas recientes
        const available = lowestAsk > 0 && (totalAsks > 0 || sales15Days > 0);
        
        const sizeUS = variant.size || variant.us_size || 'N/A';
        
        console.log(`Size ${sizeUS}: ${lowestAsk}, ${totalAsks} asks, ${sales15Days} sales, available: ${available}`);
        
        sizes.push({
            size: `US ${sizeUS}`,
            price: available ? parseFloat(lowestAsk.toFixed(2)) : 0,
            available: available,
            stockxData: {
                lowest_ask: lowestAsk,
                highest_bid: variant.highest_bid || 0,
                total_asks: totalAsks,
                total_bids: variant.total_bids || 0,
                sales_15_days: sales15Days,
                sales_30_days: variant.sales_count_30_days || 0,
                last_sale: variant.last_sale_price || 0,
                price_premium: variant.price_premium || 0
            }
        });
    });
    
    // Ordenar por talla numéricamente
    sizes.sort((a, b) => {
        const sizeA = parseFloat(a.size.replace('US ', ''));
        const sizeB = parseFloat(b.size.replace('US ', ''));
        return sizeA - sizeB;
    });
    
    console.log(`Processed ${sizes.length} sizes, ${sizes.filter(s => s.available).length} available`);
    return sizes;
}

// CORRECCIÓN: Mock data mejorado basado en IDs reales
function createEnhancedStockXMockData(queryParam, isIdQuery = false) {
    console.log(`Creating enhanced mock data for ${isIdQuery ? 'ID' : 'SKU'}: ${queryParam}`);
    
    const productInfo = getProductInfoByQuery(queryParam, isIdQuery);
    
    return {
        sku: productInfo.sku,
        title: productInfo.name, // CORRECCIÓN: Usar nombres reales según el ID/SKU
        image: productInfo.image,
        lastUpdated: new Date().toISOString(),
        regularPrice: productInfo.basePrice,
        sizes: generateRealisticSizeData(queryParam, productInfo.basePrice),
        _fallback: true,
        _message: 'Datos de demostración - StockX simulado',
        _note: 'Precios y disponibilidad generados de forma realista'
    };
}

// Limpieza automática de cache cada 5 minutos
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL * 5) { // Limpiar entradas de más de 5 minutos
            cache.delete(key);
            console.log(`Cache entry expired and removed: ${key}`);
        }
    }
    console.log(`Cache cleanup completed. Current cache size: ${cache.size}`);
}, 5 * 60 * 1000);
