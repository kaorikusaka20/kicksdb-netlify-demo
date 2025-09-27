// KicksDB API Integration - Netlify Function CORREGIDA
// Usa datos en tiempo real de StockX solo con IDs

const cache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto para datos en tiempo real

function getCacheKey(query, market = 'US') {
    return `${query}-${market}`;
}

function isCacheValid(cacheEntry) {
    return cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL);
}

export const handler = async (event) => {
    console.log('🔥 INICIO DE FUNCIÓN NETLIFY - kicksdb.js');
    console.log('📋 Event details:', {
        httpMethod: event.httpMethod,
        queryStringParameters: event.queryStringParameters,
        headers: event.headers ? Object.keys(event.headers) : 'none'
    });
    
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        console.log('⚠️ Handling CORS preflight request');
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
        console.log('❌ Method not allowed:', event.httpMethod);
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
    
    console.log('📊 Parámetros recibidos:', { sku, id, market });
    
    if (!sku && !id) {
        console.log('❌ No se recibió SKU ni ID');
        return {
            statusCode: 400,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ error: 'SKU or ID parameter is required' })
        };
    }

    // Priorizar ID sobre SKU
    const queryParam = id || sku;
    const isIdQuery = !!id;
    const cacheKey = getCacheKey(queryParam, market);
    
    console.log('🔑 Query details:', { queryParam, isIdQuery, cacheKey });
    
    const cachedData = cache.get(cacheKey);

    if (isCacheValid(cachedData)) {
        console.log('✅ CACHE HIT - Devolviendo datos cacheados');
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
    
    console.log('🔐 API Key check:', {
        hasApiKey: !!apiKey,
        keyLength: apiKey ? apiKey.length : 0,
        keyStart: apiKey ? apiKey.substring(0, 10) + '...' : 'NONE'
    });
    
    if (!apiKey) {
        console.log('❌ NO API KEY FOUND - Using fallback data');
        const productData = createFallbackData(queryParam, isIdQuery);
        
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
        console.log(`🌐 HACIENDO PETICIÓN A STOCKX API para: ${isIdQuery ? `ID: ${id}` : `SKU: ${sku}`}`);
        
        // Endpoint correcto según el tipo de consulta
        let apiEndpoint;
        if (isIdQuery) {
            apiEndpoint = `https://api.kicks.dev/v3/stockx/products/${id}`;
        } else {
            apiEndpoint = `https://api.kicks.dev/v3/stockx/products?query=${encodeURIComponent(sku)}&limit=3`;
        }
        
        console.log(`🎯 URL de la API: ${apiEndpoint}`);
        
        const response = await fetch(apiEndpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Courts-StockX-App/1.3'
            }
        });
        
        console.log(`📡 Respuesta de StockX API:`, {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: response.headers ? 'present' : 'none'
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ JSON recibido de StockX API exitosamente');
            console.log('📋 Estructura de datos:', {
                hasProduct: !!data.product,
                hasData: !!data.data,
                dataLength: data.data ? data.data.length : 0,
                keys: Object.keys(data)
            });
            
            let productData;
            if (isIdQuery && data.product) {
                console.log('🎯 Procesando respuesta directa por ID');
                console.log('📊 Product data:', {
                    id: data.product.id,
                    title: data.product.title,
                    hasVariants: !!data.product.variants,
                    variantsCount: data.product.variants ? data.product.variants.length : 0
                });
                productData = normalizeStockXResponse(data.product);
            } else if (!isIdQuery && data.data && data.data.length > 0) {
                console.log('🔍 Procesando búsqueda por SKU - tomando primer resultado');
                productData = normalizeStockXResponse(data.data[0]);
            } else {
                console.log('❌ No se encontraron datos de producto en la respuesta');
                throw new Error('No product data found in API response');
            }
            
            console.log('✅ DATOS PROCESADOS EXITOSAMENTE:', {
                title: productData.title,
                sizesTotal: productData.sizes.length,
                sizesAvailable: productData.sizes.filter(s => s.available).length,
                hasRealData: !productData._fallback
            });
            
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
            const errorText = await response.text().catch(() => 'No error text');
            console.log('❌ StockX API devolvió error:', {
                status: response.status,
                statusText: response.statusText,
                errorText: errorText.substring(0, 200)
            });
            throw new Error(`StockX API returned ${response.status}: ${response.statusText}`);
        }
        
    } catch (error) {
        console.error('💥 ERROR EN PETICIÓN A STOCKX:', {
            message: error.message,
            stack: error.stack ? error.stack.substring(0, 300) : 'No stack'
        });
        
        // Fallback a datos simulados
        console.log('🔄 Activando fallback debido al error');
        const productData = createFallbackData(queryParam, isIdQuery);
        
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

// Normalización de respuesta de StockX usando estructura real del JSON
function normalizeStockXResponse(product) {
    console.log('Normalizing StockX API response...');
    
    const title = product.title || `Producto ${product.id}`;
    const sku = product.sku || product.id;
    const basePrice = product.min_price || 120;
    const image = product.image || 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop';
    const sizes = extractStockXVariants(product.variants || []);
    const lastUpdated = product.updated_at || new Date().toISOString();

    return {
        sku: sku,
        title: title,
        image: image,
        lastUpdated: lastUpdated,
        regularPrice: basePrice,
        sizes: sizes,
        _source: 'StockX API - Datos en Tiempo Real',
        _apiData: {
            realTimeData: true,
            availableSizes: sizes.filter(s => s.available).length,
            totalSizes: sizes.length,
            minPrice: product.min_price || 0,
            maxPrice: product.max_price || 0,
            weeklyOrders: product.weekly_orders || 0
        }
    };
}

// Extracción de variantes usando estructura real del JSON StockX
function extractStockXVariants(variants) {
    if (!variants || !Array.isArray(variants)) {
        console.log('No variants found, generating fallback sizes');
        return generateFallbackSizes();
    }
    
    console.log(`Processing ${variants.length} variants from StockX API`);
    const sizes = [];
    
    variants.forEach(variant => {
        const sizeUS = variant.size || 'N/A';
        const lowestAsk = variant.lowest_ask || 0;
        const totalAsks = variant.total_asks || 0;
        
        // Lógica real de disponibilidad: precio > 0 Y ofertas > 0
        const available = lowestAsk > 0 && totalAsks > 0;
        
        console.log(`Size US ${sizeUS}: $${lowestAsk}, ${totalAsks} asks, available: ${available}`);
        
        sizes.push({
            size: `US ${sizeUS}`,
            price: available ? parseFloat(lowestAsk.toFixed(2)) : 0,
            available: available,
            stockxData: {
                lowest_ask: lowestAsk,
                total_asks: totalAsks,
                sales_15_days: variant.sales_count_15_days || 0,
                sales_30_days: variant.sales_count_30_days || 0,
                sales_60_days: variant.sales_count_60_days || 0
            }
        });
    });
    
    // Ordenar por talla
    sizes.sort((a, b) => {
        const sizeA = parseFloat(a.size.replace('US ', ''));
        const sizeB = parseFloat(b.size.replace('US ', ''));
        return sizeA - sizeB;
    });
    
    console.log(`Processed ${sizes.length} sizes, ${sizes.filter(s => s.available).length} available`);
    return sizes;
}

// Datos de fallback cuando no hay API
function createFallbackData(queryParam, isIdQuery = false) {
    console.log(`Creating fallback data for: ${queryParam}`);
    
    const fallbackTitle = isIdQuery ? `Zapatilla ${queryParam.slice(-1)}` : `Producto ${queryParam}`;
    
    return {
        sku: queryParam,
        title: fallbackTitle,
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=700&h=500&fit=crop',
        lastUpdated: new Date().toISOString(),
        regularPrice: 120.00,
        sizes: generateFallbackSizes(),
        _fallback: true,
        _message: 'Datos de demostración - API no disponible'
    };
}

// Generación de tallas de fallback realistas
function generateFallbackSizes() {
    const sizeRange = ['6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '15'];
    const basePrice = 120;
    
    return sizeRange.map(size => {
        const sizeFloat = parseFloat(size);
        
        // Probabilidad de disponibilidad basada en popularidad
        let availabilityChance = 0.65;
        if (sizeFloat >= 8 && sizeFloat <= 11) {
            availabilityChance = 0.35; // Tallas populares menos disponibles
        } else if (sizeFloat >= 13.5) {
            availabilityChance = 0.80; // Tallas grandes más disponibles
        }
        
        const available = Math.random() < availabilityChance;
        
        // Variación de precio
        let priceMultiplier = 1.0;
        if (sizeFloat <= 7 || sizeFloat >= 13.5) {
            priceMultiplier = 1.20 + (Math.random() * 0.40); // +20% a +60%
        } else if (sizeFloat >= 8 && sizeFloat <= 10.5) {
            priceMultiplier = 1.10 + (Math.random() * 0.30); // +10% a +40%
        } else {
            priceMultiplier = 0.95 + (Math.random() * 0.25); // -5% a +20%
        }
        
        const finalPrice = available ? parseFloat((basePrice * priceMultiplier).toFixed(2)) : 0;
        
        return {
            size: `US ${size}`,
            price: finalPrice,
            available: available
        };
    });
}

// Limpieza automática de cache
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > CACHE_TTL * 5) {
            cache.delete(key);
            console.log(`Cache entry expired: ${key}`);
        }
    }
}, 5 * 60 * 1000);
