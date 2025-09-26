// KicksDB Real API Integration - Netlify Function
// ONLY uses real KicksDB data - NO FALLBACKS

// In-memory cache with TTL (600s = 10 minutes)
const cache = new Map();
const CACHE_TTL = 600 * 1000; // 600 seconds in milliseconds

// Helper function to clean SKU (remove spaces around "/")
function cleanSku(sku) {
  return sku.split('/').map(part => part.trim()).join('/');
}

// Helper function to get cache key
function getCacheKey(sku, market = 'US') {
  return `${cleanSku(sku)}-${market}`;
}

// Helper function to check if cache is valid
function isCacheValid(cacheEntry) {
  return cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL);
}

// Helper function to normalize KicksDB response to our format
function normalizeKicksDbResponse(data, sku) {
  console.log('Normalizing KicksDB response:', JSON.stringify(data, null, 2));
  
  // Extract basic product info with multiple fallbacks
  const title = data.title || data.name || data.product_name || data.productName || 'Unknown Product';
  const image = data.image || data.thumbnail || data.imageUrl || data.media?.[0]?.imageUrl || data.images?.[0];
  const lastUpdated = data.updated_at || data.lastUpdated || data.last_updated || new Date().toISOString();
  
  // Determine regular price (fallback hierarchy)
  // Priority: retailPrice > msrp > basePrice > lowestAsk > price > averagePrice
  let regularPrice = null;
  
  if (data.retailPrice && !isNaN(parseFloat(data.retailPrice))) {
    regularPrice = parseFloat(data.retailPrice);
    console.log('Using retailPrice:', regularPrice);
  } else if (data.msrp && !isNaN(parseFloat(data.msrp))) {
    regularPrice = parseFloat(data.msrp);
    console.log('Using msrp:', regularPrice);
  } else if (data.basePrice && !isNaN(parseFloat(data.basePrice))) {
    regularPrice = parseFloat(data.basePrice);
    console.log('Using basePrice:', regularPrice);
  } else if (data.lowestAsk && !isNaN(parseFloat(data.lowestAsk))) {
    regularPrice = parseFloat(data.lowestAsk);
    console.log('Using lowestAsk:', regularPrice);
  } else if (data.price && !isNaN(parseFloat(data.price))) {
    regularPrice = parseFloat(data.price);
    console.log('Using price:', regularPrice);
  } else if (data.averagePrice && !isNaN(parseFloat(data.averagePrice))) {
    regularPrice = parseFloat(data.averagePrice);
    console.log('Using averagePrice:', regularPrice);
  }
  
  if (!regularPrice) {
    throw new Error('No valid price found in API response');
  }
  
  // Extract sizes information with multiple format support
  let sizes = [];
  
  if (data.variants && Array.isArray(data.variants)) {
    console.log('Processing variants array');
    sizes = data.variants.map(variant => ({
      size: variant.size || variant.us_size || variant.usSize || `US ${variant.size_us || variant.sizeUs}` || 'Unknown',
      price: parseFloat(variant.price || variant.lowest_ask || variant.lowestAsk || variant.ask || regularPrice),
      available: variant.available !== false && (variant.stock === undefined || variant.stock > 0)
    }));
  } else if (data.sizes && Array.isArray(data.sizes)) {
    console.log('Processing sizes array');
    sizes = data.sizes.map(sizeData => ({
      size: sizeData.size || sizeData.us_size || sizeData.usSize || `US ${sizeData.size_us || sizeData.sizeUs}` || 'Unknown',
      price: parseFloat(sizeData.price || sizeData.lowest_ask || sizeData.lowestAsk || sizeData.ask || regularPrice),
      available: sizeData.available !== false && (sizeData.stock === undefined || sizeData.stock > 0)
    }));
  } else if (data.asks && Array.isArray(data.asks)) {
    console.log('Processing asks array (StockX format)');
    sizes = data.asks.map(ask => ({
      size: ask.size || ask.shoe_size || ask.shoeSize || 'Unknown',
      price: parseFloat(ask.price || ask.amount || regularPrice),
      available: true // If ask exists, it's available
    }));
  } else if (data.bids && Array.isArray(data.bids)) {
    console.log('Processing bids array');
    sizes = data.bids.map(bid => ({
      size: bid.size || bid.shoe_size || bid.shoeSize || 'Unknown',
      price: parseFloat(bid.price || bid.amount || regularPrice),
      available: true
    }));
  }
  
  // Filter out invalid sizes
  sizes = sizes.filter(size => size.size && size.size !== 'Unknown' && !isNaN(size.price));
  
  if (sizes.length === 0) {
    throw new Error('No valid sizes found in API response');
  }
  
  const normalized = {
    sku: cleanSku(sku),
    title,
    image,
    lastUpdated,
    regularPrice,
    sizes
  };
  
  console.log('Normalized response:', JSON.stringify(normalized, null, 2));
  return normalized;
}

// Main handler function
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
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
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
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ error: 'SKU parameter is required' })
    };
  }

  // Check API key
  const apiKey = process.env.KICKSDB_API_KEY;
  if (!apiKey) {
    console.error('KICKSDB_API_KEY environment variable not set');
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ error: 'Server configuration error - API key not configured' })
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
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(cachedData.data)
    };
  }

  try {
    // Clean the SKU for the API call
    const cleanedSku = cleanSku(sku);
    console.log(`Attempting to fetch product from KicksDB: ${cleanedSku}`);
    
    // Try official KicksDB API endpoints based on their documentation
    const possibleEndpoints = [
      // Standard API endpoint (most likely)
      `https://api.kicks.dev/v1/products/${encodeURIComponent(cleanedSku)}`,
      `https://api.kicks.dev/v1/product/${encodeURIComponent(cleanedSku)}`,
      // Alternative Standard API
      `https://api.kicks.dev/standard/products/${encodeURIComponent(cleanedSku)}`,
      `https://api.kicks.dev/standard/product/${encodeURIComponent(cleanedSku)}`,
      // Unified API endpoint
      `https://api.kicks.dev/unified/products/${encodeURIComponent(cleanedSku)}`,
      `https://api.kicks.dev/unified/product/${encodeURIComponent(cleanedSku)}`,
      // Search endpoint as fallback
      `https://api.kicks.dev/v1/search?q=${encodeURIComponent(cleanedSku)}&limit=1`
    ];
    
    let response = null;
    let usedEndpoint = null;
    let responseData = null;
    
    // Try each endpoint until one works
    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`Trying KicksDB endpoint: ${endpoint}`);
        
        response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            'User-Agent': 'Courts-Netlify-Function/1.0',
            'Accept': 'application/json'
          }
        });
        
        console.log(`Response status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          const responseText = await response.text();
          console.log(`Raw response (first 500 chars):`, responseText.substring(0, 500));
          
          // Check if response is JSON
          if (responseText.trim().startsWith('{') || responseText.trim().startsWith('[')) {
            try {
              responseData = JSON.parse(responseText);
              usedEndpoint = endpoint;
              console.log(`Success with endpoint: ${endpoint}`);
              break;
            } catch (jsonError) {
              console.log(`JSON parse error with ${endpoint}:`, jsonError.message);
              continue;
            }
          } else {
            console.log(`Non-JSON response from ${endpoint}`);
            continue;
          }
        } else {
          const errorText = await response.text();
          console.log(`Failed with ${endpoint}: ${response.status} - ${response.statusText}`);
          console.log(`Error response:`, errorText.substring(0, 200));
        }
      } catch (endpointError) {
        console.log(`Error with ${endpoint}:`, endpointError.message);
        continue;
      }
    }
    
    if (!responseData) {
      console.error('All KicksDB endpoints failed');
      return {
        statusCode: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ 
          error: 'Unable to connect to KicksDB API',
          message: 'All API endpoints returned invalid responses. Please check your API key and SKU format.',
          sku: cleanedSku,
          endpoints_tried: possibleEndpoints.length
        })
      };
    }

    console.log(`Processing KicksDB response for ${cleanedSku}:`, JSON.stringify(responseData, null, 2));

    // Handle search endpoint response (array)
    if (Array.isArray(responseData)) {
      if (responseData.length === 0) {
        return {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store'
          },
          body: JSON.stringify({ 
            error: 'Product not found',
            sku: cleanedSku,
            message: 'No products found matching this SKU'
          })
        };
      }
      // Use the first search result
      responseData = responseData[0];
    }

    // Normalize the response to our expected format
    const normalizedData = normalizeKicksDbResponse(responseData, sku);

    // Cache the normalized data
    cache.set(cacheKey, {
      data: normalizedData,
      timestamp: Date.now()
    });

    console.log(`Successfully cached data for ${cacheKey}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(normalizedData)
    };

  } catch (error) {
    console.error('Error processing KicksDB response:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ 
        error: 'API processing error',
        message: error.message,
        sku: cleanSku(sku)
      })
    };
  }
};

// Cleanup old cache entries periodically (runs every 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key);
      console.log(`Cleaned up expired cache entry: ${key}`);
    }
  }
}, 10 * 60 * 1000);
