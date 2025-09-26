// KicksDB Netlify Function - Node 18 with native fetch
// Handles product data fetching with memory caching

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
  // Extract basic product info
  const title = data.title || data.name || data.product_name || 'Unknown Product';
  const image = data.image || data.thumbnail || data.media?.[0]?.imageUrl || '';
  const lastUpdated = data.updated_at || data.last_updated || new Date().toISOString();
  
  // Determine regular price (fallback hierarchy)
  // Priority: retailPrice > msrp > basePrice > lowestAsk > price
  let regularPrice = 0;
  if (data.retailPrice) {
    regularPrice = parseFloat(data.retailPrice);
  } else if (data.msrp) {
    regularPrice = parseFloat(data.msrp);
  } else if (data.basePrice) {
    regularPrice = parseFloat(data.basePrice);
  } else if (data.lowestAsk) {
    regularPrice = parseFloat(data.lowestAsk);
  } else if (data.price) {
    regularPrice = parseFloat(data.price);
  }
  
  // Extract sizes information
  let sizes = [];
  
  if (data.variants && Array.isArray(data.variants)) {
    // If variants array exists
    sizes = data.variants.map(variant => ({
      size: variant.size || variant.us_size || `US ${variant.size_us}` || 'Unknown',
      price: parseFloat(variant.price || variant.lowest_ask || regularPrice),
      available: variant.available !== false && variant.stock > 0
    }));
  } else if (data.sizes && Array.isArray(data.sizes)) {
    // If direct sizes array exists
    sizes = data.sizes.map(sizeData => ({
      size: sizeData.size || sizeData.us_size || `US ${sizeData.size_us}` || 'Unknown',
      price: parseFloat(sizeData.price || sizeData.lowest_ask || regularPrice),
      available: sizeData.available !== false && (sizeData.stock === undefined || sizeData.stock > 0)
    }));
  } else if (data.asks && Array.isArray(data.asks)) {
    // If asks array exists (StockX format)
    sizes = data.asks.map(ask => ({
      size: ask.size || ask.shoe_size || 'Unknown',
      price: parseFloat(ask.price || ask.amount || regularPrice),
      available: true // If ask exists, it's available
    }));
  } else {
    // Fallback: create common sizes with regular price
    const commonSizes = ['US 7', 'US 8', 'US 9', 'US 10', 'US 11', 'US 12'];
    sizes = commonSizes.map(size => ({
      size,
      price: regularPrice,
      available: true
    }));
  }
  
  return {
    sku: cleanSku(sku),
    title,
    image,
    lastUpdated,
    regularPrice,
    sizes
  };
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
      body: JSON.stringify({ error: 'Server configuration error' })
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
    
    // KicksDB Standard API call
    // Note: Endpoint may need adjustment based on actual KicksDB API documentation
    // Common patterns for sneaker APIs: /product/{sku}, /products/{sku}, /standard/{sku}
    const apiUrl = `https://api.kicks.dev/standard/product/${encodeURIComponent(cleanedSku)}`;
    
    console.log(`Fetching from KicksDB: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Courts-Netlify-Function/1.0'
      }
    });

    // Handle different response status codes
    if (response.status === 401 || response.status === 403) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (response.status === 429) {
      return {
        statusCode: 429,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ error: 'Rate limited' })
      };
    }

    if (response.status >= 500) {
      return {
        statusCode: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        },
        body: JSON.stringify({ error: 'Upstream error' })
      };
    }

    if (!response.ok) {
      throw new Error(`API responded with status: ${response.status}`);
    }

    const rawData = await response.json();
    console.log(`Raw KicksDB response for ${cleanedSku}:`, JSON.stringify(rawData, null, 2));

    // Normalize the response to our expected format
    const normalizedData = normalizeKicksDbResponse(rawData, sku);

    // Cache the normalized data
    cache.set(cacheKey, {
      data: normalizedData,
      timestamp: Date.now()
    });

    console.log(`Cached normalized data for ${cacheKey}`);

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
    console.error('Error fetching from KicksDB:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ 
        error: 'Failed to fetch product data',
        details: error.message 
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
