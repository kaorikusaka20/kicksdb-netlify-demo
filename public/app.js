// En la sección de API Functions, reemplaza fetchProductData:
async function fetchProductData(sku) {
    try {
        const response = await fetch(`/.netlify/functions/kicksdb?sku=${encodeURIComponent(sku)}&market=US`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        // Mostrar info de datos en tiempo real
        if (data._source === 'KicksDB Pro') {
            console.log(`✅ Datos en tiempo real para: ${data.title}`);
            if (data._features) {
                console.log(`📊 Características:`, data._features);
            }
        }
        
        return data;
    } catch (error) {
        console.error(`Error fetching product ${sku}:`, error);
        throw error;
    }
}

// En loadAllProducts, mejora el manejo de errores:
async function loadAllProducts() {
    showLoading(true);
    showStatus('Conectando con KicksDB Pro (Tiempo Real)...', 'loading');
    
    const loadPromises = PRODUCTS.map(async product => {
        try {
            const data = await fetchProductData(product.sku);
            __PRODUCT_CACHE[product.sku] = data;
            
            // Verificar calidad de datos
            if (data._source) {
                console.log(`✅ ${product.name}: ${data._source}`);
            } else {
                console.log(`⚠️ ${product.name}: Usando datos básicos`);
            }
            
        } catch (error) {
            console.error(`Failed to load ${product.name}:`, error);
            // Crear datos de fallback mejorados
            __PRODUCT_CACHE[product.sku] = createEnhancedFallback(product);
        }
    });
    
    await Promise.all(loadPromises);
    hideStatus();
    showLoading(false);
    renderCatalog();
}

// Función de fallback mejorada
function createEnhancedFallback(product) {
    const basePrices = {
        'Anta Kai 1 Jelly': 120.00,
        'Anta Kai 2 Triple Black': 135.00, 
        'Anta Kai Hélà White': 125.00
    };
    
    const basePrice = basePrices[product.name] || 120.00;
    
    return {
        sku: product.sku,
        title: product.name,
        image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&h=500&fit=crop',
        lastUpdated: new Date().toISOString(),
        regularPrice: basePrice,
        sizes: [
            { size: 'US 8', price: basePrice, available: true },
            { size: 'US 8.5', price: basePrice + 5, available: true },
            { size: 'US 9', price: basePrice + 10, available: true },
            { size: 'US 9.5', price: basePrice + 5, available: false },
            { size: 'US 10', price: basePrice, available: true }
        ],
        _fallback: true,
        _message: 'Datos de respaldo - Verifique conexión API'
    };
}
